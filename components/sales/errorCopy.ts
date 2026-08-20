// components/sales/errorCopy.ts
// One member-facing copy map for every Cash_Sale action failure (Req 4).
//
// This is shared rather than duplicated because the terms editor previously had
// no map at all: it fell back to "Terms changed elsewhere" for EVERY failure,
// so an operational error, a rejected address and a genuine concurrent edit all
// read as a version conflict that had not happened. A failure must name the
// thing that actually went wrong or the member cannot act on it.

import type { CashSaleActionError, CashSaleActionResult } from '@/lib/actions/cashSale';

export const CASH_SALE_ERROR_MESSAGES: Record<CashSaleActionError, string> = {
  'not-authenticated': 'Please sign in again.',
  'no-payment-method': 'Add a payment method before you can continue.',
  'buyer-confirmation-required': 'Confirm the verified seller before continuing.',
  // Names the step that is ACTUALLY missing. This said "has not completed payout
  // onboarding", which since 0069 is a different step: the disclosure is withheld
  // because the seller has not passed the identity check, and a buyer told to wait on
  // bank setup would be watching the wrong thing. `seller-not-payable` below is the
  // one that really is about payouts.
  'seller-identity-unverified': 'The seller has not verified their identity yet.',
  'seller-identity-changed': 'The seller identity changed. Review it before continuing.',
  'seller-not-payable': 'The seller cannot receive payment right now.',
  // Fallback only. The orchestrator sends a `detail` naming both regions, and
  // `cashSaleErrorMessage` prefers it — which matters here more than for most codes,
  // because "different region" without saying WHICH leaves the member unable to tell
  // a fixable cause (no region set on their own profile) from a permanent one (the
  // seller is overseas).
  'region-mismatch': 'Deals are completed within one region, and this listing is in another.',
  'item-not-found': 'That item no longer exists.',
  'item-unavailable': 'That item is no longer available.',
  'self-purchase': 'You cannot buy your own listing.',
  'cash-sale-not-found': 'This contract no longer exists.',
  'not-participant': 'You are not part of this contract.',
  'not-permitted': 'Only the other party can do that.',
  'invalid-terms': 'Complete the fulfillment terms first.',
  'stale-terms': 'The terms changed. Review the current version.',
  'terms-update-failed': 'Could not save the terms right now. Refresh and try again.',
  'already-recorded': 'You already did that.',
  'not-supported': 'That is not available for this contract.',
  'invalid-state': 'This contract has moved on.',
  'transfer-failed': 'The payment could not be collected.',
  'refund-failed': 'The refund was rejected by the provider.',
  'invalid-refund-amount': 'That refund amount is not valid for this contract.',
  'nothing-to-refund': 'Nothing was collected on this contract, so there is nothing to refund.',
};

/**
 * Member-facing copy for a failed Cash_Sale action.
 *
 * The server's own `message` wins when present, because the domain layer knows
 * which of several guards refused the write; the map is the fallback for codes
 * that carry no detail.
 */
export function cashSaleErrorMessage(
  result: Extract<CashSaleActionResult, { ok: false }>,
): string {
  return result.message ?? CASH_SALE_ERROR_MESSAGES[result.error] ?? 'Something went wrong.';
}
