// domain/orchestrator/collateralDisbursement.ts
//
// Drains `collateral_disbursements` (0133): the money that leaves a CAPTURED trade
// hold once staff decide a dispute (design §1.4).
//
// WHY A QUEUE AND NOT AN INLINE PAYOUT. The old fraud path captured the offender's
// collateral and paid it to the victim in the same request. A victim payout is the
// same cash-out shape as a mule seller's: if the "victim" is the fraudster's second
// account, the money is gone before anyone looks twice. Every movement out of a
// captured hold is therefore a row with a persisted nonce, and a PAYOUT row only
// moves once `releasePolicy` (CAPTURED_COLLATERAL, 7 days from the capture) says so.
//
// - REFUND            -> `refundPayment` against the hold's own charge, bounded by
//                        what was captured. Back to the owner's card, so no holdback.
// - PAYOUT            -> `decideRelease`, then `canReceiveFunds`, then
//                        `payoutToMerchant` sourced from the hold's charge.
// - PLATFORM_RETAINED -> marked SETTLED. The money is already in the platform
//                        balance; there is nothing to call.
//
// A deferral (RELEASE_AT / HELD) is persisted without counting as an attempt. An
// unpayable payee is FAILED / SELLER_NOT_PAYABLE and told once; the row stays
// retryable, so finishing payout setup releases it on a later pass.
//
// Pure: the repository, the payment service and the notifier are injected. Failures
// are reported through `onFailure` for the lib caller to log (domain never logs).

import type { Cents, PaymentService } from '../services/types';
import { canReceiveFunds, type MerchantRecord } from './merchantOnboarding';
import { decideRelease, type ReleaseFacts } from '../payouts/releasePolicy';

/** Provider attempts before a row stops being retried and needs an operator. */
export const MAX_DISBURSEMENT_ATTEMPTS = 5;

/** The error code persisted when the payee has no payout destination. */
export const SELLER_NOT_PAYABLE = 'SELLER_NOT_PAYABLE';

export type CollateralDisbursementKind = 'REFUND' | 'PAYOUT' | 'PLATFORM_RETAINED';
export type CollateralDisbursementStatus = 'NOT_DUE' | 'PENDING' | 'SETTLED' | 'FAILED';

/** One queued movement out of a captured hold. */
export interface CollateralDisbursementRow {
  id: string;
  tradeId: string;
  holdRef: string;
  kind: CollateralDisbursementKind;
  payeeId: string | null;
  amountMinor: Cents;
  currency: string;
  nonce: string;
  status: CollateralDisbursementStatus;
  releaseAt: string | null;
  holdReason: string | null;
  attempts: number;
  lastError: string | null;
  failureNotifiedAt: string | null;
  createdAt: string;
}

/** Data access for the drain. Implemented over the admin client in production. */
export interface CollateralDisbursementRepository {
  /**
   * Rows that may move now: PENDING, or FAILED with attempts left, in `currency`,
   * with no hold reason and `release_at` null or past.
   */
  listDue(params: { now: Date; currency: string; limit: number }): Promise<CollateralDisbursementRow[]>;
  /** The release facts for a PAYOUT row (source CAPTURED_COLLATERAL). */
  loadReleaseFacts(row: CollateralDisbursementRow): Promise<ReleaseFacts>;
  /** The payee's payout destination, or null when they have none. */
  getPayee(payeeId: string): Promise<MerchantRecord | null>;
  markSettled(params: { id: string; providerRef: string | null; at: Date }): Promise<void>;
  markFailed(params: { id: string; error: string; countAttempt: boolean }): Promise<void>;
  /** Persist a deferral: when it may move, or why it is held. Not an attempt. */
  recordDeferral(params: { id: string; releaseAt: string | null; holdReason: string | null }): Promise<void>;
  markFailureNotified(params: { id: string; at: Date }): Promise<void>;
}

/** Best-effort member notification. Must never throw. */
export interface DisbursementNotifier {
  payoutFailed(params: {
    payeeId: string;
    tradeId: string;
    cause: 'NOT_PAYABLE' | 'PROVIDER_REJECTED';
  }): Promise<void>;
}

export interface CollateralDisbursementDeps {
  repository: CollateralDisbursementRepository;
  payments: PaymentService;
  /** The currency this pass drains, i.e. the region's platform account. */
  currency: string;
  notifier?: DisbursementNotifier;
  now?: () => Date;
  limit?: number;
  maxAttempts?: number;
  /** Called for every row that failed, for the lib caller to log. */
  onFailure?: (failure: { disbursementId: string; tradeId: string; error: string }) => void;
}

export interface CollateralDisbursementPassResult {
  considered: number;
  settled: number;
  deferred: number;
  failed: number;
}

/** Process every disbursement due now, one row at a time. Never throws per row. */
export async function processDueCollateralDisbursements(
  deps: CollateralDisbursementDeps,
): Promise<CollateralDisbursementPassResult> {
  const now = (deps.now ?? (() => new Date()))();
  const result: CollateralDisbursementPassResult = { considered: 0, settled: 0, deferred: 0, failed: 0 };
  const rows = await deps.repository.listDue({
    now,
    currency: deps.currency,
    limit: deps.limit ?? 50,
  });

  for (const row of rows) {
    result.considered += 1;
    const outcome = await processOne(deps, row, now);
    result[outcome] += 1;
  }
  return result;
}

type RowOutcome = 'settled' | 'deferred' | 'failed';

async function processOne(
  deps: CollateralDisbursementDeps,
  row: CollateralDisbursementRow,
  now: Date,
): Promise<RowOutcome> {
  const { repository, payments } = deps;
  const maxAttempts = deps.maxAttempts ?? MAX_DISBURSEMENT_ATTEMPTS;

  const fail = async (error: string, countAttempt: boolean): Promise<RowOutcome> => {
    await repository.markFailed({ id: row.id, error, countAttempt });
    deps.onFailure?.({ disbursementId: row.id, tradeId: row.tradeId, error });
    return 'failed';
  };

  if (row.attempts >= maxAttempts) return fail('MAX_ATTEMPTS_REACHED', false);

  // Nothing to move. A zero row is the staff goodwill placeholder (design §1.2 step
  // 2a) or a fully consumed share; the provider refuses a zero transfer anyway.
  if (row.kind === 'PLATFORM_RETAINED' || row.amountMinor <= 0) {
    // A held zero-value PAYOUT placeholder stays visible to staff until cleared.
    if (row.kind === 'PAYOUT' && row.holdReason) {
      return 'deferred';
    }
    await repository.markSettled({ id: row.id, providerRef: null, at: now });
    return 'settled';
  }

  if (row.kind === 'REFUND') {
    const refund = await payments.refundPayment({
      paymentRef: row.holdRef,
      amount: row.amountMinor,
      nonce: row.nonce,
      ref: `collateral-refund:${row.id}`,
    });
    if (refund.status !== 'SETTLED') return fail('REFUND_FAILED', true);
    await repository.markSettled({ id: row.id, providerRef: refund.refundId || null, at: now });
    return 'settled';
  }

  // PAYOUT: release policy first, then the payee, then the provider.
  const facts = await repository.loadReleaseFacts(row);
  const decision = decideRelease(facts, now);
  if (decision.kind === 'RELEASE_AT') {
    await repository.recordDeferral({ id: row.id, releaseAt: decision.at, holdReason: null });
    return 'deferred';
  }
  if (decision.kind === 'HELD') {
    await repository.recordDeferral({ id: row.id, releaseAt: null, holdReason: decision.reason });
    return 'deferred';
  }

  const payee = row.payeeId ? await repository.getPayee(row.payeeId) : null;
  if (!canReceiveFunds(payee) || !payee?.merchantRef) {
    // Not an attempt: nothing reached the provider, and finishing payout setup
    // releases it on a later pass. Told once, not every hour.
    const outcome = await fail(SELLER_NOT_PAYABLE, false);
    if (!row.failureNotifiedAt && row.payeeId) {
      await deps.notifier?.payoutFailed({ payeeId: row.payeeId, tradeId: row.tradeId, cause: 'NOT_PAYABLE' });
      await repository.markFailureNotified({ id: row.id, at: now });
    }
    return outcome;
  }

  const payout = await payments.payoutToMerchant({
    merchantRef: payee.merchantRef,
    amount: row.amountMinor,
    ref: `collateral-payout:${row.id}`,
    // Persisted and reused verbatim on every retry.
    nonce: row.nonce,
    sourcePaymentRef: row.holdRef,
  });
  if (payout.status !== 'SETTLED') {
    const outcome = await fail('PAYOUT_FAILED', true);
    if (!row.failureNotifiedAt && row.payeeId) {
      await deps.notifier?.payoutFailed({ payeeId: row.payeeId, tradeId: row.tradeId, cause: 'PROVIDER_REJECTED' });
      await repository.markFailureNotified({ id: row.id, at: now });
    }
    return outcome;
  }
  await repository.markSettled({ id: row.id, providerRef: payout.transferId || null, at: now });
  return 'settled';
}
