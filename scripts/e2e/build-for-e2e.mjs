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

import { spawn } from 'node:child_process';

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
const E2E_BUILD_DIR = '.next-e2e';

/** Client-visible values the suite needs baked into the bundle. */
const E2E_CLIENT_ENV = {
  // Forces PlacePicker's free-text fallback. See the note above and F13 in
  // tests/e2e/FINDINGS.md for the coverage this trades away.
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'e2e-intercepted-not-a-real-key',
  NEXT_BUILD_DIR: E2E_BUILD_DIR,
};

// Server-only values are read at runtime and so belong in `webServer.env`, NOT here.
// Duplicating them would imply they are build-time, which is the confusion this
// script exists to remove.

const child = spawn('npx', ['next', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, ...E2E_CLIENT_ENV },
});

child.on('exit', (code) => process.exit(code ?? 1));
