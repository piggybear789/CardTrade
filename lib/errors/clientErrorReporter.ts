// lib/errors/clientErrorReporter.ts
//
// Browser-side error capture (0123). Sends errors the server never sees — a render
// error caught by an error boundary, an uncaught error in a click handler, an unhandled
// promise rejection — to `POST /api/errors`, which writes them as CLIENT rows.
//
// CLIENT-SAFE: no server imports, no Server Actions. A Server Action needs the app
// router to be mounted, and the errors most worth catching happen before it is (during
// hydration) or after it has failed (global-error). A plain `sendBeacon` works in both.
//
// THE SERVER DECIDES WHETHER TO STORE. This always sends; the route drops the payload
// outside production. Keeping the switch server-side means `ERROR_LOGGING=on` works for
// local testing without a second, public environment variable to keep in step.
//
// BOUNDED ON THE WAY OUT. At most `MAX_SENDS_PER_PAGE` reports per page load, and one
// per distinct error, because a render loop re-throws the same error on every attempt
// and a flood from one tab is noise, not signal.

import { isIgnorableClientError } from '@/domain/errors/errorLog';

const ENDPOINT = '/api/errors';
const MAX_SENDS_PER_PAGE = 20;
const MESSAGE_MAX = 2000;
const STACK_MAX = 8000;

/** How the error reached us. Stored in the row's context. */
export type ClientErrorKind = 'boundary' | 'uncaught' | 'rejection';

export interface ClientErrorPayload {
  /** The id shown to the member as "Ref …", when there is a screen showing it. */
  reference: string;
  message: string;
  stack?: string | null;
  /** The script the error came from, for uncaught errors. */
  filename?: string | null;
  kind: ClientErrorKind;
}

let sent = 0;
const seen = new Set<string>();

/** A short, URL-safe id for an error the server never saw. */
export function mintClientReference(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `c-${random.slice(0, 16)}`;
}

/** Report one browser error. Fire-and-forget: never throws, never awaits. */
export function sendClientError(payload: ClientErrorPayload): void {
  try {
    if (typeof window === 'undefined') return;
    if (isIgnorableClientError(payload)) return;

    const key = `${payload.message}|${(payload.stack ?? '').split('\n', 2)[1] ?? ''}`;
    if (seen.has(key) || sent >= MAX_SENDS_PER_PAGE) return;
    seen.add(key);
    sent += 1;

    const body = JSON.stringify({
      reference: payload.reference,
      message: payload.message.slice(0, MESSAGE_MAX),
      stack: payload.stack ? payload.stack.slice(0, STACK_MAX) : null,
      filename: payload.filename ?? null,
      kind: payload.kind,
      path: window.location.pathname,
    });

    // `sendBeacon` survives the page unloading, which is when a member who hit an
    // error tends to leave. Same-origin, so the session cookie goes with it and the
    // row is attributed to the member.
    if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: 'application/json' }))) {
      return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
    }).catch(() => {
      // Reporting a failure must never become a second failure.
    });
  } catch {
    // Same.
  }
}

/** Describe any thrown value, which is not always an Error. */
function describe(value: unknown): { message: string; stack: string | null } {
  if (value instanceof Error) {
    return { message: `${value.name}: ${value.message}`, stack: value.stack ?? null };
  }
  if (typeof value === 'string') return { message: value, stack: null };
  try {
    return { message: JSON.stringify(value)?.slice(0, 500) ?? String(value), stack: null };
  } catch {
    return { message: String(value), stack: null };
  }
}

let installed = false;

/**
 * Listen for errors nothing else catches. Called once from `instrumentation-client.ts`.
 *
 * React error boundaries only catch errors thrown while RENDERING. An error thrown in
 * an event handler, a timer or an awaited promise goes straight to `window`, and until
 * this existed it went nowhere else.
 */
export function installClientErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    const described = event.error
      ? describe(event.error)
      : { message: event.message || 'Unknown error', stack: null };
    sendClientError({
      reference: mintClientReference(),
      message: described.message,
      stack: described.stack,
      filename: event.filename || null,
      kind: 'uncaught',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const described = describe(event.reason);
    sendClientError({
      reference: mintClientReference(),
      message: described.message,
      stack: described.stack,
      kind: 'rejection',
    });
  });
}
