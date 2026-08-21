// domain/state-machine/types.ts
//
// Pure, dependency-free type definitions for the Trade State Machine.
// This module MUST NOT import Supabase, React, or the service layer — it is the
// framework-free domain core so it can be exhaustively unit + property tested.
//
// `domain/fulfilment` is the one import: it is equally pure, and the fulfilment
// method is a fact the machine has to branch on.

import type { FulfilmentMethod } from '../fulfilment/types';

/**
 * The lifecycle state of a Trade.
 *
 * `NEGOTIATING` and `CANCELLED` extend the original seven states from
 * Requirement 9. A Trade row is now created when the FIRST offer is made rather
 * than on acceptance, so the contract room exists for the whole lifecycle and
 * counter-offers are versioned terms on the Trade itself.
 *
 * This replaces the retired private-deal flow, whose `INVITED / TERMS /
 * CONFIRMATION` states were the same negotiation modelled a second time against
 * a separate table. Negotiating here and shipping there was the seam that made
 * two engines look necessary.
 */
export type TradeState =
  | 'NEGOTIATING'
  | 'COLLATERAL_PENDING'
  | 'COLLATERAL_LOCKED'
  | 'IN_TRANSIT'
  | 'INSPECTION'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'FRAUD_RESOLVED'
  | 'CANCELLED';

/**
 * Events that drive Trade_State transitions.
 * Each event corresponds to an aggregate payment/lifecycle fact.
 */
export type TradeEvent =
  | 'TERMS_AGREED' // both sides accepted the SAME terms version
  | 'OFFER_DECLINED' // negotiation ended before terms were agreed
  | 'HOLDS_CONFIRMED' // both pre-auths active (Req 5.5)
  | 'HOLDS_FAILED' // hold failed / timeout (Req 5.6) -> cancellation
  | 'BOTH_SHIPPED' // both parcels posted, DELIVERY only
  | 'BOTH_RECEIVED' // both parcels arrived, DELIVERY only
  | 'BOTH_HANDOVER_CONFIRMED' // both met and swapped, IN_PERSON only
  | 'HANDOVER_FAILED' // the exchange did not happen; freeze WITHOUT capturing
  | 'BOTH_ACCEPTED' // both traders accepted what they received
  | 'INSPECTION_EXPIRED' // the inspection window closed untouched
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
  'CANCELLED',
]);

/**
 * Aggregate, DB-derived facts about a Trade used by the guards / deriveEvent
 * (fleshed out in task 3.5). Kept here so guards.ts can import a single shared
 * snapshot shape. Each flag is per-trader (initiator vs counterpart).
 */
export interface TradeFacts {
  /**
   * Whether each side has accepted the CURRENT terms version.
   *
   * The snapshot builder must compare each side's accepted version against the
   * Trade's `terms_version`, not merely check that a timestamp exists. A counter
   * bumps the version and clears both ticks, exactly as `Cash_Sale` does — if
   * this were "has ever accepted", a counter-offer could be pushed into escrow
   * on the strength of an acceptance of the terms it replaced.
   */
  termsAccepted: { initiator: boolean; counterpart: boolean };
  shipped: { initiator: boolean; counterpart: boolean };
  received: { initiator: boolean; counterpart: boolean };
  accepted: { initiator: boolean; counterpart: boolean };
  holdsActive: { initiator: boolean; counterpart: boolean };
  /**
   * True when a collateral seek already ran and did not stick — a hold is
   * FAILED, VOIDED after compensation, or EXPIRED — so the room may offer a
   * retry rather than sitting in COLLATERAL_PENDING with no controls.
   *
   * False while holds have not been placed yet, and false while they are live.
   * The first accept is still in flight in those cases; a retry would race it.
   */
  collateralSeekFailed: boolean;
  /**
   * Each trader's confirmation that a face-to-face exchange happened.
   *
   * Always present, and always `false` on a DELIVERY trade. Confirming a handover
   * means "we met and swapped", NOT "I am satisfied" — both confirmations move the
   * trade to INSPECTION, never straight to COMPLETED. A trader who has just been
   * robbed or coerced at a meeting point must not be able to sign the trade off on
   * the spot, which is the one place this deliberately differs from the Cash_Sale.
   */
  handoverConfirmed: { initiator: boolean; counterpart: boolean };
  /**
   * How the goods change hands, or `null` before it has been agreed.
   *
   * The state machine needs it because the two methods take different routes to
   * INSPECTION: DELIVERY goes via BOTH_SHIPPED / BOTH_RECEIVED, IN_PERSON via
   * BOTH_HANDOVER_CONFIRMED. Without it, `deriveEvent` cannot tell which leg pair
   * to read and an in-person trade goes on asking two people in a car park to
   * "record shipment".
   */
  fulfilmentMethod: FulfilmentMethod | null;
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
  | 'PROPOSE_TERMS'
  | 'ACCEPT_TERMS'
  | 'DECLINE_OFFER'
  | 'RECORD_SHIPMENT'
  | 'RECORD_RECEIPT'
  /** Face-to-face only: confirm the meeting happened and the goods changed hands. */
  | 'CONFIRM_HANDOVER'
  /** The exchange did not happen. Freezes the trade for review, captures nothing. */
  | 'REPORT_HANDOVER_FAILED'
  | 'RECORD_ACCEPTANCE'
  | 'RAISE_DISPUTE'
  | 'REPORT_FRAUD'
  /**
   * Re-seek collateral after a declined or voided hold. Only offered from
   * COLLATERAL_PENDING once a seek has already failed — the trade stays in that
   * state on HOLDS_FAILED so this can run without going back to negotiation.
   */
  | 'RETRY_COLLATERAL';
