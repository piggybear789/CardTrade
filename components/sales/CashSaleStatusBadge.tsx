// components/sales/CashSaleStatusBadge.tsx
//
// The single source of truth for how a Cash_Sale status reads (Req 4). The map
// lives here rather than inside the contract room so the room, the account
// "Purchases"/"Sales" lists, and any future surface all label the same status the
// same way — and so it renders through the shared <ContractStatusBadge/> that
// trades and deals use.

import {
  ContractStatusBadge,
  type ContractStatusMap,
} from '@/components/contract';
import type { Enums } from '@/lib/supabase/database.types';

/** The cash-sale lifecycle state enum. */
export type CashSaleStatus = Enums<'cash_sale_status'>;

/** Label + badge tone for each cash-sale status. */
export const CASH_SALE_STATUS_MAP: ContractStatusMap<CashSaleStatus> = {
  AGREEMENT: { label: 'Agreeing terms', tone: 'secondary' },
  PAYMENT_PENDING: { label: 'Payment pending', tone: 'secondary' },
  ESCROW_HELD: { label: 'Funds confirmed', tone: 'default' },
  IN_TRANSIT: { label: 'In transit', tone: 'default' },
  HANDOVER: { label: 'Handover', tone: 'default' },
  INSPECTION: { label: 'Inspection', tone: 'default' },
  COMPLETED: { label: 'Completed', tone: 'default' },
  DISPUTED: { label: 'Disputed', tone: 'destructive' },
  CANCELLED: { label: 'Cancelled', tone: 'outline' },
  FAILED: { label: 'Payment failed', tone: 'destructive' },
  REFUNDED: { label: 'Refunded', tone: 'outline' },
};

/** Statuses where the contract is closed and no action remains. */
export const CASH_SALE_TERMINAL_STATUSES: ReadonlySet<CashSaleStatus> = new Set([
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'REFUNDED',
]);

export interface CashSaleStatusBadgeProps {
  status: CashSaleStatus;
  className?: string;
}

/** A badge showing the given cash-sale status. */
export function CashSaleStatusBadge({
  status,
  className,
}: CashSaleStatusBadgeProps) {
  return (
    <ContractStatusBadge
      status={status}
      map={CASH_SALE_STATUS_MAP}
      kind="Sale status"
      className={className}
    />
  );
}
