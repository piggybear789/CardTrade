// playwright.debug.config.ts
//
// DEVELOPMENT TOOL, not part of the suite. Runs `tests/e2e/debug/**` only, which
// prints each page's real accessible tree so specs are written against what the
// app renders instead of against what its source suggested it would render.
//
// It reuses the main config's dev server (port 3100, PAYMENTS_PROVIDER=mock) and
// the same storageState files the `setup` project writes, so run the real suite's
// setup project at least once first:
//
//   npx playwright test --project=setup
//   npx playwright test --config=playwright.debug.config.ts --grep "payouts"
//
// Deliberately NO globalSetup/globalTeardown: the inspector only reads pages, and
// running marker cleanup around a read would add a minute to every look.
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e/debug',
  // One at a time: the output is read by a human, and interleaved dumps from
  // parallel workers are unreadable.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  outputDir: './test-results-debug',
  // Matches the main suite's budget: the inspector drives the same cold-compiling
  // dev server, and some probes create a listing before they can look at anything.
  timeout: 120_000,
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
    // MUST STAY BYTE-IDENTICAL TO playwright.config.ts.
    //
    // Both configs use port 3100 with `reuseExistingServer`, so whichever ran first
    // owns the server the other one then inherits. When these env blocks differed,
    // the app behaved differently depending on the order the two configs happened to
    // be invoked in — which is the worst kind of difference to debug, because
    // nothing in the failing run mentions the other config.
    //
    // Concretely: this file originally omitted `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, so
    // under the inspector `Based near` rendered as a Places autocomplete instead of
    // the free-text fallback. Typing into it left the field `[invalid]` ("Add where
    // this listing is based"), because free text does not resolve to a PlaceValue in
    // that variant. Every probe that created a listing failed — and had a developer
    // run the inspector first, the real suite would then have inherited a
    // Maps-enabled server and failed the same way for the same invisible reason.
    env: {
      PAYMENTS_PROVIDER: 'mock',
      ENABLE_PAYMENT_DEMO: 'true',
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: '',
    },
  },
});
