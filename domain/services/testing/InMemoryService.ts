// domain/services/testing/InMemoryService.ts
//
// A fast, deterministic in-memory fake implementing the same
// `PaymentService` / `KycService` (and `WebhookEmitter`) contracts as the
// MockService and the future StripeService. It exists purely for orchestrator
// unit/property tests (tasks 7.2, 7.5, 7.6, ...): the design's "Test
// Independence" note calls for testing the orchestrator against an in-memory
// fake so payment-dependent properties (15, 18, 19, 21) stay fast and
// deterministic.
//
// Differences from the MockService (deliberate, to keep tests trivial and fast):
//   * NO HTTP / crypto. `emit` records events into an in-memory list rather than
//     signing and POSTing them. Tests can inspect `emittedEvents` directly.
//   * NO timers / auto-emission. Everything resolves synchronously via
//     `Promise.resolve`, so a test never waits on a clock.
//   * Simple, inspectable state. Every simulated entity (payers, holds with
//     amount+status, captures, transfers, verified identities) is tracked in a
//     plain Map/array a test can read to assert side effects.
//   * Explicit, deterministic failure forcing keyed by operation `ref`/`holdId`,
//     plus a KYC outcome switch — no randomness, ever.

import type {
  CaptureResult,
  Cents,
  Payer,
  PayerService,
  PayerDetails,
  PaymentService,
  PlatformBalance,
  PreAuthHold,
  RefundResult,
  TransferResult,
  WebhookEmitter,
  WebhookEvent,
} from '../types';

/** A forced outcome for a simulated payment operation. */
export type InMemoryOutcome = 'SUCCESS' | 'FAILURE';

/**
 * Deterministic control surface for the fake. Nothing is random: an operation's
 * outcome is resolved as `outcomes[key]` → `defaultOutcome` → 'SUCCESS', where
 * `key` is the operation `ref` (transfers/holds) or the `holdId`
 * (voids/captures). KYC outcome is controlled separately.
 */
export interface InMemoryServiceOptions {
  /** Fallback outcome for payment operations with no matching override. Default 'SUCCESS'. */
  defaultOutcome?: InMemoryOutcome;
  /** Explicit per-key outcomes; highest precedence. Keyed by operation `ref` or `holdId`. */
  outcomes?: Record<string, InMemoryOutcome>;
  /** Forced KYC verification outcome. Default 'VERIFIED'. */
  kycOutcome?: 'VERIFIED' | 'REJECTED';
  /** Reason recorded on a rejected KYC outcome (Req 2.3). */
  kycReason?: string;
}

/** An immutable record of a settled/failed capture, retained for test assertions. */
export interface InMemoryCapture {
  captureId: string;
  holdId: string;
  amount: Cents;
  kind: 'PARTIAL' | 'FULL';
  status: 'SETTLED' | 'FAILED';
}

/** An immutable record of a requested transfer, retained for test assertions. */
export interface InMemoryTransfer {
  transferId: string;
  payerId: string;
  amount: Cents;
  ref: string;
  status: 'SETTLED' | 'FAILED';
}

/**
 * An immutable record of a seller payout out of the platform balance, retained
 * for test assertions. Kept separate from {@link InMemoryTransfer} because a
 * payout must never involve a payer.
 */
export interface InMemoryPayout {
  transferId: string;
  merchantRef: string;
  amount: Cents;
  ref: string;
  status: 'SETTLED' | 'FAILED';
}

/**
 * An immutable record of funds returned to a payer, retained for test assertions.
 *
 * `nonce` is kept because it is the idempotency contract: a test asserting a
 * dispute resolution is safe to retry checks that a second call with the same
 * nonce adds no second entry here.
 */
export interface InMemoryRefund {
  refundId: string;
  paymentRef: string;
  amount: Cents;
  nonce: string;
  ref: string;
  status: 'SETTLED' | 'FAILED';
}

/**
 * In-memory fake payment + webhook service for orchestrator tests. Holds
 * all simulated provider state in plain collections so a test can both drive
 * behavior (via `InMemoryServiceOptions`) and inspect the resulting side
 * effects (via the public `*By*` maps / arrays).
 */
export class InMemoryService implements PaymentService, PayerService, WebhookEmitter {
  /** Provider payer keyed by owning profile id. */
  readonly payersByProfile = new Map<string, Payer>();
  /** Reverse lookup: profile id keyed by payer id. */
  readonly profileByPayer = new Map<string, string>();
  /** Simulated hold ledger keyed by hold id. */
  readonly holds = new Map<string, PreAuthHold>();
  /** Every capture requested, in order (settled and failed). */
  readonly captures: InMemoryCapture[] = [];
  /** Every transfer requested, in order (settled and failed). */
  readonly transfers: InMemoryTransfer[] = [];
  /** Every seller payout requested, in order (settled and failed). */
  readonly payouts: InMemoryPayout[] = [];
  /** Every refund requested, in order. Deduplicated by nonce. */
  readonly refunds: InMemoryRefund[] = [];
  /** Every event handed to `emit`, in order. */
  readonly emittedEvents: WebhookEvent[] = [];

  /** Monotonic counter backing deterministic id generation. */
  private seq = 0;

  constructor(private readonly opts: InMemoryServiceOptions = {}) {}

  // -------------------------------------------------------------------------
  // PayerService
  // -------------------------------------------------------------------------

  /**
   * Create (or return the existing) provider payer for a Profile (Req 2.1).
   * `_details` exists for contract parity with the real Stripe binding and is
   * ignored here.
   */
  async createPayer(profileId: string, _details?: PayerDetails): Promise<Payer> {
    const existing = this.payersByProfile.get(profileId);
    if (existing) return existing;
    const payer: Payer = { payerId: `payer_${this.nextId()}_${profileId}`, profileId };
    this.payersByProfile.set(profileId, payer);
    this.profileByPayer.set(payer.payerId, profileId);
    return payer;
  }

  // `runVerification` used to live here. Removed with the payer gate: identity is
  // the Identity_Gate now, which is Connect onboarding state rather than a
  // provider call, so a fake has nothing to stand in for.


  // -------------------------------------------------------------------------
  // PaymentService
  // -------------------------------------------------------------------------

  /** Request a bank-to-bank transfer of `amount` (Req 4.2, 8.3). */
  async requestTransfer(params: {
    payerId: string;
    amount: Cents;
    ref: string;
    nonce: string;
  }): Promise<TransferResult> {
    const ok = this.resolveOutcome(params.ref) === 'SUCCESS';
    const result: TransferResult = {
      transferId: `transfer_${this.nextId()}`,
      amount: params.amount,
      status: ok ? 'SETTLED' : 'FAILED',
    };
    this.transfers.push({
      transferId: result.transferId,
      payerId: params.payerId,
      amount: params.amount,
      ref: params.ref,
      status: result.status,
    });
    return result;
  }

  /**
   * Release escrowed funds to a Seller's connected account (Req 4.3).
   *
   * Recorded in `payouts` rather than `transfers` so a test can assert that
   * releasing money did NOT charge the Buyer again — the two are different
   * events and conflating them would hide a double-charge.
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
      transferId: `payout_${this.nextId()}`,
      amount: params.amount,
      status: ok ? 'SETTLED' : 'FAILED',
    };
    this.payouts.push({
      transferId: result.transferId,
      merchantRef: params.merchantRef,
      amount: params.amount,
      ref: params.ref,
      status: result.status,
    });
    return result;
  }

  /**
   * Report a platform balance a test can control.
   *
   * Settable so a test can drive the reconciliation verdict deliberately — including
   * the SHORTFALL case, which is the one that matters and which a real provider will
   * not produce on demand. Defaults to UNAVAILABLE so a test that never sets a balance
   * asserts against "unknown" rather than an invented figure.
   */
  platformBalance: PlatformBalance = {
    availableCents: 0,
    pendingCents: 0,
    currency: 'aud',
    status: 'UNAVAILABLE',
    reason: 'No balance configured on the in-memory service',
  };

  async getPlatformBalance(): Promise<PlatformBalance> {
    return this.platformBalance;
  }

  /**
   * Return collected funds to the Buyer (Req 4.15).
   *
   * Recorded in {@link refunds} so a test can assert both the amount returned AND
   * that it was returned exactly once — double-refunding is the failure mode worth
   * catching, since it spends the platform's own money.
   */
  async refundPayment(params: {
    paymentRef: string;
    amount?: Cents;
    nonce: string;
    ref?: string;
  }): Promise<RefundResult> {
    const label = params.ref ?? params.paymentRef;
    const ok = this.resolveOutcome(label) === 'SUCCESS';

    // Idempotent on nonce, mirroring the provider contract: a retry returns the
    // first result instead of refunding again.
    const seen = this.refunds.find((r) => r.nonce === params.nonce);
    if (seen) {
      return { refundId: seen.refundId, amount: seen.amount, status: seen.status };
    }

    const result: RefundResult = {
      refundId: ok ? `re_${this.nextId()}` : '',
      amount: params.amount ?? 0,
      status: ok ? 'SETTLED' : 'FAILED',
      ...(ok ? {} : { reason: 'Refund failed to settle' }),
    };
    this.refunds.push({
      refundId: result.refundId,
      paymentRef: params.paymentRef,
      amount: result.amount,
      nonce: params.nonce,
      ref: label,
      status: result.status,
    });
    return result;
  }

  /** Place a 100%-FMV pre-auth hold on a payer's instrument (Req 5.4). */
  async placeHold(params: { payerId: string; amount: Cents; ref: string }): Promise<PreAuthHold> {
    const ok = this.resolveOutcome(params.ref) === 'SUCCESS';
    const hold: PreAuthHold = {
      holdId: `hold_${this.nextId()}`,
      payerId: params.payerId,
      amount: params.amount,
      status: ok ? 'ACTIVE' : 'FAILED',
    };
    this.holds.set(hold.holdId, hold);
    return hold;
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
    return hold;
  }

  /** Capture a fixed portion of a hold — the Friction_Tax (Req 7.2). */
  async partialCapture(params: { holdId: string; amount: Cents }): Promise<CaptureResult> {
    const ok = this.resolveOutcome(params.holdId) === 'SUCCESS';
    const result: CaptureResult = {
      captureId: `capture_${this.nextId()}`,
      holdId: params.holdId,
      amount: params.amount,
      status: ok ? 'SETTLED' : 'FAILED',
    };
    if (ok) this.markHold(params.holdId, 'PARTIALLY_CAPTURED');
    this.captures.push({ ...result, kind: 'PARTIAL' });
    return result;
  }

  /** Capture the entire hold amount on Objective_Fraud (Req 8.2). */
  async fullCapture(holdId: string): Promise<CaptureResult> {
    const ok = this.resolveOutcome(holdId) === 'SUCCESS';
    const amount = this.holds.get(holdId)?.amount ?? 0;
    const result: CaptureResult = {
      captureId: `capture_${this.nextId()}`,
      holdId,
      amount,
      status: ok ? 'SETTLED' : 'FAILED',
    };
    if (ok) this.markHold(holdId, 'FULLY_CAPTURED');
    this.captures.push({ ...result, kind: 'FULL' });
    return result;
  }

  // -------------------------------------------------------------------------
  // WebhookEmitter
  // -------------------------------------------------------------------------

  /** Record an emitted event in memory — no signing, no HTTP. */
  async emit(event: WebhookEvent): Promise<void> {
    this.emittedEvents.push(event);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Resolve a deterministic outcome for an operation key. */
  private resolveOutcome(key: string): InMemoryOutcome {
    if (this.opts.outcomes && key in this.opts.outcomes) return this.opts.outcomes[key];
    return this.opts.defaultOutcome ?? 'SUCCESS';
  }

  /** Update a tracked hold's status if it exists in the ledger. */
  private markHold(holdId: string, status: PreAuthHold['status']): void {
    const existing = this.holds.get(holdId);
    if (existing) this.holds.set(holdId, { ...existing, status });
  }


  /** Monotonic, deterministic id fragment. */
  private nextId(): string {
    return String(++this.seq);
  }
}
