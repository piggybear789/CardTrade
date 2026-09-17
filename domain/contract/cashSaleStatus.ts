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
