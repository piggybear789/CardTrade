// domain/state-machine/machine.ts
//
// Pure Trade State Machine: the single source of truth for valid Trade_State
// transitions. No imports of Supabase, React, or the service layer.
//
// Guards, deriveEvent, and availableActions are intentionally NOT implemented
// here — they live in guards.ts / actions.ts (task 3.5) and consume the
// transition primitives exported below.

import type { TradeEvent, TradeState } from './types';

/**
 * Result of attempting a transition (Req 9.1, 9.2).
 * - On success: `ok: true` and `nextState` is set.
 * - On failure: `ok: false` and `error` is `'INVALID_TRANSITION'`.
 */
export interface TransitionResult {
  ok: boolean;
  nextState?: TradeState;
  error?: 'INVALID_TRANSITION';
}

/**
 * The single source of truth for valid transitions.
 *
 * Each entry maps a source Trade_State to the set of events permitted from that
 * state and the resulting target state. States with an empty map are terminal
 * (COMPLETED, FRAUD_RESOLVED, CANCELLED) and admit no transitions (Req 9.1).
 *
 * There are TWO routes from COLLATERAL_LOCKED to INSPECTION, one per fulfilment
 * method, and they converge deliberately. Whichever way the goods moved, the
 * receiving trader gets the same inspection window and the same remedies.
 */
export const TRANSITIONS: Record<
  TradeState,
  Partial<Record<TradeEvent, TradeState>>
> = {
  NEGOTIATING: {
    // Both sides accepted the same terms version, so collateral may be sought.
    // This is the point the old flow called "accept proposal": it now happens
    // inside the room, on a Trade that already exists.
    TERMS_AGREED: 'COLLATERAL_PENDING',
    // Either side ending it before terms are agreed. One event, not two: a
    // decline by the recipient and a withdrawal by the proposer are the same
    // fact — this offer will not become an exchange — and giving them separate
    // events would mean two ways to reach one state with no behavioural
    // difference. Who ended it is recorded on the row, not in the event.
    OFFER_DECLINED: 'CANCELLED',
  },
  COLLATERAL_PENDING: {
    HOLDS_CONFIRMED: 'COLLATERAL_LOCKED',
    // Deliberately still a self-loop rather than -> CANCELLED. The compensating
    // path in Req 5.6 voids holds and restores items while the Trade stays put
    // so collateral can be re-sought; repointing it at the new terminal state
    // would change that behaviour, which is a separate decision from adding
    // negotiation. See the orchestrator's HOLDS_FAILED handling.
    HOLDS_FAILED: 'COLLATERAL_PENDING',
  },
  COLLATERAL_LOCKED: {
    // DELIVERY: both parcels posted.
    BOTH_SHIPPED: 'IN_TRANSIT',
    // IN_PERSON: both traders confirmed the meeting happened. Note the target is
    // INSPECTION, not COMPLETED — see BOTH_HANDOVER_CONFIRMED in types.ts.
    BOTH_HANDOVER_CONFIRMED: 'INSPECTION',
    // The exchange did not happen: a no-show, a refusal at the meeting point, or
    // goods handed over under duress. Freezes the trade for review and captures
    // NOTHING, which is why it is not CONDITION_DISPUTE — that settles a
    // Friction_Tax against the other trader, and at this point neither side has
    // necessarily done anything wrong.
    HANDOVER_FAILED: 'DISPUTED',
  },
  IN_TRANSIT: {
    BOTH_RECEIVED: 'INSPECTION',
    // A parcel that never arrives. Without this an IN_TRANSIT trade had NO exit at
    // all: both traders' collateral sat until the card authorisation lapsed, which
    // removes the guarantee rather than resolving anything.
    HANDOVER_FAILED: 'DISPUTED',
  },
  INSPECTION: {
    BOTH_ACCEPTED: 'COMPLETED',
    // The window closed with neither trader accepting or disputing. Dispatched by
    // the scheduled sweep, never by a participant.
    INSPECTION_EXPIRED: 'COMPLETED',
    CONDITION_DISPUTE: 'DISPUTED',
    FRAUD_CONFIRMED: 'FRAUD_RESOLVED',
  },
  DISPUTED: {
    DISPUTE_RESOLVED: 'COMPLETED',
    FRAUD_CONFIRMED: 'FRAUD_RESOLVED',
  },
  COMPLETED: {}, // terminal
  FRAUD_RESOLVED: {}, // terminal
  CANCELLED: {}, // terminal — declined or withdrawn before terms were agreed
};

/**
 * Returns true iff `event` is a table-defined transition from `from`.
 * Pure and side-effect free (Req 9.1).
 */
export function canTransition(from: TradeState, event: TradeEvent): boolean {
  return Boolean(TRANSITIONS[from]?.[event]);
}

/**
 * Attempts a transition without ever mutating input.
 *
 * - When the `(from, event)` pair is table-defined, returns
 *   `{ ok: true, nextState }` (Req 9.1).
 * - Otherwise returns `{ ok: false, error: 'INVALID_TRANSITION' }`, leaving the
 *   caller's state to be preserved unchanged (Req 9.2).
 *
 * This function is pure: it reads the immutable TRANSITIONS table and returns a
 * fresh result object; it never writes to any state.
 */
export function transition(from: TradeState, event: TradeEvent): TransitionResult {
  const next = TRANSITIONS[from]?.[event];
  return next ? { ok: true, nextState: next } : { ok: false, error: 'INVALID_TRANSITION' };
}
