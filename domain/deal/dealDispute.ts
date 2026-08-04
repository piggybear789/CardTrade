// domain/deal/dealDispute.ts
//
// DISPUTE RESOLUTION ARITHMETIC FOR PRIVATE DEALS.
//
// A binding deal (ESCROW_LOCKED) can be disputed by either party. Until this module
// existed there was nothing on the other side of that: DISPUTED was terminal in
// practice, the cash authorisation stayed HELD and both collateral holds stayed
// ACTIVE. Card authorisations lapse in about seven days, so the escrow simply expired
// and whoever was in the wrong got their collateral back by waiting.
//
// WHY THE CASH LEG IS A CAPTURE DECISION, NOT A REFUND. A deal's cash is charged as
// an uncaptured authorisation on confirm and only captured when both parties mark the
// deal complete. So at dispute time the money has not moved. "Refund the payer" is
// therefore `voidHold` — releasing an authorisation, which moves nothing — and a split
// is `partialCapture`, which takes the arbitrated share and lets the provider release
// the remainder itself. That is a materially better position than a cash sale, where
// funds are collected up front and returning them is a real outbound refund.
//
// WHY COLLATERAL IS ALWAYS RELEASED. A deal has no Friction_Tax and no fraud finding;
// unlike the 2-way trade escrow there is no equal-FMV swap for collateral to stand
// against, and `deal_holds.captured_cents` has never been written by anything. Making
// a deal dispute able to capture a stranger's collateral would be inventing a penalty
// the parties were never told about. The cash is the only thing in dispute, so the
// collateral goes back in every outcome.
//
// Pure module: no I/O, no Supabase, no provider types. Amounts are integer AUD cents.

/** Integer AUD cents. */
export type Cents = number;

/**
 * How an arbitrator resolved a deal dispute.
 *
 * - `REFUND_PAYER`      — the exchange did not stand. Nobody is charged anything.
 * - `SPLIT`             — the parties keep the goods on adjusted terms.
 * - `RELEASE_RECIPIENT` — the dispute was not upheld; the deal completes as agreed.
 */
export type DealDisputeOutcome = 'REFUND_PAYER' | 'SPLIT' | 'RELEASE_RECIPIENT';

/** Every outcome, for narrowing an untrusted payload. */
export const DEAL_DISPUTE_OUTCOMES = [
  'REFUND_PAYER',
  'SPLIT',
  'RELEASE_RECIPIENT',
] as const;

/**
 * Narrow an arbitrary value to an outcome.
 *
 * Returns null rather than defaulting: each outcome moves a different amount of
 * someone else's money, so a mistyped payload must fail rather than pick one.
 */
export function parseDealDisputeOutcome(value: unknown): DealDisputeOutcome | null {
  const found = DEAL_DISPUTE_OUTCOMES.find((outcome) => outcome === value);
  return found ?? null;
}

/** What happens to a deal's cash authorisation. */
export interface DealCashDisposition {
  /** Taken from the payer and kept for the recipient. */
  captureCents: Cents;
  /** Left uncaptured, so the provider releases it back to the payer. */
  releaseCents: Cents;
}

/**
 * The cash disposition an outcome implies, or `null` when the request is incoherent.
 *
 * A `SPLIT` of zero or of the whole authorisation is REJECTED rather than quietly
 * reinterpreted. An arbitrator who meant "release everything" or "charge in full"
 * should say so: the two produce different terminal states for the deal and different
 * copy for the parties, so silently widening a split would misreport the finding.
 */
export function resolveDealCashDisposition(params: {
  /** `deal_payments.amount_cents` — what was authorised on confirm. */
  heldCents: Cents;
  outcome: DealDisputeOutcome;
  /** Required for SPLIT; ignored otherwise. */
  recipientCents?: Cents;
}): DealCashDisposition | null {
  const held = Math.trunc(params.heldCents);
  if (!Number.isFinite(held) || held < 0) return null;

  switch (params.outcome) {
    case 'REFUND_PAYER':
      return { captureCents: 0, releaseCents: held };
    case 'RELEASE_RECIPIENT':
      return { captureCents: held, releaseCents: 0 };
    case 'SPLIT': {
      const requested = Math.trunc(params.recipientCents ?? 0);
      if (!Number.isFinite(requested) || requested <= 0 || requested >= held) {
        return null;
      }
      return { captureCents: requested, releaseCents: held - requested };
    }
  }
}

/**
 * The terminal state a resolved deal lands in.
 *
 * Deliberately reuses the two states that already exist rather than adding a third.
 * COMPLETED means the exchange stood — the parties keep what they swapped, in full or
 * on adjusted terms. CANCELLED means it was unwound. `deals.dispute_outcome` is what
 * separates an arbitrated unwind from a pre-binding cancellation, so a `RESOLVED`
 * state would record the same fact twice and the two copies could disagree.
 */
export function dealTerminalStateFor(
  outcome: DealDisputeOutcome,
): 'COMPLETED' | 'CANCELLED' {
  return outcome === 'REFUND_PAYER' ? 'CANCELLED' : 'COMPLETED';
}

/**
 * The `deal_payments.status` a settled disposition should be recorded as.
 *
 * A capture of zero is REFUNDED: nothing was taken. Anything above zero is SETTLED,
 * including a split — the recipient WAS paid, just less than the agreed figure, and
 * `refund_cents` carries the difference. Reporting a split as REFUNDED would tell the
 * recipient they received nothing.
 */
export function dealPaymentStatusFor(
  disposition: DealCashDisposition,
): 'REFUNDED' | 'SETTLED' {
  return disposition.captureCents > 0 ? 'SETTLED' : 'REFUNDED';
}

/**
 * What money the outcome moves, for a deal with no cash component at all.
 *
 * Goods-for-goods deals are common and they can still be disputed: the only escrow is
 * collateral, which is released either way. So the outcome is purely a record of what
 * an arbitrator found, and the caller must not treat a missing cash row as a failure.
 */
export function dealDisputeMovesMoney(disposition: DealCashDisposition | null): boolean {
  return disposition !== null && (disposition.captureCents > 0 || disposition.releaseCents > 0);
}
