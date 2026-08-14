// lib/trades/inspectionSweep.ts
//
// The 2-way Trade inspection timeout: complete trades whose window has closed, and
// warn the ones about to close.
//
// WHY THIS IS TYPESCRIPT AND NOT A pg_cron FUNCTION, unlike
// `auto_complete_due_cash_sales` in 0011. Completing a trade has to release BOTH
// collateral authorisations and settle any cash leg, and neither can happen inside
// Postgres. A SQL sweeper could only flip the state, leaving both traders' cards
// authorised — which is the exact failure the timeout exists to prevent. Routing it
// through `finalizeCompletedTrade` is what makes the timeout do precisely what a
// mutual acceptance does. This is the same reasoning that put the Cash_Sale payout
// drain behind a job route rather than a cron function.
//
// WHY THERE IS A TIMEOUT AT ALL. Without one, an unresponsive counterpart parks both
// traders' collateral until the card authorisation lapses of its own accord about
// seven days after it was placed. That is not a neutral outcome: it silently removes
// the guarantee both sides were promised, and leaves a dispute with nothing to
// capture.
//
// `server-only`, and NOT a Server Action. Every export of a `'use server'` module is
// an endpoint addressable by anyone who learns its id, and a money-moving sweep has
// no business on that surface. The job route is its only caller.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createDefaultTradeOrchestrator } from '@/domain/orchestrator/supabaseTradeRepository';
import { getPaymentService } from '@/domain/services';
import { regionForCurrency } from '@/lib/regionBinding';
import { TRADE_INSPECTION_HOURS } from '@/domain/fulfilment';
import { finalizeCompletedTrade, type TradeRow } from './completion';
import { emailNotify } from '@/lib/email';

/** How long before the deadline both traders are nudged, in hours. */
const WARNING_LEAD_HOURS = 24;

/** One hour in milliseconds. */
const HOUR_MS = 3_600_000;

/**
 * How many due trades one pass will handle.
 *
 * The query used to be unbounded. A serverless function has a wall-clock limit and
 * each trade here makes several provider calls, so a large backlog did not merely run
 * slowly — it was cut off mid-batch, and the trades after the cut stayed in INSPECTION
 * past their deadline with their collateral burning down toward the ~7-day
 * authorisation limit. A bounded pass on an hourly schedule drains steadily and
 * reports what it left behind. Mirrors the cash-sale payout drain, which bounds itself
 * the same way.
 */
const MAX_TRADES_PER_PASS = 25;

/**
 * How long a trade may sit in COLLATERAL_PENDING before a human is told.
 *
 * COLLATERAL_PENDING is a MOMENT, not a phase. `placeBondsForAgreedTrade` authorises
 * both cards and `syncHolds` reads the results back immediately and dispatches
 * HOLDS_CONFIRMED or HOLDS_FAILED, all in one request. A trade should pass through in
 * seconds.
 *
 * If it does not — the process died between placing the holds and syncing them, or the
 * read-back failed — the state machine has no other exit: HOLDS_FAILED loops back to
 * COLLATERAL_PENDING rather than terminating. The trade then sits with two live
 * authorisations against two members' cards and nothing advancing it. The only thing
 * that eventually noticed was `expire_lapsed_holds`, roughly SEVEN DAYS later when the
 * authorisations lapsed of their own accord.
 *
 * An hour is generous for something that should take seconds, and on an hourly schedule
 * it means a stuck trade is surfaced within two hours instead of a week. Nothing is
 * moved or reversed here — money on hold is not money lost, and guessing which way a
 * half-finished authorisation should resolve is exactly the decision a human should make.
 */
const STALE_COLLATERAL_HOURS = 1;

/** Outcome of one pass. */
export interface TradeInspectionSweepResult {
  /** Trades completed because their window closed. */
  completed: number;
  /** Trades whose participants were warned that the window is closing. */
  warned: number;
  /** Trades that could not be completed; left for the next pass. */
  failed: number;
  /**
   * Trades that DID complete but whose money side did not fully land — a collateral
   * void the provider refused, or a cash leg that did not settle. Each one is flagged
   * `manual_reconciliation` in the database; this is the count for the job's report,
   * because "completed" alone reads as "nothing to look at".
   */
  needsReconciliation: number;
  /** True when more trades were due than one pass handles. */
  moreDue: boolean;
}

/**
 * Run one inspection-timeout pass.
 *
 * Idempotent and safe on a schedule: the state guard inside the orchestrator's
 * optimistic-lock commit means each trade leaves INSPECTION at most once, and the
 * cash transfer reuses a persisted nonce so a duplicate cannot pay anyone twice.
 * DISPUTED trades are excluded by the state filter, so raising a dispute always
 * stops the clock.
 */
export async function sweepTradeInspections(): Promise<TradeInspectionSweepResult> {
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const result: TradeInspectionSweepResult = {
    completed: 0,
    warned: 0,
    failed: 0,
    needsReconciliation: 0,
    moreDue: false,
  };

  // Oldest deadline first, so the trades closest to losing their collateral are
  // handled before the rest, and one extra row to detect a backlog.
  const { data: due } = await admin
    .from('trades')
    .select('*')
    .eq('state', 'INSPECTION')
    .not('inspection_deadline_at', 'is', null)
    .lte('inspection_deadline_at', nowIso)
    .order('inspection_deadline_at', { ascending: true })
    .limit(MAX_TRADES_PER_PASS + 1);

  const dueRows = (due ?? []) as TradeRow[];
  result.moreDue = dueRows.length > MAX_TRADES_PER_PASS;
  const batch = dueRows.slice(0, MAX_TRADES_PER_PASS);

  // One orchestrator PER PLATFORM ACCOUNT (0068), cached across the batch.
  //
  // This sweep spans every region at once, and completing a trade releases its
  // collateral — a real authorisation that belongs to the Stripe account which
  // created it. A single shared service would fail to find the PaymentIntent for
  // every trade outside its own region and leave that collateral held until the
  // authorisation lapsed, which is the failure the inspection clock exists to
  // prevent. Cached rather than rebuilt per trade because a batch is usually one
  // region and constructing a client per row is wasteful.
  const byRegion = new Map<string, ReturnType<typeof createDefaultTradeOrchestrator>>();
  const orchestratorFor = (currency: string | null) => {
    const region = regionForCurrency(currency);
    const existing = byRegion.get(region);
    if (existing) return existing;
    const built = createDefaultTradeOrchestrator({ payments: getPaymentService(region) });
    byRegion.set(region, built);
    return built;
  };

  for (const row of batch) {
    // ONE BAD ROW MUST NOT ABORT THE PASS.
    //
    // Nothing in this loop used to be guarded, so a throw from any of the writes, the
    // provider calls or the notification insert propagated out to the job route as a
    // 500. Every trade already handled stayed completed with its collateral released,
    // and every trade after it in the batch stayed in INSPECTION past its deadline —
    // the failure mode the timeout exists to prevent, triggered by the timeout itself.
    // Isolating per trade means a single unhealthy row costs one trade, not the queue.
    try {
      const orchestrator = orchestratorFor(row.currency);
      const applied = await orchestrator.applyEvent({
        tradeId: row.id,
        event: 'INSPECTION_EXPIRED',
        // Nobody decided this; a clock did. The audit row needs an actor, and the
        // initiator is recorded as the requester with the event naming the real cause.
        actorId: row.initiator_id,
      });
      if (!applied.ok) {
        // A lost optimistic-lock race or a state that moved on. Not an error worth
        // shouting about — the next pass picks it up if it is still due.
        result.failed += 1;
        continue;
      }

      await admin
        .from('trades')
        .update({ auto_completed: true, updated_at: new Date().toISOString() })
        .eq('id', row.id);

      // The whole point: release collateral and settle cash, exactly as a mutual
      // acceptance would.
      const finalized = await finalizeCompletedTrade(row);
      result.completed += 1;

      const moneySettled =
        finalized.holdsFailed === 0 && finalized.cashSettled !== false;
      if (!moneySettled) result.needsReconciliation += 1;

      // SAY ONLY WHAT HAPPENED. This message asserted that "both collateral holds
      // were released" unconditionally, because the finalize result was discarded —
      // so a trader whose card was still encumbered was told in writing that it was
      // not. The claim is now conditional on the outcome.
      await admin.from('notifications').insert(
        [row.initiator_id, row.counterpart_id].map((userId) => ({
          user_id: userId,
          type: 'TRADE' as const,
          title: 'Trade completed automatically',
          body: moneySettled
            ? `The ${TRADE_INSPECTION_HOURS}-hour inspection window closed without ` +
              'either trader accepting or disputing, so the trade completed and both ' +
              'collateral holds were released.'
            : `The ${TRADE_INSPECTION_HOURS}-hour inspection window closed without ` +
              'either trader accepting or disputing, so the trade completed. Part of ' +
              'the settlement is still being finalised and our team is on it — if a ' +
              'collateral hold is still showing on your card, it will clear shortly.',
          link: `/trades/${row.id}`,
        })),
      );
    } catch (err) {
      result.failed += 1;
      console.warn(`[trades] inspection sweep failed for trade ${row.id}:`, err);
    }
  }

  // Nudge before the window closes. A silent auto-complete would be a trap, and the
  // dispatch-deadline job in 0039 already set the precedent of warning first.
  const warnBefore = new Date(Date.now() + WARNING_LEAD_HOURS * HOUR_MS).toISOString();
  const { data: closing } = await admin
    .from('trades')
    .select('id, initiator_id, counterpart_id')
    .eq('state', 'INSPECTION')
    .is('inspection_warned_at', null)
    .not('inspection_deadline_at', 'is', null)
    .gt('inspection_deadline_at', nowIso)
    .lte('inspection_deadline_at', warnBefore);

  for (const row of closing ?? []) {
    // Isolated for the same reason as the completion loop: a failed nudge must not
    // cost the remaining traders theirs. A warning is also the cheapest thing here to
    // lose, so it is never allowed to fail the pass.
    try {
      await admin.from('notifications').insert(
        [row.initiator_id, row.counterpart_id].map((userId) => ({
          user_id: userId,
          type: 'TRADE' as const,
          title: 'Inspection window closing',
          body:
            `This trade completes automatically within ${WARNING_LEAD_HOURS} hours and ` +
            'both collateral holds are released. If something is wrong with what you ' +
            'received, accept it or raise a dispute before then.',
          link: `/trades/${row.id}`,
        })),
      );
      await admin
        .from('trades')
        .update({ inspection_warned_at: new Date().toISOString() })
        .eq('id', row.id);
      result.warned += 1;
      void emailNotify.inspectionDeadlineWarning({
        userId: row.initiator_id as string,
        contractType: 'trade',
        contractId: row.id as string,
        hoursRemaining: 24,
      });
      void emailNotify.inspectionDeadlineWarning({
        userId: row.counterpart_id as string,
        contractType: 'trade',
        contractId: row.id as string,
        hoursRemaining: 24,
      });
    } catch (err) {
      console.warn(`[trades] inspection warning failed for trade ${row.id}:`, err);
    }
  }

  return result;
}

/**
 * Flag trades stuck in COLLATERAL_PENDING for a human.
 *
 * SEPARATE FROM THE SWEEP ABOVE, on purpose. That one finishes trades whose inspection
 * window closed and makes provider calls to do it; this one only reads and flags. Bolting
 * it on would have put a detection pass inside a function whose wall-clock budget belongs
 * to money movement, and — the reason it is visible in the tests — every existing sweep
 * test would have had to grow an expectation for a query it does not care about. A test
 * harness objecting that loudly is usually describing a design problem, not an
 * inconvenience.
 *
 * Called from the same hourly job, so this adds no new schedule.
 */
export async function flagStaleCollateralTrades(): Promise<{ flagged: number }> {
  const admin = createAdminClient();
  const staleBefore = new Date(
    Date.now() - STALE_COLLATERAL_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const { data: stale } = await admin
    .from('trades')
    .select('id')
    .eq('state', 'COLLATERAL_PENDING')
    .eq('manual_reconciliation', false)
    .lt('updated_at', staleBefore)
    .limit(MAX_TRADES_PER_PASS);

  let flagged = 0;
  for (const row of (stale ?? []) as Array<{ id: string }>) {
    try {
      await admin
        .from('trades')
        .update({ manual_reconciliation: true })
        .eq('id', row.id)
        // Only if STILL stuck: a trade that advanced between the read and this write
        // must not be flagged, or the queue fills with cases that fixed themselves.
        .eq('state', 'COLLATERAL_PENDING')
        .eq('manual_reconciliation', false);
      flagged += 1;
    } catch (err) {
      console.warn(`[trades] stale-collateral flag failed for trade ${row.id}:`, err);
    }
  }

  return { flagged };
}
