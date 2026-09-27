// domain/fees/feeMinimums.ts
//
// The minimum Platform_Fee and Trade_Fee, per currency, in ONE place.
//
// WHY A MINIMUM EXISTS. The provider's costs have a FIXED part and a percentage fee
// does not. A card charge costs roughly 1.7% + $0.30 on the whole amount, and a
// Connect payout roughly 0.25% + $0.25, so on a $10 card posted for $10 the 5% fee
// ($0.50) is less than the cost of moving the money (~$0.96). Every low-value contract
// lost money by construction. A floor fixes the shape of the fee rather than its rate:
// above the crossover (~$30 for a cash sale) the percentage is larger and the floor
// never applies.
//
// PER CONTRACT, NOT PER CARD. The floor is applied to a contract's fee, so a buyer
// taking eight $3 cards out of a binder pays one minimum on a $24 contract. That is
// the behaviour we want to encourage: one set of fixed costs spread over more goods.
//
// PER CURRENCY, AND ABSENT MEANS NO FLOOR. These are integer minor units whose intent
// is a dollar figure, so a single constant would be the `FRICTION_TAX_CENTS` trap
// again — 150 is $1.50 but ¥150 is about a dollar and a half only by coincidence. A
// currency with no entry gets the plain percentage, which is exactly the behaviour
// before this module existed. That direction is deliberate: an unpriced currency may
// under-collect on a small contract, but it can never be overcharged by a guess.
//
// Pure module: no I/O, no provider types.

/**
 * Minimum Platform_Fee on a Cash_Sale, per ISO 4217 code (lowercase), in minor units.
 * AUD $1.50: covers card + payout costs on a contract with postage up to about $40.
 */
export const PLATFORM_FEE_MINIMUM_MINOR: Readonly<Record<string, number>> = {
  aud: 150,
};

/**
 * Minimum Trade_Fee per trader, per ISO 4217 code (lowercase), in minor units.
 * AUD $1.00: each trader's fee is its own card charge (~1.7% + $0.30) and a trade
 * has no payout to fund, so the floor is lower than the cash-sale one.
 */
export const TRADE_FEE_MINIMUM_MINOR: Readonly<Record<string, number>> = {
  aud: 100,
};

/** The minimum for `currency` in `table`, or 0 when that currency has no floor. */
export function feeMinimumMinor(
  table: Readonly<Record<string, number>>,
  currency: string | null | undefined,
): number {
  if (!currency) return 0;
  const minimum = table[currency.trim().toLowerCase()];
  return Number.isInteger(minimum) && minimum > 0 ? minimum : 0;
}

/**
 * A percentage fee on `baseMinor`, raised to `minimumMinor` when it falls below.
 *
 * A base of zero (or less) yields zero, never the minimum: a valueless side of a
 * trade has nothing to charge against, and a contract cannot have a zero price.
 * A rate of zero also yields zero, so setting the rate to 0 still switches the fee
 * off entirely rather than leaving a flat charge behind.
 * Rounded to the nearest minor unit, matching the pre-floor arithmetic exactly.
 */
export function percentageFeeWithMinimum(
  baseMinor: number,
  rateBps: number,
  minimumMinor: number,
): number {
  const base = Math.max(Math.trunc(baseMinor), 0);
  if (base === 0 || rateBps <= 0) return 0;
  const percentage = Math.round((base * rateBps) / 10_000);
  return Math.max(percentage, Math.max(Math.trunc(minimumMinor), 0));
}
