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
  const nowIso = new Date().toISOString();
  const warnBefore = new Date(Date.now() + WARNING_LEAD_HOURS * HOUR_MS).toISOString();
  const { data: closing } = await admin
    .from('cash_sales')
    .select('id, buyer_id')
    .eq('status', 'INSPECTION')
    .is('inspection_accepted_at', null)
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
      result.warned += 1;
    } catch (err) {
      console.warn(`[cash-sale-sweep] warning failed for ${sale.id}:`, err);
    }
  }

  return result;
}
