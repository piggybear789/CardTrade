import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Supabase client for use in **Client Components** (browser).
 *
 * Reads the public, browser-safe environment variables. This client operates
 * under the authenticated user's session (subject to RLS) and must never be
 * given the service-role key.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase browser env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }

  return createBrowserClient<Database>(url, anonKey, {
    db: { schema: 'cardtrade' },
  });
}
