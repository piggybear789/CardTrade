import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { createClient } from './server';
import { hasSupabaseSessionCookie } from './sessionCookie';

/** The signed-in member, as their verified access token describes them. */
export interface AuthUser {
  id: string;
  email?: string;
  user_metadata: Record<string, unknown>;
}

export interface CachedProfile {
  id: string;
  is_admin: boolean | null;
  is_support: boolean | null;
  display_name: string | null;
  region_code: string | null;
  avatar_path: string | null;
  onboarding_completed_at: string | null;
}

/**
 * The credential this request carries: a mobile Bearer token, the session cookie
 * (`'cookie'`), or nothing. A browser request with no session cookie has nothing to
 * verify, which keeps the catalog's guests off the auth path entirely.
 */
async function requestCredential(): Promise<{ bearer: string } | 'cookie' | null> {
  try {
    const authHeader = (await headers()).get('authorization');
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (bearer) return { bearer };
  } catch {
    // Outside request scope
  }
  try {
    return hasSupabaseSessionCookie((await cookies()).getAll()) ? 'cookie' : null;
  } catch {
    return null;
  }
}

/**
 * Per-request cached lookup of the current authenticated user, from both cookie-based
 * sessions and mobile Bearer tokens.
 *
 * `getClaims`, NOT `getUser`. The project signs access tokens with an asymmetric key
 * (ES256), so `getClaims` checks the signature locally against the cached JWKS, where
 * `getUser` was a round trip to the auth server on every request that asked. A signed-out
 * session's token stays valid until it expires, exactly as it already does for every
 * RLS query PostgREST verifies. Staff gates use {@link getVerifiedAuthUser} instead.
 */
export const getCachedAuthUser = cache(async (): Promise<AuthUser | null> => {
  try {
    const credential = await requestCredential();
    if (!credential) return null;
    const supabase = await createClient();
    const { data, error } = await (credential === 'cookie'
      ? supabase.auth.getClaims()
      : supabase.auth.getClaims(credential.bearer));
    const claims = data?.claims;
    if (error || !claims?.sub) return null;
    return {
      id: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      user_metadata: (claims.user_metadata as Record<string, unknown> | undefined) ?? {},
    };
  } catch {
    return null;
  }
});

/**
 * The current user, CONFIRMED WITH THE AUTH SERVER rather than read off the token: a
 * session signed out elsewhere stops working at once, not when its token expires. One
 * round trip, so it is for the staff gates, where a compromised account signed out
 * everywhere must lose access immediately.
 */
export const getVerifiedAuthUser = cache(async (): Promise<AuthUser | null> => {
  try {
    const credential = await requestCredential();
    if (!credential) return null;
    const supabase = await createClient();
    const {
      data: { user },
    } = await (credential === 'cookie'
      ? supabase.auth.getUser()
      : supabase.auth.getUser(credential.bearer));
    if (!user) return null;
    return { id: user.id, email: user.email, user_metadata: user.user_metadata ?? {} };
  } catch {
    return null;
  }
});

/**
 * Per-request cached lookup of a user profile.
 * Defaults to the currently authenticated user's profile if `userId` is omitted.
 */
export const getCachedProfile = cache(
  async (userId?: string): Promise<CachedProfile | null> => {
    try {
      let targetId = userId;
      if (!targetId) {
        const user = await getCachedAuthUser();
        if (!user) return null;
        targetId = user.id;
      }
      const supabase = await createClient();
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, is_admin, is_support, display_name, region_code, avatar_path, onboarding_completed_at')
        .eq('id', targetId)
        .maybeSingle();
      return profile ?? null;
    } catch {
      return null;
    }
  },
);
