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

/** Safari/WebKit project. CI always runs it; locally it doubles wall-clock time
 *  against one `next dev` server (and is what made `npm run test:e2e` feel stuck).
 *  Opt in with `E2E_MOBILE=1`. */
const includeMobile = !!process.env.CI || process.env.E2E_MOBILE === '1';

/** Identical env for both server modes — see the note on the debug config. */
const SERVER_ENV = {
  PAYMENTS_PROVIDER: 'mock',
  ENABLE_PAYMENT_DEMO: 'true',
  // THE SIMULATED WEBHOOK MUST COME BACK TO *THIS* SERVER.
  //
  // `.env.local` sets `WEBHOOK_URL=http://localhost:3000/...` for a developer's normal
  // `npm run dev`, and this suite deliberately runs on 3100 so it never collides with
  // one. Without overriding it here, every demo webhook was POSTed to port 3000 —
  // nothing listening — so delivery failed silently and no trade could ever leave
  // COLLATERAL_PENDING.
  //
  // It was silent because `fireTradeWebhook`'s caller does not guard the delivery
  // failure: the panel showed no toast at all, so the room simply sat there. The
  // database told the real story — `pre_auth_holds` had both rows and `webhook_logs`
  // had none.
  //
  // Worth stating plainly: with this wrong, the whole webhook pipeline — the
  // translate -> map -> dispatch -> log path the demo controls exist to exercise — was
  // never being tested at all.
  WEBHOOK_URL: `http://localhost:${PORT}/api/webhooks/stripe`,
  // A DUMMY MAPS KEY PLUS AN INTERCEPTED PLACES API.
  //
  // Not a credential and never leaves the browser: tests/e2e/support/places.ts routes
  // every places.googleapis.com call to a deterministic stub. The key must merely be
  // PRESENT, because searchPlaces returns [] without one.
  //
  // This replaced blanking the key. Blanking gave PlacePicker its free-text fallback,
  // which made listing creation deterministic and made agreeing ANY contract
  // impossible - domain/fulfilment/terms.ts refuses a 	ext: place for a delivery
  // address or meeting point, so escrow settlement, shipping, receipt, acceptance,
  // release, disputes, fraud and the whole trade lifecycle sat behind one field.
  // Intercepting keeps the app's real autocomplete -> details -> PlaceValue path and
  // produces a resolved place the domain accepts.
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'e2e-intercepted-not-a-real-key',
  // SEVEN SEEDED MEMBERS SIGN IN FROM ONE ADDRESS DURING SETUP.
  //
  // `authLimiter` allows 5 per minute per IP (lib/rateLimiters.ts), so frank and
  // grace — the two staff accounts, and the last two in SEED_USERS — were
  // refused with "Too many attempts" and all 210 specs were skipped. The limit
  // is right; it is the suite that is unusual in logging seven people in from
  // one machine in ten seconds.
  //
  // Raised for THIS server only. The default stays 5 wherever the variable is
  // unset, which is everywhere else.
  AUTH_RATE_LIMIT_PER_MINUTE: '100',
  // ITS OWN BUILD DIRECTORY, so the suite never shares `.next` with a developer's
  // `next dev`. Sharing it put a production build under a running dev server and
  // surfaced as Tailwind stat-ing a file that a rename had moved
  // (`ENOENT ... app/offers/loading.tsx` while compiling `globals.css`) — a cache
  // collision wearing a stylesheet error's clothes.
  //
  // Must match `E2E_BUILD_DIR` in scripts/e2e/build-for-e2e.mjs: that script
  // builds there and this tells `next start` where to look. `next.config.ts`
  // reads the variable for `distDir`; `.next-*` is gitignored.
  NEXT_BUILD_DIR: '.next-e2e',
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
    ...(includeMobile
      ? [
          {
            // Real WebKit, not Chromium mobile-viewport emulation. Several
            // findings in ux-audit-findings.md are Safari-engine-specific.
            name: 'mobile',
            testMatch: /specs\/.*\.spec\.ts/,
            use: { ...devices['iPhone 14'] },
            dependencies: ['setup'],
          },
        ]
      : []),
  ],
});
