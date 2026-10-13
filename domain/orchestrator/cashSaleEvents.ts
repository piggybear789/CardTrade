// domain/orchestrator/cashSaleEvents.ts
//
// Every `cash_sale_events.event` code the TypeScript writes (design §1.13 "Typed
// codes").
//
// `logEvent` used to take any string, so a new code shipped with no chat copy and the
// transcript said "The contract was updated." — or, before 0116, printed a raw detail.
// Narrowing the writer to this union is what lets `tests/unit/eventCopyCoverage.test.ts`
// prove every code has a branch in the newest `describe_cash_sale_event` (or is on the
// mirror's skip list). Add a code here and that test tells you to write its copy.
//
// Pure: no imports beyond types.

import type { CashSaleDisputeOutcome } from './cashSaleOrchestrator';

export type CashSaleEventCode =
  | 'AGREEMENT_CREATED'
  | 'TERMS_UPDATED'
  /** ESC-28: staff-only risk signal; hidden from participants by the 0134 policy. */
  | 'POSTAGE_OUTLIER'
  | 'PRICE_PROPOSED'
  | 'TERMS_ACCEPTED'
  | 'PAYMENT_REQUESTED'
  | 'PAYMENT_CLEARED'
  | 'PAYMENT_FAILED'
  | 'SHIPMENT_RECORDED'
  | 'RECEIPT_RECORDED'
  | 'INSPECTION_ACCEPTED'
  | 'HANDOVER_CONFIRMED'
  | 'CANCELLED'
  | 'DISPUTE_RAISED'
  | 'DISPUTE_WITHDRAWN'
  | 'DISPUTE_SETTLED_BY_PARTY'
  | 'DISPUTE_REFUND_FAILED'
  | `DISPUTE_RESOLVED_${CashSaleDisputeOutcome}`
  | 'RETURN_REQUIRED'
  | 'RETURN_SHIPPED'
  | 'RETURN_COMPLETED'
  | 'RETURN_DISPUTED'
  | 'RETURN_REFUND_FAILED'
  | 'RETURN_CASE_RESOLVED_REFUND_BUYER'
  | 'RETURN_CASE_RESOLVED_RELEASE_SELLER'
  | 'SELLER_PAYOUT_QUEUED'
  | 'SELLER_PAYOUT_SETTLED'
  | 'SELLER_PAYOUT_FAILED'
  /** ESC-02: tracking that cannot be this sale's parcel; staff decide (0134). */
  | 'TRACKING_FLAGGED'
  /** ESC-02: staff resolved a tracking flag. */
  | 'TRACKING_FLAG_RESOLVED'
  /** ESC-28 (WP5): staff-only risk signal; never mirrored, never member-readable. */
  | 'POSTAGE_OUTLIER'
  /** ESC-03: an abandoned 3-D Secure challenge was cancelled; back to AGREEMENT. */
  | 'PAYMENT_ABANDONED'
  /** ESC-14: refunded on an early fraud warning before anything shipped. */
  | 'REFUNDED_BEFORE_SHIPMENT'
  /** ESC-20: the in-person inspection window opened. */
  | 'IN_PERSON_INSPECTION_STARTED';
