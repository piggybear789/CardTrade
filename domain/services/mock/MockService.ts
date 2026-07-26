// domain/services/mock/MockService.ts
//
// The deterministic Mock_Service for the hackathon MVP. It implements the
// PaymentService, KycService, and WebhookEmitter contracts from
// `domain/services/types.ts`, simulating the Pinch Payments REST API and Pinch
// Glassbox KYC without any real payment processing.
//
// Design goals (see design.md - "MockService (this phase)"):
//   * DETERMINISTIC - given the same inputs it produces the same outputs.
//     Success/failure outcomes are driven by an explicit `scenario` control (a
//     default outcome plus per-ref/per-hold overrides), NEVER by randomness, so
//     demos and tests are reproducible. All ids are derived from their inputs
//     via a stable hash rather than random UUIDs, and all timestamps come from
//     an injectable clock.
//   * WEBHOOK-EMITTING - after a payment/KYC operation the Mock constructs the
//     corresponding WebhookEvent and either emits it immediately (auto mode) or
//     enqueues it for the caller/UI to fire manually (the default). Emission
//     POSTs a signed envelope to the configured `webhookUrl`, exercising the
//     exact code path a real Pinch webhook would.
//   * SIGNATURE-STUBBED - webhook payloads are signed with a shared secret using
//     HMAC-SHA256 over the raw body, producing the same header contract the real
//     Pinch integration will verify (Req 10.1, 10.2).
//
// This module is server-side only (it uses `node:crypto` and `fetch`); it is
// intentionally kept out of the pure state-machine/validation core.

import { createHash, createHmac } from 'node:crypto';

import type {
  CaptureResult,
  Cents,
  KycResult,
  KycService,
  ManagedMerchant,
  ManagedMerchantDetails,
  Payer,
  PayerCreateOptions,
  PayerDetails,
  PaymentService,
  PreAuthHold,
  SignedWebhookEnvelope,
  TransferResult,
  VerifiedIdentity,
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
 * constant so both the emitter (Mock now / Pinch later) and the handler agree
 * on the contract.
 */
export const PINCH_SIGNATURE_HEADER = 'x-pinch-signature';

/** The HTTP header carrying the idempotency key (the Webhook_Event id, Req 10.5). */
export const PINCH_EVENT_ID_HEADER = 'x-pinch-event-id';

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
export class MockService implements PaymentService, KycService, WebhookEmitter {
  private readonly transport: WebhookTransport;

  /** Provider payer keyed by owning profile id. */
  private readonly payersByProfile = new Map<string, Payer>();
  /** Reverse lookup: profile id keyed by payer id (for KYC + webhook payloads). */
  private readonly profileByPayer = new Map<string, string>();
  /** Stored verified identity data, populated on a VERIFIED run (Req 2.5, 8.4). */
  private readonly identities = new Map<string, VerifiedIdentity>();
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
   * real Pinch binding and deliberately ignored: the Mock derives ids from the
   * profile id alone so results stay reproducible.
   */
  async createPayer(
    profileId: string,
    _details?: PayerDetails,
    options?: PayerCreateOptions,
  ): Promise<Payer> {
    // A payer is scoped to the merchant it was created under, so the simulated id
    // includes the sub-merchant when one is targeted - mirroring the real
    // provider, where the same Profile has a distinct payer per merchant.
    const key = options?.merchantRef ? `${profileId}@${options.merchantRef}` : profileId;
    const existing = this.payersByProfile.get(key);
    if (existing) return existing;
    const payer: Payer = { payerId: `payer_${shortHash(key)}`, profileId };
    this.payersByProfile.set(key, payer);
    this.profileByPayer.set(payer.payerId, profileId);
    return payer;
  }

  /**
   * Simulate opening a sub-merchant. Deterministic id, and every enable flag
   * false - matching the real provider, where approval arrives later via a
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

  /** Run identity verification, resolving VERIFIED or REJECTED per the scenario (Req 2.2, 2.3). */
  async runVerification(payerId: string): Promise<KycResult> {
    const outcome = this.opts.scenario?.kycOutcome ?? 'VERIFIED';
    const profileId = this.profileByPayer.get(payerId);

    if (outcome === 'VERIFIED') {
      if (profileId) {
        this.identities.set(profileId, this.buildIdentity(profileId));
      }
      const result: KycResult = { payerId, outcome: 'VERIFIED' };
      await this.dispatch(
        this.makeEvent('kyc.verified', `kyc:${payerId}:verified`, { payerId, profileId }),
      );
      return result;
    }

    const reason = this.opts.scenario?.kycReason ?? 'Identity could not be verified';
    const result: KycResult = { payerId, outcome: 'REJECTED', reason };
    await this.dispatch(
      this.makeEvent('kyc.rejected', `kyc:${payerId}:rejected`, { payerId, profileId, reason }),
    );
    return result;
  }

  /** Retrieve stored verified identity data for a Police_Evidence_Pack (Req 2.5, 8.4). */
  async getVerifiedIdentity(profileId: string): Promise<VerifiedIdentity | null> {
    return this.identities.get(profileId) ?? null;
  }

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
   * keeping the demo flow identical to the real Pinch path.
   */
  async attachPaymentSource(params: {
    payerId: string;
    token: string;
    sourceType: 'credit-card' | 'bank-account';
  }): Promise<{ sourceId: string }> {
    return { sourceId: `src_${shortHash(`${params.payerId}:${params.sourceType}:${params.token}`)}` };
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

  /** Capture a fixed portion of a hold - the Friction_Tax (Req 7.2). */
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
        [PINCH_SIGNATURE_HEADER]: envelope.signature,
        [PINCH_EVENT_ID_HEADER]: envelope.event.eventId,
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

  /** Deterministic verified-identity data derived from the profile id (Req 2.5). */
  private buildIdentity(profileId: string): VerifiedIdentity {
    const suffix = shortHash(profileId).toUpperCase();
    return {
      profileId,
      legalName: `Mock User ${suffix.slice(0, 6)}`,
      dateOfBirth: '1990-01-01',
      documentType: 'DRIVERS_LICENSE',
      documentNumber: `DL-${suffix}`,
      verifiedAt: this.now().toISOString(),
    };
  }

  /** The current time from the injected clock, or a deterministic counter clock. */
  private now(): Date {
    if (this.opts.clock) return this.opts.clock();
    return new Date(DEFAULT_CLOCK_BASE_MS + this.tick++ * 1000);
  }
}
