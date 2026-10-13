// lib/trades/tradeInspectionJob.ts
//
// The ordered passes of the hourly `:17` job (`app/api/jobs/trade-inspections`).
//
// ORDER IS LOAD-BEARING, which is why it is a list here rather than a sequence of
// statements in the route (a route module may only export its handlers):
//
//   1. hold-expiry re-estimate (R4-M5) — writes the provider's real `capture_before`
//      onto holds that still carry the old seven-day planning figure.
//   2. custody backstop (ESC-01) — captures lapsing holds on disputed trades. It keys
//      on `expires_at`, so it must run AFTER (1) and before anything else reads it.
//   3. the inspection timeout — releases collateral on trades whose window closed.
//      The one CRITICAL pass: a failure fails the job, as before.
//   4…  cash-sale inspection notices, the fee retry, collateral placement, the
//      handover advance, stale-collateral handling, and expiring undecided handover
//      change proposals. Each isolated, so one failing pass cannot cost the others.
//
// `server-only`.

import 'server-only';

import { flagStaleCollateralTrades, sweepTradeInspections } from './inspectionSweep';
import { advanceDueHandovers, placeDueTradeCollateral } from './bondPlacementSweep';
import { sweepCashSaleInspections } from './cashSaleInspectionSweep';
import { reestimateHoldExpiries } from './holdExpiryReestimate';
import { sweepCustodyEscalation } from './custodyEscalationSweep';
import { expireHandoverChangeProposals } from './handoverChanges';
import { drainFailedTradeFees } from '@/lib/actions/tradeFees';
import { logBackgroundFailure } from '@/lib/errors/errorLog';

/** One pass of the job. */
export interface TradeInspectionJobStep {
  key: string;
  /** A critical pass's failure fails the whole job; the rest are isolated. */
  critical?: boolean;
  run: () => Promise<unknown>;
}

/** The passes, in the order they run. */
export const TRADE_INSPECTION_JOB_STEPS: readonly TradeInspectionJobStep[] = [
  { key: 'holdExpiry', run: () => reestimateHoldExpiries() },
  { key: 'custody', run: () => sweepCustodyEscalation() },
  { key: 'inspections', critical: true, run: () => sweepTradeInspections() },
  { key: 'cashSales', run: () => sweepCashSaleInspections() },
  { key: 'fees', run: () => drainFailedTradeFees() },
  { key: 'bonds', run: () => placeDueTradeCollateral() },
  { key: 'handovers', run: () => advanceDueHandovers() },
  { key: 'stale', run: () => flagStaleCollateralTrades() },
  { key: 'handoverProposals', run: () => expireHandoverChangeProposals() },
];

/**
 * Run every pass in order. Returns each pass's result keyed by `key` (null when an
 * isolated pass failed and was logged). A critical pass's error propagates.
 */
export async function runTradeInspectionJob(
  steps: readonly TradeInspectionJobStep[] = TRADE_INSPECTION_JOB_STEPS,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  for (const step of steps) {
    if (step.critical) {
      results[step.key] = await step.run();
      continue;
    }
    try {
      results[step.key] = await step.run();
    } catch (error) {
      console.error(`[jobs] trade-inspections pass "${step.key}" failed`, error);
      await logBackgroundFailure({ name: `job.trade-inspections.${step.key}`, error });
      results[step.key] = null;
    }
  }
  return results;
}
