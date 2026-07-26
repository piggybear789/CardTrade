// lib/lifecycle.ts
//
// Which states mean "this is over". Kept in one place so every section agrees on
// what counts as history, rather than each page inventing its own list.

import type { Enums } from '@/lib/supabase/database.types';

/**
 * A Trade is done when it completed or was resolved as fraud. DISPUTED is still
 * live: somebody is waiting on an outcome.
 */
export function isTradePast(state: Enums<'trade_state'>): boolean {
  return state === 'COMPLETED' || state === 'FRAUD_RESOLVED';
}

/**
 * A Cash_Sale is done when the goods and money have settled, or when it ended
 * without them: cancelled, failed, or refunded.
 */
export function isCashSalePast(status: Enums<'cash_sale_status'>): boolean {
  return (
    status === 'COMPLETED' ||
    status === 'CANCELLED' ||
    status === 'FAILED' ||
    status === 'REFUNDED'
  );
}

/**
 * A private deal is done when it completed or was cancelled. DISPUTED stays live,
 * for the same reason as a Trade: an outcome is still owed.
 */
export function isDealPast(state: Enums<'deal_state'>): boolean {
  return state === 'COMPLETED' || state === 'CANCELLED';
}

/**
 * An Offer negotiation is done once it has been decided one way or another.
 * Only PENDING (awaiting a decision from either side) is active; COUNTERED
 * closes the countered offer itself even though the negotiation continues under
 * a new offer row, so it reads as history like the others.
 */
export function isOfferPast(status: Enums<'offer_status'>): boolean {
  return status !== 'PENDING';
}
