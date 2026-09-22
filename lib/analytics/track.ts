'use client';

// lib/analytics/track.ts
//
// The client-side call surface for behavioural instrumentation (0121).
//
// ── EVERY FUNCTION HERE IS FIRE-AND-FORGET, AND NONE IS AWAITED ────────────────
//
// They all return `void`, not `Promise<void>`, so a call site physically cannot `await`
// one. That is a deliberate shape rather than a convenience: an awaited telemetry call on
// a submit handler adds a round trip to the path the member is waiting on, and the first
// time the analytics table is slow, the listing form is slow. Making the signature
// un-awaitable removes the temptation and the review burden at once.
//
// The underlying action already swallows every failure (see `lib/actions/uxEvents.ts`), so
// the `.catch()` here is belt-and-braces against a transport-level rejection — a dropped
// connection mid-navigation — which would otherwise surface as an unhandled rejection in
// the member's console.
//
// ── WHAT MAY BE PASSED AS `name` ──────────────────────────────────────────────
//
// A lower-case machine slug and nothing else. Never a member's input, never a rendered
// message, never an interpolated id. `validateUxEvent` refuses anything else and the
// event is silently dropped, so a call site that passes prose gets no error and no data —
// which is why the slugs used across the app are collected in `UX_NAMES` below rather than
// typed inline at each call site.

import { recordUxEvent } from '@/lib/actions/uxEvents';
import { currentSessionId } from '@/lib/analytics/session';
import type { UxEventKind } from '@/domain/analytics/uxEvent';

/**
 * The slugs this app reports, in one place.
 *
 * CENTRALISED SO A FUNNEL CANNOT BE SPLIT BY A TYPO. `create-listing` and
 * `create_listing` are two different rows in a GROUP BY and one of them will be quietly
 * missing from every chart. A const object means the compiler catches the drift that a
 * string literal at each call site would not.
 */
export const UX_NAMES = {
  /** The create-listing form, as a whole. */
  itemForm: 'item-form',
  /** The Identity_Gate refusing a member before the listing form renders. */
  listingIdentityGate: 'listing-identity-gate',
  /** The seller-disclosure gap refusing a member before the listing form renders. */
  listingDisclosureGate: 'listing-disclosure-gate',
  /** `createItem` refusing a submitted listing. */
  createItem: 'create-item',
  /** `updateItem` refusing an edited listing. */
  updateItem: 'update-item',
} as const;

/** Fire an event and forget it. */
function send(
  kind: UxEventKind,
  path: string,
  fields?: { name?: string | null; errorCode?: string | null },
): void {
  const sessionId = currentSessionId();
  // No storage, no session handle, no row. `currentSessionId` explains why an in-memory
  // fallback would be worse than dropping the event.
  if (!sessionId) return;

  void recordUxEvent({
    kind,
    sessionId,
    path,
    name: fields?.name ?? null,
    errorCode: fields?.errorCode ?? null,
  }).catch(() => {
    // Swallowed. See the header.
  });
}

/** Record that a route was rendered. Normally called by `PageViewTracker`, not directly. */
export function trackPageView(path: string): void {
  send('PAGE_VIEW', path);
}

/**
 * Record that a Server Action refused a submission.
 *
 * @param name      A slug from {@link UX_NAMES} naming the action.
 * @param errorCode The `ActionResult` `error` code — never the human `message`.
 * @param path      Where the member was. Templated server-side.
 */
export function trackActionFailure(name: string, errorCode: string, path: string): void {
  send('ACTION_FAILURE', path, { name, errorCode });
}

/**
 * Record that a gate refused a member BEFORE they attempted any work.
 *
 * Distinct from {@link trackActionFailure} because the remedy is different: nobody
 * submitted anything, so the question is whether the requirement was discoverable, not
 * whether the input was valid.
 */
export function trackGateBlocked(name: string, path: string): void {
  send('GATE_BLOCKED', path, { name });
}

/**
 * Record that a member left a form with unsaved input.
 *
 * The signal behind "I had to fill in the same fields five times": on its own an
 * abandonment is ordinary, but an abandonment moments after an `ACTION_FAILURE` on the
 * same session is a member who was pushed out of a form by an error they could not
 * resolve.
 */
export function trackFormAbandoned(name: string, path: string): void {
  send('FORM_ABANDONED', path, { name });
}
