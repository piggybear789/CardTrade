'use client';

// components/deals/DealStateBadge.tsx
//
// Renders a private deal's state as a badge. Covers all eight `deal_state` values
// and renders through the shared <ContractStatusBadge/>, so the deal room, the
// "My deals" list, and any future surface read the same labels with the same
// treatment as a cash sale or a trade.

import {
  ContractStatusBadge,
  type ContractStatusMap,
} from '@/components/contract';
import type { Enums } from '@/lib/supabase/database.types';

/** The deal lifecycle state enum. */
export type DealState = Enums<'deal_state'>;

/** Label + badge tone for each deal state. */
export const DEAL_STATUS_MAP: ContractStatusMap<DealState> = {
  INVITED: { label: 'Awaiting counterparty', tone: 'secondary' },
  TERMS: { label: 'Agreeing terms', tone: 'secondary' },
  CONFIRMATION: { label: 'Awaiting confirmation', tone: 'outline' },
  ESCROW_PENDING: { label: 'Placing collateral', tone: 'outline' },
  ESCROW_LOCKED: { label: 'Binding — collateral locked', tone: 'default' },
  COMPLETED: { label: 'Completed', tone: 'default' },
  CANCELLED: { label: 'Cancelled', tone: 'secondary' },
  DISPUTED: { label: 'Disputed', tone: 'destructive' },
};

export interface DealStateBadgeProps {
  state: DealState;
  className?: string;
}

/** A badge showing the given deal state. */
export function DealStateBadge({ state, className }: DealStateBadgeProps) {
  return (
    <ContractStatusBadge
      status={state}
      map={DEAL_STATUS_MAP}
      kind="Deal state"
      className={className}
    />
  );
}
