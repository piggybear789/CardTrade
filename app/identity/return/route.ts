import { NextResponse, type NextRequest } from 'next/server';

// app/identity/return/route.ts
//
// The one place Stripe's hosted identity check sends a member back to.
//
// It does nothing except decide where they were going. Every VerificationSession is
// created with this route as its `return_url` (see `lib/identity/identityReturn.ts`
// for why the URL has to be constant), and the action that handed out the hosted link
// left a cookie naming the screen the member pressed the button on. This forwards them
// there with `identity=complete` appended, or to the Verification tab when nothing was
// remembered — a cookie that expired, a different browser, a session started before
// the cookie existed.
//
// NOTHING HERE DECIDES WHETHER THE CHECK PASSED. Returning proves only that the member
// came back; the marker is read by the destination's reconciler, which asks the
// provider. That is also why this route needs no session of its own: an expired login
// is bounced to sign-in by `proxy.ts` at the destination, with the marker preserved in
// `redirectTo`.

import {
  IDENTITY_RETURN_COOKIE,
  safeIdentityReturnPath,
  withIdentityCompleteMarker,
} from '@/lib/identity/identityReturn';

/**
 * Resolve the origin to build the redirect against. Prefers `NEXT_PUBLIC_SITE_URL`,
 * then the forwarded host (correct behind a proxy), then the request URL — the same
 * ladder `app/auth/callback/route.ts` climbs.
 */
function resolveOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const remembered = request.cookies.get(IDENTITY_RETURN_COOKIE)?.value ?? null;
  const destination = withIdentityCompleteMarker(safeIdentityReturnPath(remembered));

  const response = NextResponse.redirect(new URL(destination, resolveOrigin(request)));
  // Consumed. A stale return path must not decide where the NEXT check lands; the
  // action that opens it writes a fresh one.
  response.cookies.delete(IDENTITY_RETURN_COOKIE);
  return response;
}
