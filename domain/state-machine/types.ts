// domain/state-machine/types.ts
//
// Pure, dependency-free type definitions for the Trade State Machine.
// This module MUST NOT import Supabase, React, or the service layer - it is the
// framework-free domain core so it can be exhaustively unit + property tested.

/**
 * The lifecycle state of a Trade.
 * Canonical set of seven states from Requirement 9 / the design.
 */
export type TradeState =
  | 'COLLATERAL_PENDING'
  | 'COLLATERAL_LOCKED'
  | 'IN_TRANSIT'
  | 'INSPECTION'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'FRAUD_RESOLVED';

/**
 * Events that drive Trade_State transitions.
 * Each event corresponds to an aggregate payment/lifecycle fact.
 */
export type TradeEvent =
  | 'HOLDS_CONFIRMED' // both pre-auths active (Req 5.5)
  | 'HOLDS_FAILED' // hold failed / timeout (Req 5.6) -> cancellation
  | 'BOTH_SHIPPED' // Req 6.2
  | 'BOTH_RECEIVED' // Req 6.4
  | 'BOTH_ACCEPTED' // Req 6.6
  | 'CONDITION_DISPUTE' // Req 7.1
  | 'DISPUTE_RESOLVED' // disputed item returned (Req 7.5)
  | 'FRAUD_CONFIRMED'; // Req 8.1

/**
 * States from which no further transition is permitted (Req 9.1).
 * Terminal states are absorbing: any event applied to them is rejected.
 */
export const TERMINAL_STATES: ReadonlySet<TradeState> = new Set<TradeState>([
  'COMPLETED',
  'FRAUD_RESOLVED',
]);

/**
 * Aggregate, DB-derived facts about a Trade used by the guards / deriveEvent
 * (fleshed out in task 3.5). Kept here so guards.ts can import a single shared
 * snapshot shape. Each flag is per-trader (initiator vs counterpart).
 */
export interface TradeFacts {
  shipped: { initiator: boolean; counterpart: boolean };
  received: { initiator: boolean; counterpart: boolean };
  accepted: { initiator: boolean; counterpart: boolean };
  holdsActive: { initiator: boolean; counterpart: boolean };
}

/**
 * The role of the viewer relative to a Trade. Drives which actions the UI may
 * surface. Defined minimally here; extended in task 3.5 (actions.ts).
 */
export type TradeViewerRole = 'INITIATOR' | 'COUNTERPART';

/**
 * Context describing who is looking at a Trade and the facts relevant to
 * deciding which actions they may take. Minimal definition to be fleshed out in
 * task 3.5.
 */
export interface TradeViewerContext {
  role: TradeViewerRole;
  facts: TradeFacts;
}

/**
 * A control the UI may render for a viewer in a given state (Req 11.3-11.4).
 * Minimal definition to be fleshed out in task 3.5 (actions.ts).
 */
export type TradeAction =
  | 'RECORD_SHIPMENT'
  | 'RECORD_RECEIPT'
  | 'RECORD_ACCEPTANCE'
  | 'RAISE_DISPUTE'
  | 'REPORT_FRAUD';
