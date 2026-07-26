import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

/**
 * Service-role Supabase client for **trusted server-only tasks** (e.g. the
 * webhook handler and the trade orchestrator's guarded writes).
 *
 * This client uses the service-role key and therefore **bypasses RLS**. It must
 * NEVER be imported into client code - the `server-only` import above turns any
 * such import into a build-time error. Session persistence and auto-refresh are
 * disabled because there is no user session to manage.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase admin env vars: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    db: { schema: 'cardtrade' },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
