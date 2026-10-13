// app/api/jobs/cash-sale-payouts/route.ts
//
// Drains the queue of owed Seller releases (Req 4.3).
//
// WHY THIS EXISTS AS A ROUTE. Releasing funds requires calling the payment
// provider, which cannot happen inside Postgres — so the `auto_complete_due_cash_sales`
// cron can only QUEUE a release, not perform it. Something outside the database
// has to do the paying, and a scheduled request to this endpoint is it.
//
// SECURITY. This endpoint moves real money and is NOT session-authenticated,
// exactly like the webhook route. It is guarded by a shared secret in
// `JOBS_SECRET`, compared in constant time, and it FAILS CLOSED when that secret
// is absent — an unauthenticated money-moving endpoint would be far worse than a
// job that does not run. Being called by an attacker cannot create payouts that
// were not already owed (the queue is derived from COMPLETED sales, and every
// release is idempotent on a persisted nonce), but it could be used to hammer the
// provider, so it stays authenticated.

import { timingSafeEqual } from 'node:crypto';

import { createDefaultCashSaleOrchestrator } from '@/domain/orchestrator/supabaseCashSaleRepository';
import { createDefaultCollateralDisbursementDrain } from '@/domain/orchestrator/supabaseCollateralDisbursementRepository';
import { drainTradeCash } from '@/domain/orchestrator/tradeCashSettlement';
import { createDefaultTradeCashDeps } from '@/domain/orchestrator/supabaseTradeCashSettlementRepository';
import { getPaymentService, operationalPlatforms } from '@/domain/services';
import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { regionForCashSale } from '@/lib/regionBinding';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkCashSaleReturnLeg } from '@/lib/tracking/refreshOnRead';

/** Payouts must not be prerendered or cached. */
export const dynamic = 'force-dynamic';

/** Compare two secrets without leaking length or content through timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which would itself be a leak.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract a bearer token from the Authorization header. */
function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme.toLowerCase() !== 'bearer') return null;
  const token = rest.join(' ').trim();
  return token || null;
}

/** A return not read back from the carrier for this long is re-checked (ESC-30). */
const RETURN_SYNC_TTL_MINUTES = 6 * 60;
/** A return still in transit after this many days is surfaced to staff. */
const STALE_RETURN_DAYS = 14;

/**
 * Read back every in-flight return the carrier has not been asked about in six hours,
 * so a missed webhook cannot strand a buyer's refund (ESC-30). Returns the number
 * checked and the sales that have been in transit for over two weeks.
 */
async function syncStaleReturns(): Promise<{ checked: number; stale: string[] }> {
  const admin = createAdminClient();
  const before = new Date(Date.now() - RETURN_SYNC_TTL_MINUTES * 60_000).toISOString();
  const { data, error } = await admin
    .from('cash_sales')
    .select('id, return_shipped_at')
    .eq('status', 'RETURN_IN_TRANSIT')
    .is('return_carrier_delivered_at', null)
    .or(`return_tracking_checked_at.is.null,return_tracking_checked_at.lt.${before}`)
    .limit(100);
  if (error) throw new Error(`syncStaleReturns: ${error.message}`);

  const staleCutoff = Date.now() - STALE_RETURN_DAYS * 86_400_000;
  let checked = 0;
  const stale: string[] = [];
  for (const row of data ?? []) {
    if (await checkCashSaleReturnLeg(row.id, { ttlMinutes: RETURN_SYNC_TTL_MINUTES })) checked += 1;
    const shipped = row.return_shipped_at ? Date.parse(row.return_shipped_at) : NaN;
    if (Number.isFinite(shipped) && shipped < staleCutoff) stale.push(row.id);
  }
  return { checked, stale };
}

/** Authenticate, run one pass, and report the outcome. Shared by GET and POST. */
async function runPayoutPass(request: Request): Promise<Response> {
  const jobsSecret = process.env.JOBS_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const secrets = [jobsSecret, cronSecret].filter(Boolean) as string[];

  if (secrets.length === 0) {
    // Fail closed. Never run an unauthenticated money-moving job.
    return Response.json(
      { ok: false, error: 'Neither JOBS_SECRET nor CRON_SECRET is configured' },
      { status: 503 },
    );
  }

  const token = bearerToken(request);
  if (!token || !secrets.some((expected) => secretMatches(token, expected))) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // One pass PER REGION (0068). Each region's proceeds sit in its own Stripe
    // platform account, so a single pass could only release the sellers in its own
    // region; the rest would fail as cross-region transfers and, worse, each failure
    // burns a payout attempt until the retry budget is exhausted on a contract that
    // was never broken.
    //
    // A failing region must not abort the others: an outage on one platform account
    // is not a reason to leave every other region's sellers unpaid. Failures are
    // collected and reported, and the pass still returns 200 when any region drained,
    // because a cron retry of the whole job would re-attempt the ones that worked.
    const totals = { considered: 0, settled: 0, stillOwed: 0 };
    // Refunds owed to BUYERS, drained on the same pass. They are the mirror image of a
    // seller release — money the platform holds that belongs to a member — and until
    // now nothing retried one that failed, which for a partial refund meant never.
    const refunds = { considered: 0, settled: 0, stillOwed: 0 };
    const collateral = { considered: 0, settled: 0, deferred: 0, failed: 0 };
    const tradeCash = { released: 0, refunded: 0, deferred: 0, failed: 0 };
    const failures: string[] = [];

    // Every per-sale failure the drains report, written to the error log (0123) once
    // the pass is over. Collected rather than written inline because the hooks are
    // synchronous, and awaited at the end so the rows land before the function freezes.
    const drainReports: Parameters<typeof logBackgroundFailure>[0][] = [];

    // One pass per PLATFORM and CURRENCY: the US platform holds contracts in USD, EUR,
    // GBP and more, and looping over regions would drain it once per EEA country.
    // `region` below names the pass as `<platform>:<currency>` in logs and failures.
    const passes = [...operationalPlatforms()].flatMap(([platform, currencies]) =>
      currencies.map((currency) => ({ platform, currency, region: `${platform}:${currency}` })),
    );
    for (const { platform, currency, region } of passes) {
      try {
        const orchestrator = createDefaultCashSaleOrchestrator({
          payments: getPaymentService(platform),
          payoutRegionCurrency: currency,
          onDrainError: ({ cashSaleId, error }) => {
            console.error(`[cash-sale drain] ${cashSaleId}:`, error);
            drainReports.push({
              name: 'job.cash-sale-payouts.sale',
              errorCode: 'THREW',
              error,
              context: { cashSaleId, region },
            });
          },
          onDrainFailure: ({ cashSaleId, kind, error, detail }) => {
            drainReports.push({
              name: kind === 'payout' ? 'payout.seller' : 'refund.buyer',
              errorCode: error,
              message: detail ?? `${kind === 'payout' ? 'Seller release' : 'Buyer refund'} failed: ${error}`,
              context: { cashSaleId, region },
            });
          },
        });
        const result = await orchestrator.processDuePayouts();
        totals.considered += result.considered;
        totals.settled += result.settled;
        totals.stillOwed += result.stillOwed;

        // Isolated from the release drain: a refund problem must not stop sellers being
        // paid, and vice versa.
        try {
          const refunded = await orchestrator.processDueRefunds();
          refunds.considered += refunded.considered;
          refunds.settled += refunded.settled;
          refunds.stillOwed += refunded.stillOwed;
        } catch (error) {
          console.error(`[jobs] cash-sale refund drain failed for region ${region}`, error);
          drainReports.push({
            name: 'job.cash-sale-payouts.refunds',
            error,
            context: { region },
          });
        }

        // ESC-03: buyer-present payments left unfinished for 30 min (an abandoned
        // 3-D Secure check) are cancelled and returned to AGREEMENT, or settled when
        // the check finished meanwhile. A read against another region's account
        // reports PENDING and is simply skipped, so per-region passes are safe.
        try {
          const swept = await orchestrator.sweepAbandonedPayments();
          if (swept.abandoned + swept.settled + swept.failed > 0) {
            console.info(`[jobs] abandoned payments (${region})`, swept);
          }
        } catch (error) {
          drainReports.push({
            name: 'job.cash-sale-payouts.abandoned-payments',
            errorCode: 'THREW',
            error,
            context: { region },
          });
        }

        // ESC-05 / ESC-06: trade cash legs the platform holds. Releases to the
        // receiver through the release policy, refunds to the payer, and unfinished
        // 3-D Secure checks older than 30 minutes cancelled. Isolated like the rest.
        try {
          const cash = await drainTradeCash(createDefaultTradeCashDeps(getPaymentService(platform)), {
            currency,
            onFailure: ({ tradeId, error, detail }) => {
              drainReports.push({
                name: error === 'REFUND_FAILED' ? 'trade_cash.refund' : 'trade_cash.release',
                errorCode: error,
                message: detail ?? `Trade cash ${error}`,
                context: { tradeId, region },
              });
            },
          });
          tradeCash.released += cash.released;
          tradeCash.refunded += cash.refunded;
          tradeCash.deferred += cash.deferred;
          tradeCash.failed += cash.failed;
        } catch (error) {
          drainReports.push({
            name: 'trade_cash.drain',
            errorCode: 'THREW',
            error,
            context: { region },
          });
        }

        // Money leaving CAPTURED trade collateral (0133): refunds to the hold's owner
        // and payouts to a wronged trader, each through releasePolicy. Isolated like
        // the refunds above.
        if (currency) {
          try {
            const disbursed = await createDefaultCollateralDisbursementDrain({
              payments: getPaymentService(platform),
              currency,
              onFailure: ({ disbursementId, tradeId, error }) => {
                drainReports.push({
                  name: 'collateral.disbursement',
                  errorCode: error,
                  message: `Collateral disbursement failed: ${error}`,
                  context: { disbursementId, tradeId, region },
                });
              },
            }).run();
            collateral.considered += disbursed.considered;
            collateral.settled += disbursed.settled;
            collateral.deferred += disbursed.deferred;
            collateral.failed += disbursed.failed;
          } catch (error) {
            console.error(`[jobs] collateral disbursement drain failed for region ${region}`, error);
            drainReports.push({
              name: 'collateral.disbursement',
              errorCode: 'THREW',
              error,
              context: { region },
            });
          }
        }
      } catch (error) {
        console.error(`[jobs] cash-sale-payouts failed for region ${region}`, error);
        failures.push(region);
        drainReports.push({
          name: 'job.cash-sale-payouts.region',
          error,
          context: { region },
        });
      }
    }

    // RETURNS (ESC-11, ESC-30, ESC-38). Once per pass, NOT per region: a return's
    // refund goes back through the region of the SALE, resolved per sale from its
    // frozen currency, so a regional loop would only add ways to pick the wrong one.
    const returns = { synced: 0, stale: 0, refunded: 0, failed: 0 };
    try {
      const synced = await syncStaleReturns();
      returns.synced = synced.checked;
      returns.stale = synced.stale.length;
      for (const cashSaleId of synced.stale) {
        drainReports.push({
          name: 'returns.stale',
          errorCode: 'RETURN_STALE',
          message: `Return in transit for over ${STALE_RETURN_DAYS} days with no carrier delivery.`,
          context: { cashSaleId },
        });
      }
    } catch (error) {
      drainReports.push({ name: 'returns.sync', errorCode: 'THREW', error });
    }
    try {
      const released = await createDefaultCashSaleOrchestrator({
        payments: getPaymentService(),
      }).releaseDueReturnRefunds({
        paymentsFor: async (cashSaleId) => getPaymentService(await regionForCashSale(cashSaleId)),
      });
      returns.refunded = released.refunded.length;
      returns.failed = released.failed.length;
      for (const failure of released.failed) {
        drainReports.push({
          name: 'refund.return',
          errorCode: failure.error,
          message: failure.detail ?? `Return refund failed: ${failure.error}`,
          context: { cashSaleId: failure.cashSaleId },
        });
      }
    } catch (error) {
      drainReports.push({ name: 'refund.return', errorCode: 'THREW', error });
    }

    await Promise.all(drainReports.map((report) => logBackgroundFailure(report)));

    if (failures.length > 0 && totals.considered === 0) {
      // Nothing drained anywhere: report it as a failure so the schedule's own
      // alerting sees it rather than a green run that moved no money.
      return Response.json(
        { ok: false, error: 'Payout pass failed', failedRegions: failures },
        { status: 500 },
      );
    }

    return Response.json({
      ok: true,
      ...totals,
      refunds,
      collateral,
      tradeCash,
      returns,
      ...(failures.length > 0 ? { failedRegions: failures } : {}),
    });
  } catch (error) {
    console.error('[jobs] cash-sale-payouts failed', error);
    await logBackgroundFailure({ name: 'job.cash-sale-payouts', error });
    return Response.json(
      { ok: false, error: 'Payout pass failed' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  return runPayoutPass(request);
}

/**
 * GET exists solely because scheduled invocation uses it.
 *
 * Vercel Cron issues a GET with `Authorization: Bearer $CRON_SECRET`, so a
 * POST-only endpoint could not be scheduled at all — which is why this job had a
 * `vercel.json` entry pointing at a method it did not implement, and in practice
 * only ever ran when an operator pressed the button in the admin console.
 *
 * A GET that moves money is normally a smell, and it is safe here only because of
 * three specific properties: the same bearer secret is required and compared in
 * constant time, the endpoint fails closed without it, and the work is idempotent —
 * the queue is derived from COMPLETED sales and every release reuses a persisted
 * nonce, so a duplicate call cannot pay anyone twice. Set `CRON_SECRET` to the same
 * value as `JOBS_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  return runPayoutPass(request);
}
