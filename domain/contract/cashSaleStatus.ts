// domain/contract/cashSaleStatus.ts
//
// Shared Cash_Sale lifecycle predicates used outside any one UI or repository.
// Keeping terminality here prevents contract selection, account closure, and
// status badges from inventing different meanings for the same persisted state.

/** Cash_Sale statuses with no remaining contractual action. */
export const CASH_SALE_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'REFUNDED',
]);

/** True when a Cash_Sale status is closed rather than active or returning. */
export function isTerminalCashSaleStatus(status: string): boolean {
  return CASH_SALE_TERMINAL_STATUSES.has(status);
}

/**
 * Whether this viewer may report a problem on a posted sale that was never posted
 * (0132).
 *
 * True only for the BUYER of a DELIVERY sale still waiting in ESCROW_HELD after the
 * hourly sweep found its ship-by date passed (`ship_lapsed_at`). The server has always
 * accepted a dispute from ESCROW_HELD, but the room offered none there, so a seller who
 * never posted left the buyer's payment held with nothing in the product able to move
 * it on. Never true for the seller, whose remedy is to post it.
 *
 * Kept with the lifecycle predicates rather than in the room so it can be held to
 * `cashSaleMarkerCase`, the rule that lists the same sale for staff as "Not shipped".
 * The staff guidance on that case says the buyer can report a problem; this is what
 * makes it true.
 */
export function canReportUnpostedSale(
  sale: { status: string; fulfillmentMethod: string | null; shipLapsedAt: string | null },
  viewerRole: 'BUYER' | 'SELLER',
): boolean {
  return (
    viewerRole === 'BUYER' &&
    sale.status === 'ESCROW_HELD' &&
    sale.fulfillmentMethod === 'DELIVERY' &&
    Boolean(sale.shipLapsedAt)
  );
}
