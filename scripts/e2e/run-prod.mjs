// scripts/e2e/run-prod.mjs
//
// Build, then run the e2e suite against a PRODUCTION server.
//
//   npm run test:e2e:prod                 -- whole suite
//   npm run test:e2e:prod -- --project=desktop tests/e2e/specs/offers.spec.ts
//
// Anything after `--` is forwarded to Playwright.
//
// WHY THIS IS THE RECOMMENDED WAY TO RUN. Against `next dev` the suite is slower and
// noisier for reasons that have nothing to do with the app:
//
//   * Routes compile on first request, so a first visit to `/messages/[id]` or
//     `/sales/[id]` takes 15–25s. Specs carry large navigation budgets purely to
//     out-wait that, and one early spec drew a WRONG conclusion from a short wait —
//     it recorded that sending a message "does not navigate" when the push was simply
//     queued behind a cold compile.
//   * `next dev` injects the dev-tools overlay, which contributes a control whose
//     accessible name matches "Next" and has already stolen a click from the
//     onboarding wizard.
//
// Measured: 7.5 minutes against a production build versus 14.7 against dev, for the
// same specs.
//
// TWO SHARED-STATE TRAPS, both learned the hard way:
//   1. `next dev` and `next build` share `.next`, so running anything in dev mode —
//      including the inspector at playwright.debug.config.ts — invalidates a
//      production build. `next start` then dies with `next-start-no-build-id`, and
//      Playwright reports "webServer was not able to start", which looks nothing like
//      "your build is stale". This script always rebuilds, so that cannot happen.
//   2. The build must bake the suite's client env (see build-for-e2e.mjs). Setting a
//      `NEXT_PUBLIC_*` var in Playwright's `webServer.env` has no effect on a
//      production server, because those values were inlined at build time.

import { spawn } from 'node:child_process';

/** Run a command to completion, rejecting on a non-zero exit. */
function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, ...env },
    });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
    );
  });
}

const forwarded = process.argv.slice(2);

try {
  console.log('\n[e2e] building with the suite\'s client env...\n');
  await run('node', ['scripts/e2e/build-for-e2e.mjs']);

  console.log('\n[e2e] running against the production server...\n');
  await run('npx', ['playwright', 'test', ...forwarded], {
    E2E_PRODUCTION_SERVER: '1',
  });
} catch (error) {
  console.error(`\n[e2e] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
