// domain/fees/percentageFee.ts
//
// The rounding rule for a plain percentage fee, used by the Trade_Fee
// (`domain/trade/tradeFee.ts`, currently at a rate of 0). The cash-sale fee is the
// Processing_Fee (`processingFee.ts`), which has its own pass-through formula.
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
