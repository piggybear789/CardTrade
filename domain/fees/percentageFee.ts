// domain/fees/percentageFee.ts
//
// The ONE rounding rule for the Platform_Fee (Cash_Sale) and the Trade_Fee.
//
// NO MINIMUM, DELIBERATELY. A per-currency floor ($1.50 per Cash_Sale, $1.00 per
// trader) existed briefly and was removed on purpose. Below about $30 a cash sale no
// longer covers the provider's fixed costs (card ~$0.30, payout ~$0.25); that
// trade-off is accepted. Do not reintroduce a floor without a product decision.
//
// Pure module: no I/O, no provider types.

/**
 * `rateBps` of `baseMinor`, rounded to the nearest minor unit. A base of zero (or
 * less) or a rate of zero yields zero. No minimum is applied.
 */
export function percentageFeeMinor(baseMinor: number, rateBps: number): number {
  const base = Math.max(Math.trunc(baseMinor), 0);
  if (base === 0 || rateBps <= 0) return 0;
  return Math.round((base * rateBps) / 10_000);
}
