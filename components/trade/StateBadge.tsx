'use client';

// components/trade/StateBadge.tsx
//
// Renders the current Trade_State as a badge (Req 11.1). Each state maps to a
// label + tone, then renders through the shared <ContractStatusBadge/> so a
// trade's status is presented identically to a cash sale's. This file owns only
// the Trade_State vocabulary.

import {
  ContractStatusBadge,
  type ContractStatusMap,
} from '@/components/contract';
import type { TradeState } from '@/domain/state-machine/types';

/** Visual treatment for each Trade_State. */
export const TRADE_STATUS_MAP: ContractStatusMap<TradeState> = {
  // "Negotiating", not "Pending": the members are actively countering each other,
  // and nothing is waiting on the platform.
  NEGOTIATING: { label: 'Negotiating', tone: 'secondary' },
  COLLATERAL_PENDING: { label: 'Collateral pending', tone: 'secondary' },
  COLLATERAL_LOCKED: { label: 'Collateral locked', tone: 'default' },
  IN_TRANSIT: { label: 'In transit', tone: 'default' },
  INSPECTION: { label: 'Inspection', tone: 'default' },
  COMPLETED: { label: 'Completed', tone: 'default' },
  DISPUTED: { label: 'Disputed', tone: 'destructive' },
  FRAUD_RESOLVED: { label: 'Fraud resolved', tone: 'destructive' },
  // Declined or withdrawn before terms were agreed. Neutral tone on purpose:
  // walking away from an offer is a normal outcome, not a failure.
  CANCELLED: { label: 'Cancelled', tone: 'secondary' },
};

export interface StateBadgeProps {
  state: TradeState;
  className?: string;
}

/** A badge showing the given Trade_State (Req 11.1). */
export function StateBadge({ state, className }: StateBadgeProps) {
  return (
    <ContractStatusBadge
      status={state}
      map={TRADE_STATUS_MAP}
      kind="Trade state"
      className={className}
    />
  );
}
