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
// `cardtrade_dev` sandbox schema is reached over REST.
//
// The Playwright process does not load `.env.local` — nothing else needed it — so the
// file is parsed here rather than adding a global dependency for one helper.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertSandboxSchema, SANDBOX_SCHEMA } from '../audit/core/preflight';

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
 * Run a PostgREST request against the sandbox schema ({@link e2eSchema}) with the
 * service role.
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
  if (method === 'GET') headers['Accept-Profile'] = e2eSchema();
  else headers['Content-Profile'] = e2eSchema();

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

/**
 * Mark an auth user's email as confirmed, with the service role.
 *
 * WHY THE SUITE NEEDS THIS. With email confirmation enforced, `signUp` returns no
 * session, so a spec that registers through the form lands on `/sign-in` and can go no
 * further — there is no inbox to click in a headless run. Confirming through the Admin
 * API is the supported stand-in for that click, and it keeps the specs exercising the
 * REAL sign-up path rather than provisioning members behind the app's back.
 *
 * Hits the Auth Admin API rather than `rest()`, which is scoped to PostgREST and the
 * `cardtrade` schema; `auth.users` is neither.
 */
export async function confirmUserEmail(userId: string): Promise<void> {
  const response = await authAdmin('PUT', `users/${encodeURIComponent(userId)}`, {
    email_confirm: true,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Auth admin confirm ${userId} -> ${response.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Auth Admin API (auth.users)
// ---------------------------------------------------------------------------
//
// `auth.users` is SHARED WITH PRODUCTION: the sandbox is a second schema in the same
// project, not a second project. So every helper below refuses to run unless the
// harness is pointed at the sandbox ({@link e2eSchema}), and the two that act on an
// account refuse one that is not a Sandbox_Account (Req 2.1, 2.2).

/** The reserved test domain every Sandbox_Account uses (RFC 2606). */
const SANDBOX_EMAIL = /@example\.com$/i;

/** The subset of a GoTrue user the suite reads. */
export interface AuthUser {
  id: string;
  email: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  email_confirmed_at: string | null;
  banned_until: string | null;
  created_at: string;
}

/** True when the account carries the sandbox flag (`app_metadata.sandbox = true`). */
export function isSandboxAccount(user: Pick<AuthUser, 'app_metadata'>): boolean {
  return user.app_metadata?.sandbox === true;
}

/** One Auth Admin API request with the service role, after the sandbox guard. */
async function authAdmin(
  method: 'GET' | 'POST' | 'PUT',
  pathAndQuery: string,
  body?: unknown,
): Promise<Response> {
  e2eSchema();
  const { url, serviceKey } = credentials();
  return fetch(`${url}/auth/v1/admin/${pathAndQuery}`, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function toAuthUser(raw: Record<string, unknown>): AuthUser {
  return {
    id: String(raw.id),
    email: typeof raw.email === 'string' ? raw.email : null,
    app_metadata: (raw.app_metadata as Record<string, unknown> | undefined) ?? {},
    user_metadata: (raw.user_metadata as Record<string, unknown> | undefined) ?? {},
    email_confirmed_at: typeof raw.email_confirmed_at === 'string' ? raw.email_confirmed_at : null,
    banned_until: typeof raw.banned_until === 'string' ? raw.banned_until : null,
    created_at: String(raw.created_at ?? ''),
  };
}

/**
 * The auth user behind `userId`, or null when there is none. For the preflight's
 * account-flag check (Req 2.3) and for confirming an Admin write landed.
 */
export async function getAuthUser(userId: string): Promise<AuthUser | null> {
  const response = await authAdmin('GET', `users/${encodeURIComponent(userId)}`);
  if (response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Auth admin get ${userId} -> ${response.status}: ${text}`);
  }
  return toAuthUser(JSON.parse(text) as Record<string, unknown>);
}

/** The user, refused unless it exists and its email is on the reserved test domain. */
async function requireTestDomainUser(userId: string, action: string): Promise<AuthUser> {
  const user = await getAuthUser(userId);
  if (!user) throw new Error(`${action}: no auth user ${userId}`);
  if (!user.email || !SANDBOX_EMAIL.test(user.email)) {
    throw new Error(`${action}: auth user ${userId} is not on the reserved test domain`);
  }
  return user;
}

/**
 * Merge `patch` into an auth user's `app_metadata` (GoTrue merges keys; a `null`
 * value removes one) and return the updated user.
 *
 * Used to flag a Sandbox_Account (`{ sandbox: true }`, Req 2.1) and, in the preflight
 * refusal Pathway, to arrange an unflagged one. Refuses any account whose email is
 * not on `example.com`, so it can never touch a real member's row.
 */
export async function setAppMetadata(
  userId: string,
  patch: Record<string, unknown>,
): Promise<AuthUser> {
  await requireTestDomainUser(userId, 'setAppMetadata');
  const response = await authAdmin('PUT', `users/${encodeURIComponent(userId)}`, {
    app_metadata: patch,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Auth admin app_metadata ${userId} -> ${response.status}: ${text}`);
  }
  return toAuthUser(JSON.parse(text) as Record<string, unknown>);
}

/** Link types the suite generates: a password reset, a sign-in link, a confirmation. */
export type AuthLinkType = 'recovery' | 'magiclink' | 'signup';

/** A generated Admin link. Secret-bearing: pass it to a page, never log it. */
export interface AuthLink {
  /** The verify URL a member would click in the email. */
  actionLink: string;
  /** The hashed token, for `verifyOtp({ token_hash, type })` against `/auth/confirm`. */
  hashedToken: string;
  verificationType: string;
  redirectTo: string | null;
}

/**
 * Generate an auth email link through the Admin API (`/admin/generate_link`) without
 * sending any email, the headless stand-in for clicking a reset or confirmation link
 * (Req 7.6, 7.7).
 *
 * Takes a user ID rather than an email, and refuses unless that account already
 * exists, is on the reserved test domain AND is a Sandbox_Account. A `signup` link for
 * an unknown email would CREATE an unflagged auth user in production's `auth.users`;
 * resolving the account first makes that impossible. A `signup` link needs the
 * account's password, which GoTrue requires for that type.
 */
export async function generateAuthLink(
  type: AuthLinkType,
  userId: string,
  options: { redirectTo?: string; password?: string } = {},
): Promise<AuthLink> {
  const user = await requireTestDomainUser(userId, 'generateAuthLink');
  if (!isSandboxAccount(user)) {
    throw new Error(`generateAuthLink: auth user ${userId} is not a Sandbox_Account`);
  }
  if (type === 'signup' && !options.password) {
    throw new Error('generateAuthLink: a signup link needs the account password');
  }

  const response = await authAdmin('POST', 'generate_link', {
    type,
    email: user.email,
    ...(type === 'signup' ? { password: options.password } : {}),
    ...(options.redirectTo ? { redirect_to: options.redirectTo } : {}),
  });
  const text = await response.text();
  if (!response.ok) {
    // GoTrue's error body names the problem, not the link, so it is safe to surface.
    throw new Error(`Auth admin generate_link (${type}) ${userId} -> ${response.status}: ${text}`);
  }

  // GoTrue returns the user with the link properties merged in at the top level;
  // older versions nest them under `properties`.
  const raw = JSON.parse(text) as Record<string, unknown>;
  const props = (raw.properties as Record<string, unknown> | undefined) ?? raw;
  const actionLink = props.action_link;
  const hashedToken = props.hashed_token;
  if (typeof actionLink !== 'string' || typeof hashedToken !== 'string') {
    throw new Error(`Auth admin generate_link (${type}) ${userId} returned no link`);
  }
  return {
    actionLink,
    hashedToken,
    verificationType: typeof props.verification_type === 'string' ? props.verification_type : type,
    redirectTo: typeof props.redirect_to === 'string' ? props.redirect_to : null,
  };
}

/** A value from the environment or `.env.local`, for specs that call a provider. */
export function envValue(name: string): string | undefined {
  return process.env[name] ?? readEnvFile()[name];
}

/**
 * The schema the app under test reads (`lib/supabase/schema.ts`), which for the e2e
 * suite must be the dev sandbox. The helpers must use the same one as the server, or
 * an arranged row lands where the app never looks.
 *
 * Throws unless `NEXT_PUBLIC_SUPABASE_SCHEMA` is exactly `cardtrade_dev` (Req 1.1, 1.2).
 * There is no default and no override: these helpers write with the service role, and
 * an unset value would otherwise resolve to production.
 */
export function e2eSchema(): typeof SANDBOX_SCHEMA {
  const schema = envValue('NEXT_PUBLIC_SUPABASE_SCHEMA')?.trim();
  assertSandboxSchema(schema);
  return schema;
}

/**
 * Update rows matching raw PostgREST query syntax, with the service role. For
 * ARRANGING a state, and restoring it after (see the rule on {@link rest}).
 */
export async function updateRows<T = Record<string, unknown>>(
  table: string,
  query: string,
  patch: Record<string, unknown>,
): Promise<T[]> {
  return (await rest<T[]>('PATCH', `${table}?${query}`, patch)) ?? [];
}

/** Insert one row with the service role and return it. For ARRANGING a state only. */
export async function insertRow<T = Record<string, unknown>>(
  table: string,
  row: Record<string, unknown>,
): Promise<T> {
  const [inserted] = (await rest<T[]>('POST', table, row)) ?? [];
  if (!inserted) throw new Error(`insert into ${table} returned nothing`);
  return inserted;
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
