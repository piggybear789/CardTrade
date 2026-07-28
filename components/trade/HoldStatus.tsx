'use client';

// components/trade/HoldStatus.tsx
//
// Renders the current status of each Pre_Auth_Hold associated with a Trade
// (Req 11.1). Each hold shows the trader it belongs to (labelled relative to
// the viewer), the hold amount formatted as AUD (integer cents -> formatAud),
// and its live status. Updates arrive via the realtime subscription upstream,
// so this component is purely presentational.

import { Badge, type BadgeProps } from '@/components/ui/badge';
import type { HoldRow } from '@/lib/realtime/useTradeRealtime';
import type { TradeViewerRole } from '@/domain/state-machine/types';
import { formatAud } from '@/lib/format';

/** Human-readable label + badge variant for each hold_status enum value. */
const HOLD_STATUS: Record<
  HoldRow['status'],
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  ACTIVE: { label: 'Active', variant: 'default' },
  VOIDED: { label: 'Released', variant: 'secondary' },
  PARTIALLY_CAPTURED: { label: 'Partially captured', variant: 'destructive' },
  FULLY_CAPTURED: { label: 'Fully captured', variant: 'destructive' },
  FAILED: { label: 'Failed', variant: 'destructive' },
};

export interface HoldStatusProps {
  /** The holds for the trade (one per trader). */
  holds: HoldRow[];
  /** Map of profile id -> role, used to label each hold relative to the viewer. */
  initiatorId: string;
  counterpartId: string;
  /** The viewer's own role, so their hold can be labelled "You". */
  viewerRole: TradeViewerRole;
}

/** Resolve a friendly owner label for a hold given its trader id. */
function ownerLabel(
  traderId: string,
  initiatorId: string,
  counterpartId: string,
  viewerRole: TradeViewerRole,
): string {
  const role: TradeViewerRole | null =
    traderId === initiatorId
      ? 'INITIATOR'
      : traderId === counterpartId
        ? 'COUNTERPART'
        : null;
  if (role === null) return 'Trader';
  if (role === viewerRole) return 'Your collateral';
  return "Counterpart's collateral";
}

/**
 * List of collateral holds with amount + live status (Req 11.1). Renders an
 * explanatory empty state before any holds have been placed (e.g. while the
 * Trade is still COLLATERAL_PENDING).
 */
export function HoldStatus({
  holds,
  initiatorId,
  counterpartId,
  viewerRole,
}: HoldStatusProps) {
  if (holds.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing is on the line yet.
      </p>
    );
  }

  // Stable ordering: the viewer's own hold first, then the counterpart's.
  const ordered = [...holds].sort((a, b) => {
    const aMine = a.trader_id === (viewerRole === 'INITIATOR' ? initiatorId : counterpartId);
    const bMine = b.trader_id === (viewerRole === 'INITIATOR' ? initiatorId : counterpartId);
    return aMine === bMine ? 0 : aMine ? -1 : 1;
  });

  return (
    <ul className="space-y-3" aria-label="What each trader has on the line">
      {ordered.map((hold) => {
        const status = HOLD_STATUS[hold.status];
        return (
          <li
            key={hold.id}
            className="flex items-center justify-between gap-4 rounded-md border p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {ownerLabel(hold.trader_id, initiatorId, counterpartId, viewerRole)}
              </p>
              <p className="text-sm tabular-nums text-muted-foreground">
                {formatAud(hold.amount_cents)}
                {hold.captured_cents > 0 ? (
                  <span> · {formatAud(hold.captured_cents)} captured</span>
                ) : null}
              </p>
            </div>
            <Badge variant={status.variant} aria-label={`Hold status: ${status.label}`}>
              {status.label}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
