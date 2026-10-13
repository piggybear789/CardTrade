import 'server-only';

// lib/tracking/refreshOnRead.ts
//
// ASK THE CARRIER WHEN SOMEONE OPENS THE ROOM, not on a clock.
//
// A carrier-confirmed delivery is the only thing that starts a Cash_Sale's inspection
// window, and the window ending is what pays the seller. Until now the only things that
// could deliver that fact were an inbound Ship24 webhook — which, on the evidence, has
// never fired for this project — and a member pressing a refresh button, which is the
// system asking a person to do its job. Both are gone as the primary path: the button is
// removed, and this asks the question at the moment somebody wants the answer.
//
// WHY THIS BEATS AN HOURLY SWEEP. A sweep pays for every in-flight contract every hour,
// whether or not anyone cares, and still leaves a member staring at a stale room for up
// to an hour. A read-triggered check costs nothing for contracts nobody is looking at and
// resolves the one being looked at within a page load.
//
// HOW THE ANSWER REACHES THE SCREEN. It does NOT come back in the response — the check
// runs in `after()`, so the page has already been sent. Both rooms subscribe to Supabase
// Realtime on their own row, so the write lands, Postgres publishes it, and the open room
// moves to Inspection by itself. That is why nothing here needs to revalidate a path or
// return a value.
//
// THE THROTTLE IS NOT OPTIONAL, and it is not in memory. A contract room re-renders on
// every realtime message, every navigation and every `router.refresh()`, so a naive hook
// would call the provider several times a minute per viewer. Serverless has no single
// process to hold a cache and two visitors would each see an empty one, so the claim is
// made against the row itself: `tracking_checked_at` is stamped by a conditional UPDATE
// that returns the row to exactly one caller (0114). Both parties opening the room at
// once produces one lookup.
//
// STAMPED BEFORE THE CALL, AND KEPT EVEN WHEN THE CALL FAILS. A provider that is down or
// rate-limiting must not be retried on every subsequent page view. The next visit after
// the window is soon enough, and a failed lookup changes nothing a member can see.
//
// FAILURES ARE SWALLOWED ON PURPOSE. This is a side effect of reading a page. It must
// never surface as an error on a room that rendered perfectly, and it must never be a
// precondition for anything — the same rule `createNotification` follows, for the same
// reason.

import { after } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getTrackingService } from '@/domain/services/tracking';

/**
 * How long a carrier answer is treated as current.
 *
 * Ten minutes. A parcel produces a handful of scans a day, so a shorter window buys
 * nothing but provider quota; a longer one leaves a member who has just refreshed the
 * page wondering why the room disagrees with the carrier's website. Anyone who needs a
 * faster answer than this has the carrier's own page one click away in the room.
 */
const CHECK_TTL_MINUTES = 10;

/** ISO instant this many minutes ago, for the throttle comparison. */
function staleBefore(): string {
  return new Date(Date.now() - CHECK_TTL_MINUTES * 60_000).toISOString();
}

/**
 * Claim the right to ask about this sale, atomically.
 *
 * True when this caller stamped the row — nobody else has asked inside the window, so
 * this caller owns the lookup. The condition and the write are ONE statement precisely so
 * two concurrent visits cannot both win; splitting them into a read and a write would put
 * the race back.
 *
 * `status` is re-checked here as well as by the caller, because between the read and this
 * update the sale may have left IN_TRANSIT — a webhook, or the other party confirming.
 */
async function claimCashSale(cashSaleId: string): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .from('cash_sales')
    .update({ tracking_checked_at: new Date().toISOString() })
    .eq('id', cashSaleId)
    .eq('status', 'IN_TRANSIT')
    .or(`tracking_checked_at.is.null,tracking_checked_at.lt.${staleBefore()}`)
    .select('id');
  return !error && (data ?? []).length > 0;
}

/** The same claim for one side of a trade. Two parcels, two independent windows. */
async function claimTradeSide(
  tradeId: string,
  column: 'initiator_tracking_checked_at' | 'counterpart_tracking_checked_at',
): Promise<boolean> {
  const now = new Date().toISOString();
  // Spelled out per side rather than built from the `column` variable: a computed key
  // widens the patch to `{ [x: string]: string }`, which the generated row type rejects
  // outright — and the two-branch version is also the one that survives a column rename.
  const patch =
    column === 'initiator_tracking_checked_at'
      ? { initiator_tracking_checked_at: now }
      : { counterpart_tracking_checked_at: now };
  const { data, error } = await createAdminClient()
    .from('trades')
    .update(patch)
    .eq('id', tradeId)
    .eq('state', 'IN_TRANSIT')
    .or(`${column}.is.null,${column}.lt.${staleBefore()}`)
    .select('id');
  return !error && (data ?? []).length > 0;
}

/**
 * Check a Cash_Sale's outbound parcel with the carrier, after the response is sent.
 *
 * Call it from the room and from any list that shows the sale's state. Safe to call for
 * any sale in any status: everything that would make the lookup pointless is checked
 * here, so callers do not have to repeat the conditions.
 */
export function scheduleCashSaleTrackingCheck(cashSaleId: string): void {
  // No poll available means the manual binding is configured (it deliberately has no
  // `fetchStatus`), so there is nothing to ask and no reason to schedule anything.
  const tracking = getTrackingService();
  if (typeof tracking.fetchStatus !== 'function') return;

  after(async () => {
    try {
      const admin = createAdminClient();
      const { data: sale } = await admin
        .from('cash_sales')
        .select('id, status, tracking_carrier, tracking_number, tracking_checked_at')
        .eq('id', cashSaleId)
        .maybeSingle();

      // ESC-30: a return in flight is checked on read too, on its own throttle.
      if (sale?.status === 'RETURN_IN_TRANSIT') {
        await checkCashSaleReturnLeg(cashSaleId);
        return;
      }

      // IN_TRANSIT only. Before that there is no parcel; after it the delivery is
      // already recorded and a carrier answer cannot change the contract.
      if (!sale || sale.status !== 'IN_TRANSIT' || !sale.tracking_number) return;

      if (!(await claimCashSale(cashSaleId))) return;

      const snapshot = await tracking.fetchStatus!({
        carrier: sale.tracking_carrier ?? '',
        trackingNumber: sale.tracking_number,
      });
      if (!snapshot) return;

      // THE SAME RPC THE WEBHOOK CALLS. It owns the whole rule — DELIVERED sets
      // `carrier_delivered_at`, computes the inspection deadline, moves the status and
      // writes the CARRIER_DELIVERED event; anything else just records the state. Going
      // through it is what keeps a read-triggered delivery and a webhook delivery
      // identical, including the audit trail.
      await admin.rpc('apply_cash_sale_tracking', {
        p_cash_sale_id: cashSaleId,
        p_tracking_status: snapshot.status,
        // ?? undefined, not ?? null: the generated Args type for this RPC has the
        // parameter optional rather than nullable, and Postgres defaults it to null.
        p_delivered_at: snapshot.deliveredAt ?? undefined,
      });
    } catch (error) {
      // Never a member-visible failure: the room they asked for has already rendered.
      console.error('[tracking] cash sale check failed', cashSaleId, error);
    }
  });
}

/**
 * Claim the right to ask about a sale's RETURN parcel (ESC-30). Same single-statement
 * claim as the outbound leg, on its own column so the two legs never throttle each
 * other.
 */
async function claimReturnLeg(cashSaleId: string, ttlMinutes: number): Promise<boolean> {
  const before = new Date(Date.now() - ttlMinutes * 60_000).toISOString();
  const { data, error } = await createAdminClient()
    .from('cash_sales')
    .update({ return_tracking_checked_at: new Date().toISOString() })
    .eq('id', cashSaleId)
    .eq('status', 'RETURN_IN_TRANSIT')
    .is('return_carrier_delivered_at', null)
    .or(`return_tracking_checked_at.is.null,return_tracking_checked_at.lt.${before}`)
    .select('id');
  return !error && (data ?? []).length > 0;
}

/**
 * Ask the carrier about a sale's return parcel now, and apply the answer (ESC-30).
 *
 * Before this, only the Ship24 webhook could record a return's delivery, so a missed
 * delivery left the buyer's refund waiting on nothing. Since ESC-11, delivery opens
 * the seller's inspection window and nothing more; the refund itself is released by
 * the `:47` job once that window closes.
 *
 * Returns whether a lookup happened. Never throws.
 */
export async function checkCashSaleReturnLeg(
  cashSaleId: string,
  options: { ttlMinutes?: number } = {},
): Promise<boolean> {
  const tracking = getTrackingService();
  if (typeof tracking.fetchStatus !== 'function') return false;
  try {
    const admin = createAdminClient();
    const { data: sale } = await admin
      .from('cash_sales')
      .select('id, status, return_tracking_carrier, return_tracking_number, return_carrier_delivered_at')
      .eq('id', cashSaleId)
      .maybeSingle();
    if (
      !sale ||
      sale.status !== 'RETURN_IN_TRANSIT' ||
      !sale.return_tracking_number ||
      sale.return_carrier_delivered_at
    ) {
      return false;
    }
    if (!(await claimReturnLeg(cashSaleId, options.ttlMinutes ?? CHECK_TTL_MINUTES))) return false;

    const snapshot = await tracking.fetchStatus({
      carrier: sale.return_tracking_carrier ?? '',
      trackingNumber: sale.return_tracking_number,
    });
    if (!snapshot) return true;

    // The same RPC the webhook calls, so both paths open the same window.
    const { error } = await admin.rpc('apply_cash_sale_return_tracking', {
      p_cash_sale_id: cashSaleId,
      p_tracking_status: snapshot.status,
      p_delivered_at: snapshot.deliveredAt ?? undefined,
    });
    if (error) console.error('[tracking] return leg not applied', cashSaleId, error.message);
    return true;
  } catch (error) {
    console.error('[tracking] return leg check failed', cashSaleId, error);
    return false;
  }
}

/**
 * Check both parcels on a Trade, after the response is sent.
 *
 * A trade posts in both directions and the two parcels are independent, so each side
 * carries its own throttle column and is claimed separately. `apply_trade_tracking`
 * deliberately does NOT advance the state on a single delivery — a trade needs both — so
 * this only ever records what the carrier said and leaves the orchestrator to read the
 * columns back.
 */
export function scheduleTradeTrackingCheck(tradeId: string): void {
  const tracking = getTrackingService();
  if (typeof tracking.fetchStatus !== 'function') return;

  after(async () => {
    try {
      const admin = createAdminClient();
      const { data: trade } = await admin
        .from('trades')
        .select(
          'id, state, initiator_id, counterpart_id, initiator_tracking_carrier, initiator_tracking_number, counterpart_tracking_carrier, counterpart_tracking_number',
        )
        .eq('id', tradeId)
        .maybeSingle();
      if (!trade || trade.state !== 'IN_TRANSIT') return;

      const sides = [
        {
          traderId: trade.initiator_id,
          carrier: trade.initiator_tracking_carrier,
          number: trade.initiator_tracking_number,
          column: 'initiator_tracking_checked_at' as const,
        },
        {
          traderId: trade.counterpart_id,
          carrier: trade.counterpart_tracking_carrier,
          number: trade.counterpart_tracking_number,
          column: 'counterpart_tracking_checked_at' as const,
        },
      ];

      for (const side of sides) {
        if (!side.number || !side.traderId) continue;
        if (!(await claimTradeSide(tradeId, side.column))) continue;

        const snapshot = await tracking.fetchStatus!({
          carrier: side.carrier ?? '',
          trackingNumber: side.number,
        });
        if (!snapshot) continue;

        await admin.rpc('apply_trade_tracking', {
          p_trade_id: tradeId,
          p_trader_id: side.traderId,
          p_tracking_status: snapshot.status,
          // ?? undefined, not ?? null: the generated Args type for this RPC has the
        // parameter optional rather than nullable, and Postgres defaults it to null.
        p_delivered_at: snapshot.deliveredAt ?? undefined,
        });
      }
    } catch (error) {
      console.error('[tracking] trade check failed', tradeId, error);
    }
  });
}
