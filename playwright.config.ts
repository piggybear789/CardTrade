// playwright.config.ts
//
// THE AUDIT SUITE'S ONE CONFIG (.kiro/specs/e2e-ux-audit-suite, design "Servers",
// "Webhook_Source", "Projects"). Functional pathways plus the UX audit, against the dev
// sandbox (`cardtrade_dev`) and Stripe TEST mode.
//
// Three web servers, all started before any test:
//
//   main      `next start` on 3100, real Stripe test keys from `.env.local`. Every
//             Pathway that collects, holds, refunds or transfers money (Req 4.3), and
//             every other Pathway by default.
//   aux       `next start` on 3101, the mock provider, the default auth limit. Only
//             Pathways declared `provider: 'mock'` and the auth rate-limit Pathway
//             (Req 4.4). The only server with ALLOW_MOCK_PAYMENTS_IN_PRODUCTION.
//   webhooks  `stripeListen.mjs` forwarding both test platforms to 3100, ready when
//             GET :3199/ready answers 200 (Req 4.5).
//
// Both app servers serve the same production build in `.next-e2e`, made by
// `node scripts/e2e/build-for-e2e.mjs` (Req 4.1). There is no `next dev` mode any
// more: F5, F17 and F70 in tests/e2e/FINDINGS.md recorded what it cost. Every server's
// output passes through `scripts/e2e/scrubbed-server.mjs`, which masks secret values,
// client secrets and emails before Playwright prints a line (Req 32.1).
//
// Ports 3000 (a developer's `next dev`) and 3123 are never used here.
//
// Requirements: 1.1, 1.2, 1.3, 1.6, 3.1, 4.1, 4.3, 4.4, 4.6, 29.1, 35.2
import { defineConfig, devices } from '@playwright/test';
import { decidePreflight } from './tests/e2e/audit/core/preflight';
import { auxWebhookSecret, harnessEnvironment, readClientEnv, ship24WebhookSecret } from './tests/e2e/audit/harnessEnv';
import { describePreflightProblem } from './tests/e2e/audit/preflightMessages';
import { runId } from './tests/e2e/support/marker';
import { APP_SERVER_PORTS, SEED_CHECK_USERS, appServerUrl } from './tests/e2e/support/users';

/** The build-time overrides `build-for-e2e.mjs` bakes into the bundle (`E2E_CLIENT_ENV`). */
const CLIENT_ENV = readClientEnv(__dirname);

/** Port of the webhook forwarder's readiness endpoint. */
const WEBHOOK_READY_PORT = 3199;

const MAIN_PORT = APP_SERVER_PORTS.main;
const AUX_PORT = APP_SERVER_PORTS.aux;
const MAIN_URL = appServerUrl('main');
const AUX_URL = appServerUrl('aux');

// STATIC PREFLIGHT, at module load (Req 1.1, 1.2, 1.3, 1.6).
//
// Playwright starts every `webServer` before `globalSetup`, so a check that must
// stop a run before any server boots has to run here. It covers a bare
// `npx playwright test` as well as `npm run audit`.
//
// The environment checked is what the servers will see (`harnessEnvironment` in
// tests/e2e/audit/harnessEnv.ts, shared with the `preflight` project so both compose
// it in the same order and the client env fingerprint matches the build stamp).
//
// There is deliberately no flag, variable or CLI option that skips this. A live
// Stripe key anywhere aborts the run, and the message names the variable, never
// its value.
const HARNESS_ENV = harnessEnvironment(__dirname, CLIENT_ENV);
{
  const verdict = decidePreflight({
    harnessSchema: HARNESS_ENV.NEXT_PUBLIC_SUPABASE_SCHEMA?.trim() || undefined,
    env: HARNESS_ENV,
  });
  if (!verdict.ok) {
    throw new Error(
      'E2E preflight refused to start the run:\n' +
        verdict.problems.map((problem) => `  - ${describePreflightProblem(problem)}`).join('\n'),
    );
  }
}

/**
 * The run id. `runId()` reads `E2E_RUN_ID` or generates one and writes it back to
 * `process.env`, so the workers, the reporter and both app servers (which stamp it on
 * every Stripe object they create, design "Stripe metadata") agree on one value.
 */
const RUN_ID = runId();

/**
 * The main server's Ship24 bearer secret (`ship24WebhookSecret`): the configured one,
 * else the suite's fallback. Written back to `process.env` so the workers, which
 * inherit it, sign fixture deliveries (`backend/ship24.ts` reads it with `envValue`)
 * with the value the server verifies against.
 */
const SHIP24_SECRET = ship24WebhookSecret(HARNESS_ENV);
process.env.SHIP24_WEBHOOK_SECRET = SHIP24_SECRET;

/** Wraps a server command so its output is scrubbed before Playwright prints it. */
function scrubbed(command: string): string {
  return `node scripts/e2e/scrubbed-server.mjs ${command}`;
}

/** Environment both app servers share. */
const APP_SERVER_ENV = {
  // The same client overrides the build baked in, so the server's runtime view of
  // `NEXT_PUBLIC_*` matches the bundle, and `NEXT_BUILD_DIR` points `next start` at
  // `.next-e2e`, never the `.next` a developer's `next dev` uses.
  //
  // The Maps key is a dummy: tests/e2e/support/places.ts intercepts every
  // places.googleapis.com call with a deterministic stub, and the key need only be
  // PRESENT because searchPlaces returns [] without one.
  ...CLIENT_ENV,
  E2E_RUN_ID: RUN_ID,
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Four workers: Pathways run in parallel, each on its own personas and listings. A
  // developer can override it with E2E_WORKERS.
  workers: Number(process.env.E2E_WORKERS) || 4,
  // No retries in the dev loop. The full run (`npm run audit` with no filters sets
  // E2E_FULL_RUN=1) keeps one retry, so a Pathway that passes only on its retry is
  // reported as `flaky` by the audit reporter rather than hidden (Req 34.3).
  retries: process.env.E2E_FULL_RUN === '1' ? 1 : 0,
  // A multi-step Pathway that drives two members through a contract needs more than
  // Playwright's 30s default. An assertion that never resolves still fails.
  timeout: 90_000,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    [
      './tests/e2e/audit/reporter.ts',
      {
        runId: RUN_ID,
        servers: [
          { name: 'main', port: MAIN_PORT, paymentsMode: 'stripe-test' },
          { name: 'aux', port: AUX_PORT, paymentsMode: 'mock' },
        ],
        // The seed sets each member's `identity_check_name` to their display name.
        legalNames: SEED_CHECK_USERS.map((user) => user.displayName),
      },
    ],
  ],
  outputDir: './test-results',
  use: {
    baseURL: MAIN_URL,
    // Playwright traces cost about 100 MB and a long write per failure. Off unless
    // `E2E_TRACE=1` asks for them; the step screenshots, console logs and videos
    // already show each failure.
    trace: process.env.E2E_TRACE === '1' ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
    // Every context records, at the project's viewport, one video per member
    // (Req 29.1). Contexts a spec opens itself get `recordVideo` from the
    // `browser.newContext` patch in support/fixtures.ts.
    video: 'on',
  },
  globalSetup: './tests/e2e/support/globalSetup.ts',
  globalTeardown: './tests/e2e/support/globalTeardown.ts',
  webServer: [
    {
      name: 'main',
      command: scrubbed(`npx next start -p ${MAIN_PORT}`),
      url: MAIN_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...APP_SERVER_ENV,
        // Real Stripe TEST keys come from `.env.local`; the static preflight above has
        // already refused any live key. Named explicitly so an inherited
        // `PAYMENTS_PROVIDER=mock` cannot turn the main server into a mock.
        PAYMENTS_PROVIDER: 'stripe',
        // `auth.setup.ts` signs every seeded member in from one address, which the
        // production limit of 5 a minute refuses. Raised on THIS server only; the aux
        // server keeps the default for the rate-limit Pathway.
        AUTH_RATE_LIMIT_PER_MINUTE: '100',
        // Webhooks come back to THIS server (F20, Req 4.6). `.env.local` points
        // WEBHOOK_URL at 3000 for a developer's `npm run dev`.
        WEBHOOK_URL: `${MAIN_URL}/api/webhooks/stripe`,
        // The Ship24 fixture helper is its only sender (see `ship24WebhookSecret`).
        SHIP24_WEBHOOK_SECRET: SHIP24_SECRET,
      },
    },
    {
      name: 'aux',
      command: scrubbed(`npx next start -p ${AUX_PORT}`),
      url: AUX_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...APP_SERVER_ENV,
        PAYMENTS_PROVIDER: 'mock',
        // ESC-16: `next start` refuses the mock without this. Set on the aux server
        // only (Req 4.4).
        ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: 'true',
        ENABLE_PAYMENT_DEMO: 'true',
        // Mock webhooks are refused without a secret (there is no default).
        WEBHOOK_SECRET: auxWebhookSecret(HARNESS_ENV),
        // The default limit of 5 a minute. Blank rather than absent so a value
        // inherited from the shell cannot raise it (lib/rateLimiters.ts reads a
        // non-positive number as the default).
        AUTH_RATE_LIMIT_PER_MINUTE: '',
        WEBHOOK_URL: `${AUX_URL}/api/webhooks/stripe`,
      },
    },
    {
      name: 'webhooks',
      command: scrubbed(`node scripts/dev/stripeListen.mjs ${MAIN_PORT} --ready-port ${WEBHOOK_READY_PORT}`),
      url: `http://localhost:${WEBHOOK_READY_PORT}/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
  projects: [
    {
      // Server probes, the Coverage_Map check, seed rows and account flags
      // (design "Safety preflight"). Every other project depends on it.
      name: 'preflight',
      testMatch: /audit[\\/]preflight\.setup\.ts$/,
      fullyParallel: false,
    },
    {
      // Sign-in on both servers, then Stripe test bindings for the seed members.
      name: 'setup',
      testMatch: [/[\\/]auth\.setup\.ts$/, /audit[\\/]stripe-bindings\.setup\.ts$/],
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['preflight'],
    },
    {
      name: 'desktop',
      testMatch: /specs[\\/].*\.spec\.ts$/,
      grepInvert: /@aux|@isolated/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
    {
      // Real WebKit, not Chromium viewport emulation: several findings in
      // ux-audit-findings.md are Safari-engine-specific. Always runs.
      name: 'phone',
      testMatch: /specs[\\/].*\.spec\.ts$/,
      grepInvert: /@aux|@isolated/,
      use: { ...devices['iPhone 14'] },
      dependencies: ['setup'],
    },
    {
      name: 'desktop-aux',
      testMatch: /specs[\\/].*\.spec\.ts$/,
      grep: /@aux/,
      grepInvert: /@isolated/,
      use: { ...devices['Desktop Chrome'], baseURL: AUX_URL },
      dependencies: ['setup'],
    },
    {
      name: 'phone-aux',
      testMatch: /specs[\\/].*\.spec\.ts$/,
      grep: /@aux/,
      grepInvert: /@isolated/,
      use: { ...devices['iPhone 14'], baseURL: AUX_URL },
      dependencies: ['setup'],
    },
    {
      // Pathways that change state other Pathways read (a fraud ban, an exhausted
      // shared limit). They run after everything else instead of serialising the
      // whole suite. A Pathway here that needs the aux server addresses it through
      // `appServerUrl('aux')`.
      name: 'isolated',
      testMatch: /specs[\\/].*\.spec\.ts$/,
      grep: /@isolated/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['desktop', 'phone', 'desktop-aux', 'phone-aux'],
    },
  ],
});
