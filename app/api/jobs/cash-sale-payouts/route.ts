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
import { getPaymentService, operationalRegions } from '@/domain/services';
import { regionCurrency } from '@/domain/region';

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

/** Authenticate, run one pass, and report the outcome. Shared by GET and POST. */
async function runPayoutPass(request: Request): Promise<Response> {
  const expected = process.env.JOBS_SECRET?.trim();
  if (!expected) {
    // Fail closed. Never run an unauthenticated money-moving job.
    return Response.json(
      { ok: false, error: 'JOBS_SECRET is not configured' },
      { status: 503 },
    );
  }

  const token = bearerToken(request);
  if (!token || !secretMatches(token, expected)) {
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
    const failures: string[] = [];

    for (const region of operationalRegions()) {
      try {
        const orchestrator = createDefaultCashSaleOrchestrator({
          payments: getPaymentService(region),
          payoutRegionCurrency: regionCurrency(region) ?? undefined,
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
        }
      } catch (error) {
        console.error(`[jobs] cash-sale-payouts failed for region ${region}`, error);
        failures.push(region);
      }
    }

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
      ...(failures.length > 0 ? { failedRegions: failures } : {}),
    });
  } catch (error) {
    console.error('[jobs] cash-sale-payouts failed', error);
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
