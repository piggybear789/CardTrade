import { NextResponse, type NextRequest } from 'next/server';

// app/auth/callback/route.ts
//
// OAuth and recovery callback Route Handler (Req 1.1, 1.7).
//
// Google (and password-reset emails) redirect here with a one-time `code`. We
// exchange it for a session on the cookie-bound client (which also consumes the
// PKCE verifier cookie written by `signInWithGoogle`), make sure a Profile
// exists for OAuth, then send the User on to their destination. Failures never
// surface a stack trace: they redirect back to /sign-in with a fixed
// `authError` message.

import { createClient } from '@/lib/supabase/server';
import { ensureProfile } from '@/lib/auth/ensureProfile';

/** Fallback destination for a User who already has a Profile. */
const DEFAULT_DESTINATION = '/listings';

/** Same-origin absolute paths only, so `next` cannot become an open redirect. */
function safeNextPath(target: string | null): string | null {
  if (target && target.startsWith('/') && !target.startsWith('//')) {
    return target;
  }
  return null;
}

/**
 * Password-recovery landing — skip onboarding even if a Profile was just created.
 *
 * The recovery path this app sends is `/auth/update-password`, reached via
 * `/auth/confirm`. This branch is a backstop for a link that arrives here instead: it
 * still lands the member on the setter rather than dropping them at onboarding.
 */
const RECOVERY_PATH = '/auth/update-password';

function isRecoveryPath(target: string | null): boolean {
  return target === RECOVERY_PATH || Boolean(target?.startsWith(`${RECOVERY_PATH}?`));
}

/**
 * Resolve the origin to build redirects against. Prefers `NEXT_PUBLIC_SITE_URL`,
 * then the forwarded host (correct behind a proxy), then the request URL.
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
  const origin = resolveOrigin(request);
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get('next'));
  const recovery =
    isRecoveryPath(next) || params.get('type') === 'recovery';

  const failure = (message: string) => {
    const url = new URL('/sign-in', origin);
    url.searchParams.set('authError', message);
    if (next) {
      url.searchParams.set('redirectTo', next);
    }
    return NextResponse.redirect(url);
  };

  // The User declined consent, or the provider rejected the request.
  if (params.get('error_description') ?? params.get('error')) {
    return failure(
      recovery
        ? 'This reset link is invalid or has expired.'
        : 'Google sign-in was cancelled or could not be completed.',
    );
  }

  const code = params.get('code');
  if (!code) {
    return failure('This sign-in link is missing its authorization code.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    if (error && /ban(?:ned)?/i.test(error.message)) {
      return NextResponse.redirect(new URL('/account-suspended', origin));
    }
    return failure(
      recovery
        ? 'This reset link is invalid or has expired.'
        : 'Could not complete sign-in.',
    );
  }

  if (recovery) {
    return NextResponse.redirect(new URL(next ?? RECOVERY_PATH, origin));
  }

  const user = data.user;
  const metadata = (user.user_metadata ?? {}) as {
    full_name?: string | null;
    name?: string | null;
  };
  const email = user.email;

  if (!email) {
    return failure('Google did not share an email address for this account.');
  }

  const profile = await ensureProfile(user.id, email, metadata.full_name ?? metadata.name ?? null);

  if (!profile.ok) {
    // The session is live but unusable without a Profile; drop it so the User
    // is not stranded in a half-provisioned state.
    await supabase.auth.signOut();
    return failure('Signed in, but profile setup failed. Please try again.');
  }

  // New users go through onboarding, carrying the intended destination so the
  // post-onboarding hop can resume the original task. Returning users go to
  // that destination (or the catalog as fallback).
  const destination = profile.created
    ? next
      ? `/onboarding?redirectTo=${encodeURIComponent(next)}`
      : '/onboarding'
    : (next ?? DEFAULT_DESTINATION);

  return NextResponse.redirect(new URL(destination, origin));
}
