// lib/api/mobileSession.ts
//
// Shared session helper for mobile API route handlers.
//
// The Flutter client sends the Supabase session as a bearer token in the
// Authorization header rather than as a cookie. This helper establishes a
// session from whichever is present — cookie first (the website path),
// then bearer (the mobile path) — and returns 401 when neither is valid.
//
// Every handler under `app/api/mobile/**` uses this instead of rolling its own
// auth check, so there is one opinion about who the caller is.

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

import type { Database } from '@/lib/supabase/database.types';

export interface MobileSession {
  /** The authenticated user's id. */
  userId: string;
  /** A cookie- or bearer-authenticated Supabase client acting as this user. */
  supabase: ReturnType<typeof createServerClient<Database>>;
}

export type MobileSessionResult =
  | { ok: true; session: MobileSession }
  | { ok: false; response: Response };

/**
 * Authenticate a mobile API request.
 *
 * Precedence:
 * 1. Cookie-based session (website / SSR path).
 * 2. Bearer token in `Authorization: Bearer <access_token>`.
 *
 * Returns 401 with a JSON body when neither yields an authenticated user.
 * Never reads a user id from the request body.
 */
export async function authenticateMobileRequest(
  request: NextRequest,
): Promise<MobileSessionResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ ok: false, error: 'SERVER_MISCONFIGURED', message: 'Missing Supabase env vars' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    };
  }

  // Try cookie-based session first (the website path).
  const cookieStore = await cookies();
  const cookieClient = createServerClient<Database>(url, anonKey, {
    db: { schema: 'cardtrade' },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot mutate cookies — safe to ignore.
        }
      },
    },
  });

  // `getClaims`, not `getUser`: the access token is ES256-signed, so it is verified
  // locally against the cached JWKS rather than by a round trip to the auth server on
  // every mobile request (see `getCachedAuthUser`).
  const { data: cookieAuth } = await cookieClient.auth.getClaims();
  const cookieUserId = cookieAuth?.claims.sub;

  if (cookieUserId) {
    return {
      ok: true,
      session: { userId: cookieUserId, supabase: cookieClient },
    };
  }

  // Fall back to bearer token (mobile path).
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return unauthorized();
  }

  // A client acting as the token's user; `getClaims` below verifies the token.
  const bearerClient = createServerClient<Database>(url, anonKey, {
    db: { schema: 'cardtrade' },
    global: {
      headers: { Authorization: `Bearer ${token}` },
    },
    cookies: {
      getAll() {
        return [];
      },
      setAll() {
        // No cookies in the bearer path.
      },
    },
  });

  const { data: bearerAuth } = await bearerClient.auth.getClaims(token);
  const bearerUserId = bearerAuth?.claims.sub;

  if (!bearerUserId) {
    return unauthorized();
  }

  return {
    ok: true,
    session: { userId: bearerUserId, supabase: bearerClient },
  };
}

function unauthorized(): MobileSessionResult {
  return {
    ok: false,
    response: new Response(
      JSON.stringify({ ok: false, error: 'NOT_AUTHENTICATED', message: 'Please sign in to continue.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    ),
  };
}
