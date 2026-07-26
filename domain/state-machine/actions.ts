// domain/state-machine/actions.ts
//
// Pure derivation of the controls a viewer may take in the current Trade_State.
// Framework-free: no Supabase, React, or service-layer imports. The UI calls
// availableActions(state, viewer) so transition/permission rules live in one
// place and are never hard-coded in components (Req 11.3, 11.4).
//
// Requirement mapping:
// - Show each permitted action for the current state          -> Req 11.3
// - Show no action controls when none are permitted            -> Req 11.4
// - Shipment/receipt/acceptance are once-only per trader       -> Req 6.1, 6.3, 6.5, 6.8
// - Raise dispute during INSPECTION                            -> Req 7.1
// - Report fraud during INSPECTION or DISPUTED                 -> Req 8.1

import { hasAccepted, hasReceived, hasShipped } from './guards';
import type { TradeAction, TradeState, TradeViewerContext } from './types';

/**
 * Returns exactly the actions the given viewer may take in the current
 * Trade_State, and an empty array when none are permitted (Req 11.3, 11.4).
 *
 * Once-only lifecycle actions (RECORD_SHIPMENT / RECORD_RECEIPT /
 * RECORD_ACCEPTANCE) are suppressed once the viewer has already performed them,
 * using the facts snapshot on the viewer context (Req 6.1, 6.3, 6.5, 6.8).
 * Dispute/fraud actions are one-shot state transitions, so they are guarded by
 * the current state alone: raising a dispute or confirming fraud moves the
 * Trade out of the state in which the control is offered.
 *
 * This function is pure and never mutates its inputs.
 */
export function availableActions(
  state: TradeState,
  viewer: TradeViewerContext,
): TradeAction[] {
  const { role, facts } = viewer;
  const actions: TradeAction[] = [];

  switch (state) {
    case 'COLLATERAL_LOCKED':
      // Each Trader may record shipment of their own Item exactly once (Req 6.1).
      if (!hasShipped(facts, role)) {
        actions.push('RECORD_SHIPMENT');
      }
      break;

    case 'IN_TRANSIT':
      // Each Trader may record receipt of the Counterpart's Item exactly once (Req 6.3).
      if (!hasReceived(facts, role)) {
        actions.push('RECORD_RECEIPT');
      }
      break;

    case 'INSPECTION':
      // Each Trader may record acceptance exactly once (Req 6.5), and may raise
      // a condition dispute (Req 7.1) or report objective fraud (Req 8.1).
      if (!hasAccepted(facts, role)) {
        actions.push('RECORD_ACCEPTANCE');
      }
      actions.push('RAISE_DISPUTE');
      actions.push('REPORT_FRAUD');
      break;

    case 'DISPUTED':
      // A dispute may escalate to objective fraud (Req 8.1).
      actions.push('REPORT_FRAUD');
      break;

    // COLLATERAL_PENDING (awaiting hold confirmation) and the terminal states
    // COMPLETED / FRAUD_RESOLVED expose no trader controls (Req 11.4).
    default:
      break;
  }

  return actions;
}
