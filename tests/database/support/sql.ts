// tests/database/support/sql.ts
//
// Running catalog queries against the linked Supabase project from a test.
//
// WHY THIS EXISTS. The grant and policy assertions in this directory need to ask the
// DATABASE what is true, not ask the migration files what was intended. There is no
// local Postgres here and PostgREST cannot run arbitrary SQL, so the only channel is the
// Management API — the same one `scripts/apply-sql.mjs` uses.
//
// READ-ONLY BY CONVENTION. Everything in `tests/database/**` queries `pg_catalog` and
// `information_schema` and nothing else. The channel is capable of DDL, so keep it that
// way: a test that mutates the shared project would be a test that breaks the app for
// everyone else running against it.
//
// SKIPS RATHER THAN FAILS WITHOUT CREDENTIALS. `SUPABASE_PAT` is a personal access token
// and will not exist in CI or on a colleague's machine. A security check that turns into
// a red build for everyone who lacks a token gets deleted; one that quietly reports
// "skipped" stays. `databaseTestsEnabled()` is the guard, and the suite is explicit about
// having skipped so a green run is not mistaken for a verified one.

import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Parse the subset of dotenv syntax this repository's `.env.local` uses. */
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
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

interface Credentials {
  projectRef: string;
  pat: string;
}

let cached: Credentials | null | undefined;

function credentials(): Credentials | null {
  if (cached !== undefined) return cached;

  const env = { ...readEnvFile(), ...process.env } as Record<string, string>;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const pat = env.SUPABASE_PAT;

  if (!url || !pat) {
    cached = null;
    return cached;
  }

  try {
    cached = { projectRef: new URL(url).hostname.split('.')[0], pat };
  } catch {
    cached = null;
  }
  return cached;
}

/** Whether a project and token are configured, so these tests can run at all. */
export function databaseTestsEnabled(): boolean {
  return credentials() !== null;
}

/**
 * Run one SQL statement and return its rows.
 *
 * Throws on a non-2xx response with the provider's message, because a query that could
 * not run must never be mistaken for a query that found no problems — that would turn
 * this whole file into a test that always passes.
 */
export async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const creds = credentials();
  if (!creds) throw new Error('database tests are not configured; guard with databaseTestsEnabled()');

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${creds.projectRef}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    },
  );

  const text = await response.text();
  if (!response.ok) {
    // The token itself is never included in the message.
    throw new Error(`Management API ${response.status}: ${text.slice(0, 500)}`);
  }

  const parsed = JSON.parse(text) as T[];
  return Array.isArray(parsed) ? parsed : [];
}

/** Escape a single-quoted SQL literal. Inputs here are hard-coded identifiers. */
export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
