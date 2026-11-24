// scripts/e2e/build-for-e2e.mjs
//
// Produce a production build configured for the e2e suite.
//
// WHY A SCRIPT AND NOT JUST `webServer.env`. `NEXT_PUBLIC_*` variables are INLINED
// INTO THE CLIENT BUNDLE AT BUILD TIME. Setting one in Playwright's `webServer.env`
// therefore works for `next dev` — which compiles on demand, after the server has
// the environment — and is silently ignored by `next start`, which serves a bundle
// whose values were fixed when `next build` ran.
//
// That asymmetry cost a confusing failure. The suite blanks
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY so `PlacePicker` uses its free-text fallback and
// listing creation is deterministic (see playwright.config.ts). Under `next dev` that
// worked. Against a production build made with the real key present in `.env.local`,
// the same specs failed with `combobox "Based near *" [invalid]` — the field was a
// live Places autocomplete, so typed text never resolved to a place and the form
// refused with "Add where this listing is based".
//
// An actual environment variable takes precedence over `.env.local` in Next, so
// blanking it here is enough to override the checked-in value.
//
//   node scripts/e2e/build-for-e2e.mjs
//
// Prefer `npm run test:e2e:prod`, which chains this with the run.
//
// THE BUILD STAMP (Req 4.1, 4.2, F18). After a successful build this writes
// `.next-e2e/e2e-client-env.json`:
//
//   { "fingerprint": "<sha-256 hex>" }
//
// The fingerprint is `clientEnvFingerprint` (tests/e2e/audit/core/preflight.ts) of
// the environment `next build` saw: `.env*` files loaded the way Next loads them
// for a production build, with real environment variables and `E2E_CLIENT_ENV`
// taking precedence. Preflight recomputes it from the run's environment and aborts
// with STALE_BUILD on a difference. Only the one-way hash is written, never a
// `NEXT_PUBLIC_*` value. It is written AFTER the build because `next build` empties
// its distDir first, and only on success, so a failed build leaves no stamp.

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import nextEnv from '@next/env';
import { tsImport } from 'tsx/esm/api';

/**
 * Build into a directory of the suite's own, NOT `.next`.
 *
 * `next dev` and `next build` share `.next`, so running this while a developer
 * has a dev server up left them with a production build under their dev server:
 * Tailwind kept a file list from before the last rename and died with
 * `ENOENT ... app/offers/loading.tsx` while compiling `globals.css`, which reads
 * like a broken stylesheet and is actually two processes sharing a cache.
 *
 * `next.config.ts` already resolves `distDir` from `NEXT_BUILD_DIR`, so setting
 * it here — and identically in `playwright.config.ts`'s `webServer.env`, so
 * `next start` looks in the same place — is enough to separate them. Anything
 * matching `.next-*` is already gitignored.
 *
 * Keep the two values in step: a build here that `next start` cannot find fails
 * as "webServer was not able to start", which says nothing about the cause.
 */
export const E2E_BUILD_DIR = '.next-e2e';

/** Where the build stamp lives, relative to the repo root. */
export const E2E_CLIENT_ENV_STAMP = path.join(E2E_BUILD_DIR, 'e2e-client-env.json');

/**
 * Client-visible values the suite needs baked into the bundle. Exported so the
 * runner can apply the same overrides to the environment preflight fingerprints.
 */
export const E2E_CLIENT_ENV = {
  // Forces PlacePicker's free-text fallback. See the note above and F13 in
  // tests/e2e/FINDINGS.md for the coverage this trades away.
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'e2e-intercepted-not-a-real-key',
  NEXT_BUILD_DIR: E2E_BUILD_DIR,
};

// Server-only values are read at runtime and so belong in `webServer.env`, NOT here.
// Duplicating them would imply they are build-time, which is the confusion this
// script exists to remove.

const ROOT = process.cwd();

/**
 * The environment `next build` will see. `loadEnvConfig` (production mode) fills
 * `process.env` from `.env.production.local`, `.env.local`, `.env.production` and
 * `.env` without overriding variables already set, exactly as the child build
 * does, and `E2E_CLIENT_ENV` wins over both.
 */
export function buildEnvironment() {
  nextEnv.loadEnvConfig(ROOT, false, { info() {}, error: console.error });
  return { ...process.env, ...E2E_CLIENT_ENV };
}

/** Writes the stamp holding only the fingerprint of `env`'s public values. */
export async function writeClientEnvStamp(env) {
  const { clientEnvFingerprint } = await tsImport(
    '../../tests/e2e/audit/core/preflight.ts',
    import.meta.url,
  );
  const file = path.join(ROOT, E2E_CLIENT_ENV_STAMP);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ fingerprint: clientEnvFingerprint(env) })}\n`);
  return file;
}

function main() {
  const env = buildEnvironment();
  const child = spawn('npx', ['next', 'build'], { stdio: 'inherit', shell: true, env });

  child.on('exit', async (code) => {
    if (code !== 0) process.exit(code ?? 1);
    try {
      const file = await writeClientEnvStamp(env);
      console.log(`Wrote the client env fingerprint to ${path.relative(ROOT, file)}`);
      process.exit(0);
    } catch (error) {
      console.error('Build succeeded but the client env stamp could not be written:', error);
      process.exit(1);
    }
  });
}

// Run only when executed directly, so the runner can import the constants above.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
