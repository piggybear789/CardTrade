// domain/fulfilment/handoverEdits.ts
//
// When a trade's meeting terms may change, and how (ESC-04, design ESC-04).
//
// THE ATTACK THIS CLOSES. `updateTradeHandoverTerms` used to accept edits from
// NEGOTIATING through COLLATERAL_LOCKED, unilaterally, with no version bump and no
// notice. A trader who had already taken the other's card at the meeting could then
// move the meeting a month out (so the handover sweep never fired) or null it, and
// the victim — unable to dispute before INSPECTION — watched the collateral lapse.
// A trader could also move an accepted public venue to a car park and keep the other
// side's acceptance.
//
// THE RULE:
//
//   NEGOTIATING            -> DIRECT edit. The OTHER party's acceptance is cleared
//                             (theirs is the tick that was given for the old place).
//   COLLATERAL_PENDING     -> PROPOSAL the other trader must accept, and only while
//     before the cutoff       no hold is ACTIVE and `now < meeting_at - lead`.
//     with no ACTIVE hold
//   anything else          -> LOCKED. Collateral is placed for THIS meeting; a change
//                             means cancelling and re-agreeing.
//
// The database enforces the same lock (`trades_lock_handover`, 0133), because the
// admin client bypasses RLS and only a trigger binds every writer.
//
// Pure: no Supabase, React or service imports.

import type { TradeState } from '../state-machine/types';
import { BOND_PLACEMENT_LEAD_HOURS } from './inspection';

const HOUR_MS = 3_600_000;

/** A proposed meeting must leave at least this long before its own placement cutoff. */
export const HANDOVER_PROPOSAL_SLACK_HOURS = 1;

export type HandoverEditMode = 'DIRECT' | 'PROPOSAL' | 'LOCKED';

/** The instant collateral is placed for a meeting: `meeting_at - lead`. */
export function placementCutoff(meetingAt: string | null | undefined): number | null {
  if (!meetingAt) return null;
  const ms = Date.parse(meetingAt);
  return Number.isFinite(ms) ? ms - BOND_PLACEMENT_LEAD_HOURS * HOUR_MS : null;
}

/** How (whether) the meeting terms of a trade in this state may change now. */
export function handoverEditMode(params: {
  state: TradeState;
  meetingAt: string | null;
  hasActiveHold: boolean;
  now: Date;
}): HandoverEditMode {
  if (params.state === 'NEGOTIATING') return 'DIRECT';
  if (params.state !== 'COLLATERAL_PENDING') return 'LOCKED';
  if (params.hasActiveHold) return 'LOCKED';
  const cutoff = placementCutoff(params.meetingAt);
  // No meeting on file: nothing has been placed against one, so a proposal is the
  // only way to set it (the stale sweep abandons such a trade otherwise).
  if (cutoff === null) return 'PROPOSAL';
  return params.now.getTime() < cutoff ? 'PROPOSAL' : 'LOCKED';
}

/**
 * Whether a PROPOSED meeting still leaves room to place collateral for it: at least
 * `lead + slack` hours from now. Checked at proposal and again at acceptance, because
 * the cutoff may have passed in between.
 */
export function proposalMeetingIsPlaceable(meetingAt: string | null, now: Date): boolean {
  if (!meetingAt) return false;
  const ms = Date.parse(meetingAt);
  if (!Number.isFinite(ms)) return false;
  return ms >= now.getTime() + (BOND_PLACEMENT_LEAD_HOURS + HANDOVER_PROPOSAL_SLACK_HOURS) * HOUR_MS;
}

/** When an undecided proposal lapses: the placement cutoff of the CURRENT meeting. */
export function proposalExpiry(currentMeetingAt: string | null, proposedMeetingAt: string | null, now: Date): string {
  const cutoff = placementCutoff(currentMeetingAt) ?? placementCutoff(proposedMeetingAt);
  return new Date(cutoff ?? now.getTime() + BOND_PLACEMENT_LEAD_HOURS * HOUR_MS).toISOString();
}

/** The acceptance columns a NEGOTIATING edit by `editor` clears: the OTHER party's. */
export function acceptanceToClear(editor: 'initiator' | 'counterpart'): {
  acceptedAt: 'initiator_terms_accepted_at' | 'counterpart_terms_accepted_at';
  acceptedVersion: 'initiator_terms_accepted_version' | 'counterpart_terms_accepted_version';
} {
  return editor === 'initiator'
    ? { acceptedAt: 'counterpart_terms_accepted_at', acceptedVersion: 'counterpart_terms_accepted_version' }
    : { acceptedAt: 'initiator_terms_accepted_at', acceptedVersion: 'initiator_terms_accepted_version' };
}
