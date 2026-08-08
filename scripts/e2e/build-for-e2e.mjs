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

/** Client-visible values the suite needs baked into the bundle. */
const E2E_CLIENT_ENV = {
  // Forces PlacePicker's free-text fallback. See the note above and F13 in
  // tests/e2e/FINDINGS.md for the coverage this trades away.
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'e2e-intercepted-not-a-real-key',
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
