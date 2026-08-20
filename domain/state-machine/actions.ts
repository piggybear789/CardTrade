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
// - Propose/accept/decline terms while NEGOTIATING             -> negotiation in room
// - Shipment/receipt/acceptance are once-only per trader       -> Req 6.1, 6.3, 6.5, 6.8
// - Raise dispute during INSPECTION                            -> Req 7.1
// - Report fraud during INSPECTION or DISPUTED                 -> Req 8.1
//
// COLLATERAL_LOCKED offers different controls per fulfilment method: a posted trade
// records a shipment, a face-to-face one confirms the handover. Both may report that
// the exchange failed.

import {
  hasAccepted,
  hasAcceptedTerms,
  hasConfirmedHandover,
  hasReceived,
  hasShipped,
} from './guards';
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
    case 'NEGOTIATING':
      // Handover is edited on the Terms row by either trader and does not
      // reset acceptances. Cash and binder goods are the listing owner's —
      // the counterpart — so only they get Counter. Either side may still
      // accept the current version once, or walk away.
      if (!hasAcceptedTerms(facts, role)) {
        actions.push('ACCEPT_TERMS');
      }
      if (role === 'COUNTERPART') {
        actions.push('PROPOSE_TERMS');
      }
      actions.push('DECLINE_OFFER');
      break;

    case 'COLLATERAL_LOCKED':
      // The control depends on how the goods were agreed to change hands. Asking
      // two people who are meeting in person to "record shipment" was the visible
      // half of the trade room having a delivery method it did not act on.
      if (facts.fulfilmentMethod === 'IN_PERSON') {
        if (!hasConfirmedHandover(facts, role)) {
          actions.push('CONFIRM_HANDOVER');
        }
      } else if (!hasShipped(facts, role)) {
        // Each Trader may record shipment of their own Item exactly once (Req 6.1).
        actions.push('RECORD_SHIPMENT');
      }
      // Either way, either trader may report that the exchange did not happen — a
      // no-show, a refusal at the meeting point, or an exchange under duress. This
      // freezes the trade for review and captures nothing.
      actions.push('REPORT_HANDOVER_FAILED');
      break;

    case 'IN_TRANSIT':
      // Each Trader may record receipt of the Counterpart's Item exactly once (Req 6.3).
      if (!hasReceived(facts, role)) {
        actions.push('RECORD_RECEIPT');
      }
      // A parcel that never arrives previously had no exit: the trade sat in
      // IN_TRANSIT until the collateral authorisation lapsed.
      actions.push('REPORT_HANDOVER_FAILED');
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
    // COMPLETED / FRAUD_RESOLVED / CANCELLED expose no trader controls (Req 11.4).
    default:
      break;
  }

  return actions;
}
