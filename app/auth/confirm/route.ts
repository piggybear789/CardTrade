import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

// app/auth/confirm/route.ts
//
// EMAIL LINK exchange (signup confirmation and password recovery).
//
// WHY THIS EXISTS SEPARATELY FROM `/auth/callback`. That route completes OAuth: it
// takes a `code` and calls `exchangeCodeForSession`. An emailed link is a different
// grant — it carries a `token_hash` and a `type`, and is redeemed with `verifyOtp`.
//
// AND WHY IT IS REQUIRED AT ALL. This app uses `@supabase/ssr`, i.e. the PKCE flow, so
// the default `{{ .ConfirmationURL }}` template is not usable: it returns the session
// in the URL FRAGMENT, which never reaches a server component. The email templates must
// therefore point here with `token_hash`, and this route sets the session as cookies.
//
// Redeeming a `recovery` link produces a real (if narrow) session, which is exactly
// what `/auth/update-password` needs in order to call `updateUser`.
//
// This route MUST stay outside `PROTECTED_PREFIXES` in `proxy.ts`. Under `/account` the
// onboarding gate would redirect a member mid-recovery to `/onboarding`, stranding them
// one step from setting the password they came to set.

import { createClient } from '@/lib/supabase/server';

/** Where each link type lands once the session exists. */
const DESTINATION: Partial<Record<EmailOtpType, string>> = {
  // A confirmed signup goes to onboarding; `proxy.ts` would send them there anyway.
  signup: '/onboarding',
  email: '/onboarding',
  // A recovery link exists to set a new password, so it goes straight to that form.
  recovery: '/auth/update-password',
  email_change: '/profile',
};

/** Same-origin absolute paths only, so `next` cannot become an open redirect. */
function safeNextPath(target: string | null): string | null {
  if (target && target.startsWith('/') && !target.startsWith('//') && !target.includes('\\')) {
    return target;
  }
  return null;
}

/**
 * Resolve the origin to build redirects against. Prefers `NEXT_PUBLIC_SITE_URL`, then
 * the forwarded host (correct behind a proxy), then the request URL. Mirrors
 * `/auth/callback`.
 */
function resolveOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = request.headers.get('x-forwarded-proto') ?? 'https';
    return `${proto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

export async function GET(request: NextRequest) {
  const origin = resolveOrigin(request);
  const params = request.nextUrl.searchParams;

  /**
   * Send an expired or already-used link somewhere it can be REPLACED, carrying the
   * reason. A dead link is the normal failure here — they are single-use and
   * short-lived — so the answer must be "get a new one", never a bare error page.
   */
  const failure = (message: string, type: EmailOtpType | null) => {
    const url = new URL(type === 'recovery' ? '/forgot-password' : '/sign-in', origin);
    url.searchParams.set('authError', message);
    return NextResponse.redirect(url);
  };

  const tokenHash = params.get('token_hash');
  const type = params.get('type') as EmailOtpType | null;

  if (!tokenHash || !type) {
    return failure('That link was incomplete. Request a new one.', type);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    if (/ban(?:ned)?/i.test(error.message)) {
      return NextResponse.redirect(new URL('/account-suspended', origin));
    }
    // Supabase reports expiry and reuse the same way; both mean "ask for another".
    return failure(
      'That link has expired or was already used. Request a new one below.',
      type,
    );
  }

  const next = safeNextPath(params.get('next'));
  const destination = next ?? DESTINATION[type] ?? '/';

  return NextResponse.redirect(new URL(destination, origin));
}
