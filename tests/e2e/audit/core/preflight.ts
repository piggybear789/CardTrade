// tests/e2e/audit/core/preflight.ts
//
// THE SAFETY PREFLIGHT AND CLEANUP GUARDS for the e2e UX audit suite. Pure: no I/O,
// no Supabase, no Stripe SDK, no Playwright, no `node:fs`, no network. The callers
// (`scripts/e2e/audit.mjs`, `playwright.config.ts` at module load, the `preflight`
// project, and the cleanup script) gather the facts and hand them in; this module
// only decides.
//
// Requirements:
//   1.1, 1.2  the harness schema must be exactly `cardtrade_dev`, else abort naming it
//   1.3       a live Stripe key in ANY configured variable aborts, naming the variable
//             and never the value
//   1.4, 1.5  each server's reported schema and payments mode must agree with the run
//   1.6       there is no option that disables the live-key check
//   2.1, 2.8  cleanup only ever targets the sandbox schema and marked sandbox users
//   2.2, 2.3  every account the run signs in as is flagged sandbox, reported masked
//   4.2       the built client bundle matches the run's `NEXT_PUBLIC_*` values
//
// Values from `env` never leave this module: problems carry variable NAMES, and the
// only derived value returned is a one-way fingerprint.

import { createHash } from 'node:crypto';

/** The one schema the suite may run against and clean up. */
export const SANDBOX_SCHEMA = 'cardtrade_dev';

/** What the app resolves an unset or empty `NEXT_PUBLIC_SUPABASE_SCHEMA` to. */
const DEFAULT_APP_SCHEMA = 'cardtrade';

/** Payments mode each server is expected to report by default (`/api/health`). */
const DEFAULT_SERVER_MODES = { main: 'test', aux: 'mock' } as const;

/** Stripe key variable names, e.g. `STRIPE_SECRET_KEY_US`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`. */
const STRIPE_KEY_VARIABLE = /^(NEXT_PUBLIC_)?STRIPE_.*(KEY|SECRET)/;
const STRIPE_IDENTITY_RESTRICTED_VARIABLE = /^STRIPE_IDENTITY_RESTRICTED_KEY/;

/** Prefixes that mean a key acts on real money. */
const LIVE_KEY_PREFIXES = ['sk_live_', 'rk_live_', 'pk_live_'] as const;
const TEST_KEY_PREFIXES = ['sk_test_', 'rk_test_', 'pk_test_'] as const;

/** Only these users may ever be deleted by cleanup. */
const DELETABLE_SANDBOX_EMAIL = /^e2e-.+@example\.com$/;

/** Everything the preflight decides on. Optional parts are checked only when given. */
export interface PreflightInput {
  /** `NEXT_PUBLIC_SUPABASE_SCHEMA` as the harness reads it. */
  harnessSchema: string | undefined;
  /** Names and values; values never leave this module. */
  env: Record<string, string | undefined>;
  /** What each running server reported from `/api/health`. */
  servers?: Array<{ name: 'main' | 'aux'; schema?: string; paymentsMode?: string; payments?: string }>;
  /** Payments mode each server must report. Defaults to main `test`, aux `mock`. */
  expectedServerModes?: { main: 'test'; aux: 'mock' };
  /** Every Sandbox_Account the run will sign in as. */
  accounts?: Array<{ email: string; sandbox: boolean }>;
  /** Fingerprint the build wrote into `.next-e2e`. */
  builtClientEnv?: string;
  /** Variable names that must hold a non-blank value. */
  requiredSecrets?: readonly string[];
}

/** One reason the run must not start. Carries names and masked values only. */
export type PreflightProblem =
  | { code: 'SCHEMA_NOT_SANDBOX'; resolved: string }
  | { code: 'LIVE_KEY'; variable: string }
  | { code: 'SERVER_MISMATCH'; server: string; harness: string; reported: string }
  | { code: 'ACCOUNT_NOT_SANDBOX'; maskedEmail: string }
  | { code: 'STALE_BUILD' }
  | { code: 'MISSING_SECRET'; variable: string };

/** The preflight verdict. */
export type PreflightResult = { ok: true } | { ok: false; problems: PreflightProblem[] };

/**
 * Classifies a Stripe key by its prefix. `sk_live_`, `rk_live_` and `pk_live_` are
 * live; the matching `_test_` prefixes are test; anything else (a `whsec_` secret,
 * a `vf_` flow id, garbage) is unknown. Surrounding whitespace is ignored, so a
 * padded live key is still live.
 */
export function classifyStripeKey(value: string): 'live' | 'test' | 'unknown' {
  const key = value.trim();
  if (LIVE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return 'live';
  if (TEST_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) return 'test';
  return 'unknown';
}

/** True when `name` is a variable that may hold a Stripe key (Req 1.3). */
export function isStripeKeyVariable(name: string): boolean {
  return STRIPE_KEY_VARIABLE.test(name) || STRIPE_IDENTITY_RESTRICTED_VARIABLE.test(name);
}

/**
 * A one-way fingerprint of the client environment: SHA-256 over the sorted
 * `NEXT_PUBLIC_*` name/value pairs. Non-public variables and unset values do not
 * contribute, and insertion order does not matter (Req 4.2).
 */
export function clientEnvFingerprint(env: Record<string, string | undefined>): string {
  const pairs = Object.keys(env)
    .filter((name) => name.startsWith('NEXT_PUBLIC_') && env[name] !== undefined)
    .sort()
    .map((name) => [name, env[name] as string]);
  return createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
}

/**
 * Masks an email for reports: the first character of the local part, then `***`,
 * then the domain (`alice@example.com` → `a***@example.com`). The result never
 * equals the input.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  const local = at === -1 ? email : email.slice(0, at);
  const domain = at === -1 ? '' : email.slice(at);
  const masked = `${local.slice(0, 1)}***${domain}`;
  return masked === email ? `***${domain}` : masked;
}

/**
 * Decides whether a run may start. Returns every problem found, not just the first,
 * so one run reports everything the owner has to fix. The live-key check cannot be
 * switched off: no input field or variable disables it (Req 1.6).
 */
export function decidePreflight(input: PreflightInput): PreflightResult {
  const problems: PreflightProblem[] = [];

  // Req 1.1, 1.2: the harness must resolve to the sandbox, exactly.
  if (input.harnessSchema !== SANDBOX_SCHEMA) {
    problems.push({ code: 'SCHEMA_NOT_SANDBOX', resolved: input.harnessSchema || DEFAULT_APP_SCHEMA });
  }

  // Req 1.3: every Stripe key variable, every region. Name only, never the value.
  for (const variable of Object.keys(input.env).sort()) {
    const value = input.env[variable];
    if (value === undefined || !isStripeKeyVariable(variable)) continue;
    if (classifyStripeKey(value) === 'live') problems.push({ code: 'LIVE_KEY', variable });
  }

  // Req 1.4, 1.5: each server's own resolution must agree with the run.
  const expectedModes = input.expectedServerModes ?? DEFAULT_SERVER_MODES;
  for (const server of input.servers ?? []) {
    if (server.schema !== SANDBOX_SCHEMA) {
      problems.push({
        code: 'SERVER_MISMATCH',
        server: server.name,
        harness: SANDBOX_SCHEMA,
        reported: server.schema ?? '(not reported)',
      });
    }
    const expectedMode = expectedModes[server.name];
    if (server.paymentsMode !== expectedMode) {
      problems.push({
        code: 'SERVER_MISMATCH',
        server: server.name,
        harness: expectedMode,
        reported: server.paymentsMode ?? '(not reported)',
      });
    }
  }

  // Req 2.2, 2.3: sign in only as flagged sandbox accounts, reported masked.
  for (const account of input.accounts ?? []) {
    if (account.sandbox !== true) {
      problems.push({ code: 'ACCOUNT_NOT_SANDBOX', maskedEmail: maskEmail(account.email) });
    }
  }

  // Req 4.2: the bundle must have been built with this run's public env.
  if (input.builtClientEnv !== undefined && input.builtClientEnv !== clientEnvFingerprint(input.env)) {
    problems.push({ code: 'STALE_BUILD' });
  }

  for (const variable of input.requiredSecrets ?? []) {
    const value = input.env[variable];
    if (value === undefined || value.trim() === '') problems.push({ code: 'MISSING_SECRET', variable });
  }

  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

/**
 * Throws unless `schema` is exactly `cardtrade_dev`. The cleanup script calls this
 * before it touches anything, so it has no path that writes to production (Req 2.8).
 */
export function assertSandboxSchema(schema: string | undefined): asserts schema is typeof SANDBOX_SCHEMA {
  if (schema !== SANDBOX_SCHEMA) {
    throw new Error(
      `Refusing to run: the schema is "${schema ?? DEFAULT_APP_SCHEMA}", and only "${SANDBOX_SCHEMA}" is allowed.`,
    );
  }
}

/**
 * True only for an auth user the suite may delete: an `e2e-…@example.com` email AND
 * `app_metadata.sandbox === true`. Either alone is not enough (Req 2.1, 2.8).
 */
export function isDeletableSandboxUser(user: {
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
}): boolean {
  return (
    typeof user.email === 'string' &&
    DELETABLE_SANDBOX_EMAIL.test(user.email) &&
    user.app_metadata?.sandbox === true
  );
}
