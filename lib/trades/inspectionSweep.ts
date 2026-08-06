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

/** How long before the deadline both traders are nudged, in hours. */
const WARNING_LEAD_HOURS = 24;

/** One hour in milliseconds. */
const HOUR_MS = 3_600_000;

/** Outcome of one pass. */
export interface TradeInspectionSweepResult {
  /** Trades completed because their window closed. */
  completed: number;
  /** Trades whose participants were warned that the window is closing. */
  warned: number;
  /** Trades that could not be completed; left for the next pass. */
  failed: number;
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
  const result: TradeInspectionSweepResult = { completed: 0, warned: 0, failed: 0 };

  const { data: due } = await admin
    .from('trades')
    .select('*')
    .eq('state', 'INSPECTION')
    .not('inspection_deadline_at', 'is', null)
    .lte('inspection_deadline_at', nowIso);

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

  for (const row of (due ?? []) as TradeRow[]) {
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
    await finalizeCompletedTrade(row);
    result.completed += 1;

    await admin.from('notifications').insert(
      [row.initiator_id, row.counterpart_id].map((userId) => ({
        user_id: userId,
        type: 'TRADE' as const,
        title: 'Trade completed automatically',
        body:
          `The ${TRADE_INSPECTION_HOURS}-hour inspection window closed without ` +
          'either trader accepting or disputing, so the trade completed and both ' +
          'collateral holds were released.',
        link: `/trades/${row.id}`,
      })),
    );
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
  }

  return result;
}
