// app/api/errors/route.ts
//
// POST /api/errors — where the browser sends errors the server never saw (0123):
// render errors caught by an error boundary, uncaught errors, unhandled rejections.
// Written as CLIENT rows by `lib/errors/errorLog.ts`.
//
// UNAUTHENTICATED ON PURPOSE, AND BOUNDED ACCORDINGLY. Guests hit errors too, and the
// errors most worth catching happen before a session is readable. So nothing here
// requires sign-in; instead it:
//   * stores nothing outside production (`isErrorLoggingEnabled`);
//   * refuses a cross-origin post, so another site cannot write to it from a visitor's
//     browser;
//   * caps the body at 16 KB and every field at the table's own limits;
//   * rate-limits per member or IP (`errorLogLimiter`);
//   * drops known browser noise (`isIgnorableClientError`).
// A member who IS signed in is attributed from their session cookie, never from the
// body. The response is always 204 and says nothing about what was stored.

import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { errorLogLimiter } from '@/lib/rateLimiters';
import { rateLimitIdentifier } from '@/lib/rateLimit';
import { isErrorLoggingEnabled, writeErrorLog } from '@/lib/errors/errorLog';
import { isIgnorableClientError, normalizeReference } from '@/domain/errors/errorLog';

const MAX_BODY_BYTES = 16 * 1024;
const KINDS = new Set(['boundary', 'uncaught', 'rejection']);

const NO_CONTENT = () => new Response(null, { status: 204 });

/** True when the post came from this site, or from something that is not a browser. */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isErrorLoggingEnabled()) return NO_CONTENT();
  if (!isSameOrigin(request)) return new Response(null, { status: 403 });

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return NO_CONTENT();
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return NO_CONTENT();
    body = parsed as Record<string, unknown>;
  } catch {
    return NO_CONTENT();
  }

  const message = typeof body.message === 'string' ? body.message : null;
  const stack = typeof body.stack === 'string' ? body.stack : null;
  const filename = typeof body.filename === 'string' ? body.filename : null;
  const reference = normalizeReference(body.reference);
  if (!reference || !message) return NO_CONTENT();
  if (isIgnorableClientError({ message, stack, filename })) return NO_CONTENT();

  let profileId: string | null = null;
  try {
    profileId = (await getCachedAuthUser())?.id ?? null;
  } catch {
    // A guest, or a broken session: still worth recording.
  }

  const { allowed } = await errorLogLimiter.check(await rateLimitIdentifier(profileId));
  if (!allowed) return NO_CONTENT();

  const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'uncaught';
  await writeErrorLog({
    source: 'CLIENT',
    reference,
    message,
    stack,
    path: body.path,
    // The browser's user agent says which browser broke, which is often the whole
    // story for a client-only error. Capped by `boundContext` like any context string.
    context: {
      kind,
      userAgent: (request.headers.get('user-agent') ?? '').slice(0, 120) || undefined,
      script: filename ? filename.slice(-120) : undefined,
    },
    profileId,
  });

  return NO_CONTENT();
}
