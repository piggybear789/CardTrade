// lib/analytics/session.ts
//
// The per-session handle that stitches UX events into a journey (0121).
//
// WHY A SESSION ID AT ALL. A bare count of failures tells you a screen is bad; an ORDERED
// sequence tells you what someone tried before they gave up. "Opened the listing form,
// was refused, went to the verification tab, came back, was refused again" is the shape
// of the report this instrumentation exists to reproduce, and it cannot be recovered from
// unlinked rows.
//
// ── WHY sessionStorage AND NOT A COOKIE OR localStorage ───────────────────────
//
// This is the whole privacy design, so it is worth stating plainly.
//
// `sessionStorage` is scoped to the tab and is destroyed when the tab closes. That makes
// the handle incapable of correlating two visits, which is exactly the property wanted: a
// funnel needs to know that six events belong to one attempt, and needs nothing at all
// about whether last Tuesday's visitor is today's. A cookie would travel on every request
// and outlive the session; `localStorage` would persist indefinitely and become a durable
// device identifier — a tracking primitive, obtained without asking, for the sake of a
// slightly nicer chart.
//
// It is also why this value must never be mixed with anything derived from the member:
// no profile id, no email hash, no fingerprint. The one join to a person is
// `ux_events.profile_id`, which RLS pins to the caller and which account deletion nulls.

import { isSessionId } from '@/domain/analytics/uxEvent';

/** Where the handle lives for the life of the tab. */
const STORAGE_KEY = 'nd.ux.sid';

/** Bytes of entropy. 16 → a 22-character base64url handle, inside the 8–64 bound. */
const ID_BYTES = 16;

/**
 * Mint an opaque handle satisfying `ux_events_session_shape`.
 *
 * base64url rather than a UUID because the column's shape is `[A-Za-z0-9_-]{8,64}` and
 * base64url is exactly that alphabet — a UUID's hyphens would pass too, but a UUID here
 * invites being mistaken for a row id somewhere downstream.
 */
function mintSessionId(): string {
  const bytes = new Uint8Array(ID_BYTES);
  crypto.getRandomValues(bytes);

  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The current tab's session handle, minting one on first call.
 *
 * Returns `null` when there is no usable storage — server rendering, or a browser with
 * storage blocked. Callers MUST treat that as "do not record" rather than falling back to
 * an in-memory value: an in-memory handle would be reminted on every full page load and
 * would silently split one journey across several ids, which is worse than no journey
 * because it looks like data.
 *
 * A stored value that no longer satisfies the shape is replaced rather than trusted, so a
 * hand-edited or stale key cannot make every subsequent insert fail its CHECK.
 */
export function currentSessionId(): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const existing = window.sessionStorage.getItem(STORAGE_KEY);
    if (existing && isSessionId(existing)) return existing;

    const minted = mintSessionId();
    window.sessionStorage.setItem(STORAGE_KEY, minted);
    return minted;
  } catch {
    // Safari in private mode historically threw on `setItem`, and a member may block
    // storage outright. Instrumentation is never worth an exception on a real flow.
    return null;
  }
}
