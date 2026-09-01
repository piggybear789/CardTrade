// app/api/jobs/trade-inspections/route.ts
//
// Runs the 2-way Trade inspection timeout.
//
// WHY THIS EXISTS AS A ROUTE. Completing a trade releases both collateral
// authorisations and settles any cash leg through the payment provider, which cannot
// happen inside Postgres — so unlike `auto_complete_due_cash_sales`, this sweep
// cannot be a pg_cron function. A SQL sweeper would flip the state and leave both
// traders' cards authorised, which is the failure the timeout is meant to prevent.
//
// SECURITY. This endpoint releases holds and moves cash and is NOT
// session-authenticated, exactly like the webhook route and the cash-sale payout
// drain. It is guarded by a shared secret in `JOBS_SECRET`, compared in constant
// time, and FAILS CLOSED when that secret is absent. An attacker calling it cannot
// complete a trade that was not already due — the queue is derived from
// `inspection_deadline_at <= now()` and every cash transfer reuses a persisted
// nonce — but it stays authenticated so it cannot be used to hammer the provider.

import { timingSafeEqual } from 'node:crypto';

import {
  flagStaleCollateralTrades,
  sweepTradeInspections,
} from '@/lib/trades/inspectionSweep';
import { advanceDueHandovers, placeDueTradeCollateral } from '@/lib/trades/bondPlacementSweep';
import { sweepCashSaleInspections } from '@/lib/trades/cashSaleInspectionSweep';
import { drainFailedTradeFees } from '@/lib/actions/tradeFees';

/** Never prerender or cache a job that moves money. */
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
async function runSweep(request: Request): Promise<Response> {
  const expected = process.env.JOBS_SECRET?.trim();
  if (!expected) {
    // Fail closed. Never run an unauthenticated job that releases holds.
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
    const result = await sweepTradeInspections();

    // Cash sale inspection notifications: the pg_cron function completes the sale
    // but cannot send in-app or email notifications, so this pass handles them.
    let cashSales: Awaited<ReturnType<typeof sweepCashSaleInspections>> | null = null;
    try {
      cashSales = await sweepCashSaleInspections();
    } catch (error) {
      console.error('[jobs] cash-sale-inspection sweep failed', error);
    }

    // The Trade_Fee retry rides along on this pass rather than on a route of its own.
    // It is trade-scoped, hourly is the cadence its attempt budget assumes, and a
    // second cron entry is a second thing to forget to configure. Isolated so a
    // collection problem can never cost the inspection sweep, which is the half that
    // releases collateral.
    let fees: Awaited<ReturnType<typeof drainFailedTradeFees>> | null = null;
    try {
      fees = await drainFailedTradeFees();
    } catch (error) {
      console.error('[jobs] trade-fee drain failed', error);
    }

    // Authorise collateral for trades meeting within the day. This is the OTHER half
    // of the money in this job — the inspection sweep releases holds, this one places
    // them — and it is isolated for the same reason: a placement problem must never
    // cost the release of collateral that is already held.
    //
    // Ordered after the release passes deliberately. If the wall clock runs out, the
    // work that has already been left undone is a hold placed slightly later, not a
    // trader's collateral left sitting past its deadline.
    let bonds: Awaited<ReturnType<typeof placeDueTradeCollateral>> | null = null;
    try {
      bonds = await placeDueTradeCollateral();
    } catch (error) {
      console.error('[jobs] trade collateral placement failed', error);
    }

    // Open the inspection window on trades whose meeting time has passed without
    // either side confirming. Isolated like the rest: a trade that cannot be advanced
    // must not stop the ones behind it getting their dispute window.
    let handovers: Awaited<ReturnType<typeof advanceDueHandovers>> | null = null;
    try {
      handovers = await advanceDueHandovers();
    } catch (error) {
      console.error('[jobs] handover advance failed', error);
    }

    // Trades whose meeting has arrived with no collateral behind it. Detection only,
    // no provider calls, and isolated for the same reason as the fee drain. Rides this
    // schedule because a second cron entry is a second thing to forget to configure.
    let stale: Awaited<ReturnType<typeof flagStaleCollateralTrades>> | null = null;
    try {
      stale = await flagStaleCollateralTrades();
    } catch (error) {
      console.error('[jobs] stale-collateral flagging failed', error);
    }

    return Response.json({ ok: true, ...result, cashSales, fees, bonds, handovers, stale });
  } catch (error) {
    console.error('[jobs] trade-inspections failed', error);
    return Response.json({ ok: false, error: 'Inspection pass failed' }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  return runSweep(request);
}

/**
 * GET exists because scheduled invocation uses it: Vercel Cron issues a GET with
 * `Authorization: Bearer $CRON_SECRET`, so a POST-only endpoint could not be
 * scheduled at all. Safe here for the same three reasons as the payout drain — the
 * same bearer secret, constant-time comparison, fail-closed without it, and
 * idempotent work. Set `CRON_SECRET` to the same value as `JOBS_SECRET`.
 */
export async function GET(request: Request): Promise<Response> {
  return runSweep(request);
}
