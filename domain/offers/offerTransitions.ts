// domain/offers/offerTransitions.ts
//
// The one Offer status rule (ESC-22).
//
// Members used to hold `update (status)` on `cardtrade.offers`, guarded only by a
// party-scoped RLS policy. Either party could therefore move any of their offers to
// any status directly through PostgREST — revive a DECLINED or COUNTERED offer back to
// PENDING, or mark one ACCEPTED without a contract ever being opened. Status writes now
// go through the service role in `lib/actions/offers.ts`, and every one of them asks
// this table first.
//
// Only a PENDING offer moves, and only to a terminal outcome. Nothing returns to
// PENDING; a counter is a NEW offer row.
//
// Pure: no imports.

export type OfferStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'COUNTERED' | 'WITHDRAWN';

const ALLOWED: Readonly<Record<OfferStatus, readonly OfferStatus[]>> = {
  PENDING: ['ACCEPTED', 'DECLINED', 'COUNTERED', 'WITHDRAWN'],
  ACCEPTED: [],
  DECLINED: [],
  COUNTERED: [],
  WITHDRAWN: [],
};

export type OfferTransitionResult = { ok: true } | { ok: false; error: 'INVALID_TRANSITION' };

/** Whether an offer may move from `from` to `to`. */
export function offerTransition(from: OfferStatus, to: OfferStatus): OfferTransitionResult {
  return ALLOWED[from]?.includes(to) ? { ok: true } : { ok: false, error: 'INVALID_TRANSITION' };
}
