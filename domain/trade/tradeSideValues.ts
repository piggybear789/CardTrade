// domain/trade/tradeSideValues.ts
//
// What each side of a Trade is WORTH, for the two things that turn a valuation
// into money: collateral sizing and the Trade_Fee.
//
// WHY THIS EXISTS. Both of those numbers used to be derived by summing
// `items.fmv_cents` over each side's `trade_items`, in two separate places — the
// bond sizing in `placeBondsForAgreedTrade` and the fee sizing in
// `acceptTradeTerms`. That is correct as long as every item on the table is one
// object with one price. A binder is not: its `fmv_cents` is an indicative "from"
// figure for a whole inventory (0064), so summing it would authorise a card for
// the value of an entire collection and charge 5% of it.
//
// So the rule lives here, once, and both call sites read it. Two places deriving
// one money figure is the shape of bug this codebase has already paid for twice.

/**
 * The binder rule: a SHOPFRONT side is worth what is offered against it.
 *
 * A 2-Way Trade is an equal-value swap by construction — that is what makes 100%
 * collateral on both sides symmetric and fair. When one side is a binder there is
 * no determinate figure for the goods actually changing hands, so the only value
 * both traders have actually agreed on is the one they can both see: the bundle
 * put up against it. The binder side is therefore valued AT that bundle, and any
 * extra items the binder's owner adds are part of what they hand over rather than
 * an addition on top — there is no second number to add them to.
 *
 * The alternative was asking the initiator to type what they think they are asking
 * for out of the binder. That is a second self-declared figure, and
 * `trades.declared_value_cents` already exists as exactly that and is documented
 * as NEVER sizing a bond, for the good reason that a number one party invents
 * cannot decide how much of the other party's money gets authorised.
 *
 * @returns the value of each side in integer minor currency units.
 */
export function resolveTradeSideValues(params: {
  /** Sum of `fmv_cents` over the initiator's goods. */
  initiatorGoodsCents: number;
  /** Sum of `fmv_cents` over the counterpart's goods, binder included. */
  counterpartGoodsCents: number;
  /** True when the listing the trade was opened against is a SHOPFRONT (0064). */
  counterpartIsShopfront: boolean;
}): { initiatorSideCents: number; counterpartSideCents: number } {
  const initiatorSideCents = Math.max(Math.trunc(params.initiatorGoodsCents), 0);
  if (!params.counterpartIsShopfront) {
    return {
      initiatorSideCents,
      counterpartSideCents: Math.max(Math.trunc(params.counterpartGoodsCents), 0),
    };
  }
  return { initiatorSideCents, counterpartSideCents: initiatorSideCents };
}

/**
 * Whether a Trade can be collateralised at all.
 *
 * Zero is refused rather than treated as "no bond needed". `requiredBondCents`
 * returns 0 for a side worth 0, and the acceptance path reads a total of 0 bonds
 * as "nobody owes one" and confirms escrow immediately — which on a binder trade
 * would mean an exchange with no collateral behind it, i.e. the safety machinery
 * silently switched off. On a binder it is also reachable, because the binder side
 * inherits its value from the other side.
 */
/**
 * THE ONE FIGURE A TRADE IS WORTH, for display.
 *
 * The rooms used to headline `$159.00 ⇄ $145.00`, which puts the two sides'
 * valuations next to each other and invites the reader to check whether they
 * balance. They frequently do not — a 2-Way Trade is an equal-value swap by
 * intent, not by arithmetic on two independently priced sides, and the cash leg
 * exists precisely to settle the gap. Showing the gap as the headline made
 * every trade look mispriced.
 *
 * So one number: the value the two of them agreed on. `declared_value_cents` is
 * that figure whenever it was recorded (migration 0052 calls it the agreed value
 * basis). It is nullable, so the goods fall back to the larger side — the same
 * quantity a fraud finding captures, and never smaller than what either trader
 * has put up. The cash leg is folded in rather than trailed as `+ $20.00 cash`,
 * because the total consideration is the thing being stated.
 *
 * NOTE: this is presentation only. Collateral and the Trade_Fee are still sized
 * per side by `resolveTradeSideValues` and must not read this.
 *
 * @returns the agreed value in integer minor currency units.
 */
export function tradeAgreedValueCents(params: {
  /** `trades.declared_value_cents`, when the terms recorded one. */
  declaredValueCents: number | null | undefined;
  initiatorSideCents: number;
  counterpartSideCents: number;
  /** The cash leg, in either direction. */
  cashAmountCents: number;
}): number {
  const declared = params.declaredValueCents ?? 0;
  const goodsCents =
    declared > 0
      ? Math.trunc(declared)
      : Math.max(params.initiatorSideCents, params.counterpartSideCents, 0);
  return goodsCents + Math.max(Math.trunc(params.cashAmountCents), 0);
}

export function tradeSidesAreValued(sides: {
  initiatorSideCents: number;
  counterpartSideCents: number;
}): boolean {
  return sides.initiatorSideCents > 0 && sides.counterpartSideCents > 0;
}
