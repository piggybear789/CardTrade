// playwright.config.ts
//
// Functional + visual regression suite for the whole app (see
// tests/e2e/README.md... actually: see the plan this suite was built from,
// ux-audit-findings.md for the severity-scale convention it feeds).
//
// Runs its own Next dev server on a port distinct from a developer's normal
// `npm run dev` (3100, not 3000) so this suite never collides with, or is
// mistaken for, a regular dev session. PAYMENTS_PROVIDER is forced to `mock`
// for that server only — never for a developer's own `npm run dev` — because
// the checked-in .env.local sets PAYMENTS_PROVIDER=stripe, under which
// IdentityDemoControls/CashSaleDemoControls/DemoPanel render nothing
// (isPaymentDemoEnabled() in domain/services/providerMode.ts).
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Serve a PRODUCTION build instead of `next dev`.
 *
 * `E2E_PRODUCTION_SERVER=1 npm run test:e2e` (and always in CI). Requires
 * `npm run build` first — the command below only starts what is already built, so a
 * stale or missing `.next` fails loudly instead of silently testing old code.
 *
 * WHY IT MATTERS, and it is not only speed. `next dev` compiles each route on its
 * first request and holds the compiler in-process, which caused two distinct
 * problems the suite had to work around:
 *
 *   * A first visit to `/messages/[id]` or `/sales/[id]` took 15–25s, so specs carry
 *     20–30s navigation budgets. Those exist purely to out-wait a compile, and one
 *     early spec drew the wrong conclusion from a shorter wait — it recorded that
 *     sending a message "does not navigate" when the push was simply queued behind a
 *     cold route.
 *   * Across a long serial run the server degraded until unrelated specs failed
 *     together: `locator.check()` timing out after 90s on a radio, `ECONNRESET`, pages
 *     rendering nothing. The same files passed per-file against a fresh server.
 *
 * A production server has neither: routes are prebuilt, nothing recompiles, and the
 * Next dev-tools overlay — which injects a control whose accessible name matches
 * "Next" and has already stolen one click from a wizard — is not present.
 *
 * Kept OPT-IN rather than made the default because every spec here was verified
 * against `next dev`, and swapping the server under a green suite without re-verifying
 * would trade a known problem for an unknown one.
 */
const useProductionServer = process.env.E2E_PRODUCTION_SERVER === '1' || !!process.env.CI;

/** Identical env for both server modes — see the note on the debug config. */
const SERVER_ENV = {
  PAYMENTS_PROVIDER: 'mock',
  ENABLE_PAYMENT_DEMO: 'true',
  // FORCE THE PLACEPICKER'S FREE-TEXT FALLBACK, deliberately.
  //
  // `Based near` is a REQUIRED field on the listing form, so a spec that creates a
  // listing has to fill it. With a Maps key present the field is a Google Places
  // Autocomplete: results arrive over the network, the listbox options are
  // provider-rendered, and clicking one hung the run for the full test timeout.
  // Driving that reliably would mean depending on a live Google response inside
  // every listing test.
  //
  // With no key, `PlacePicker` renders a plain input whose onChange produces a
  // complete PlaceValue (`placeId: 'text:<label>'`). That is not a test-only shim —
  // it is the app's own documented no-key path, so the form, the validator and the
  // action all run exactly as they do in production.
  //
  // ACCEPTED COVERAGE GAP, and a large one: fulfilment terms REFUSE a `text:` place
  // (`domain/fulfilment/terms.ts`), so no contract needing a delivery address or a
  // meeting point can be agreed in this configuration. Six steps of
  // cash-sale.spec.ts are `test.fixme` for that reason and the trade lifecycle is
  // out of reach entirely. See F13 in tests/e2e/FINDINGS.md.
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: '',
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // PER-TEST BUDGET, raised from Playwright's 30s default on purpose.
  //
  // This suite drives `next dev`, which compiles a route on its first request. A
  // first visit to `/messages/[id]` or `/sales/[id]` can take 15–25s on its own,
  // and specs allow for that with generous navigation waits (`COLD_ROUTE`). At the
  // default those waits were the same length as the whole test, so a test could be
  // killed mid-wait and report "Test ended" — which reads as the app hanging
  // rather than as the budget being too small. A multi-step flow that visits two
  // cold routes needs more than either number alone.
  //
  // Not a licence to let real hangs pass: an assertion that genuinely never
  // resolves still fails, just later.
  timeout: 90_000,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }], ['list']],
  outputDir: './test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  globalSetup: './tests/e2e/support/globalSetup.ts',
  globalTeardown: './tests/e2e/support/globalTeardown.ts',
  webServer: {
    command: useProductionServer
      ? `npm run start -- -p ${PORT}`
      : `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: SERVER_ENV,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      fullyParallel: false,
    },
    {
      name: 'desktop',
      testMatch: /specs\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      // Real WebKit, not Chromium mobile-viewport emulation: several open
      // findings in ux-audit-findings.md (e.g. F19 iOS Safari input-zoom,
      // F24 touch/pointer semantics) are Safari-engine-specific, so Chromium
      // emulation would silently pass on exactly the bugs this project exists
      // to catch.
      name: 'mobile',
      testMatch: /specs\/.*\.spec\.ts/,
      use: { ...devices['iPhone 14'] },
      dependencies: ['setup'],
    },
  ],
});
