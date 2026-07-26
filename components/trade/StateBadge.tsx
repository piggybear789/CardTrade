'use client';

// components/trade/StateBadge.tsx
//
// Renders the current Trade_State as a badge (Req 11.1). Each of the seven
// canonical states maps to a badge variant + human-readable label so the live
// escrow status is legible at a glance. Terminal states (COMPLETED,
// FRAUD_RESOLVED) get a distinct treatment.

import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { TradeState } from '@/domain/state-machine/types';

/** Visual treatment for each Trade_State. */
const STATE_BADGE: Record<
  TradeState,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  COLLATERAL_PENDING: { label: 'Collateral pending', variant: 'secondary' },
  COLLATERAL_LOCKED: { label: 'Collateral locked', variant: 'default' },
  IN_TRANSIT: { label: 'In transit', variant: 'default' },
  INSPECTION: { label: 'Inspection', variant: 'default' },
  COMPLETED: { label: 'Completed', variant: 'default' },
  DISPUTED: { label: 'Disputed', variant: 'destructive' },
  FRAUD_RESOLVED: { label: 'Fraud resolved', variant: 'destructive' },
};

export interface StateBadgeProps {
  state: TradeState;
  className?: string;
}

/** A badge showing the given Trade_State (Req 11.1). */
export function StateBadge({ state, className }: StateBadgeProps) {
  const { label, variant } = STATE_BADGE[state];
  return (
    <Badge variant={variant} className={className} aria-label={`Trade state: ${label}`}>
      {label}
    </Badge>
  );
}
