import 'server-only';

// lib/errors/withActionLog.ts
//
// The wrapper every Server Action is exported through, so a failed action lands in
// `cardtrade.error_logs` (0123) without a single action having to remember to log.
//
// WHY A WRAPPER AND NOT A LOG CALL IN `fail()`. By convention an action reports an
// expected failure as a value — `{ ok: false, error, message }` — and never throws, so
// "the sale did not go through" is invisible to `onRequestError` and to every error
// boundary. `fail()` is the obvious choke point and the wrong one: it is also called by
// helpers whose results are later rewritten, it cannot know which action it is inside,
// and production server bundles are minified, so a stack trace cannot say either. The
// wrapper knows the one thing that matters for resolving a failure: WHICH action.
//
// WHAT IT RECORDS:
//   * a returned failure → an ACTION row: the action name, the `error` code, the
//     message, the page (from the referer), the member, and the ids in the arguments.
//   * a thrown error → a SERVER row attributed to the action, then rethrown unchanged.
//     Marked so `onRequestError` does not record it twice. Next's own redirect and
//     not-found signals are control flow, not failures, and pass straight through.
//
// WHAT IT NEVER DOES: change a result, delay a response, or throw. The write is
// scheduled with `after()`, so it runs once the response is sent; outside a request
// (a script, a test) it degrades to fire-and-forget. Production only.
//
// EXPECTED REFUSALS ARE RECORDED ONLY WHEN A MEMBER ASKED. A Server Action request or a
// mobile API call records every failure, tagged expected or not. The same module called
// as a plain function while a page renders records only breakages, because a read that
// says "not signed in" on every page view is the page working, not a problem.
//
// ONLY THE OUTERMOST ACTION LOGS. Actions call other actions (accepting an offer opens
// a cash sale), and a nested failure would otherwise be recorded twice under two names.
// The one the member invoked is the one worth grouping by.

import { AsyncLocalStorage } from 'node:async_hooks';
import { headers } from 'next/headers';
import { unstable_rethrow } from 'next/navigation';
import { after } from 'next/server';

import { extractIdContext, isExpectedFailureCode } from '@/domain/errors/errorLog';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { actionFailureLimiter } from '@/lib/rateLimiters';
import {
  describeError,
  isErrorLoggingEnabled,
  markErrorLogged,
  writeErrorLog,
} from '@/lib/errors/errorLog';

const insideAction = new AsyncLocalStorage<true>();

/** The ActionResult failure shape, checked structurally. */
function asActionFailure(
  value: unknown,
): { error: string; message: string | null; field: string | null } | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.ok !== false || typeof candidate.error !== 'string') return null;
  const message =
    typeof candidate.message === 'string'
      ? candidate.message
      : typeof candidate.detail === 'string'
        ? candidate.detail
        : null;
  return {
    error: candidate.error,
    message,
    field: typeof candidate.field === 'string' ? candidate.field : null,
  };
}

/** Run `task` after the response, or now when there is no request to wait for. */
function schedule(task: () => Promise<void>): void {
  const guarded = async () => {
    try {
      await task();
    } catch (err) {
      console.error('[withActionLog] could not record action failure:', err);
    }
  };
  try {
    after(guarded);
  } catch {
    void guarded();
  }
}

interface RequestFacts {
  profileId: string | null;
  /** The page the action was invoked from, when a member invoked it. */
  path: string | null;
  /**
   * Whether a member invoked this directly: a Server Action request from the browser
   * (Next sends `Next-Action`) or a mobile API call (a Bearer token). False when an
   * action module is called as a plain function while a Server Component renders.
   */
  memberInitiated: boolean;
  /** Rate-limit key: the member, else the caller's IP. */
  limiterKey: string;
}

/**
 * The member and the page. Best-effort throughout, and never rejects.
 *
 * STARTED BEFORE `after()`, not inside it. A Server Component may not read `headers()`
 * or `cookies()` inside an `after` callback, and read-style actions are called from
 * pages as plain functions; a Server Action or Route Handler could read them later,
 * but reading them up front works in all three.
 */
async function requestFacts(): Promise<RequestFacts> {
  let hdrs: Headers | null = null;
  try {
    hdrs = await headers();
  } catch {
    // No request scope (a script, a test).
  }
  let profileId: string | null = null;
  try {
    profileId = (await getCachedAuthUser())?.id ?? null;
  } catch {
    // Signed out, or no request: recorded without a member.
  }

  const memberInitiated = Boolean(
    hdrs && (hdrs.has('next-action') || /^Bearer\s/i.test(hdrs.get('authorization') ?? '')),
  );
  const ip = hdrs?.get('x-forwarded-for')?.split(',')[0]?.trim() || hdrs?.get('x-real-ip') || 'unknown';

  return {
    profileId,
    // A Server Action posts to the page it was called from, so the referer is that
    // page. During a render the referer is the PREVIOUS page, which would mislead.
    path: memberInitiated ? (hdrs?.get('referer') ?? null) : null,
    memberInitiated,
    limiterKey: profileId ? `user:${profileId}` : `ip:${ip}`,
  };
}

function record(
  name: string,
  args: readonly unknown[],
  outcome:
    | { kind: 'failure'; failure: NonNullable<ReturnType<typeof asActionFailure>> }
    | { kind: 'thrown'; error: unknown },
): void {
  // Read the arguments NOW: the task runs after the response, when a caller may have
  // mutated a FormData or object it passed in.
  const ids = extractIdContext(args);
  const factsPromise = requestFacts();

  schedule(async () => {
    const facts = await factsPromise;
    const { profileId, path } = facts;

    // A read-style action refusing during a page render ("not signed in", "not
    // found") is the page working as designed, and recording it would write a row
    // per page view. Breakages are still recorded wherever they happen.
    if (
      outcome.kind === 'failure' &&
      !facts.memberInitiated &&
      isExpectedFailureCode(outcome.failure.error)
    ) {
      return;
    }

    const { allowed } = await actionFailureLimiter.check(facts.limiterKey);
    if (!allowed) return;

    if (outcome.kind === 'failure') {
      await writeErrorLog({
        source: 'ACTION',
        name,
        errorCode: outcome.failure.error,
        message: outcome.failure.message,
        path,
        context: outcome.failure.field ? { ...(ids ?? {}), field: outcome.failure.field } : ids,
        profileId,
      });
      return;
    }

    const described = describeError(outcome.error);
    await writeErrorLog({
      source: 'SERVER',
      name,
      message: described.message,
      stack: described.stack,
      path,
      // Grouped by the action rather than by the page it was called from: the same
      // throw from the same action is one problem wherever the button was.
      routePath: `action:${name}`,
      routeType: 'action',
      method: 'POST',
      context: ids,
      profileId,
    });
  });
}

/**
 * Export a Server Action through this so its failures are recorded.
 *
 * ```ts
 * export const acceptCashSaleTerms = withActionLog(
 *   'cashSale.acceptCashSaleTerms',
 *   async function acceptCashSaleTerms(params: AcceptParams) { … },
 * );
 * ```
 *
 * Allowed in a `'use server'` module because Next checks only that each export is a
 * function at runtime, and this returns an async one. The name is `<module>.<export>`
 * and is the group key on the console, so keep it stable when renaming.
 */
export function withActionLog<A extends unknown[], R>(
  name: string,
  action: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  async function logged(...args: A): Promise<R> {
    if (insideAction.getStore()) return action(...args);

    return insideAction.run(true, async () => {
      let result: R;
      try {
        result = await action(...args);
      } catch (error) {
        // redirect(), notFound() and friends are control flow. Let Next have them.
        unstable_rethrow(error);
        if (isErrorLoggingEnabled()) {
          markErrorLogged(error);
          record(name, args, { kind: 'thrown', error });
        }
        throw error;
      }

      if (isErrorLoggingEnabled()) {
        const failure = asActionFailure(result);
        if (failure) record(name, args, { kind: 'failure', failure });
      }
      return result;
    });
  }

  Object.defineProperty(logged, 'name', { value: action.name || name });
  return logged;
}
