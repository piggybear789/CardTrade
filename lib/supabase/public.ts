import 'server-only';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/supabase/database.types';

type PublicCatalogClient = ReturnType<typeof createSupabaseClient<Database>>;

/**
 * Anon Supabase client for public catalog reads.
 *
 * No cookies, no session, no per-request construction. Catalog rows are
 * readable under the anon RLS policy, and keeping this client out of
 * `cookies()` is what lets those reads sit in `unstable_cache`.
 */
let client: PublicCatalogClient | null = null;

export function publicCatalogClient(): PublicCatalogClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Missing Supabase public env vars: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.',
    );
  }

  client = createSupabaseClient<Database>(url, anonKey, {
    db: { schema: 'cardtrade' },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return client;
}
