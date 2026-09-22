// domain/analytics/uxEvent.ts
//
// The pure half of behavioural instrumentation (0121): what a UX event may contain, and
// how a concrete URL becomes a groupable route.
//
// PURE BY REQUIREMENT, NOT BY PREFERENCE. Every rule here is mirrored by a CHECK
// constraint in migration 0121, and the two are meant to agree — so this module must be
// unit-testable without a database, a request, or a browser. No Supabase, no React, no
// `lib/` imports.
//
// ── THE NO-FREE-TEXT GUARANTEE ────────────────────────────────────────────────
//
// `isEventSlug` is the mechanism by which a member's words cannot reach the table. It is
// not a tidiness rule. A slug cannot contain a space or a capital, so a typed sentence,
// a legal name, an address, an email or a JWT fails it — and the caller gets `null`
// rather than a truncated or scrubbed version, because a scrubber catches the patterns
// someone thought of and misses the rest.
//
// So do NOT add a `metadata` bag, a `detail` string, or a "just the message" field to
// the event shape. Doing so would not extend the feature; it would remove the guarantee
// and replace it with a promise that a future reviewer has to keep.

/** What shape of thing happened. Mirrors `cardtrade.ux_event_kind` (0121). */
export type UxEventKind =
  | 'PAGE_VIEW'
  | 'ACTION_FAILURE'
  | 'GATE_BLOCKED'
  | 'FORM_ABANDONED';

/** Every value of {@link UxEventKind}, for narrowing an untrusted string. */
export const UX_EVENT_KINDS: readonly UxEventKind[] = [
  'PAGE_VIEW',
  'ACTION_FAILURE',
  'GATE_BLOCKED',
  'FORM_ABANDONED',
] as const;

/** Longest `name` / `error_code` the column accepts. Mirrors 0121. */
export const UX_SLUG_MAX = 64;

/** Longest `path` the column accepts. Mirrors `ux_events_path_shape`. */
export const UX_PATH_MAX = 512;

/**
 * Machine-slug shape for `name` and `error_code`.
 *
 * Identical to `ux_events_name_shape` / `ux_events_error_code_shape` in 0121. Lower-case
 * start, then lower-case alphanumerics and `_ . : -` only.
 */
const EVENT_SLUG = /^[a-z0-9][a-z0-9_.:-]*$/;

/** Opaque session handle shape. Identical to `ux_events_session_shape` in 0121. */
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** A canonical UUID, which is what every dynamic route segment in this app is. */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route segments whose CHILD is an opaque handle rather than a UUID.
 *
 * `/t/<token>` is the private-deal invite link. Its token is not a UUID and is a
 * capability — possession of it is what grants access — so it must never be stored, and
 * it cannot be recognised by shape the way a UUID can. Recognised by its PARENT instead.
 */
const OPAQUE_CHILD_OF: readonly string[] = ['t'] as const;

/** True when `value` satisfies the slug shape the `ux_events` columns enforce. */
export function isEventSlug(value: string): boolean {
  return value.length > 0 && value.length <= UX_SLUG_MAX && EVENT_SLUG.test(value);
}

/** True when `value` is a well-formed opaque session handle. */
export function isSessionId(value: string): boolean {
  return SESSION_ID.test(value);
}

/** Narrow an untrusted string to a {@link UxEventKind}, or `null`. */
export function asUxEventKind(value: string): UxEventKind | null {
  return (UX_EVENT_KINDS as readonly string[]).includes(value)
    ? (value as UxEventKind)
    : null;
}

/**
 * Reduce a concrete URL or pathname to a groupable route template, or `null` when it is
 * not a path at all.
 *
 * ── WHY TEMPLATE RATHER THAN STORE THE REAL PATH ──────────────────────────────
 *
 * Two reasons, and the second is the important one.
 *
 * Grouping: `/listings/<uuid>` is a different string for every listing, so a funnel over
 * raw paths has one row per listing and no shape. Collapsed to `/listings/[id]` it
 * answers "how many people reach a listing page" with a GROUP BY and no LIKE.
 *
 * Disclosure: the raw path IS the data. A table of `/sellers/<uuid>` rows keyed to a
 * session is a record of who looked at whom, and a table of `/t/<token>` rows is a
 * record of invite tokens — which are capabilities, so storing one is closer to storing
 * a password than to storing an id. Templating removes both before the value is ever
 * sent, which is why it happens here rather than in a query later.
 *
 * WHAT IS COLLAPSED, AND WHY CONSERVATIVELY. A UUID, an all-digit segment, and any child
 * of a segment in {@link OPAQUE_CHILD_OF}. Nothing else — this is deliberately not a
 * general "looks opaque to me" heuristic, because every such heuristic eventually eats a
 * real route name (`/listings/mine`, `/profile/payouts`) and reports it as an id. A new
 * dynamic segment that is neither a UUID nor numeric must be added to
 * {@link OPAQUE_CHILD_OF} explicitly.
 *
 * The query string and hash are dropped, on the same reasoning as `feedback.page_path`:
 * `?tab=` and `?region=` are re-derivable and a `?token=` is not something to keep.
 */
export function toRouteTemplate(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw.startsWith('/')) return null;

  // Query and hash go first, so a token in either can never survive into a segment.
  const path = raw.split(/[?#]/, 1)[0] ?? '';
  if (path.length === 0 || path.length > UX_PATH_MAX) return null;

  const segments = path.split('/');
  const templated = segments.map((segment, index) => {
    if (segment.length === 0) return segment;

    const parent = index > 0 ? segments[index - 1] : '';
    if (parent && OPAQUE_CHILD_OF.includes(parent)) return '[token]';

    if (UUID.test(segment)) return '[id]';
    // Numeric-only. Nothing in this app routes on a bare number today, but an
    // `/invoices/1042` added later should group rather than fan out.
    if (/^\d+$/.test(segment)) return '[id]';

    return segment;
  });

  // A trailing slash would make `/saved` and `/saved/` two different funnels.
  const joined = templated.join('/');
  const normalized = joined.length > 1 ? joined.replace(/\/+$/, '') : joined;
  return normalized.length > 0 ? normalized : '/';
}

/** A validated event, ready to persist. */
export interface UxEvent {
  kind: UxEventKind;
  path: string;
  name: string | null;
  errorCode: string | null;
}

/** Why an event was rejected. Diagnostic only — never shown to a member. */
export type UxEventProblem =
  | 'bad-path'
  | 'bad-kind'
  | 'bad-name'
  | 'bad-error-code'
  | 'missing-error-code'
  | 'missing-name';

/**
 * Validate an untrusted event, returning the row to write or the reason it cannot be.
 *
 * MIRRORS 0121's CHECK CONSTRAINTS RATHER THAN TRUSTING THEM, per the enforce-twice
 * convention: the member INSERT grant means anything holding a member's JWT can attempt
 * this insert, so these rules have to hold at the boundary too. The difference is only
 * in what happens on violation — here the caller gets a reason it can drop silently,
 * whereas the constraint raises.
 *
 * NOTE THE ASYMMETRY WITH THE TWO REQUIRED-FIELD RULES. `ACTION_FAILURE` without a code
 * and `GATE_BLOCKED` without a name are refused rather than stored, because the only
 * value either kind has is grouping by WHAT failed. A row that says "something refused
 * someone somewhere" costs storage and answers nothing.
 */
export function validateUxEvent(input: {
  kind: string;
  path: string | null | undefined;
  name?: string | null;
  errorCode?: string | null;
}): { ok: true; event: UxEvent } | { ok: false; problem: UxEventProblem } {
  const kind = asUxEventKind(input.kind);
  if (!kind) return { ok: false, problem: 'bad-kind' };

  const path = toRouteTemplate(input.path);
  if (!path) return { ok: false, problem: 'bad-path' };

  const rawName = input.name?.trim() ?? '';
  const name = rawName.length > 0 ? rawName : null;
  if (name !== null && !isEventSlug(name)) return { ok: false, problem: 'bad-name' };

  const rawCode = input.errorCode?.trim() ?? '';
  const errorCode = rawCode.length > 0 ? rawCode : null;
  if (errorCode !== null && !isEventSlug(errorCode)) {
    return { ok: false, problem: 'bad-error-code' };
  }

  if (kind === 'ACTION_FAILURE' && errorCode === null) {
    return { ok: false, problem: 'missing-error-code' };
  }
  if (kind === 'GATE_BLOCKED' && name === null) {
    return { ok: false, problem: 'missing-name' };
  }

  return { ok: true, event: { kind, path, name, errorCode } };
}
