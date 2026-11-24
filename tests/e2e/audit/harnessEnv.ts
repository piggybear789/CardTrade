// tests/e2e/audit/harnessEnv.ts
//
// THE ENVIRONMENT THE APP SERVERS SEE, composed once for the static preflight in
// `playwright.config.ts` and again for the `preflight` project (design, "Safety
// preflight"). Both must compose it identically: the client env fingerprint the
// preflight project recomputes is compared with the build stamp, and a different
// composition order would report STALE_BUILD for an up-to-date build (Req 4.2).
//
// The env files are parsed into a local object, never written into `process.env`,
// so calling this does not change what the servers or workers inherit. Values are
// returned to the caller only to hand to `decidePreflight`, which never lets one out.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/** Next's env file load order for a production server, lowest precedence first. */
const ENV_FILES = ['.env', '.env.production', '.env.local', '.env.production.local'] as const;

/** Where the build writes its client env stamp, relative to the repo root (task 7.2). */
export const CLIENT_ENV_STAMP = path.join('.next-e2e', 'e2e-client-env.json');

/**
 * The aux server's mock webhook secret when none is configured. Mock webhooks are
 * refused without a secret (ESC-16, there is no default in the app), so the suite
 * supplies one of its own to the aux server only.
 */
export const AUX_WEBHOOK_SECRET_FALLBACK = 'e2e-mock-webhook-secret';

/**
 * The build-time overrides `build-for-e2e.mjs` bakes into the bundle (`E2E_CLIENT_ENV`).
 *
 * Read from the script itself so there is one copy of them. Playwright loads the config
 * as CommonJS and cannot `require` an ES module on this Node, so the export is read
 * through a short-lived `node` child. The values are not secrets (a dummy Maps key and
 * the build directory).
 */
export function readClientEnv(root: string = process.cwd()): Record<string, string> {
  const script =
    "const m = await import('./scripts/e2e/build-for-e2e.mjs');" +
    'process.stdout.write(JSON.stringify(m.E2E_CLIENT_ENV));';
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf8',
  });
  return JSON.parse(out) as Record<string, string>;
}

/**
 * The env files `next start` loads, with the process environment on top (Next gives
 * the process precedence), and the build's own client overrides on top of that,
 * exactly as `buildEnvironment()` in build-for-e2e.mjs composes it.
 */
export function harnessEnvironment(
  root: string = process.cwd(),
  clientEnv: Record<string, string> = readClientEnv(root),
): Record<string, string | undefined> {
  const fromFiles: Record<string, string | undefined> = {};
  for (const file of ENV_FILES) {
    const full = path.join(root, file);
    if (existsSync(full)) Object.assign(fromFiles, parseEnv(readFileSync(full, 'utf8')));
  }
  return { ...fromFiles, ...process.env, ...clientEnv };
}

/** The `WEBHOOK_SECRET` the aux server runs with. */
export function auxWebhookSecret(env: Record<string, string | undefined>): string {
  return env.WEBHOOK_SECRET?.trim() || AUX_WEBHOOK_SECRET_FALLBACK;
}

/**
 * The main server's Ship24 bearer secret when none is configured.
 *
 * Real Ship24 deliveries go to the deployed webhook, never to localhost:3100, so the
 * only sender the main server has is the suite's own fixture helper
 * (`backend/ship24.ts`). The value only has to agree between the two, and the route
 * refuses every delivery without one, so the suite supplies its own when
 * `.env.local` has none, the same way it does for the aux server's mock secret.
 * Fixed rather than random so a reused server (`reuseExistingServer`) still agrees.
 */
export const SHIP24_WEBHOOK_SECRET_FALLBACK = 'e2e-ship24-webhook-secret';

/** The `SHIP24_WEBHOOK_SECRET` the main server runs with and the fixture helper sends. */
export function ship24WebhookSecret(env: Record<string, string | undefined>): string {
  return env.SHIP24_WEBHOOK_SECRET?.trim() || SHIP24_WEBHOOK_SECRET_FALLBACK;
}

/**
 * The fingerprint the last e2e build wrote, or null when there is no stamp (no build
 * yet, or a build made before task 7.2). Throws on a stamp it cannot read, rather than
 * treating a corrupt file as "no stamp".
 */
export function readBuiltClientEnv(root: string = process.cwd()): string | null {
  const file = path.join(root, CLIENT_ENV_STAMP);
  if (!existsSync(file)) return null;
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { fingerprint?: unknown };
  if (typeof parsed.fingerprint !== 'string' || parsed.fingerprint === '') {
    throw new Error(`${CLIENT_ENV_STAMP} holds no fingerprint; rebuild with node scripts/e2e/build-for-e2e.mjs`);
  }
  return parsed.fingerprint;
}
