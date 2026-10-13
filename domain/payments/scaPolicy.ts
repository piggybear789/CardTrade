// domain/payments/scaPolicy.ts
//
// When a buyer-present collection must ask the issuer for a 3-D Secure challenge
// (ESC-03 layer 2). Pure.
//
// `'any'` asks for a challenge whenever the card supports one; `'automatic'` leaves
// it to Stripe's and the issuer's risk engines. A challenge is friction, so it is
// forced only where card-testing and stolen-card cash-out concentrate: a buyer's
// first few purchases, and any amount large enough to be worth stealing a card for.
// A successful challenge also moves fraud liability for the charge to the issuer.

/** Amounts at or above this (minor units) are always challenged. */
export const THREE_DS_ALWAYS_ABOVE_MINOR: Readonly<Record<string, number>> = {
  aud: 25_000,
  usd: 20_000,
};

/** A buyer with fewer completed purchases than this is always challenged. */
export const NEW_BUYER_PURCHASES = 3;

export type ThreeDSRequest = 'any' | 'automatic';

/**
 * Decide the 3-D Secure request for one collection.
 *
 * An unlisted currency is always challenged: there is no calibrated threshold for
 * it, and guessing one in a money path is the wrong default.
 */
export function decideThreeDS(params: {
  completedPurchases: number;
  amountMinor: number;
  currency: string;
}): ThreeDSRequest {
  const threshold = THREE_DS_ALWAYS_ABOVE_MINOR[params.currency.toLowerCase()];
  if (threshold === undefined) return 'any';
  if (params.completedPurchases < NEW_BUYER_PURCHASES) return 'any';
  if (params.amountMinor >= threshold) return 'any';
  return 'automatic';
}
