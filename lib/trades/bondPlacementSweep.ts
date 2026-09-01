// lib/trades/bondPlacementSweep.ts
//
// Place a Trade's collateral the day before the meeting.
//
// WHY NOT AT AGREEMENT, WHICH IS WHERE IT USED TO HAPPEN. A card authorisation lasts
// about seven days and cannot be extended on this account. Placing it when terms were
// agreed spent that budget on WAITING: agree today, meet in three weeks, and the
// collateral was long dead before anyone shook hands. The only defence was to ration
// the meeting date, which charged traders for our infrastructure limit.
//
// Placing it `BOND_PLACEMENT_LEAD_HOURS` before the meeting spends the authorisation
// on the part that actually carries risk — the handover and the inspection window
// after it — and lets two traders pick any date they like.
//
// WHY A DAY EARLY AND NOT AT THE MEETING. A declined card has to be survivable. Found
// the evening before it is a text message and a new card; found in a car park it is
// two people standing there with nothing to do. The lead time is the only chance to
// fix a decline before it matters.
//
// `server-only`, and NOT a Server Action. Every export of a `'use server'` module is
// an endpoint addressable by anyone who learns its id, and "authorise both traders'
// cards" has no business on that surface. The job route is its only caller.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { BOND_PLACEMENT_LEAD_HOURS } from '@/domain/fulfilment';
import { createDefaultTradeOrchestrator } from '@/domain/orchestrator/supabaseTradeRepository';
import { getPaymentService } from '@/domain/services';
import { regionForCurrency } from '@/lib/regionBinding';
import { createNotification } from '@/lib/notifications/createNotification';
import { placeTradeCollateral } from './collateralPlacement';

/**
 * How many trades one pass will authorise.
 *
 * Each one makes several provider calls and a serverless function has a wall-clock
 * limit, so an unbounded pass does not merely run slowly — it is cut off mid-batch,
 * and the trades after the cut reach their meeting with no collateral at all. Mirrors
 * the bound on the inspection sweep and the payout drain.
 */
const MAX_TRADES_PER_PASS = 25;

const HOUR_MS = 3_600_000;

export interface BondPlacementSweepResult {
  /** Trades whose collateral is now live. */
  placed: number;
  /** Trades whose cards refused. They stay in COLLATERAL_PENDING and can be retried. */
  failed: number;
  /** Due trades this pass did not reach, so a backlog is visible rather than silent. */
  remaining: number;
}

/**
 * Authorise collateral for every trade whose meeting is within the lead time.
 *
 * Runs on the hourly job. The window is deliberately open-ended on the near side —
 * anything from "a day away" down to "already overdue" is picked up — because a pass
 * that skipped late trades would leave a trade that missed its slot permanently
 * unauthorised. A trade whose meeting has already passed without collateral is
 * surfaced by `flagStaleCollateralTrades` instead.
 */
export async function placeDueTradeCollateral(): Promise<BondPlacementSweepResult> {
  const admin = createAdminClient();
  const dueBefore = new Date(Date.now() + BOND_PLACEMENT_LEAD_HOURS * HOUR_MS).toISOString();

  const { data } = await admin
    .from('trades')
    .select('id, initiator_id, meeting_at')
    .eq('state', 'COLLATERAL_PENDING')
    .not('meeting_at', 'is', null)
    .lte('meeting_at', dueBefore)
    // Soonest meeting first: the trade closest to needing its collateral is the one
    // that can least afford to be at the back of a backlog.
    .order('meeting_at', { ascending: true })
    .limit(MAX_TRADES_PER_PASS + 1);

  const rows = (data ?? []) as Array<{
    id: string;
    initiator_id: string;
    meeting_at: string | null;
  }>;
  const batch = rows.slice(0, MAX_TRADES_PER_PASS);

  let placed = 0;
  let failed = 0;

  for (const row of batch) {
    // Isolated per trade. One unhealthy row must cost one trade, not the queue —
    // a thrown error here would leave every later trade in the batch unauthorised
    // on the morning of its meeting.
    try {
      const result = await placeTradeCollateral({
        tradeId: row.id,
        // Nobody decided this; a clock did. The audit row needs an actor, so the
        // initiator is recorded as requester and the event names the real cause.
        // Same convention as the inspection sweep.
        actorId: row.initiator_id,
      });

      if (result.ok) {
        placed += 1;
        continue;
      }

      failed += 1;
      // Told to BOTH traders, not just the one whose card refused. The other has a
      // meeting tomorrow that is no longer protected, and that is their business too.
      await notifyBothTraders(row.id, result.message);
    } catch (error) {
      failed += 1;
      console.error(`[trades] collateral placement failed for trade ${row.id}`, error);
    }
  }

  return { placed, failed, remaining: Math.max(rows.length - batch.length, 0) };
}

export interface HandoverAdvanceResult {
  /** Trades whose inspection window opened without anyone confirming. */
  advanced: number;
}

/**
 * Open the inspection window on trades whose meeting time has passed.
 *
 * WHY THIS EXISTS. `COLLATERAL_LOCKED -> INSPECTION` needs BOTH traders to confirm the
 * handover, and nothing advanced it on a timer. Two people who met and forgot to tap
 * left the trade believing nothing had happened: no dispute window, and collateral
 * quietly lapsing under a swap that really occurred. Auto-completion already existed
 * one step later — `INSPECTION_EXPIRED` finishes an untouched trade — so silence was
 * already read as consent there. This closes the step before it.
 *
 * ADVANCING RATHER THAN VOIDING, and the difference matters. Voiding a trade whose
 * meeting time has passed would delete the dispute path on an exchange that may well
 * have happened; the system only knows what people told it, and it was told nothing.
 * Advancing opens the window instead: both are notified, either can raise a problem
 * for the next five days, and the collateral is still live to answer it. A meeting
 * that never happened is recoverable too — that is `HANDOVER_FAILED`.
 *
 * The event is `HANDOVER_ASSUMED`, not `BOTH_HANDOVER_CONFIRMED`, so the audit trail
 * never claims a confirmation nobody gave.
 */
export async function advanceDueHandovers(): Promise<HandoverAdvanceResult> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data } = await admin
    .from('trades')
    .select('id, initiator_id, currency')
    .eq('state', 'COLLATERAL_LOCKED')
    .eq('handover_method', 'IN_PERSON')
    .not('meeting_at', 'is', null)
    .lte('meeting_at', nowIso)
    .order('meeting_at', { ascending: true })
    .limit(MAX_TRADES_PER_PASS);

  const rows = (data ?? []) as Array<{
    id: string;
    initiator_id: string;
    currency: string | null;
  }>;

  let advanced = 0;
  for (const row of rows) {
    // Isolated per trade, like every other pass here: one unhealthy row costs one
    // trade rather than leaving the rest of the batch without a dispute window.
    try {
      const orchestrator = createDefaultTradeOrchestrator({
        payments: getPaymentService(regionForCurrency(row.currency)),
      });
      const applied = await orchestrator.applyEvent({
        tradeId: row.id,
        event: 'HANDOVER_ASSUMED',
        // Nobody decided this; a clock did. The audit row needs an actor, so the
        // initiator is recorded as requester and the event names the real cause.
        actorId: row.initiator_id,
      });
      if (!applied.ok) continue;

      advanced += 1;
      await notifyBoth(
        row.id,
        'Your trade is now in inspection',
        'Your meeting time has passed, so the inspection window is open. Check what you ' +
          'received and raise a problem in the next five days if anything is wrong. If ' +
          'you never met, report it now.',
      );
    } catch (error) {
      console.error(`[trades] handover advance failed for trade ${row.id}`, error);
    }
  }

  return { advanced };
}

/** Tell both participants that tomorrow's meeting has no collateral behind it yet. */
async function notifyBothTraders(tradeId: string, detail: string): Promise<void> {
  await notifyBoth(
    tradeId,
    'Trade collateral could not be placed',
    `${detail} Your meeting is not protected until the hold is in place.`,
  );
}

/**
 * Notify both participants of a trade.
 *
 * Both, never just the one the event happened to. A collateral failure on one card
 * leaves the OTHER trader with an unprotected meeting tomorrow, and an inspection
 * window that opens on its own is a deadline for each of them.
 */
async function notifyBoth(tradeId: string, title: string, body: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('trades')
    .select('initiator_id, counterpart_id')
    .eq('id', tradeId)
    .maybeSingle();
  const row = data as { initiator_id: string; counterpart_id: string } | null;
  if (!row) return;

  for (const userId of [row.initiator_id, row.counterpart_id]) {
    if (!userId) continue;
    try {
      // A failed notification must not cost the state change that earned it.
      await createNotification({ userId, type: 'TRADE', title, body, link: `/trades/${tradeId}` });
    } catch (error) {
      console.warn(`[trades] could not notify ${userId} about trade ${tradeId}`, error);
    }
  }
}
