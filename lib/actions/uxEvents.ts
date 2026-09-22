'use server';

// lib/actions/uxEvents.ts
//
// The write boundary for behavioural instrumentation (0121).
//
// ── THIS ACTION CANNOT FAIL, AND THAT IS DELIBERATE ───────────────────────────
//
// `recordUxEvent` returns `void` and swallows everything: an unauthenticated caller, a
// rejected event, a rate limit, a dead database. It is the one action in this codebase
// that does NOT return an `ActionResult`, and the exception is the point rather than an
// oversight.
//
// Every other action here reports failure because a member is waiting on the answer.
// Nobody is waiting on this one. If it returned a result, some call site would eventually
// branch on it, and then a telemetry outage would become a checkout outage — the failure
// mode where the thing watching the system takes the system down with it. A dropped event
// costs a row in a chart. A thrown event costs a listing.
//
// So: no `ActionResult`, no thrown errors, no `revalidatePath`. Nothing downstream may
// depend on a row being written, and `product.md`'s rule about instrumentation staying off
// the critical path is enforced here by having nothing to depend on.
//
// ── WHY A SERVER ACTION RATHER THAN A DIRECT INSERT FROM THE CLIENT ───────────
//
// The member's JWT can already insert into this table under RLS, so the browser could
// write rows itself and skip a round trip. It does not, for two reasons. The rate limiter
// lives here and cannot live on a client that an attacker controls. And `validateUxEvent`
// has to run somewhere the caller cannot skip — the CHECK constraints would still refuse a
// bad row, but they would refuse it as a 400 the browser has to interpret, rather than as
// a silent drop.

import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { uxEventLimiter } from '@/lib/rateLimiters';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import { isSessionId, validateUxEvent } from '@/domain/analytics/uxEvent';

/**
 * What a caller reports. Deliberately narrow — see the no-free-text note in
 * `domain/analytics/uxEvent.ts`.
 */
export interface RecordUxEventInput {
  /** One of `PAGE_VIEW` | `ACTION_FAILURE` | `GATE_BLOCKED` | `FORM_ABANDONED`. */
  kind: string;
  /** The tab's session handle, from `currentSessionId()`. */
  sessionId: string;
  /** Where it happened. Templated here, so a concrete pathname is fine to pass. */
  path: string;
  /** Machine slug naming which thing of that kind. Required for `GATE_BLOCKED`. */
  name?: string | null;
  /** The `ActionResult` error code. Required for `ACTION_FAILURE`. */
  errorCode?: string | null;
}

/**
 * Record one behavioural event, or quietly do nothing.
 *
 * Writes through the COOKIE-BOUND client so `ux_events_self_insert` pins `profile_id` to
 * the caller: the id passed to `insert` is checked against `auth.uid()` by RLS rather than
 * trusted. Guests are dropped rather than recorded as null rows — 0121's header records
 * why an `anon` write path is not wanted.
 *
 * @param input The event. Invalid input is discarded, never reported.
 */
export async function recordUxEvent(input: RecordUxEventInput): Promise<void> {
  try {
    const user = await getCachedAuthUser();
    // No member, no row. RLS would refuse the insert anyway; returning here saves the
    // round trip and keeps the reason legible.
    if (!user) return;

    if (!isSessionId(input.sessionId ?? '')) return;

    const validated = validateUxEvent({
      kind: input.kind,
      path: input.path,
      name: input.name,
      errorCode: input.errorCode,
    });
    if (!validated.ok) return;

    // KEYED ON THE MEMBER, NOT THE ADDRESS. A shared address — a household, an office,
    // a mobile carrier NAT — would otherwise let one busy member exhaust the budget for
    // everyone behind it, and the thing being protected is table growth per account.
    const { allowed } = await uxEventLimiter.check(await rateLimitIdentifier(user.id));
    if (!allowed) return;

    const supabase = await createClient();
    await supabase.from('ux_events').insert({
      session_id: input.sessionId,
      profile_id: user.id,
      kind: validated.event.kind,
      path: validated.event.path,
      name: validated.event.name,
      error_code: validated.event.errorCode,
    });
  } catch {
    // Intentionally empty, and NOT a TODO. See the header: the entire contract of this
    // function is that no caller can be harmed by it. A `console.error` here would be the
    // beginning of making instrumentation noisy enough to disable.
  }
}
