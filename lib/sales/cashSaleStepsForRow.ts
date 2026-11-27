// lib/sales/cashSaleStepsForRow.ts
//
// A cash sale's step plan from its row, for surfaces that read sales in bulk or in
// passing: the Purchases and Sales lists, and the notification list, which says when a
// sale it points at is waiting on the reader. The contract room builds its plan from a
// fuller viewer read; this is the same derivation fed from the columns those lighter
// surfaces select.
//
// ONE MAPPING, the sale twin of `lib/trades/tradeStepsForRow.ts`. It lived inline in the
// account lists; the notification list needed the same answer, and two copies of "which
// row fields feed the plan" would drift the first time a fact was added.

import {
  deriveCashSaleSteps,
  isCashSaleStatus,
  type ContractStep,
} from '@/domain/contract';

/**
 * The columns {@link cashSaleStepsForRow} reads, to add to a select. Column for column,
 * `lib/api/contractStepPlan.ts`'s mapping, which is itself `CashSaleView`'s.
 */
export const CASH_SALE_STEP_COLUMNS = [
  'status',
  // Identify the viewer's side and the counterparty, whose name the step copy uses.
  'buyer_id',
  'seller_id',
  'fulfillment_method',
  'terms_version',
  'tracking_number',
  'buyer_handover_confirmed_at',
  'seller_handover_confirmed_at',
  'disputed_by',
  'return_tracking_number',
  'return_disputed_at',
  'return_carrier_delivered_at',
  'return_inspection_deadline_at',
] as const;

/** The row fields the plan reads: {@link CASH_SALE_STEP_COLUMNS}, typed. */
export interface CashSaleStepRow {
  status: string;
  buyer_id: string;
  seller_id: string;
  fulfillment_method: string | null;
  terms_version: number;
  tracking_number: string | null;
  buyer_handover_confirmed_at: string | null;
  seller_handover_confirmed_at: string | null;
  disputed_by: string | null;
  return_tracking_number: string | null;
  return_disputed_at: string | null;
  return_carrier_delivered_at: string | null;
  return_inspection_deadline_at: string | null;
}

/**
 * The plan as `viewerId` sees it, or `[]` when the viewer is not a party to the sale or
 * its status is one this build does not recognise.
 *
 * The guard rather than a cast: a status a later migration adds must produce no next
 * move rather than a plan that looks derived and is not. Same reasoning as
 * `cashSaleStepPlan`, which refuses outright.
 *
 * `haltedAt` IS DELIBERATELY NOT SUPPLIED. Reading it means one `cash_sale_events` query
 * per contract, and all it refines is WHICH step a closed contract marks as halted. A
 * closed contract has no live step either way, so `currentStep` is null and these
 * surfaces show no next move for one: the refinement would change nothing here. The
 * contract room, where the halt point IS the point, still reads it.
 */
export function cashSaleStepsForRow(
  row: CashSaleStepRow,
  viewerId: string,
  counterpartyName: string,
): ContractStep[] {
  const status: unknown = row.status;
  if (!isCashSaleStatus(status)) return [];
  if (row.buyer_id !== viewerId && row.seller_id !== viewerId) return [];
  const iAmBuyer = row.buyer_id === viewerId;
  return deriveCashSaleSteps({
    status,
    viewerRole: iAmBuyer ? 'BUYER' : 'SELLER',
    counterpartyName,
    termsSet: row.fulfillment_method !== null,
    termsVersion: row.terms_version,
    isDelivery: row.fulfillment_method === 'DELIVERY',
    hasTracking: Boolean(row.tracking_number),
    myHandoverConfirmed: Boolean(
      iAmBuyer ? row.buyer_handover_confirmed_at : row.seller_handover_confirmed_at,
    ),
    theirHandoverConfirmed: Boolean(
      iAmBuyer ? row.seller_handover_confirmed_at : row.buyer_handover_confirmed_at,
    ),
    disputeRaisedByMe: row.disputed_by === viewerId,
    hasReturnTracking: Boolean(row.return_tracking_number),
    returnDisputed: Boolean(row.return_disputed_at),
    returnCarrierDeliveredAt: row.return_carrier_delivered_at ?? null,
    returnInspectionDeadlineAt: row.return_inspection_deadline_at ?? null,
  });
}
