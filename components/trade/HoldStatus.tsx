'use client';

// components/trade/HoldStatus.tsx
//
// Renders the current status of each Pre_Auth_Hold associated with a Trade
// (Req 11.1). Its only job now is to label each hold relative to the viewer and
// order the viewer's own hold first; the presentation comes from the shared
// <ContractHoldList/>, which the deal room's collateral list also uses.
//
// Purely presentational — hold updates arrive via the realtime subscription
// upstream.

import { ContractHoldList, type ContractHold } from '@/components/contract';
import type { HoldRow } from '@/lib/realtime/useTradeRealtime';
import type { TradeViewerRole } from '@/domain/state-machine/types';

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
  const myId = viewerRole === 'INITIATOR' ? initiatorId : counterpartId;

  // Stable ordering: the viewer's own hold first, then the counterpart's.
  const ordered: ContractHold[] = [...holds]
    .sort((a, b) => {
      const aMine = a.trader_id === myId;
      const bMine = b.trader_id === myId;
      return aMine === bMine ? 0 : aMine ? -1 : 1;
    })
    .map((hold) => ({
      id: hold.id,
      label: ownerLabel(hold.trader_id, initiatorId, counterpartId, viewerRole),
      amountCents: hold.amount_cents,
      capturedCents: hold.captured_cents,
      status: hold.status,
    }));

  return (
    <ContractHoldList
      holds={ordered}
      ariaLabel="What each trader has on the line"
    />
  );
}
