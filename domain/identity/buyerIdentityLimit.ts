// domain/identity/buyerIdentityLimit.ts
//
// When a CASH BUYER must pass the Identity_Gate before paying.
//
// A cash buyer normally needs no ID: their money is collected before anything ships,
// they are only ever refunded to the card or bank they paid from, and 3-D Secure
// already challenges new buyers and large amounts (`domain/payments/scaPolicy.ts`).
// What ID adds is accountability for the purchases where a loss would be largest: a
// fraud-banned buyer cannot come back under a new email once their person is on the
// blocklist, and a slab swapped on a return has a known person behind it. So a single
// purchase priced over the limit below needs the buyer verified; anything at or under
// it does not.
//
// PER SALE, ON THE PRICE. The figure compared is the sale's agreed price (the sum of
// its lines on a binder sale), not the charged total: postage and the service fee move
// with the way of paying, and a limit that a buyer crosses by choosing card over bank
// would read as arbitrary. The check runs at Pay, the commitment point, so every way
// into a cash sale (Buy Now, an accepted offer, a private deal) meets it once.
//
// THE SAME GATE, NOT A SECOND ONE. Verified means `satisfiesIdentityGate`, exactly what
// a seller passes. There is no buyer-specific verification status.
//
// EVERY TRADING CURRENCY NEEDS AN ENTRY. An unlisted currency requires ID for every
// purchase rather than guessing a figure in a money path. Round local amounts: 5,000
// in the two-decimal majors, and about US$5,000 in the rest.
//
// Pure: no Supabase, React or service imports.

import { satisfiesIdentityGate, type IdentityCheckStatus } from './identityGate';

/**
 * The highest price (minor units) an unverified buyer may pay in one cash sale, per
 * contract currency. A price above it needs the buyer's identity verified first.
 */
export const UNVERIFIED_BUYER_PRICE_LIMIT_MINOR: Readonly<Record<string, number>> = {
  aud: 500_000,
  usd: 500_000,
  eur: 500_000,
  gbp: 500_000,
  cad: 500_000,
  chf: 500_000,
  sek: 5_000_000,
  nok: 5_000_000,
  dkk: 3_500_000,
  pln: 2_000_000,
  czk: 12_000_000,
  ron: 2_500_000,
  bgn: 900_000,
};

/** The unverified-buyer limit for `currency`, or null when the currency has no entry. */
export function unverifiedBuyerPriceLimitMinor(currency: string | null | undefined): number | null {
  const code = currency?.trim().toLowerCase();
  if (!code) return null;
  return UNVERIFIED_BUYER_PRICE_LIMIT_MINOR[code] ?? null;
}

/**
 * Whether a sale at `priceMinor` is over the unverified-buyer limit, whoever the buyer
 * is. A currency with no limit is always over it. The sale room uses this to ask an
 * unverified buyer to verify before Pay; the orchestrator uses
 * {@link buyerMustVerifyIdentity}, which is this plus the buyer's own status.
 */
export function priceNeedsVerifiedBuyer(
  priceMinor: number,
  currency: string | null | undefined,
): boolean {
  const limit = unverifiedBuyerPriceLimitMinor(currency);
  if (limit === null) return true;
  return priceMinor > limit;
}

/**
 * Whether the buyer must verify their identity before paying for a sale at
 * `priceMinor`. False for a verified buyer, and for any price at or under the limit.
 * A currency with no limit requires ID.
 */
export function buyerMustVerifyIdentity(p: {
  priceMinor: number;
  currency: string | null | undefined;
  identityCheckStatus: IdentityCheckStatus | null | undefined;
}): boolean {
  if (satisfiesIdentityGate({ identityCheckStatus: p.identityCheckStatus ?? 'NONE' })) return false;
  return priceNeedsVerifiedBuyer(p.priceMinor, p.currency);
}
