import 'server-only';

// lib/errors/errorLog.ts
//
// The one writer for `cardtrade.error_logs` (0123). Every row goes through here, via
// the service-role client, because the table has no member or anon grant: error
// messages can quote data, so nothing outside the server may write or read it.
//
// The rules for what a row may contain — bounds, grouping, the expected/unexpected
// split — live in `domain/errors/errorLog.ts`, which is pure and tested. This module
// only decides WHEN to write and does the insert.
//
// NEVER THROWS. It runs inside error handling — `onRequestError`, an action wrapper, a
// job's catch block — and a logger that throws there either masks the original failure
// or loops. A failed write goes to the console and is dropped.

import { createAdminClient } from '@/lib/supabase/admin';
import {
  buildErrorLogRecord,
  normalizeReference,
  type ErrorLogInput,
} from '@/domain/errors/errorLog';

export type { ErrorLogInput };

/**
 * Whether failures are logged AUTOMATICALLY.
 *
 * Production only by default: on Vercel that is `VERCEL_ENV === 'production'`, so
 * preview deployments stay out of the table; elsewhere it is `NODE_ENV`. Local dev
 * would otherwise fill it with every half-saved file's render error.
 *
 * `ERROR_LOGGING=on` forces it on (to test the pipeline locally), `ERROR_LOGGING=off`
 * forces it off. Member REPORTS are not gated by this — see `reportError`.
 */
export function isErrorLoggingEnabled(): boolean {
  const override = process.env.ERROR_LOGGING?.trim().toLowerCase();
  if (override === 'on') return true;
  if (override === 'off') return false;
  if (process.env.VERCEL_ENV) return process.env.VERCEL_ENV === 'production';
  return process.env.NODE_ENV === 'production';
}

/**
 * Marks an error the action wrapper has already recorded, so `onRequestError` does not
 * record the same throw a second time. A registered symbol, so it survives module
 * duplication between the instrumentation and action bundles.
 */
const LOGGED = Symbol.for('noditto.error-logged');

export function markErrorLogged(error: unknown): void {
  if (!error || typeof error !== 'object') return;
  try {
    Object.defineProperty(error, LOGGED, { value: true, enumerable: false });
  } catch {
    // A frozen or exotic object: the worst case is one duplicate row.
  }
}

export function wasErrorLogged(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as Record<symbol, unknown>)[LOGGED],
  );
}

/** A message and stack for any thrown value, which is not always an Error. */
export function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: `${error.name}: ${error.message}`, stack: error.stack ?? null };
  }
  if (typeof error === 'string') return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error)?.slice(0, 500) ?? String(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

/**
 * Write one row. Returns whether it landed, and never throws.
 *
 * A REPORT is filed into the group of the error it references, so a complaint sits
 * next to the thing it is about. When that error was never captured (logging was off,
 * or it was rate-limited), the report forms a group of its own.
 *
 * Callers decide whether logging is enabled; this only writes.
 */
export async function writeErrorLog(input: ErrorLogInput): Promise<boolean> {
  try {
    const admin = createAdminClient();

    let fingerprint = input.fingerprint ?? null;
    if (input.source === 'REPORT' && !fingerprint) {
      const reference = normalizeReference(input.reference);
      if (reference) {
        const { data } = await admin
          .from('error_logs')
          .select('fingerprint')
          .eq('reference', reference)
          .neq('source', 'REPORT')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        fingerprint = data?.fingerprint ?? null;
      }
    }

    const record = buildErrorLogRecord({ ...input, fingerprint });
    const { error } = await admin.from('error_logs').insert({
      source: record.source,
      fingerprint: record.fingerprint,
      expected: record.expected,
      reference: record.reference,
      name: record.name,
      error_code: record.errorCode,
      message: record.message,
      stack: record.stack,
      path: record.path,
      route_path: record.routePath,
      route_type: record.routeType,
      method: record.method,
      context: record.context,
      note: record.note,
      profile_id: record.profileId,
    });

    if (error) {
      console.error('[errorLog] insert failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[errorLog] could not write error log:', err);
    return false;
  }
}

/**
 * Record a failure that happened with no member present: a cron job, a webhook, a
 * payout, refund, fee or collateral attempt the provider refused. Production only
 * (`isErrorLoggingEnabled`), never throws.
 *
 * AWAITED by callers rather than deferred with `after()`. These run inside jobs and
 * webhooks that are already off the member's critical path, and awaiting guarantees
 * the row lands before the function instance is frozen.
 *
 * @param input.name     What failed, as a stable slug: `job.cash-sale-payouts`,
 *                       `payout.seller`, `webhook.stripe`. This is the group key.
 * @param input.errorCode A machine code when there is one (`SELLER_NOT_PAYABLE`).
 * @param input.error    A thrown value, for its message and stack.
 * @param input.message  A message, when there is no thrown value.
 * @param input.context  Identifiers only: `{ cashSaleId, region }`.
 */
export async function logBackgroundFailure(input: {
  name: string;
  errorCode?: string | null;
  error?: unknown;
  message?: string | null;
  context?: Record<string, unknown> | null;
}): Promise<void> {
  if (!isErrorLoggingEnabled()) return;
  const described = input.error !== undefined ? describeError(input.error) : null;
  await writeErrorLog({
    source: 'BACKGROUND',
    name: input.name,
    errorCode: input.errorCode ?? null,
    message: input.message ?? described?.message ?? null,
    stack: described?.stack ?? null,
    context: input.context ?? null,
  });
}
