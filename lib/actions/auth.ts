'use server';

// lib/actions/auth.ts
//
// Authentication Server Actions — thin wrappers over Supabase Auth plus the
// pure credential validator (Req 1.1–1.3). Sign-up also provisions the 1:1
// `profiles` row (Req 1.1). Google OAuth follows the
// same contract: `signInWithGoogle` starts the PKCE flow and
// `app/auth/callback/route.ts` completes it, provisioning the Profile there.
//
// Client choice: user-scoped auth (sign-up/in/out) uses the cookie-bound server
// client so the session is written to cookies. The profile row insert on
// sign-up uses the admin client: immediately after `signUp` there may be no
// authenticated session yet (e.g. when email confirmation is enabled), so the
// RLS `profiles_owner_insert` policy (`auth.uid() = id`) could reject a
// cookie-bound insert. The insert is a trusted server-side provisioning step
// keyed to the id Supabase Auth just returned, so the RLS-bypassing admin
// client is the sensible binding for this single write.

import { headers } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { validateRegistrationCredentials } from '@/domain/validation';
import { friendlyWriteFailure } from '@/lib/actions/writeFailure';
import { type ActionResult, fail, ok } from './result';
import { authLimiter } from '@/lib/rateLimiters';
import { rateLimitIdentifier } from '@/lib/rateLimit';

/** Typed failure codes for {@link signUp}. */
export type SignUpError =
  | 'VALIDATION' // credentials failed syntactic validation (Req 1.3)
  | 'DUPLICATE_ACCOUNT' // email already registered (Req 1.2)
  | 'PROFILE_CREATION_FAILED' // auth user created but profile insert failed
  | 'SIGN_UP_FAILED'; // provider rejected the sign-up for another reason

/** Data returned on a successful sign-up. */
export interface SignUpData {
  userId: string;
  /** Whether an email-confirmation step is pending before a session exists. */
  emailConfirmationRequired: boolean;
}

/** Typed failure codes for {@link signIn}. */
export type SignInError = 'VALIDATION' | 'INVALID_CREDENTIALS' | 'ACCOUNT_BANNED';

/** Typed failure codes for {@link signOut}. */
export type SignOutError = 'SIGN_OUT_FAILED';

/**
 * Derive a non-empty default display name from an email local-part. The
 * `profiles.display_name` column is NOT NULL; sign-up only collects email +
 * password, so we seed a sensible default the User can edit later via
 * {@link updateProfile}. Falls back to the raw email if the local-part is empty.
 */
function defaultDisplayName(email: string): string {
  const localPart = email.split('@')[0]?.trim();
  const candidate = localPart && localPart.length > 0 ? localPart : email;
  // profiles.display_name is capped at 255 chars by a check constraint.
  return candidate.slice(0, 255);
}

/**
 * Register a new User (Req 1.1–1.3).
 *
 * 1. Validate credentials with the pure validator; on failure return the
 *    offending field (Req 1.3).
 * 2. Create the Supabase Auth user. A duplicate email is mapped to
 *    `DUPLICATE_ACCOUNT` (Req 1.2) — detected both from the provider error and
 *    from Supabase's enumeration-safe "empty identities" signal.
 * 3. Insert the associated `profiles` row (Req 1.1)
 *    via the admin client.
 */
export async function signUp(
  email: string,
  password: string,
): Promise<ActionResult<SignUpData, SignUpError>> {
  const identifier = await rateLimitIdentifier();
  const { allowed } = await authLimiter.check(identifier);
  if (!allowed) {
    return fail('VALIDATION', 'Too many attempts. Please wait a minute and try again.');
  }

  // 1. Syntactic validation (Req 1.1, 1.3).
  const validation = validateRegistrationCredentials({ email, password });
  if (!validation.ok) {
    return fail('VALIDATION', validation.message, validation.field);
  }
  const { email: validEmail, password: validPassword } = validation.value;

  const supabase = await createClient();

  // 2. Create the Auth user (Req 1.1).
  const { data, error } = await supabase.auth.signUp({
    email: validEmail,
    password: validPassword,
  });

  if (error) {
    // Req 1.2: duplicate email is a distinct, typed error.
    if (/already\s*(registered|been registered|exists)|already in use/i.test(error.message)) {
      return fail('DUPLICATE_ACCOUNT', 'An account with this email already exists.', 'email');
    }
    return fail('SIGN_UP_FAILED', error.message);
  }

  const user = data.user;
  if (!user) {
    return fail('SIGN_UP_FAILED', 'Sign-up did not return a user.');
  }

  // Supabase obfuscates duplicate sign-ups (to prevent user enumeration) by
  // returning a user with an empty `identities` array rather than an error.
  if (Array.isArray(user.identities) && user.identities.length === 0) {
    return fail('DUPLICATE_ACCOUNT', 'An account with this email already exists.', 'email');
  }

  // 3. Provision the associated Profile (Req 1.1). No verification column is
  // seeded: a new account is simply not verified, which the Identity_Gate reports
  // from `merchant_status` defaulting to NONE.
  const admin = createAdminClient();
  const { error: profileError } = await admin.from('profiles').insert({
    id: user.id,
    display_name: defaultDisplayName(validEmail),
    contact_email: validEmail,
  });

  if (profileError) {
    // A unique-violation here means the auth user pre-existed with a profile;
    // treat as duplicate. Otherwise the account is in an inconsistent state.
    if (/duplicate key|already exists|unique/i.test(profileError.message)) {
      return fail('DUPLICATE_ACCOUNT', 'An account with this email already exists.', 'email');
    }
    return fail(
      'PROFILE_CREATION_FAILED',
      `Account created but profile setup failed: ${profileError.message}`,
    );
  }

  return ok({
    userId: user.id,
    // No session on the response means an email-confirmation step is pending.
    emailConfirmationRequired: data.session === null,
  });
}

/**
 * Authenticate an existing User (Req 1.7 — establishes the session used by
 * protected resources). Credentials are validated for shape first so an empty
 * or malformed submission returns a field-level error rather than a generic
 * auth failure.
 */
export async function signIn(
  email: string,
  password: string,
): Promise<ActionResult<{ userId: string }, SignInError>> {
  const identifier = await rateLimitIdentifier();
  const { allowed } = await authLimiter.check(identifier);
  if (!allowed) {
    return fail('VALIDATION', 'Too many attempts. Please wait a minute and try again.');
  }

  const validation = validateRegistrationCredentials({ email, password });
  if (!validation.ok) {
    return fail('VALIDATION', validation.message, validation.field);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: validation.value.email,
    password: validation.value.password,
  });

  if (error || !data.user) {
    if (error && /ban(?:ned)?/i.test(error.message)) {
      return fail(
        'ACCOUNT_BANNED',
        'This account was permanently suspended after a staff-confirmed objective fraud finding.',
      );
    }
    return fail('INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  return ok({ userId: data.user.id });
}

/** End the current session. */
export async function signOut(): Promise<ActionResult<null, SignOutError>> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return fail('SIGN_OUT_FAILED', error.message);
  }
  return ok(null);
}

/** Typed failure codes for {@link signInWithGoogle}. */
export type OAuthStartError = 'OAUTH_START_FAILED';

/**
 * Only permit same-origin, absolute-path redirects so the `next` value carried
 * through the OAuth round-trip cannot become an open redirect.
 */
function safeNextPath(target: string | null | undefined): string | null {
  if (target && target.startsWith('/') && !target.startsWith('//')) {
    return target;
  }
  return null;
}

/**
 * Resolve the origin to send the provider back to. Prefers an explicit
 * `NEXT_PUBLIC_SITE_URL` (needed behind proxies and in preview deploys), then
 * the forwarded/request host from the inbound Server Action request.
 */
async function resolveOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  if (!host) {
    return 'http://localhost:3000';
  }
  const proto =
    headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/**
 * Begin the Google OAuth sign-in flow (Req 1.1, 1.7).
 *
 * Runs on the server so the PKCE code verifier is written to an HTTP-only
 * cookie that `app/auth/callback/route.ts` can read when exchanging the code.
 * Returns the provider consent URL for the caller to navigate to rather than
 * redirecting, keeping the ActionResult contract intact for failures.
 *
 * @param redirectTo - Post-sign-in destination; ignored unless it is a
 *   same-origin absolute path.
 */
export async function signInWithGoogle(
  redirectTo?: string,
): Promise<ActionResult<{ url: string }, OAuthStartError>> {
  const supabase = await createClient();
  const origin = await resolveOrigin();

  const callback = new URL('/auth/callback', origin);
  const next = safeNextPath(redirectTo);
  if (next) {
    callback.searchParams.set('next', next);
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.toString(),
      queryParams: {
        // Ask Google to always show the account chooser instead of silently
        // reusing the last session.
        prompt: 'select_account',
      },
    },
  });

  if (error || !data?.url) {
    return fail(
      'OAUTH_START_FAILED',
      friendlyWriteFailure(error, 'Could not start Google sign-in. Please try again.'),
    );
  }

  return ok({ url: data.url });
}
