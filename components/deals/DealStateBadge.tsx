'use client';

// components/deals/DealStateBadge.tsx
//
// Renders a private deal's state as a badge. Covers all eight `deal_state`
// values so the deal room, the "My deals" list, and any future surface read the
// same labels.

import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { Enums } from '@/lib/supabase/database.types';

/** The deal lifecycle state enum. */
export type DealState = Enums<'deal_state'>;

/** Visual treatment + label for each deal state. */
const STATE_BADGE: Record<
  DealState,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  INVITED: { label: 'Awaiting counterparty', variant: 'secondary' },
  TERMS: { label: 'Agreeing terms', variant: 'secondary' },
  CONFIRMATION: { label: 'Awaiting confirmation', variant: 'outline' },
  ESCROW_PENDING: { label: 'Placing collateral', variant: 'outline' },
  ESCROW_LOCKED: { label: 'Binding — collateral locked', variant: 'default' },
  COMPLETED: { label: 'Completed', variant: 'default' },
  CANCELLED: { label: 'Cancelled', variant: 'secondary' },
  DISPUTED: { label: 'Disputed', variant: 'destructive' },
};

export interface DealStateBadgeProps {
  state: DealState;
  className?: string;
}

/** A badge showing the given deal state. */
export function DealStateBadge({ state, className }: DealStateBadgeProps) {
  const { label, variant } = STATE_BADGE[state];
  return (
    <Badge variant={variant} className={className} aria-label={`Deal state: ${label}`}>
      {label}
    </Badge>
  );
}
