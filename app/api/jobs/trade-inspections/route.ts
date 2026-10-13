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

import { runTradeInspectionJob } from '@/lib/trades/tradeInspectionJob';
import { logBackgroundFailure } from '@/lib/errors/errorLog';

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
  const jobsSecret = process.env.JOBS_SECRET?.trim();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const secrets = [jobsSecret, cronSecret].filter(Boolean) as string[];

  if (secrets.length === 0) {
    // Fail closed. Never run an unauthenticated job that releases holds.
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
    // The passes and their ORDER live in `lib/trades/tradeInspectionJob.ts` (a route
    // module may only export handlers). The hold-expiry re-estimate and the custody
    // backstop run first because both key on `expires_at` (ESC-01, ESC-17a, R4-M5);
    // the inspection timeout is the one critical pass; the rest are isolated.
    const results = await runTradeInspectionJob();
    const inspections = (results.inspections ?? {}) as Record<string, unknown>;
    return Response.json({ ok: true, ...inspections, ...results });
  } catch (error) {
    console.error('[jobs] trade-inspections failed', error);
    await logBackgroundFailure({ name: 'job.trade-inspections', error });
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
