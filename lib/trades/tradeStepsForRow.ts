// lib/trades/tradeStepsForRow.ts
//
// A trade's step plan from its row and holds, for surfaces that read trades in bulk or
// in passing — the Trades list, and a trade's chat thread opened from the inbox. The
// contract room builds its plan from a fuller viewer read; this is the same derivation
// fed from the columns those lighter surfaces already have.
//
// ONE MAPPING. It lived inline in the Trades list; the thread needed the same answer,
// and two copies of "which row fields feed the plan" would drift the first time a fact
// was added.

import {
  deriveTradeSteps,
  isTradeState,
  type ContractStep,
} from '@/domain/contract';
import { deriveHoldLegs, type HoldRowLike } from '@/domain/state-machine/holdLegs';
import { factsFromTrade, type TradeRow } from '@/lib/actions/tradeLifecycleStore';

/**
 * The plan as the viewer sees it, or `[]` when the row's state is one this build does
 * not recognise.
 *
 * The row's own facts with the two hold-derived legs overlaid, because `factsFromTrade`
 * defaults those to false and the release step depends on them. Addresses come from the
 * row's `*_delivery_address_configured` flags rather than the address rows — whether one
 * EXISTS is what gates posting, and a trader may not read the other's until collateral
 * locks.
 */
export function tradeStepsForRow(
  row: TradeRow,
  holds: readonly HoldRowLike[],
  viewerId: string,
  counterpartyName: string,
): ContractStep[] {
  const state: unknown = row.state;
  if (!isTradeState(state)) return [];
  const isInitiator = row.initiator_id === viewerId;
  return deriveTradeSteps({
    state,
    viewerRole: isInitiator ? 'INITIATOR' : 'COUNTERPART',
    facts: {
      ...factsFromTrade(row),
      ...deriveHoldLegs([...holds], row.initiator_id, row.counterpart_id),
    },
    counterpartyName,
    addresses:
      row.handover_method === 'DELIVERY'
        ? {
            mine: Boolean(
              isInitiator
                ? row.initiator_delivery_address_configured
                : row.counterpart_delivery_address_configured,
            ),
            theirs: Boolean(
              isInitiator
                ? row.counterpart_delivery_address_configured
                : row.initiator_delivery_address_configured,
            ),
          }
        : undefined,
  });
}
