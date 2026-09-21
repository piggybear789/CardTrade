import 'server-only';

// lib/identity/identityReturn.ts
//
// Where a member lands after Stripe's hosted identity check, and how that is decided.
//
// THE RETURN URL IS FIXED AT SESSION CREATION AND CANNOT BE CHANGED. A Stripe Identity
// VerificationSession takes `return_url` once, on create; `update` does not accept it
// and the object does not even read it back. Our own binding RESUMES a member's existing
// session rather than opening a new one on every press — deliberately, because a hosted
// link is single-use and Stripe keeps the attempt history on the session — so whatever
// return URL the session was born with is the one the member comes back to, no matter
// which screen they pressed the button on this time.
//
// That is the bug this module ends. A session opened from `/profile/payouts` (the
// default return path in an earlier release) sent a member who resumed it from the
// Verification tab back to `/profile/payouts` — which redirects to the PAYOUTS tab and
// drops the `identity=complete` marker on the way — so finishing an identity check
// landed on the wrong tab with nothing reconciling the result. A session opened from
// the onboarding wizard and resumed from a listing page has the same shape of problem.
//
// THE FIX: ONE RETURN URL FOR EVERY SESSION, AND A ROUTE THAT DECIDES. Every session is
// created with `return_url = <origin>/identity/return`. When the member presses the
// button, the action remembers WHERE they pressed it in a short-lived cookie; when Stripe
// sends them back, the route reads the cookie and forwards them there with the marker
// appended. Resuming from a different screen just rewrites the cookie. Nothing about the
// session has to change, so resuming stays cheap and the attempt history stays intact.
//
// Sessions minted before this change still carry their old per-screen URL. Those keep
// working as they did — `/profile/payouts` now forwards its markers to the Verification
// tab (see `app/(workspace)/profile/payouts/page.tsx`) — and are replaced by a
// fixed-URL session the next time one is opened fresh.

/** Cookie carrying the same-origin path to forward a returning member to. */
export const IDENTITY_RETURN_COOKIE = 'nd_identity_return';

/** The one path every hosted identity session returns to. */
export const IDENTITY_RETURN_ROUTE = '/identity/return';

/**
 * Where a return lands when nothing remembered where the check was started: the tab
 * that owns identity. Matches the default `returnPath` of `beginIdentityCheck`.
 */
export const DEFAULT_IDENTITY_RETURN_PATH = '/profile?tab=verification';

/**
 * Long enough for a member to complete a document check that includes "continue on
 * your phone" and a slow upload; short enough that a stale choice from days ago does
 * not decide where a later attempt lands. The cookie is rewritten on every press, so
 * this only ever governs the gap between pressing the button and coming back.
 */
const IDENTITY_RETURN_MAX_AGE_SECONDS = 60 * 60 * 12;

/**
 * Same-origin absolute paths only, or the default.
 *
 * The path comes from a client-supplied prop on the way in and from a cookie on the
 * way out; either could be tampered with, and both end in a redirect. Anything that is
 * not an unambiguous same-origin path is discarded: `//evil.example` is
 * protocol-relative, a backslash is normalised to `/` by browsers, and a control
 * character has no business in a URL.
 */
export function safeIdentityReturnPath(path: string | null | undefined): string {
  const candidate = path?.trim();
  if (
    candidate &&
    candidate.startsWith('/') &&
    !candidate.startsWith('//') &&
    !candidate.includes('\\') &&
    !/[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return candidate;
  }
  return DEFAULT_IDENTITY_RETURN_PATH;
}

/**
 * The `identity=complete` marker appended to a return path. The marker picks a
 * screen and nothing else: `app/onboarding/page.tsx` opens the seller step on it, and
 * the reconcilers re-read the provider regardless of what the URL claims.
 */
export function withIdentityCompleteMarker(path: string): string {
  const [withoutHash, hash] = path.split('#');
  const separator = withoutHash.includes('?') ? '&' : '?';
  return `${withoutHash}${separator}identity=complete${hash ? `#${hash}` : ''}`;
}

/** The absolute URL every hosted identity session is created with. */
export function identityReturnUrl(): string {
  const origin = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
  return `${origin}${IDENTITY_RETURN_ROUTE}`;
}

/** Cookie options for the remembered return path. */
export function identityReturnCookieOptions() {
  return {
    maxAge: IDENTITY_RETURN_MAX_AGE_SECONDS,
    path: '/',
    // `lax`, not `strict`: the member arrives back on a top-level GET from Stripe's
    // origin, and a strict cookie is withheld on exactly that navigation.
    sameSite: 'lax' as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  };
}
