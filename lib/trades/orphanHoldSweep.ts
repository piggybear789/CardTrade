// lib/trades/orphanHoldSweep.ts
//
// The daily orphan-authorisation sweep (ESC-34), run inside the `:17` job at 03 UTC,
// once per configured Stripe platform account.
//
// A region whose search fails (search unavailable on that account, a rate limit) is a
// logged skip, never a job failure. Each voided orphan is logged too, so an operator
// can see that the system released a card hold nobody had on file.
//
// `server-only`, not a Server Action.

import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { allConfiguredRegionCodes, getPaymentService } from '@/domain/services';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { sweepOrphanHolds, type OrphanSweepResult } from '@/domain/orchestrator/orphanHolds';

/** The UTC hour the daily pass runs in. */
export const ORPHAN_SWEEP_UTC_HOUR = 3;

export async function runOrphanHoldSweep(
  now: Date = new Date(),
): Promise<{ ran: boolean; regions: Record<string, OrphanSweepResult | 'skipped'> }> {
  if (now.getUTCHours() !== ORPHAN_SWEEP_UTC_HOUR) return { ran: false, regions: {} };
  const admin = createAdminClient();
  const regions: Record<string, OrphanSweepResult | 'skipped'> = {};

  for (const region of allConfiguredRegionCodes()) {
    const payments = getPaymentService(region);
    if (!payments.listUncapturedHolds) continue;
    try {
      regions[region] = await sweepOrphanHolds(
        {
          listUncaptured: (olderThan) => payments.listUncapturedHolds!({ olderThan }),
          async liveHoldIds(holdIds) {
            const { data, error } = await admin
              .from('pre_auth_holds')
              .select('hold_ref')
              .in('hold_ref', holdIds)
              .eq('status', 'ACTIVE');
            // A failed read must never look like "nothing is live": that would void
            // every real hold on the platform.
            if (error) throw new Error(`pre_auth_holds read: ${error.message}`);
            return new Set(((data ?? []) as Array<{ hold_ref: string }>).map((row) => row.hold_ref));
          },
          voidHold: (holdId) => payments.voidHold(holdId),
          async onVoided(holdId) {
            await logBackgroundFailure({
              name: 'collateral.orphan_voided',
              errorCode: 'ORPHAN_HOLD_VOIDED',
              message: 'Released a card hold with no live trade row.',
              context: { region, holdRef: holdId },
            });
          },
          async onVoidFailed(holdId, status) {
            await logBackgroundFailure({
              name: 'collateral.void',
              errorCode: 'VOID_FAILED',
              message: `An orphaned card hold could not be released (status ${status}).`,
              context: { region, holdRef: holdId },
            });
          },
        },
        now,
      );
    } catch (error) {
      regions[region] = 'skipped';
      await logBackgroundFailure({
        name: 'collateral.orphan_sweep',
        errorCode: 'ORPHAN_SWEEP_SKIPPED',
        error,
        context: { region },
      });
    }
  }
  return { ran: true, regions };
}
