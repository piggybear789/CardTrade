// tests/e2e/support/db.ts
//
// Direct database access for tests, over PostgREST with the service-role key.
//
// WHY TESTS NEED DATABASE ACCESS AT ALL. Most assertions belong in the UI, and this
// helper is not an invitation to move them. It exists for two jobs the UI cannot do:
//
//   1. ARRANGE a state a member cannot reach by clicking. The case that prompted it
//      is a signed-in member whose `profiles` row is missing — reachable in
//      production (the row is created at sign-up and at the OAuth callback, and
//      nothing repaired one that went missing afterwards) but reachable through no
//      screen, which is exactly why the state went untested.
//   2. CONFIRM a write actually landed. A UI that reports success while writing
//      nothing is the failure mode F20 hid: the demo webhook button looked fine,
//      `webhook_logs` was empty, and only the database could say so.
//
// WHY NOT `@supabase/supabase-js`. Constructing that client in the Playwright process
// fails with "Node.js detected but native WebSocket not found" — it wires up Realtime
// whether or not a caller wants it. A test helper that reads and writes a few rows
// needs none of that, and plain `fetch` has no such requirement. Schema selection
// rides on the `Accept-Profile` / `Content-Profile` headers, which is how the
// `cardtrade` schema is reached over REST.
//
// The Playwright process does not load `.env.local` — nothing else needed it — so the
// file is parsed here rather than adding a global dependency for one helper.

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Parse the subset of dotenv syntax this repository's `.env.local` actually uses. */
function readEnvFile(): Record<string, string> {
  const file = path.join(process.cwd(), '.env.local');
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

interface Credentials {
  url: string;
  serviceKey: string;
}

let cached: Credentials | null = null;

function credentials(): Credentials {
  if (cached) return cached;
  const env = { ...readEnvFile(), ...process.env } as Record<string, string>;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'tests/e2e/support/db.ts needs NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY, from the environment or .env.local.',
    );
  }
  cached = { url: url.replace(/\/+$/, ''), serviceKey };
  return cached;
}

/**
 * Run a PostgREST request against the `cardtrade` schema with the service role.
 *
 * RLS-bypassing, which is the point: arranging a state needs writes a member could
 * not perform. Never use it to assert something a member should be able to SEE —
 * that answer ignores the policies, which are part of the behaviour. F19 was a policy
 * bug that a service-role read would have pronounced healthy.
 */
async function rest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  pathAndQuery: string,
  body?: unknown,
): Promise<T> {
  const { url, serviceKey } = credentials();
  const headers: Record<string, string> = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  // GET selects a schema with Accept-Profile; writes use Content-Profile.
  if (method === 'GET') headers['Accept-Profile'] = 'cardtrade';
  else headers['Content-Profile'] = 'cardtrade';

  const response = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`PostgREST ${method} ${pathAndQuery} -> ${response.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** Rows from a table, filtered with raw PostgREST query syntax. */
export async function selectRows<T = Record<string, unknown>>(
  table: string,
  query: string,
): Promise<T[]> {
  return (await rest<T[]>('GET', `${table}?${query}`)) ?? [];
}

/** Delete rows matching raw PostgREST query syntax. Returns how many went. */
export async function deleteRows(table: string, query: string): Promise<number> {
  const deleted = await rest<unknown[]>('DELETE', `${table}?${query}`);
  return Array.isArray(deleted) ? deleted.length : 0;
}

/** The profile id behind a contact email, or null when there is no such row. */
export async function profileIdByEmail(email: string): Promise<string | null> {
  const rows = await selectRows<{ id: string }>(
    'profiles',
    `select=id&contact_email=eq.${encodeURIComponent(email)}`,
  );
  return rows[0]?.id ?? null;
}
