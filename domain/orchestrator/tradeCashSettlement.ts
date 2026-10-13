// domain/orchestrator/tradeCashSettlement.ts
//
// A trade's CASH LEG, held by the platform (ESC-05 / ESC-06, design §1.5, 0139).
//
// Before this, "my card plus $50 for yours" moved the $50 only at COMPLETED: the
// payer's card was charged off-session and forwarded straight to the receiver in one
// call. Nothing backed the cash while the trade was live (ESC-05), and nothing could
// hold it back or route it to a victim once it was paid (ESC-06).
//
// Now:
//
//   * The payer pays BUYER-PRESENT (3-D Secure possible) while the trade is
//     COLLATERAL_PENDING, by `pay_by`, and BEFORE any collateral hold is placed.
//   * The money sits in the platform balance. Completion queues a release to the
//     receiver; the `:47` drain pays it through the release policy.
//   * Every outcome routes it: completion releases, NO_EXCHANGE refunds, FRAUD goes to
//     the wronged side, an abandon refunds.
//   * Every write is GUARDED on the expected status, so two writers cannot both move
//     one row, and a collection that lands after the trade ended is refunded by the
//     0139 trigger whoever records it.
//
// Pure: data access, payments and the clock are injected.

import type { PaymentService } from '../services/types';
import { decideThreeDS } from '../payments/scaPolicy';
import { BOND_PLACEMENT_LEAD_HOURS } from '../fulfilment/inspection';
import { decideRelease, type ReleaseFacts } from '../payouts/releasePolicy';

export type TradeCashStatus =
  | 'NOT_COLLECTED'
  | 'COLLECTING'
  | 'COLLECTED'
  | 'RELEASE_PENDING'
  | 'RELEASED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'FAILED';

export interface TradeCashSettlementRecord {
  tradeId: string;
  payerId: string;
  receiverId: string;
  amountMinor: number;
  currency: string;
  status: TradeCashStatus;
  collectionAttempt: number;
  collectionRef: string | null;
  collectionRequestedAt: string | null;
  collectedAt: string | null;
  payBy: string;
  releaseNonce: string | null;
  refundNonce: string | null;
  holdReason: 'CHARGE_DISPUTE' | 'FRAUD_WARNING' | 'STAFF' | null;
  cancelFailures: number;
  attempts: number;
}

/** Fields a guarded transition may write alongside the new status. */
export type TradeCashPatch = Partial<
  Pick<
    TradeCashSettlementRecord,
    | 'collectionAttempt'
    | 'collectionRef'
    | 'collectionRequestedAt'
    | 'collectedAt'
    | 'releaseNonce'
    | 'refundNonce'
    | 'cancelFailures'
    | 'attempts'
  >
> & { releaseRef?: string | null; refundRef?: string | null; releaseAt?: string | null; lastError?: string | null };

export interface TradeCashSettlementRepository {
  load(tradeId: string): Promise<TradeCashSettlementRecord | null>;
  loadTrade(tradeId: string): Promise<{ id: string; state: string; meetingAt: string | null } | null>;
  /**
   * Move the row from one of `from` to `to`, writing `patch`. Returns the updated row,
   * or null when the row was not in `from` (someone else moved it). The 0139 trigger
   * may rewrite a COLLECTED landing on an ended trade to REFUND_PENDING.
   */
  transition(
    tradeId: string,
    from: TradeCashStatus[],
    to: TradeCashStatus,
    patch?: TradeCashPatch,
  ): Promise<TradeCashSettlementRecord | null>;
  /** Write fields without changing status, guarded on the current status. */
  patch(tradeId: string, status: TradeCashStatus, patch: TradeCashPatch): Promise<TradeCashSettlementRecord | null>;
  /** The payer's vaulted provider payer id, or null without a saved card. */
  loadPayerRef(profileId: string): Promise<string | null>;
  /** The receiver's connected account, when they can be paid. */
  loadReceiverPayout(profileId: string): Promise<{ merchantRef: string | null; payable: boolean }>;
  countCompletedPurchases?(profileId: string): Promise<number>;
  listByStatus(status: TradeCashStatus, limit: number): Promise<TradeCashSettlementRecord[]>;
  /** COLLECTING rows whose collection was requested before `before`. */
  listCollectingBefore(before: string, limit: number): Promise<TradeCashSettlementRecord[]>;
  /** Release-policy facts for the receiver (ESC-03 holdback applies to trade cash). */
  loadReleaseFacts?(record: TradeCashSettlementRecord): Promise<ReleaseFacts | null>;
}

export interface TradeCashSettlementDeps {
  repository: TradeCashSettlementRepository;
  payments: PaymentService;
  now?: () => Date;
}

export type TradeCashError =
  | 'NOT_FOUND'
  | 'NOT_PAYER'
  | 'NOT_PENDING'
  | 'ALREADY_PAID'
  | 'TRADE_CASH_PAY_BY_PASSED'
  | 'NO_PAYMENT_METHOD'
  | 'CASH_DECLINED'
  | 'CONCURRENT'
  | 'TRADE_CASH_NOT_COLLECTED'
  | 'RECEIVER_NOT_PAYABLE'
  | 'PAYOUT_HELD'
  | 'PAYOUT_FAILED'
  | 'REFUND_FAILED';

export type TradeCashResult =
  | {
      ok: true;
      record: TradeCashSettlementRecord;
      /** The issuer asked for a 3-D Secure check (ESC-05, same flow as ESC-03). */
      nextAction?: { clientSecret: string; publishableKey?: string };
    }
  | { ok: false; error: TradeCashError; detail?: string };

const HOUR_MS = 3_600_000;
/** A challenge left unfinished this long is cancelled by the `:47` job. */
export const TRADE_CASH_ABANDON_MINUTES = 30;
/** Failed cancels at `pay_by` before an operator is flagged. */
export const TRADE_CASH_MAX_CANCEL_FAILURES = 3;

function now(deps: TradeCashSettlementDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

/**
 * When the payer must have paid by (design §1.5): `BOND_PLACEMENT_LEAD_HOURS` before
 * the meeting, so collateral can still be placed on time. When terms are agreed later
 * than that, the earlier of two hours from now and an hour before the meeting. With no
 * meeting on file, a day from now.
 */
export function computePayBy(params: { meetingAt: string | null; agreedAt: Date }): Date {
  if (!params.meetingAt) return new Date(params.agreedAt.getTime() + 24 * HOUR_MS);
  const meeting = new Date(params.meetingAt).getTime();
  const lead = meeting - BOND_PLACEMENT_LEAD_HOURS * HOUR_MS;
  if (lead > params.agreedAt.getTime()) return new Date(lead);
  return new Date(Math.min(params.agreedAt.getTime() + 2 * HOUR_MS, meeting - HOUR_MS));
}

/** The idempotency key for one collection attempt. A retry is a new intent. */
export function collectionNonce(tradeId: string, attempt: number): string {
  return `trade-cash:collect:${tradeId}:${attempt}`;
}

/**
 * The payer pays the cash leg (ESC-05). Payer only, COLLATERAL_PENDING only, while
 * the row is NOT_COLLECTED and `pay_by` has not passed.
 */
export async function payTradeCash(
  deps: TradeCashSettlementDeps,
  params: { actorId: string; tradeId: string },
): Promise<TradeCashResult> {
  const record = await deps.repository.load(params.tradeId);
  if (!record) return { ok: false, error: 'NOT_FOUND' };
  if (record.payerId !== params.actorId) return { ok: false, error: 'NOT_PAYER' };
  const trade = await deps.repository.loadTrade(params.tradeId);
  if (!trade || trade.state !== 'COLLATERAL_PENDING') return { ok: false, error: 'NOT_PENDING' };
  if (record.status !== 'NOT_COLLECTED') {
    return record.status === 'COLLECTING'
      ? { ok: false, error: 'CONCURRENT', detail: 'A payment is already in progress.' }
      : { ok: false, error: 'ALREADY_PAID' };
  }
  const at = now(deps);
  // R4-N3: refused with ZERO provider calls once the deadline has passed.
  if (at.getTime() >= new Date(record.payBy).getTime()) {
    return { ok: false, error: 'TRADE_CASH_PAY_BY_PASSED' };
  }

  const payerRef = await deps.repository.loadPayerRef(record.payerId);
  if (!payerRef) {
    return { ok: false, error: 'NO_PAYMENT_METHOD', detail: 'Add a card before you pay.' };
  }

  const attempt = record.collectionAttempt + 1;
  const claimed = await deps.repository.transition(params.tradeId, ['NOT_COLLECTED'], 'COLLECTING', {
    collectionAttempt: attempt,
    collectionRequestedAt: at.toISOString(),
    collectionRef: null,
  });
  if (!claimed) return { ok: false, error: 'CONCURRENT' };

  const completedPurchases = (await deps.repository.countCompletedPurchases?.(record.payerId)) ?? 0;
  // No `merchantRef`: collected into the platform balance, released later.
  const transfer = await deps.payments.requestTransfer({
    payerId: payerRef,
    amount: record.amountMinor,
    ref: `trade-cash:${params.tradeId}`,
    nonce: collectionNonce(params.tradeId, attempt),
    presence: {
      kind: 'BUYER_PRESENT',
      threeDS: decideThreeDS({ completedPurchases, amountMinor: record.amountMinor, currency: record.currency }),
    },
  });

  if (transfer.status === 'SETTLED') {
    const collected = await deps.repository.transition(params.tradeId, ['COLLECTING'], 'COLLECTED', {
      collectionRef: transfer.transferId,
      collectedAt: at.toISOString(),
    });
    return collected ? { ok: true, record: collected } : { ok: false, error: 'CONCURRENT' };
  }
  if (transfer.status === 'REQUIRES_ACTION') {
    const pending = await deps.repository.patch(params.tradeId, 'COLLECTING', {
      collectionRef: transfer.transferId,
    });
    return {
      ok: true,
      record: pending ?? claimed,
      ...(transfer.clientSecret
        ? {
            nextAction: {
              clientSecret: transfer.clientSecret,
              ...(transfer.publishableKey ? { publishableKey: transfer.publishableKey } : {}),
            },
          }
        : {}),
    };
  }
  await deps.repository.transition(params.tradeId, ['COLLECTING'], 'NOT_COLLECTED', {
    collectionRef: null,
    collectionRequestedAt: null,
  });
  return { ok: false, error: 'CASH_DECLINED', detail: 'The card was declined. Nothing was charged.' };
}

/** Read the collection back after a 3-D Secure check (ESC-05). Payer only. */
export async function confirmTradeCashPayment(
  deps: TradeCashSettlementDeps,
  params: { actorId: string; tradeId: string },
): Promise<TradeCashResult> {
  const record = await deps.repository.load(params.tradeId);
  if (!record) return { ok: false, error: 'NOT_FOUND' };
  if (record.payerId !== params.actorId) return { ok: false, error: 'NOT_PAYER' };
  if (record.status !== 'COLLECTING' || !record.collectionRef || !deps.payments.readCollection) {
    return { ok: true, record };
  }
  const read = await deps.payments.readCollection(record.collectionRef);
  if (read.status === 'SETTLED') {
    const collected = await deps.repository.transition(params.tradeId, ['COLLECTING'], 'COLLECTED', {
      collectedAt: now(deps).toISOString(),
    });
    return { ok: true, record: collected ?? (await deps.repository.load(params.tradeId)) ?? record };
  }
  if (read.status === 'FAILED') {
    await deps.repository.transition(params.tradeId, ['COLLECTING'], 'NOT_COLLECTED', {
      collectionRef: null,
      collectionRequestedAt: null,
    });
    return { ok: false, error: 'CASH_DECLINED', detail: 'The payment did not go through. Nothing was charged.' };
  }
  return { ok: true, record };
}

/** The outstanding 3-D Secure secret, read back from the provider. Payer only. */
export async function getTradeCashPaymentAction(
  deps: TradeCashSettlementDeps,
  params: { actorId: string; tradeId: string },
): Promise<{ ok: true; clientSecret: string | null; publishableKey?: string } | { ok: false; error: TradeCashError }> {
  const record = await deps.repository.load(params.tradeId);
  if (!record) return { ok: false, error: 'NOT_FOUND' };
  if (record.payerId !== params.actorId) return { ok: false, error: 'NOT_PAYER' };
  if (record.status !== 'COLLECTING' || !record.collectionRef || !deps.payments.readCollection) {
    return { ok: true, clientSecret: null };
  }
  const read = await deps.payments.readCollection(record.collectionRef);
  if (read.status !== 'REQUIRES_ACTION' || !read.clientSecret) return { ok: true, clientSecret: null };
  return {
    ok: true,
    clientSecret: read.clientSecret,
    ...(read.publishableKey ? { publishableKey: read.publishableKey } : {}),
  };
}

/** What the placement sweep should do with a trade whose `pay_by` has passed. */
export type PayByDecision =
  /** No cash leg, or it is collected: place collateral as usual. */
  | { kind: 'PLACE' }
  /** Nothing was collected (or the in-flight intent was cancelled): abandon. */
  | { kind: 'ABANDON' }
  /** A payment may still succeed: leave the trade for the next sweep. */
  | { kind: 'WAIT'; flagged: boolean };

/**
 * Resolve the cash leg at `pay_by` (round-3 review #6). Never abandons a trade with a
 * payment in flight: a COLLECTING row is cancelled first, and only a definite cancel
 * lets the abandon proceed. A collected leg past the last safe placement instant is
 * abandoned too; the abandon refunds it.
 */
export async function resolveCashAtPayBy(
  deps: TradeCashSettlementDeps,
  params: { tradeId: string },
): Promise<PayByDecision> {
  const record = await deps.repository.load(params.tradeId);
  if (!record) return { kind: 'PLACE' };
  const at = now(deps);
  if (at.getTime() < new Date(record.payBy).getTime()) {
    return record.status === 'COLLECTED' ? { kind: 'PLACE' } : { kind: 'WAIT', flagged: false };
  }

  if (record.status === 'NOT_COLLECTED') return { kind: 'ABANDON' };
  if (record.status === 'COLLECTED') return placeOrAbandonCollected(deps, params.tradeId, at);
  if (record.status !== 'COLLECTING') return { kind: 'WAIT', flagged: false };

  if (!record.collectionRef || !deps.payments.cancelCollection) {
    const reset = await deps.repository.transition(params.tradeId, ['COLLECTING'], 'NOT_COLLECTED', {
      collectionRequestedAt: null,
    });
    return reset ? { kind: 'ABANDON' } : { kind: 'WAIT', flagged: false };
  }
  const cancel = await deps.payments.cancelCollection(record.collectionRef);
  if (cancel.status === 'CANCELLED') {
    const reset = await deps.repository.transition(params.tradeId, ['COLLECTING'], 'NOT_COLLECTED', {
      collectionRef: null,
      collectionRequestedAt: null,
    });
    return reset ? { kind: 'ABANDON' } : { kind: 'WAIT', flagged: false };
  }
  if (cancel.status === 'ALREADY_SETTLED') {
    await deps.repository.transition(params.tradeId, ['COLLECTING'], 'COLLECTED', {
      collectedAt: at.toISOString(),
    });
    return placeOrAbandonCollected(deps, params.tradeId, at);
  }
  // The cancel call itself failed. Never abandon while the intent may still succeed.
  const failures = record.cancelFailures + 1;
  await deps.repository.patch(params.tradeId, 'COLLECTING', { cancelFailures: failures });
  return { kind: 'WAIT', flagged: failures >= TRADE_CASH_MAX_CANCEL_FAILURES };
}

async function placeOrAbandonCollected(
  deps: TradeCashSettlementDeps,
  tradeId: string,
  at: Date,
): Promise<PayByDecision> {
  const trade = await deps.repository.loadTrade(tradeId);
  const meeting = trade?.meetingAt ? new Date(trade.meetingAt).getTime() : null;
  if (meeting === null || at.getTime() < meeting - HOUR_MS) return { kind: 'PLACE' };
  return { kind: 'ABANDON' };
}

/**
 * Step 1 of the one abandon operation (design §1.5): never end a trade over a payment
 * that may still succeed. A COLLECTING leg is cancelled first; a cancel that fails
 * STOPS the abandon for this run. A challenge that finished first leaves the leg
 * COLLECTED, which step 6 then refunds.
 */
export async function settleCashBeforeAbandon(
  deps: TradeCashSettlementDeps,
  params: { tradeId: string },
): Promise<'PROCEED' | 'STOP'> {
  const record = await deps.repository.load(params.tradeId);
  if (!record || record.status !== 'COLLECTING') return 'PROCEED';
  if (!record.collectionRef || !deps.payments.cancelCollection) {
    const reset = await deps.repository.transition(params.tradeId, ['COLLECTING'], 'NOT_COLLECTED', {
      collectionRequestedAt: null,
    });
    return reset ? 'PROCEED' : 'STOP';
  }
  const cancel = await deps.payments.cancelCollection(record.collectionRef);
  if (cancel.status === 'CANCELLED') {
    await deps.repository.transition(params.tradeId, ['COLLECTING'], 'NOT_COLLECTED', {
      collectionRef: null,
      collectionRequestedAt: null,
    });
    return 'PROCEED';
  }
  if (cancel.status === 'ALREADY_SETTLED') {
    await deps.repository.transition(params.tradeId, ['COLLECTING'], 'COLLECTED', {
      collectedAt: now(deps).toISOString(),
    });
    return 'PROCEED';
  }
  await deps.repository.patch(params.tradeId, 'COLLECTING', { cancelFailures: record.cancelFailures + 1 });
  return 'STOP';
}

/** Step 6 of the one abandon operation: a COLLECTED leg is refunded. */
export async function queueTradeCashRefund(
  deps: TradeCashSettlementDeps,
  params: { tradeId: string },
): Promise<boolean> {
  const moved = await deps.repository.transition(params.tradeId, ['COLLECTED'], 'REFUND_PENDING', {
    refundNonce: `trade-cash:refund:${params.tradeId}`,
  });
  return moved !== null;
}

/** Completion (or a CONDITION / UNFOUNDED outcome) queues the release. */
export async function queueTradeCashRelease(
  deps: TradeCashSettlementDeps,
  params: { tradeId: string },
): Promise<boolean> {
  const moved = await deps.repository.transition(params.tradeId, ['COLLECTED'], 'RELEASE_PENDING', {
    releaseNonce: `trade-cash:release:${params.tradeId}`,
  });
  return moved !== null;
}

/** NO_EXCHANGE on a leg that was never paid: nothing to move, the row is closed. */
export async function closeUncollectedTradeCash(
  deps: TradeCashSettlementDeps,
  params: { tradeId: string },
): Promise<boolean> {
  const moved = await deps.repository.transition(params.tradeId, ['NOT_COLLECTED'], 'FAILED', {
    lastError: 'closed-uncollected',
  });
  return moved !== null;
}

/**
 * The `:47` 30-minute cancel (ESC-05): a COLLECTING row whose challenge was left
 * unfinished goes back to NOT_COLLECTED (the payer can try again before `pay_by`), or
 * to COLLECTED when the check finished meanwhile.
 */
export async function sweepStaleTradeCashCollections(
  deps: TradeCashSettlementDeps,
  params: { limit?: number } = {},
): Promise<{ collected: number; reset: number; skipped: number }> {
  const tally = { collected: 0, reset: 0, skipped: 0 };
  if (!deps.payments.readCollection) return tally;
  const before = new Date(now(deps).getTime() - TRADE_CASH_ABANDON_MINUTES * 60_000).toISOString();
  for (const record of await deps.repository.listCollectingBefore(before, params.limit ?? 50)) {
    if (!record.collectionRef) {
      tally.skipped += 1;
      continue;
    }
    const read = await deps.payments.readCollection(record.collectionRef);
    if (read.status === 'SETTLED') {
      await deps.repository.transition(record.tradeId, ['COLLECTING'], 'COLLECTED', {
        collectedAt: now(deps).toISOString(),
      });
      tally.collected += 1;
      continue;
    }
    if (read.status === 'FAILED') {
      await deps.repository.transition(record.tradeId, ['COLLECTING'], 'NOT_COLLECTED', {
        collectionRef: null,
        collectionRequestedAt: null,
      });
      tally.reset += 1;
      continue;
    }
    if (read.status !== 'REQUIRES_ACTION' || !deps.payments.cancelCollection) {
      tally.skipped += 1;
      continue;
    }
    const cancel = await deps.payments.cancelCollection(record.collectionRef);
    if (cancel.status === 'CANCELLED') {
      await deps.repository.transition(record.tradeId, ['COLLECTING'], 'NOT_COLLECTED', {
        collectionRef: null,
        collectionRequestedAt: null,
      });
      tally.reset += 1;
    } else if (cancel.status === 'ALREADY_SETTLED') {
      await deps.repository.transition(record.tradeId, ['COLLECTING'], 'COLLECTED', {
        collectedAt: now(deps).toISOString(),
      });
      tally.collected += 1;
    } else {
      tally.skipped += 1;
    }
  }
  return tally;
}

/**
 * Pay one RELEASE_PENDING row to the receiver (ESC-06). Only after the transfer
 * settles is it RELEASED. `PAYOUT_MODE` is irrelevant: platform collect-then-pay is
 * the only path. A row with no collection behind it is refused, never paid.
 */
export async function releaseTradeCash(
  deps: TradeCashSettlementDeps,
  record: TradeCashSettlementRecord,
): Promise<TradeCashResult> {
  if (record.status !== 'RELEASE_PENDING') return { ok: true, record };
  if (!record.collectionRef || !record.collectedAt) {
    return { ok: false, error: 'TRADE_CASH_NOT_COLLECTED' };
  }
  if (record.holdReason) return { ok: false, error: 'PAYOUT_HELD', detail: record.holdReason };

  const facts = await deps.repository.loadReleaseFacts?.(record);
  if (facts) {
    const decision = decideRelease(facts, now(deps));
    if (decision.kind !== 'RELEASE_NOW') {
      await deps.repository.patch(record.tradeId, 'RELEASE_PENDING', {
        releaseAt: decision.kind === 'RELEASE_AT' ? decision.at : null,
      });
      return { ok: false, error: 'PAYOUT_HELD', detail: decision.kind };
    }
  }

  const receiver = await deps.repository.loadReceiverPayout(record.receiverId);
  if (!receiver.payable || !receiver.merchantRef) return { ok: false, error: 'RECEIVER_NOT_PAYABLE' };

  const nonce = record.releaseNonce ?? `trade-cash:release:${record.tradeId}`;
  const payout = await deps.payments.payoutToMerchant({
    merchantRef: receiver.merchantRef,
    amount: record.amountMinor,
    ref: `trade-cash:${record.tradeId}`,
    nonce,
    sourcePaymentRef: record.collectionRef,
  });
  if (payout.status !== 'SETTLED') {
    await deps.repository.patch(record.tradeId, 'RELEASE_PENDING', {
      attempts: record.attempts + 1,
      lastError: 'payout-failed',
    });
    return { ok: false, error: 'PAYOUT_FAILED' };
  }
  const released = await deps.repository.transition(record.tradeId, ['RELEASE_PENDING'], 'RELEASED', {
    releaseRef: payout.transferId,
    releaseNonce: nonce,
  });
  return released ? { ok: true, record: released } : { ok: false, error: 'CONCURRENT' };
}

/** Refund one REFUND_PENDING row to the payer's card. */
export async function refundTradeCash(
  deps: TradeCashSettlementDeps,
  record: TradeCashSettlementRecord,
): Promise<TradeCashResult> {
  if (record.status !== 'REFUND_PENDING') return { ok: true, record };
  if (!record.collectionRef) return { ok: false, error: 'TRADE_CASH_NOT_COLLECTED' };
  const nonce = record.refundNonce ?? `trade-cash:refund:${record.tradeId}`;
  const refund = await deps.payments.refundPayment({
    paymentRef: record.collectionRef,
    amount: record.amountMinor,
    nonce,
    ref: `trade-cash:${record.tradeId}`,
  });
  if (refund.status !== 'SETTLED') {
    await deps.repository.patch(record.tradeId, 'REFUND_PENDING', {
      attempts: record.attempts + 1,
      lastError: 'refund-failed',
    });
    return { ok: false, error: 'REFUND_FAILED' };
  }
  const refunded = await deps.repository.transition(record.tradeId, ['REFUND_PENDING'], 'REFUNDED', {
    refundRef: refund.refundId,
    refundNonce: nonce,
  });
  return refunded ? { ok: true, record: refunded } : { ok: false, error: 'CONCURRENT' };
}

/** One pass of the `:47` drain over trade cash: releases, refunds, stale challenges. */
export async function drainTradeCash(
  deps: TradeCashSettlementDeps,
  params: {
    limit?: number;
    /** Only rows in this currency: each region's money sits in its own platform account. */
    currency?: string;
    onFailure?: (failure: { tradeId: string; error: TradeCashError; detail?: string }) => void;
  } = {},
): Promise<{ released: number; refunded: number; deferred: number; failed: number }> {
  const tally = { released: 0, refunded: 0, deferred: 0, failed: 0 };
  const limit = params.limit ?? 50;
  const mine = (record: TradeCashSettlementRecord) =>
    !params.currency || record.currency.toLowerCase() === params.currency.toLowerCase();
  await sweepStaleTradeCashCollections(deps, { limit });

  for (const record of (await deps.repository.listByStatus('RELEASE_PENDING', limit)).filter(mine)) {
    const result = await releaseTradeCash(deps, record);
    if (result.ok) {
      tally.released += 1;
    } else if (result.error === 'PAYOUT_HELD') {
      tally.deferred += 1;
    } else {
      tally.failed += 1;
      params.onFailure?.({ tradeId: record.tradeId, error: result.error, detail: result.detail });
    }
  }
  for (const record of (await deps.repository.listByStatus('REFUND_PENDING', limit)).filter(mine)) {
    const result = await refundTradeCash(deps, record);
    if (result.ok) {
      tally.refunded += 1;
    } else {
      tally.failed += 1;
      params.onFailure?.({ tradeId: record.tradeId, error: result.error, detail: result.detail });
    }
  }
  return tally;
}
