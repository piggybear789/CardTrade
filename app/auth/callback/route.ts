import { NextResponse, type NextRequest } from 'next/server';

// app/auth/callback/route.ts
//
// OAuth callback Route Handler (Req 1.1, 1.7).
//
// Google redirects here with a one-time `code`. We exchange it for a session on
// the cookie-bound client (which also consumes the PKCE verifier cookie written
// by `signInWithGoogle`), make sure a Profile exists with KYC_Status UNVERIFIED,
// then send the User on to their destination. Failures never surface a stack
// trace: they redirect back to /sign-in with a readable `authError` message.

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

  const failure = (message: string) => {
    const url = new URL('/sign-in', origin);
    url.searchParams.set('authError', message);
    return NextResponse.redirect(url);
  };

  // The User declined consent, or the provider rejected the request.
  const providerError = params.get('error_description') ?? params.get('error');
  if (providerError) {
    return failure(providerError);
  }

  const code = params.get('code');
  if (!code) {
    return failure('Sign-in link was missing its authorization code.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return failure(error?.message ?? 'Could not complete Google sign-in.');
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
    return failure(`Signed in, but profile setup failed: ${profile.message}`);
  }

  const next = safeNextPath(params.get('next'));

  // Both new and returning users go to wherever they were headed (or the
  // catalog as fallback). Identity verification is offered on-demand from
  // /profile, not imposed as a mandatory detour after sign-up.
  const destination = next ?? DEFAULT_DESTINATION;

  return NextResponse.redirect(new URL(destination, origin));
}
