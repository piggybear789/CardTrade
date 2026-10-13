// domain/dispute/custodyEscalation.ts
//
// Which holds the custody backstop takes, and when (design §1.2 "Custody backstop
// sweep", ESC-01, ESC-17a, R4-M5).
//
// A disputed trade's collateral is an uncaptured authorisation that lapses on its own.
// Before this, a slow staff decision simply lost it: the provider released the funds
// and the fraud victim got nothing. The hourly sweep now full-captures each live hold
// on a DISPUTED trade into the platform balance once it is within
// `CUSTODY_CAPTURE_MARGIN_HOURS` of its `expires_at`; staff then refund or pay it out.
//
// SCOPE. Every live hold on the trade by default, whoever filed and whatever they
// filed. Capturing only the "accused" would let the first filer choose whose
// collateral survives: a fraudster files against the victim and lets their own hold
// lapse. Only staff may narrow it (`custody_scope = 'ACCUSED_ONLY'`).
//
// Pure: no Supabase, React or service imports.

import type { TradeState } from '../state-machine/types';
import { currentLiveHold, type HoldLike } from '../bond/currentHolds';
import { CARD_AUTHORISATION_HOURS } from '../fulfilment/inspection';

/** Capture this many hours before a hold's expiry: up to six hourly sweep attempts. */
export const CUSTODY_CAPTURE_MARGIN_HOURS = 6;

/**
 * The floor on a re-estimated expiry (R4-M5), from now.
 *
 * A hold whose `expires_at` was the old seven-day planning figure and whose provider
 * reports no `capture_before` is re-estimated at `created_at + 114h`, but never
 * earlier than `now + 7h`. Without the floor a hold placed between 114 hours and seven
 * days ago would get an expiry already in the past, and the `:27` lapse job would mark
 * it EXPIRED before the custody sweep could try it. It must exceed the capture margin,
 * so the sweep always gets at least one attempt.
 */
export const REESTIMATE_FLOOR_HOURS = 7;

/** Pre-warning both traders get before custody, in hours before the capture point. */
export const CUSTODY_WARNING_HOURS = 24;

const HOUR_MS = 3_600_000;

export type CustodyScope = 'ALL' | 'ACCUSED_ONLY';

/** A hold as the backstop reads it. */
export interface EscalationHold extends HoldLike {
  expiresAt: string | null;
}

/** The trade facts the selection needs. */
export interface EscalationTrade {
  state: TradeState;
  initiatorId: string;
  counterpartId: string;
  custodyScope: CustodyScope;
  accusedId: string | null;
}

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Each participant's current live hold that is still an open authorisation. */
function candidates(trade: EscalationTrade, holds: readonly EscalationHold[]): EscalationHold[] {
  let traders = [trade.initiatorId, trade.counterpartId];
  if (trade.custodyScope === 'ACCUSED_ONLY' && trade.accusedId) {
    traders = traders.filter((id) => id === trade.accusedId);
  }
  return traders
    .map((id) => currentLiveHold(holds, id))
    .filter((hold): hold is EscalationHold => hold !== undefined && hold.status === 'ACTIVE');
}

/**
 * The hold refs to capture into custody now.
 *
 * `[]` unless the trade is DISPUTED. A hold with no `expires_at` (the mock) is never a
 * candidate: there is no deadline to beat.
 */
export function holdsToEscalate(
  trade: EscalationTrade,
  holds: readonly EscalationHold[],
  now: Date,
): string[] {
  if (trade.state !== 'DISPUTED') return [];
  return candidates(trade, holds)
    .filter((hold) => {
      const expires = parse(hold.expiresAt);
      return expires !== null && expires - CUSTODY_CAPTURE_MARGIN_HOURS * HOUR_MS <= now.getTime();
    })
    .map((hold) => hold.holdRef);
}

/**
 * The hold refs whose custody capture is within the next day, for the one-time
 * pre-warning. Excludes holds already due (those are captured this pass).
 */
export function holdsToWarn(
  trade: EscalationTrade,
  holds: readonly EscalationHold[],
  now: Date,
): string[] {
  if (trade.state !== 'DISPUTED') return [];
  return candidates(trade, holds)
    .filter((hold) => {
      const expires = parse(hold.expiresAt);
      if (expires === null) return false;
      const capturePoint = expires - CUSTODY_CAPTURE_MARGIN_HOURS * HOUR_MS;
      return capturePoint > now.getTime() && capturePoint - CUSTODY_WARNING_HOURS * HOUR_MS <= now.getTime();
    })
    .map((hold) => hold.holdRef);
}

/**
 * The expiry to write for a hold flagged `expires_at_estimated` (R4-M5).
 *
 * The provider's own `capture_before`, verbatim, when it reports one. Otherwise
 * `max(created_at + CARD_AUTHORISATION_HOURS, now + REESTIMATE_FLOOR_HOURS)`.
 */
export function reestimatedExpiry(params: {
  createdAt: string;
  providerExpiresAt: string | null;
  now: Date;
}): string {
  if (params.providerExpiresAt && parse(params.providerExpiresAt) !== null) {
    return params.providerExpiresAt;
  }
  const created = parse(params.createdAt) ?? params.now.getTime();
  const estimate = created + CARD_AUTHORISATION_HOURS * HOUR_MS;
  const floor = params.now.getTime() + REESTIMATE_FLOOR_HOURS * HOUR_MS;
  return new Date(Math.max(estimate, floor)).toISOString();
}
