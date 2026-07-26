// domain/state-machine/guards.ts
//
// Pure guard predicates over a TradeFacts snapshot plus deriveEvent, which maps
// aggregate DB-derived facts to the TradeEvent they imply for the current
// Trade_State. This module is framework-free: it MUST NOT import Supabase,
// React, or the service layer. The orchestrator computes a TradeFacts snapshot
// from the database and asks this module what (if anything) it implies.
//
// Requirement mapping:
// - Per-trader once-only shipment/receipt/acceptance checks -> Req 6.1, 6.3, 6.5, 6.8
// - Aggregate "both shipped/received/accepted" derivations   -> Req 6.2, 6.4, 6.6
// - Aggregate "both holds active" derivation                 -> Req 5.5

import type { TradeEvent, TradeFacts, TradeState, TradeViewerRole } from './types';

/**
 * Maps a viewer role to the corresponding key on the per-trader fact records.
 * INITIATOR -> 'initiator', COUNTERPART -> 'counterpart'.
 */
function roleKey(role: TradeViewerRole): 'initiator' | 'counterpart' {
  return role === 'INITIATOR' ? 'initiator' : 'counterpart';
}

// ---------------------------------------------------------------------------
// Aggregate predicates (both traders) - pure reads of the facts snapshot.
// ---------------------------------------------------------------------------

/** True iff both traders have recorded shipment of their own Item (Req 6.2). */
export function bothShipped(facts: TradeFacts): boolean {
  return facts.shipped.initiator && facts.shipped.counterpart;
}

/** True iff both traders have recorded receipt of the Counterpart's Item (Req 6.4). */
export function bothReceived(facts: TradeFacts): boolean {
  return facts.received.initiator && facts.received.counterpart;
}

/** True iff both traders have recorded acceptance of the Counterpart's Item (Req 6.6). */
export function bothAccepted(facts: TradeFacts): boolean {
  return facts.accepted.initiator && facts.accepted.counterpart;
}

/** True iff both traders' Pre_Auth_Holds are active (Req 5.5). */
export function bothHoldsActive(facts: TradeFacts): boolean {
  return facts.holdsActive.initiator && facts.holdsActive.counterpart;
}

// ---------------------------------------------------------------------------
// Per-trader once-only predicates - used to suppress already-performed actions
// (Req 6.1, 6.3, 6.5, 6.8). Each is a pure read of the facts snapshot.
// ---------------------------------------------------------------------------

/** True iff the given trader has already recorded shipment of their own Item. */
export function hasShipped(facts: TradeFacts, role: TradeViewerRole): boolean {
  return facts.shipped[roleKey(role)];
}

/** True iff the given trader has already recorded receipt of the Counterpart's Item. */
export function hasReceived(facts: TradeFacts, role: TradeViewerRole): boolean {
  return facts.received[roleKey(role)];
}

/** True iff the given trader has already recorded acceptance of the Counterpart's Item. */
export function hasAccepted(facts: TradeFacts, role: TradeViewerRole): boolean {
  return facts.accepted[roleKey(role)];
}

/** True iff the given trader's Pre_Auth_Hold is currently active. */
export function holdActive(facts: TradeFacts, role: TradeViewerRole): boolean {
  return facts.holdsActive[roleKey(role)];
}

// ---------------------------------------------------------------------------
// deriveEvent - the single place that turns aggregate facts into the event the
// current state implies. Kept strictly aligned with the TRANSITIONS table in
// machine.ts: it only ever returns an event that is table-defined from `state`.
// ---------------------------------------------------------------------------

/**
 * Returns the TradeEvent that the aggregate `facts` imply for the current
 * `state`, or `null` when the facts do not (yet) satisfy any automatic
 * transition from that state.
 *
 * Only the fact-driven, automatic transitions are derived here:
 * - COLLATERAL_PENDING + both holds active -> HOLDS_CONFIRMED (Req 5.5)
 * - COLLATERAL_LOCKED  + both shipped       -> BOTH_SHIPPED   (Req 6.2)
 * - IN_TRANSIT         + both received      -> BOTH_RECEIVED  (Req 6.4)
 * - INSPECTION         + both accepted      -> BOTH_ACCEPTED  (Req 6.6)
 *
 * Events that are the result of an explicit human decision rather than an
 * aggregate fact - CONDITION_DISPUTE, DISPUTE_RESOLVED, FRAUD_CONFIRMED,
 * HOLDS_FAILED - are intentionally NOT derived from the facts snapshot and are
 * dispatched by the orchestrator/webhook layer instead. Terminal states derive
 * nothing.
 *
 * This function is pure and never mutates its inputs.
 */
export function deriveEvent(state: TradeState, facts: TradeFacts): TradeEvent | null {
  switch (state) {
    case 'COLLATERAL_PENDING':
      return bothHoldsActive(facts) ? 'HOLDS_CONFIRMED' : null;
    case 'COLLATERAL_LOCKED':
      return bothShipped(facts) ? 'BOTH_SHIPPED' : null;
    case 'IN_TRANSIT':
      return bothReceived(facts) ? 'BOTH_RECEIVED' : null;
    case 'INSPECTION':
      return bothAccepted(facts) ? 'BOTH_ACCEPTED' : null;
    default:
      return null;
  }
}
