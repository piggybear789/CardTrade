// domain/fees/postagePolicy.ts
//
// ESC-28: postage is a pass-through, so it must not become a way to move the price.
//
// The Platform_Fee is charged on the item price only, and the seller sets postage.
// Nothing bounded it, so "$1 card, $400 postage" moved the real price into a field
// the fee never sees, and an inflated postage figure is also the usual shape of a
// buyer being overcharged. This module bounds postage and says how much of it counts
// toward the fee. Pure, so the orchestrator, the disclosure and the tests share it.
//
// Amounts are in the currency's minor unit.

/** Postage up to this much is fee-free: an ordinary tracked parcel. */
export const POSTAGE_FEE_FREE_ALLOWANCE_MINOR = 2_500;

/** No contract may carry more postage than this, whatever the item price. */
export const POSTAGE_ABSOLUTE_CAP_MINOR = 15_000;

/** Postage above this share of the item price is flagged for staff (POSTAGE_OUTLIER). */
export const POSTAGE_OUTLIER_SHARE = 0.5;

/**
 * The most postage a contract for `itemMinor` may carry: the item price, but never
 * below the fee-free allowance (a cheap card still needs a tracked parcel) and never
 * above the absolute cap.
 */
export function postageCapMinor(itemMinor: number): number {
  const item = Math.max(0, Math.trunc(itemMinor));
  return Math.min(POSTAGE_ABSOLUTE_CAP_MINOR, Math.max(POSTAGE_FEE_FREE_ALLOWANCE_MINOR, item));
}

/**
 * What the Platform_Fee is charged on: the item price plus any postage above the
 * fee-free allowance. Never below the item price; non-decreasing in postage.
 */
export function feeBaseMinor(itemMinor: number, postageMinor: number): number {
  const item = Math.max(0, Math.trunc(itemMinor));
  const postage = Math.max(0, Math.trunc(postageMinor));
  return item + Math.max(0, postage - POSTAGE_FEE_FREE_ALLOWANCE_MINOR);
}

/** True when postage is an outlier worth a staff look. Never a refusal. */
export function isPostageOutlier(itemMinor: number, postageMinor: number): boolean {
  return postageMinor > POSTAGE_FEE_FREE_ALLOWANCE_MINOR && postageMinor > itemMinor * POSTAGE_OUTLIER_SHARE;
}
