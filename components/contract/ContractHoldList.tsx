// components/contract/ContractHoldList.tsx
//
// What each party has on the line. A trade's `Pre_Auth_Hold` rows and a deal's
// collateral holds are the same thing shown two different ways before this; the
// owning room maps its rows into `ContractHold` (labelling each hold relative to
// the viewer) and this renders them identically.

import { Badge } from '@/components/ui/badge';
import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ContractHold, ContractHoldStatus, ContractStatusTone } from './types';

/** Human-readable label + badge tone for each `hold_status` value. */
const HOLD_STATUS: Record<
  ContractHoldStatus,
  { label: string; tone: ContractStatusTone }
> = {
  ACTIVE: { label: 'Active', tone: 'default' },
  VOIDED: { label: 'Released', tone: 'secondary' },
  PARTIALLY_CAPTURED: { label: 'Partially captured', tone: 'destructive' },
  FULLY_CAPTURED: { label: 'Fully captured', tone: 'destructive' },
  FAILED: { label: 'Failed', tone: 'destructive' },
  // Destructive, not secondary: "Released" reads as a good outcome, and this is
  // the opposite — the authorisation window ran out and the collateral is gone.
  EXPIRED: { label: 'Expired — no longer protected', tone: 'destructive' },
};

export interface ContractHoldListProps {
  holds: ContractHold[];
  /** Copy shown before any hold has been placed. */
  emptyLabel?: string;
  /** Accessible name for the list. */
  ariaLabel?: string;
  className?: string;
}

/** The shared collateral / pre-authorization hold list. */
export function ContractHoldList({
  holds,
  emptyLabel = 'Nothing is on the line yet.',
  ariaLabel = 'What each party has on the line',
  className,
}: ContractHoldListProps) {
  if (holds.length === 0) {
    return <p className="text-body text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className={cn('space-y-cozy', className)} aria-label={ariaLabel}>
      {holds.map((hold) => {
        const status = HOLD_STATUS[hold.status] ?? {
          label: hold.status.toLowerCase().replace(/_/g, ' '),
          tone: 'outline' as ContractStatusTone,
        };
        return (
          <li
            key={hold.id}
            className="flex items-center justify-between gap-group"
          >
            <div className="min-w-0">
              <p className="truncate text-body font-medium">{hold.label}</p>
              <p className="text-body tabular-nums text-muted-foreground">
                {formatAud(hold.amountCents)}
                {hold.capturedCents && hold.capturedCents > 0 ? (
                  <span> · {formatAud(hold.capturedCents)} captured</span>
                ) : null}
              </p>
            </div>
            <Badge
              variant={status.tone}
              className="shrink-0"
              aria-label={`Hold status: ${status.label}`}
            >
              {status.label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
