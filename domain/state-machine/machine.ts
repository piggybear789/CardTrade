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
 * (COMPLETED, FRAUD_RESOLVED) and admit no transitions (Req 9.1).
 *
 * Requirement mapping:
 * - HOLDS_CONFIRMED / HOLDS_FAILED  -> Req 5.5 / 5.6
 * - BOTH_SHIPPED                    -> Req 6.2
 * - BOTH_RECEIVED                   -> Req 6.4
 * - BOTH_ACCEPTED                   -> Req 6.6
 * - CONDITION_DISPUTE               -> Req 7.1
 * - DISPUTE_RESOLVED                -> Req 7.5
 * - FRAUD_CONFIRMED                 -> Req 8.1
 */
export const TRANSITIONS: Record<
  TradeState,
  Partial<Record<TradeEvent, TradeState>>
> = {
  COLLATERAL_PENDING: {
    HOLDS_CONFIRMED: 'COLLATERAL_LOCKED',
    HOLDS_FAILED: 'COLLATERAL_PENDING', // -> cancellation (holds voided, items restored)
  },
  COLLATERAL_LOCKED: {
    BOTH_SHIPPED: 'IN_TRANSIT',
  },
  IN_TRANSIT: {
    BOTH_RECEIVED: 'INSPECTION',
  },
  INSPECTION: {
    BOTH_ACCEPTED: 'COMPLETED',
    CONDITION_DISPUTE: 'DISPUTED',
    FRAUD_CONFIRMED: 'FRAUD_RESOLVED',
  },
  DISPUTED: {
    DISPUTE_RESOLVED: 'COMPLETED',
    FRAUD_CONFIRMED: 'FRAUD_RESOLVED',
  },
  COMPLETED: {}, // terminal
  FRAUD_RESOLVED: {}, // terminal
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
