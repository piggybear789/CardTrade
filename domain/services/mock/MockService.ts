// domain/services/mock/MockService.ts
//
// The deterministic Mock_Service for the hackathon MVP. It implements the
// PaymentService, KycService, and WebhookEmitter contracts from
// `domain/services/types.ts`, simulating the Stripe REST API and Stripe
// Glassbox KYC without any real payment processing.
//
// Design goals (see design.md — "MockService (this phase)"):
//   * DETERMINISTIC — given the same inputs it produces the same outputs.
//     Success/failure outcomes are driven by an explicit `scenario` control (a
//     default outcome plus per-ref/per-hold overrides), NEVER by randomness, so
//     demos and tests are reproducible. All ids are derived from their inputs
//     via a stable hash rather than random UUIDs, and all timestamps come from
//     an injectable clock.
//   * WEBHOOK-EMITTING — after a payment/KYC operation the Mock constructs the
//     corresponding WebhookEvent and either emits it immediately (auto mode) or
//     enqueues it for the caller/UI to fire manually (the default). Emission
//     POSTs a signed envelope to the configured `webhookUrl`, exercising the
//     exact code path a real Stripe webhook would.
//   * SIGNATURE-STUBBED — webhook payloads are signed with a shared secret using
//     HMAC-SHA256 over the raw body, producing the same header contract the real
//     Stripe integration will verify (Req 10.1, 10.2).
//
// This module is server-side only (it uses `node:crypto` and `fetch`); it is
// intentionally kept out of the pure state-machine/validation core.

import { createHash, createHmac } from 'node:crypto';

import type {
  CaptureResult,
  Cents,
  InstrumentSetup,
  ManagedMerchant,
  ManagedMerchantDetails,
  IdentityCheck,
  IdentityCheckOutcome,
  Payer,
  PayerService,
  PayerCreateOptions,
  PayerDetails,
  PaymentService,
  PlatformBalance,
  PreAuthHold,
  RefundResult,
  SignedWebhookEnvelope,
  TransferResult,
  VaultedInstrument,
  WebhookEmitter,
  WebhookEvent,
  WebhookEventPayload,
  WebhookEventType,
} from '../types';

// ---------------------------------------------------------------------------
// Webhook header contract
// ---------------------------------------------------------------------------

/**
 * The HTTP header carrying the HMAC signature of the webhook body. The
 * Webhook_Handler recomputes the HMAC over the raw body and compares it to this
 * header before applying any state change (Req 10.1, 10.2). Kept as a shared
 * constant so both the emitter (Mock now / Stripe later) and the handler agree
 * on the contract.
 */
export const MOCK_SIGNATURE_HEADER = 'x-mock-signature';

/** The HTTP header carrying the idempotency key (the Webhook_Event id, Req 10.5). */
export const MOCK_EVENT_ID_HEADER = 'x-stripe-event-id';

/**
 * Compute the webhook signature: an HMAC-SHA256 (hex) over the exact raw body
 * bytes using the shared secret. Exported so the Webhook_Handler can recompute
 * an identical value for authenticity verification.
 */
export function signWebhookBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Scenario / options
// ---------------------------------------------------------------------------

/** A forced outcome for a simulated payment operation. */
export type MockOutcome = 'SUCCESS' | 'FAILURE';

/**
 * The explicit control surface that makes the Mock deterministic. Nothing here
 * is random: an operation's outcome is resolved as
 *   `outcomes[key]` → `forceFailure[key]` → `defaultOutcome` → 'SUCCESS'
 * where `key` is the operation `ref` (transfers/holds) or the `holdId`
 * (voids/captures). KYC outcomes are controlled separately.
 */
export interface MockScenario {
  /** Fallback outcome for payment operations with no matching override. Default 'SUCCESS'. */
  defaultOutcome?: MockOutcome;
  /** Explicit per-key outcomes; highest precedence. Keyed by operation `ref` or `holdId`. */
  outcomes?: Record<string, MockOutcome>;
  /** Convenience per-key force-failure toggle (equivalent to `outcomes[key] = 'FAILURE'`). */
  forceFailure?: Record<string, boolean>;
  /** Forced KYC verification outcome. Default 'VERIFIED'. */
  kycOutcome?: 'VERIFIED' | 'REJECTED';
  /** Reason recorded against the Profile on a rejected KYC outcome (Req 2.3). */
  kycReason?: string;
  /**
   * When true, each operation emits its WebhookEvent immediately (auto mode).
   * When false (default) events are enqueued for manual emission via `flush()`
   * or `emit()`, so the demo UI drives when transitions fire.
   */
  autoEmit?: boolean;
}

/**
 * A minimal fetch-like transport so tests can inject a fake and capture the
 * POSTed webhooks without real HTTP. The default binding uses the global
 * `fetch`. The return value is ignored beyond being awaited.
 */
export type WebhookTransport = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<unknown>;

export interface MockServiceOptions {
  /** Where signed Webhook_Events are POSTed (the Webhook_Handler route). */
  webhookUrl: string;
  /** Shared secret used to sign webhook bodies (the signature stub). */
  secret: string;
  /** Deterministic outcome/emission control. Omitted → all-success, manual emission. */
  scenario?: MockScenario;
  /** Injectable transport for tests; defaults to the global `fetch`. */
  fetchFn?: WebhookTransport;
  /** Injectable clock for deterministic timestamps; defaults to a monotonic counter clock. */
  clock?: () => Date;
}

// ---------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------

/** A stable, collision-resistant short id derived from an input string. */
function shortHash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 16);
}

/** Fixed base epoch for the default counter clock (2025-01-01T00:00:00Z). */
const DEFAULT_CLOCK_BASE_MS = Date.parse('2025-01-01T00:00:00.000Z');

// ---------------------------------------------------------------------------
// MockService
// ---------------------------------------------------------------------------

/**
 * Deterministic in-memory implementation of the payment + KYC + webhook
 * contracts. A single instance holds the simulated provider state (payers,
 * holds, verified identities) and a queue of pending Webhook_Events.
 */
export class MockService implements PaymentService, PayerService, WebhookEmitter {
  private readonly transport: WebhookTransport;

  /** Provider payer keyed by owning profile id. */
  private readonly payersByProfile = new Map<string, Payer>();
  /** Reverse lookup: profile id keyed by payer id (for KYC + webhook payloads). */
  private readonly profileByPayer = new Map<string, string>();
  /** Simulated verification session id keyed by profile id. */
  private readonly identityByProfile = new Map<string, string>();
  /** Reverse lookup: profile id keyed by verification session id. */
  private readonly profileByIdentity = new Map<string, string>();
  /** Demo-driven outcome per verification session; absent means PENDING. */
  private readonly identityOutcomes = new Map<string, IdentityCheckOutcome>();
  /** Simulated hold ledger keyed by hold id. */
  private readonly holds = new Map<string, PreAuthHold>();
  /** Events awaiting manual emission (when `scenario.autoEmit` is false). */
  private readonly queue: WebhookEvent[] = [];

  /** Monotonic tick backing the default counter clock. */
  private tick = 0;

  constructor(private readonly opts: MockServiceOptions) {
    this.transport = opts.fetchFn ?? ((url, init) => fetch(url, init));
  }

  // -------------------------------------------------------------------------
  // KycService
  // -------------------------------------------------------------------------

  /**
   * Create a provider payer for a Profile (Req 2.1). Deterministic id, no
   * webhook. `_details` (name/email) is accepted for contract parity with the
   * real Stripe binding and deliberately ignored: the Mock derives ids from the
   * profile id alone so results stay reproducible.
   */
  async createPayer(
    profileId: string,
    _details?: PayerDetails,
    options?: PayerCreateOptions,
  ): Promise<Payer> {
    // A payer is scoped to the merchant it was created under, so the simulated id
    // includes the sub-merchant when one is targeted — mirroring the real
    // provider, where the same Profile has a distinct payer per merchant.
    const key = options?.merchantRef ? `${profileId}@${options.merchantRef}` : profileId;
    const existing = this.payersByProfile.get(key);
    if (existing) return existing;
    const payer: Payer = { payerId: `payer_${shortHash(key)}`, profileId };
    this.payersByProfile.set(key, payer);
    this.profileByPayer.set(payer.payerId, profileId);
    return payer;
  }

  // -------------------------------------------------------------------------
  // Identity verification — the Identity_Gate (0069)
  // -------------------------------------------------------------------------

  /**
   * Simulate opening a verification session.
   *
   * Lands PENDING, never VERIFIED — matching the real provider, where the member
   * has to complete Stripe's hosted pages and the outcome arrives afterwards by
   * webhook or read-back. A mock that returned VERIFIED immediately would let local
   * development pass a gate that production makes you earn, which is precisely the
   * 0060 shape of mistake.
   *
   * The demo drives the outcome with an `identity.verification_session.verified`
   * event, the same way it drives Connect approval.
   */
  async createIdentityCheck(params: {
    profileId: string;
    returnUrl: string;
  }): Promise<IdentityCheck> {
    const sessionId = `vs_${shortHash(params.profileId)}`;
    this.identityByProfile.set(params.profileId, sessionId);
    this.profileByIdentity.set(sessionId, params.profileId);

    return {
      sessionId,
      outcome: 'PENDING',
      verifiedName: null,
      verifiedAt: null,
      // Back to the caller's own return URL: there is no provider page to host, and
      // sending the member somewhere that does not exist would break the local flow.
      hostedUrl: params.returnUrl,
      failureReason: null,
    };
  }

  /** Read back a simulated session. Reflects whatever the demo has driven it to. */
  async readIdentityCheck(sessionId: string): Promise<IdentityCheck> {
    const outcome = this.identityOutcomes.get(sessionId) ?? 'PENDING';
    const profileId = this.profileByIdentity.get(sessionId);
    const verified = outcome === 'VERIFIED';

    return {
      sessionId,
      outcome,
      // A deterministic stand-in for a document-backed name, so the disclosure path
      // is exercisable locally.
      verifiedName: verified ? `Mock Member ${shortHash(profileId ?? sessionId)}` : null,
      verifiedAt: verified ? new Date().toISOString() : null,
      hostedUrl: null,
      failureReason: outcome === 'FAILED' ? 'document_unverified_other' : null,
    };
  }

  /**
   * Demo control: drive a simulated session to an outcome.
   *
   * NOT part of the production contract — the real binding learns outcomes from
   * Stripe. Exposed so the demo panel can exercise the verified and failed branches
   * without a real document.
   */
  setIdentityOutcome(sessionId: string, outcome: IdentityCheckOutcome): void {
    this.identityOutcomes.set(sessionId, outcome);
  }

  /**
   * Simulate opening a sub-merchant. Deterministic id, and every enable flag
   * false — matching the real provider, where approval arrives later via a
   * compliance webhook. The demo can drive that with a
   * `merchant.compliance.updated` event.
   */
  async createManagedMerchant(details: ManagedMerchantDetails): Promise<ManagedMerchant> {
    return {
      merchantRef: `mch_${shortHash(`${details.legalEntityName}:${details.businessEmail}`)}`,
      complianceStatus: 'new',
      liveEnabled: false,
      transactionsEnabled: false,
      settlementsEnabled: false,
    };
  }

  // `runVerification` used to live here, resolving VERIFIED or REJECTED from a
  // scenario flag and emitting `kyc.verified` / `kyc.rejected`. It is gone: this
  // was the simulation that stood in for a real provider check, and identity is
  // now the Identity_Gate, which is Connect onboarding state rather than a call.


  // -------------------------------------------------------------------------
  // PaymentService
  // -------------------------------------------------------------------------

  /**
   * Request a bank-to-bank transfer of `amount` (Req 4.2, 8.3). `merchantRef` and
   * `applicationFee` are accepted for contract parity with the real provider
   * (which routes settlement to the sub-merchant and retains the platform fee)
   * and do not change the simulated outcome.
   */
  async requestTransfer(params: {
    payerId: string;
    amount: Cents;
    ref: string;
    nonce: string;
    merchantRef?: string;
    applicationFee?: Cents;
  }): Promise<TransferResult> {
    const ok = this.resolveOutcome(params.ref) === 'SUCCESS';
    const result: TransferResult = {
      transferId: `transfer_${shortHash(params.ref)}`,
      amount: params.amount,
      status: ok ? 'SETTLED' : 'FAILED',
    };
    await this.dispatch(
      this.makeEvent(ok ? 'transfer.settled' : 'transfer.failed', `transfer:${params.ref}`, {
        transferId: result.transferId,
        amount: result.amount,
        status: result.status,
        ...(ok ? {} : { reason: 'Transfer failed to settle' }),
      }),
    );
    return result;
  }

  /**
   * Release escrowed funds from the simulated platform balance to a Seller
   * (Req 4.3). Charges no payer, mirroring the real binding — the Buyer was
   * already debited when the sale was agreed.
   */
  async payoutToMerchant(params: {
    merchantRef: string;
    amount: Cents;
    ref: string;
    nonce: string;
    sourcePaymentRef?: string;
  }): Promise<TransferResult> {
    const ok = this.resolveOutcome(params.ref) === 'SUCCESS';
    const result: TransferResult = {
      transferId: `payout_${shortHash(params.ref)}`,
      amount: params.amount,
      status: ok ? 'SETTLED' : 'FAILED',
    };
    await this.dispatch(
      this.makeEvent(ok ? 'transfer.settled' : 'transfer.failed', `payout:${params.ref}`, {
        transferId: result.transferId,
        amount: result.amount,
        status: result.status,
        ...(ok ? {} : { reason: 'Seller payout failed to settle' }),
      }),
    );
    return result;
  }

  /**
   * Report a simulated platform balance.
   *
   * Deliberately reports UNAVAILABLE rather than inventing a figure. A number here
   * would make the reconciliation panel render a confident green "solvent" in mock
   * mode, which is precisely the reassurance nobody should get from simulated money.
   * "Unknown" is the honest answer when there is no real balance to read.
   */
  async getPlatformBalance(): Promise<PlatformBalance> {
    return {
      availableCents: 0,
      pendingCents: 0,
      currency: 'aud',
      status: 'UNAVAILABLE',
      reason: 'Mock provider holds no real balance',
    };
  }

  /**
   * Return collected funds to the Buyer (Req 4.15).
   *
   * Deterministic like every other Mock primitive: the outcome is derived from the
   * `ref` so a scenario can force a refund failure and exercise the compensating
   * path. Emits no Webhook_Event, matching the real binding — Stripe's refund
   * events are not translated, so a mock event here would teach callers to expect
   * a message production never sends.
   */
  async refundPayment(params: {
    paymentRef: string;
    amount?: Cents;
    nonce: string;
    ref?: string;
  }): Promise<RefundResult> {
    const label = params.ref ?? params.paymentRef;
    const ok = this.resolveOutcome(label) === 'SUCCESS';
    return {
      refundId: ok ? `re_${shortHash(label)}` : '',
      amount: params.amount ?? 0,
      status: ok ? 'SETTLED' : 'FAILED',
      ...(ok ? {} : { reason: 'Refund failed to settle' }),
    };
  }

  /** Place a 100%-FMV pre-auth hold on a payer's instrument (Req 5.4). */
  async placeHold(params: { payerId: string; amount: Cents; ref: string }): Promise<PreAuthHold> {
    const ok = this.resolveOutcome(params.ref) === 'SUCCESS';
    const hold: PreAuthHold = {
      holdId: `hold_${shortHash(params.ref)}`,
      payerId: params.payerId,
      amount: params.amount,
      status: ok ? 'ACTIVE' : 'FAILED',
    };
    this.holds.set(hold.holdId, hold);
    await this.dispatch(
      this.makeEvent(ok ? 'hold.active' : 'hold.failed', `hold:${params.ref}`, {
        holdId: hold.holdId,
        amount: hold.amount,
        status: hold.status,
        ...(ok ? {} : { reason: 'Pre-auth hold failed' }),
      }),
    );
    return hold;
  }

  /**
   * Vault a tokenised instrument against a payer. The Mock has no instruments to
   * store, so it just returns a deterministic source id derived from the inputs,
   * keeping the demo flow identical to the real Stripe path.
   */
  async attachPaymentSource(params: {
    payerId: string;
    token: string;
    sourceType: 'credit-card' | 'bank-account';
  }): Promise<{ sourceId: string }> {
    return { sourceId: `src_${shortHash(`${params.payerId}:${params.sourceType}:${params.token}`)}` };
  }

  // `getIdentitySummary` used to live here, returning a fixed "Demo Collector"
  // name. Removed with the payer gate: the only identity the platform holds now is
  // the provider-verified legal name Connect reports for a connected account.

  /**
   * Deterministic stand-in for a provider-hosted instrument capture flow. The
   * `clientSecret` is inert — no real SDK will accept it — so the mock UI shows
   * a simulated card entry step instead of mounting a provider iframe.
   */
  async beginInstrumentSetup(params: { payerId: string }): Promise<InstrumentSetup> {
    const setupId = `seti_${shortHash(`setup:${params.payerId}`)}`;
    return {
      setupId,
      clientSecret: `${setupId}_secret_mock`,
      // Recognisably fake, so a component that mounts a real SDK with this key
      // fails loudly in development rather than half-working.
      publishableKey: 'pk_test_mock',
    };
  }

  /** Complete the simulated setup, returning a stable fake card. */
  async completeInstrumentSetup(params: {
    payerId: string;
    setupId: string;
  }): Promise<VaultedInstrument> {
    return {
      sourceId: `src_${shortHash(`${params.payerId}:${params.setupId}`)}`,
      brand: 'visa',
      last4: '4242',
    };
  }

  /** Release a hold at $0 cost (Req 6.7, 7.5, 8.5). Voids always succeed. */
  async voidHold(holdId: string): Promise<PreAuthHold> {
    const existing = this.holds.get(holdId);
    const hold: PreAuthHold = {
      holdId,
      payerId: existing?.payerId ?? '',
      amount: existing?.amount ?? 0,
      status: 'VOIDED',
    };
    this.holds.set(holdId, hold);
    await this.dispatch(
      this.makeEvent('hold.voided', `void:${holdId}`, { holdId, status: 'VOIDED' }),
    );
    return hold;
  }

  /** Capture a fixed portion of a hold — the Friction_Tax (Req 7.2). */
  async partialCapture(params: { holdId: string; amount: Cents }): Promise<CaptureResult> {
    const ok = this.resolveOutcome(params.holdId) === 'SUCCESS';
    const result: CaptureResult = {
      captureId: `capture_${shortHash(`${params.holdId}:partial:${params.amount}`)}`,
      holdId: params.holdId,
      amount: params.amount,
      status: ok ? 'SETTLED' : 'FAILED',
    };
    if (ok) this.markHold(params.holdId, 'PARTIALLY_CAPTURED');
    await this.dispatch(
      this.makeEvent(ok ? 'capture.partial.settled' : 'capture.failed', `capture:partial:${params.holdId}:${params.amount}`, {
        captureId: result.captureId,
        holdId: result.holdId,
        amount: result.amount,
        status: result.status,
        ...(ok ? {} : { reason: 'Partial capture failed to settle' }),
      }),
    );
    return result;
  }

  /** Capture the entire hold amount on Objective_Fraud (Req 8.2). */
  async fullCapture(holdId: string): Promise<CaptureResult> {
    const ok = this.resolveOutcome(holdId) === 'SUCCESS';
    const amount = this.holds.get(holdId)?.amount ?? 0;
    const result: CaptureResult = {
      captureId: `capture_${shortHash(`${holdId}:full`)}`,
      holdId,
      amount,
      status: ok ? 'SETTLED' : 'FAILED',
    };
    if (ok) this.markHold(holdId, 'FULLY_CAPTURED');
    await this.dispatch(
      this.makeEvent(ok ? 'capture.full.settled' : 'capture.failed', `capture:full:${holdId}`, {
        captureId: result.captureId,
        holdId: result.holdId,
        amount: result.amount,
        status: result.status,
        ...(ok ? {} : { reason: 'Full capture failed to settle' }),
      }),
    );
    return result;
  }

  // -------------------------------------------------------------------------
  // WebhookEmitter + demo controls
  // -------------------------------------------------------------------------

  /**
   * Sign and POST a single Webhook_Event to the configured `webhookUrl`
   * (WebhookEmitter contract). This is the path the demo UI drives to fire a
   * simulated webhook manually.
   */
  async emit(event: WebhookEvent): Promise<void> {
    const envelope = this.buildEnvelope(event);
    await this.transport(this.opts.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [MOCK_SIGNATURE_HEADER]: envelope.signature,
        [MOCK_EVENT_ID_HEADER]: envelope.event.eventId,
      },
      body: envelope.rawBody,
    });
  }

  /** The events awaiting manual emission (snapshot copy). */
  pendingEvents(): WebhookEvent[] {
    return [...this.queue];
  }

  /** Emit every queued event in order and clear the queue. */
  async flush(): Promise<void> {
    const events = this.queue.splice(0, this.queue.length);
    for (const event of events) {
      await this.emit(event);
    }
  }

  /**
   * Build the signed delivery envelope for an event: the canonical JSON body
   * and its HMAC signature over the exact bytes. Exposed for tests and for the
   * Webhook_Handler to reason about the contract.
   */
  buildEnvelope(event: WebhookEvent): SignedWebhookEnvelope {
    const rawBody = JSON.stringify(event);
    return { event, rawBody, signature: signWebhookBody(rawBody, this.opts.secret) };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Auto-emit or enqueue depending on the scenario's emission mode. */
  private async dispatch(event: WebhookEvent): Promise<void> {
    if (this.opts.scenario?.autoEmit) {
      await this.emit(event);
    } else {
      this.queue.push(event);
    }
  }

  /** Resolve a deterministic outcome for an operation key. */
  private resolveOutcome(key: string): MockOutcome {
    const scenario = this.opts.scenario;
    if (scenario?.outcomes && key in scenario.outcomes) return scenario.outcomes[key];
    if (scenario?.forceFailure?.[key]) return 'FAILURE';
    return scenario?.defaultOutcome ?? 'SUCCESS';
  }

  /** Update a tracked hold's status if it exists in the ledger. */
  private markHold(holdId: string, status: PreAuthHold['status']): void {
    const existing = this.holds.get(holdId);
    if (existing) this.holds.set(holdId, { ...existing, status });
  }

  /** Construct a Webhook_Event with a deterministic id and timestamp. */
  private makeEvent(
    type: WebhookEventType,
    keyBase: string,
    payload: WebhookEventPayload,
  ): WebhookEvent {
    return {
      eventId: `evt_${shortHash(`${type}:${keyBase}`)}`,
      type,
      occurredAt: this.now().toISOString(),
      payload,
    };
  }


  /** The current time from the injected clock, or a deterministic counter clock. */
  private now(): Date {
    if (this.opts.clock) return this.opts.clock();
    return new Date(DEFAULT_CLOCK_BASE_MS + this.tick++ * 1000);
  }
}
