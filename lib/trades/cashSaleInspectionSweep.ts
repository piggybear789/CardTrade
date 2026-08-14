import 'server-only';

// lib/trades/cashSaleInspectionSweep.ts
//
// Notification companion to the pg_cron `auto_complete_due_cash_sales` function.
// The SQL sweep completes the sale and queues the payout, but SQL cannot send
// in-app notifications or emails. This TypeScript pass runs on the same hourly
// schedule and handles:
//   1. Notifying both parties when a sale auto-completed since the last pass
//   2. Warning the buyer 24h before their inspection window closes

import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/createNotification';
import { emailNotify } from '@/lib/email';

/** How long before the deadline the buyer is nudged, in hours. */
const WARNING_LEAD_HOURS = 24;
const HOUR_MS = 3_600_000;

export interface CashSaleInspectionSweepResult {
  /** Sales whose parties were notified of auto-completion. */
  completionNotified: number;
  /** Sales whose buyer was warned about the closing window. */
  warned: number;
  /** Sales whose buyer was warned about the closing RETURN dispatch deadline (0088). */
  returnWarned: number;
  /** Returns whose deadline passed unposted, now flagged for staff (0089). */
  returnLapsed: number;
}

/**
 * Run one notification pass for cash sale inspections.
 *
 * De-duplication: auto-complete notifications are sent only for sales completed
 * in the last 2 hours with `auto_completed = true`. The hourly schedule means
 * each sale is seen at most twice, and `createNotification` is best-effort
 * (duplicate notifications are a cosmetic issue, not a money one).
 *
 * Warnings use `inspection_accepted_at IS NULL` as a proxy: once the buyer
 * accepts, the warning is moot. A sale that sits in INSPECTION without
 * acceptance for approaching the deadline gets warned.
 */
export async function sweepCashSaleInspections(): Promise<CashSaleInspectionSweepResult> {
  const admin = createAdminClient();
  const result: CashSaleInspectionSweepResult = {
    completionNotified: 0,
    warned: 0,
    returnWarned: 0,
    returnLapsed: 0,
  };

  // 1. Notify on recently auto-completed sales.
  const twoHoursAgo = new Date(Date.now() - 2 * HOUR_MS).toISOString();
  const { data: completed } = await admin
    .from('cash_sales')
    .select('id, buyer_id, seller_id')
    .eq('status', 'COMPLETED')
    .eq('auto_completed', true)
    .gte('completed_at', twoHoursAgo)
    .limit(50);

  for (const sale of completed ?? []) {
    try {
      await createNotification({
        userId: sale.buyer_id as string,
        type: 'SALE',
        title: 'Purchase completed automatically',
        body: 'Your inspection window closed without a dispute, so the sale is complete and the seller has been paid.',
        link: `/sales/${sale.id}`,
      });
      await createNotification({
        userId: sale.seller_id as string,
        type: 'SALE',
        title: 'Sale completed — payout queued',
        body: 'The buyer\'s inspection window closed. Your payout is being processed.',
        link: `/sales/${sale.id}`,
      });
      result.completionNotified += 1;
    } catch (err) {
      console.warn(`[cash-sale-sweep] notification failed for ${sale.id}:`, err);
    }
  }

  // 2. Warn the buyer 24h before the inspection window closes.
  //
  // DEDUPED ON `inspection_warned_at`. This ran hourly with nothing recording that it had
  // already fired, so one sale sent the buyer up to 24 identical notifications and 24
  // identical emails, each claiming the window closes "within 24 hours". Repeated
  // identical sends are also how mailbox providers decide a sender is spam, which puts
  // the messages a member genuinely must receive at risk. Three sibling warnings in this
  // codebase already stamp themselves; this was the one that did not.
  const nowIso = new Date().toISOString();
  const warnBefore = new Date(Date.now() + WARNING_LEAD_HOURS * HOUR_MS).toISOString();
  const { data: closing } = await admin
    .from('cash_sales')
    .select('id, buyer_id')
    .eq('status', 'INSPECTION')
    .is('inspection_accepted_at', null)
    .is('inspection_warned_at', null)
    .not('inspection_deadline_at', 'is', null)
    .gt('inspection_deadline_at', nowIso)
    .lte('inspection_deadline_at', warnBefore)
    .limit(50);

  for (const sale of closing ?? []) {
    try {
      await createNotification({
        userId: sale.buyer_id as string,
        type: 'SALE',
        title: 'Inspection window closing',
        body: 'Your inspection window closes within 24 hours. Accept the item or raise a dispute before then — otherwise the sale completes and the seller is paid.',
        link: `/sales/${sale.id}`,
      });
      void emailNotify.inspectionDeadlineWarning({
        userId: sale.buyer_id as string,
        contractType: 'sale',
        contractId: sale.id as string,
        hoursRemaining: 24,
      });
      // Stamped AFTER the send, so a failed send is retried next pass rather than being
      // silently recorded as warned.
      await admin
        .from('cash_sales')
        .update({ inspection_warned_at: nowIso })
        .eq('id', sale.id)
        .is('inspection_warned_at', null);
      result.warned += 1;
    } catch (err) {
      console.warn(`[cash-sale-sweep] warning failed for ${sale.id}:`, err);
    }
  }

  // 3. Warn the buyer before the RETURN dispatch deadline closes (0088).
  //
  // `return_warned_at IS NULL` is the de-duplication here, unlike the inspection
  // warning above which tolerates a repeat. A return warning must not repeat: it is
  // the notice that precedes a case going to arbitration, so sending it twice would
  // misrepresent how much time is left.
  const { data: returnsClosing } = await admin
    .from('cash_sales')
    .select('id, buyer_id')
    .eq('status', 'RETURN_PENDING')
    .is('return_shipped_at', null)
    .is('return_warned_at', null)
    .not('return_deadline_at', 'is', null)
    .gt('return_deadline_at', nowIso)
    .lte('return_deadline_at', warnBefore)
    .limit(50);

  for (const sale of returnsClosing ?? []) {
    try {
      await createNotification({
        userId: sale.buyer_id as string,
        type: 'SALE',
        title: 'Post your return within 24 hours',
        // Says what happens next WITHOUT threatening the refund, because the refund is
        // not at risk on this timer — see 0089. Overstating the consequence to force
        // action would be a lie told for convenience.
        body:
          'Your refund is waiting on the item coming back. Post it and add the tracking '
          + 'number within 24 hours. If you miss the deadline our team picks the case up '
          + 'rather than closing it automatically — but it will take longer to resolve.',
        link: `/sales/${sale.id}`,
      });
      void emailNotify.returnDeadlineWarning({
        userId: sale.buyer_id as string,
        contractId: sale.id as string,
        hoursRemaining: 24,
      });
      // Stamped AFTER the send, so a failed send is retried on the next pass rather
      // than being silently marked as warned.
      await admin
        .from('cash_sales')
        .update({ return_warned_at: nowIso })
        .eq('id', sale.id)
        .is('return_warned_at', null);
      result.returnWarned += 1;
    } catch (err) {
      console.warn(`[cash-sale-sweep] return warning failed for ${sale.id}:`, err);
    }
  }

  // 4. Flag returns whose dispatch deadline has passed with nothing posted.
  //
  // NOTHING IS SETTLED HERE. No refund is reversed and nothing is released to the
  // seller — this only makes the case visible to staff, for the reasons recorded in
  // migration 0089. Reversing an operator's finding on a timer, unattended, is the
  // one thing this sweep must never do.
  const { data: lapsed } = await admin
    .from('cash_sales')
    .select('id, buyer_id, seller_id')
    .eq('status', 'RETURN_PENDING')
    .is('return_shipped_at', null)
    .is('return_lapsed_at', null)
    .not('return_deadline_at', 'is', null)
    .lt('return_deadline_at', nowIso)
    .limit(50);

  for (const sale of lapsed ?? []) {
    try {
      const { error } = await admin
        .from('cash_sales')
        .update({ return_lapsed_at: nowIso })
        .eq('id', sale.id)
        .is('return_lapsed_at', null);
      // Only notify if THIS pass won the stamp, so a concurrent run cannot double-send.
      if (error) continue;

      await createNotification({
        userId: sale.seller_id as string,
        type: 'SALE',
        title: 'Return not posted — we are reviewing it',
        body:
          'The buyer did not post the item back before the deadline. Our team is now '
          + 'reviewing the case. Nothing has been paid out either way while we do.',
        link: `/sales/${sale.id}`,
      });
      await createNotification({
        userId: sale.buyer_id as string,
        type: 'SALE',
        title: 'Return deadline passed',
        body:
          'You have not posted the item back yet, so your refund is on hold and our team '
          + 'is reviewing the case. You can still post it — add the tracking number and '
          + 'the review closes on its own.',
        link: `/sales/${sale.id}`,
      });
      result.returnLapsed += 1;
    } catch (err) {
      console.warn(`[cash-sale-sweep] lapse flag failed for ${sale.id}:`, err);
    }
  }

  return result;
}
