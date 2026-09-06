// domain/account/accountClosure.ts
//
// Closure eligibility — the ONE place the Money_In_Flight rule is evaluated
// (Req 7.2, 7.3).
//
// WHAT THIS DOES. Given a count per category of unsettled value a member is party
// to, it answers two questions at once: may this account be closed, and if not,
// which categories block it. Requirement 7.3 asks for the CATEGORY back, not a
// bare refusal, because "you cannot close your account" with no reason is
// indistinguishable from a bug and drives the member to support instead of to the
// contract that is actually open.
//
// WHY IT IS PURE. The orchestrator (`domain/orchestrator/accountClosureOrchestrator`)
// loads the snapshot through a repository and this function decides on it. Keeping
// the decision free of Supabase, `lib/` and the clock means both entry points — the
// web server action and `app/api/mobile/account/close` — reach the same verdict, and
// the rule is testable without a database. `domain/` may not import from `app/`,
// `components/` or `lib/`; nothing here does.
//
// THIS FILE COUNTS CONTRACTS, NOT AMOUNTS. Every field is a COUNT of open things,
// never a sum of money, so there is no currency and no minor-unit handling here on
// purpose — do not add a dollar figure to this module. If closure ever needs to show
// a member how much is in flight, that figure belongs on the read model that already
// owns money formatting (`domain/payouts/payoutReadModel.ts` and `formatMoney`), not
// here, where a bare integer with no denomination would be read as cents by one
// caller and as dollars by the next.
//
// A REFUSAL IS A REFUSAL, NOT A QUEUE. Decision D3: closure while money is in flight
// is refused outright rather than accepted and deferred. A deferred closure has to
// keep the member reachable to settle the contract, which is precisely what closure
// takes away.

/**
 * A category of Money_In_Flight that prevents an account from being closed.
 *
 * Each value names a class of unsettled value the member is party to:
 * - `ACTIVE_CASH_SALE` — a Cash_Sale in any non-terminal status.
 * - `ACTIVE_TRADE_COLLATERAL` — an uncaptured Trade_Collateral authorisation.
 * - `PENDING_PAYOUT` — a queued or failed payout owed to the member.
 * - `OPEN_DISPUTE` — an open dispute or arbitration case.
 */
export type ClosureBlocker =
  | 'ACTIVE_CASH_SALE'
  | 'ACTIVE_TRADE_COLLATERAL'
  | 'PENDING_PAYOUT'
  | 'OPEN_DISPUTE';

/**
 * How much unsettled value a member is party to, one count per
 * {@link ClosureBlocker} category.
 *
 * These are counts of open records, not amounts of money. A count is expected to be
 * a non-negative integer; see {@link evaluateClosureEligibility} for how anything
 * else is treated.
 */
export interface MoneyInFlightSnapshot {
  /** Cash_Sales in a non-terminal status the member is a party to. */
  activeCashSaleCount: number;
  /** Uncaptured Trade_Collateral authorisations standing against the member. */
  activeTradeCollateralCount: number;
  /** Payouts owed to the member that are queued or have failed. */
  pendingPayoutCount: number;
  /** Open disputes or arbitration cases involving the member. */
  openDisputeCount: number;
}

/**
 * The verdict on a closure request.
 *
 * `blockers` is sorted deterministically and deduplicated, so two callers rendering
 * the same refusal list them in the same order (Req 7.3).
 */
export interface ClosureDecision {
  /** True if and only if `blockers` is empty. */
  closable: boolean;
  /** The categories blocking closure: sorted, deduplicated, possibly empty. */
  blockers: ClosureBlocker[];
}

/**
 * The deterministic order blockers are reported in.
 *
 * Declared once rather than sorted lexically at the end, so the order is a decision
 * rather than an accident of the enum spelling: goods first, then money owed, then
 * the process that would outlive both.
 */
const BLOCKER_ORDER: readonly ClosureBlocker[] = [
  'ACTIVE_CASH_SALE',
  'ACTIVE_TRADE_COLLATERAL',
  'PENDING_PAYOUT',
  'OPEN_DISPUTE',
];

/** Each blocker paired with the snapshot field that reports it. */
const BLOCKER_FIELDS: readonly (readonly [ClosureBlocker, keyof MoneyInFlightSnapshot])[] = [
  ['ACTIVE_CASH_SALE', 'activeCashSaleCount'],
  ['ACTIVE_TRADE_COLLATERAL', 'activeTradeCollateralCount'],
  ['PENDING_PAYOUT', 'pendingPayoutCount'],
  ['OPEN_DISPUTE', 'openDisputeCount'],
];

/**
 * Does this count, on its own, clear its category?
 *
 * A count clears only when it is a non-negative integer equal to zero. ANYTHING
 * ELSE — a negative number, a fraction, NaN, Infinity, or a non-number arriving
 * from an untyped boundary — is nonsense data and MUST NOT produce `closable: true`
 * on the strength of that field. A negative count is the case that matters: reading
 * `-1` as "nothing in flight" would let a closure through on a bad read, at exactly
 * the moment the member has an open contract and the platform is holding funds. So
 * unreadable is treated as blocking, not as clear, and the category is reported.
 */
function fieldIsClear(count: number): boolean {
  return Number.isInteger(count) && count === 0;
}

/**
 * Decide whether an account may be closed, and report what blocks it (Req 7.2, 7.3).
 *
 * A category appears in `blockers` if and only if its count is not a clean zero —
 * that is, when it is positive, or when it is unreadable in the sense described by
 * the negative-count rule above. `closable` is true if and only if `blockers` is
 * empty, so the all-zero snapshot is the only shape that closes an account.
 *
 * Pure: no I/O, no clock, no randomness. The same snapshot always yields the same
 * decision.
 *
 * @param s The member's Money_In_Flight counts.
 * @returns The verdict, with a sorted, deduplicated blocker list.
 */
export function evaluateClosureEligibility(s: MoneyInFlightSnapshot): ClosureDecision {
  const present = new Set<ClosureBlocker>();

  for (const [blocker, field] of BLOCKER_FIELDS) {
    if (!fieldIsClear(s[field])) {
      present.add(blocker);
    }
  }

  // Iterating the declared order is what makes the result sorted; the Set is what
  // makes it deduplicated. Both hold by construction rather than by convention.
  const blockers = BLOCKER_ORDER.filter((blocker) => present.has(blocker));

  return { closable: blockers.length === 0, blockers };
}
