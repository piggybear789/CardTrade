import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Cookie-bound Supabase client for use in **Server Components, Server Actions,
 * and Route Handlers** that act on behalf of the signed-in user.
 *
 * It reads/writes the auth session from Next.js cookies so RLS is enforced
 * against the current user. Cookie writes are wrapped in try/catch because
 * Server Components cannot mutate cookies - in that context the middleware /
 * Server Action is responsible for session refresh.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase server env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
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
          // The `setAll` method was called from a Server Component. This can be
          // ignored when session refresh happens in middleware or a Server Action.
        }
      },
    },
  });
}
