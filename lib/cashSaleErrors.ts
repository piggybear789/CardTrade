// lib/cashSaleErrors.ts
//
// Member-facing copy for a refused Cash_Sale, in ONE place.
//
// A Cash_Sale is opened from more than one surface — the Buy button on a listing
// and accepting an Offer — and both have to explain the same refusals. When each
// kept its own map they drifted, and worse, BOTH WERE WRONG:
//
//   * `OffersSection` collapsed every failure into "the item may no longer be
//     available". Not merely vague — untrue for the commonest case. A buyer with
//     no saved card was told the goods were gone, so they abandoned a purchase
//     that needed one more click.
//   * `BuyButton` kept a kebab-case map (`'no-payment-method'`, `'item-unavailable'`)
//     while `CashSaleError` is SCREAMING_SNAKE. Not one key ever matched. It only
//     looked fine because the action also returns a `message`, which was being
//     read first — the map was dead code that appeared to work.
//
// KEYS MUST MATCH `CashSaleError` in domain/orchestrator/cashSaleOrchestrator.ts
// EXACTLY. That is the only reason this file is correct, and the only thing to
// re-check when that union changes.

/**
 * Refusal codes a member can actually cause, mapped to copy that tells them what
 * to do next.
 *
 * Deliberately NOT exhaustive over `CashSaleError`. Codes that describe an
 * internal or operator-side failure (`PAYOUT_FAILED`, `REFUND_FAILED`,
 * `CASH_SALE_NOT_FOUND`, `INVALID_STATE`, …) are left out: there is no member
 * action that resolves them, so inventing reassuring copy would hide a problem
 * that needs the server's own message and a support conversation.
 */
export const CASH_SALE_REFUSAL_COPY: Record<string, string> = {
  // ACTIONABLE, and it must stay that way. This is the refusal that used to be
  // reported as "the item may no longer be available".
  BUYER_NO_PAYMENT_METHOD: 'Add a card before opening this contract.',
  BUYER_CONFIRMATION_REQUIRED: 'Confirm the verified seller identity to continue.',
  // Two DIFFERENT blocks, and they must not read the same. Identity is step one and
  // is what withholds the disclosure; payability is step two (0069). Saying
  // "verified to receive payment" for the first conflated them.
  SELLER_IDENTITY_UNVERIFIED: 'This seller has not verified their identity yet.',
  SELLER_IDENTITY_CHANGED:
    'The seller identity changed. Close and review the current details.',
  SELLER_NOT_PAYABLE: 'This seller cannot receive payment yet.',
  // A precondition, not a judgement on either party (0065) — so the copy blames
  // neither.
  REGION_MISMATCH: 'You and this seller trade in different regions.',
  ITEM_NOT_FOUND: 'This listing is no longer available.',
  ITEM_UNAVAILABLE: 'This listing is no longer available to buy.',
  SELF_PURCHASE: 'You cannot buy your own listing.',
  INVALID_TERMS: 'These terms are not valid. Ask the seller to review them.',
  STALE_TERMS: 'The terms changed. Reload and review them before accepting.',
  TRANSFER_FAILED: 'The contract could not be opened. Please try again.',
};

/**
 * Copy for a refused contract open.
 *
 * @param code   the `CashSaleError` code, when one is known
 * @param detail the server's own message, preferred over the generic fallback —
 *               a specific message the server took the trouble to send is worth
 *               more than anything this file could invent for an unmapped code
 */
export function cashSaleRefusalMessage(
  code: string | null | undefined,
  detail?: string | null,
): string {
  if (code && CASH_SALE_REFUSAL_COPY[code]) return CASH_SALE_REFUSAL_COPY[code];
  return detail ?? 'The contract could not be opened. Please try again.';
}
