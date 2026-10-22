// playwright.stripe.config.ts
//
// The Pay step against REAL Stripe TEST mode, in a browser: the bank rails (0158) as a
// buyer meets them, including Stripe's own bank approval pages and the redirect back
// into the contract room. The main config forces `PAYMENTS_PROVIDER=mock`, which
// settles every payment by itself and so cannot show that a real bank payment works.
//
//   npx playwright test -c playwright.stripe.config.ts
//
// Opt-in and separate on purpose: it needs the TEST keys in `.env.local`, it makes real
// test-mode API calls, and it temporarily re-points two seeded members at real Stripe
// test objects (restored after the run). Its own port and build directory, so it never
// shares a server or `.next` with the mock suite or a developer's `npm run dev`.
import { defineConfig, devices } from '@playwright/test';

const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [['list']],
  outputDir: './test-results/stripe',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  globalSetup: './tests/e2e/support/globalSetup.ts',
  globalTeardown: './tests/e2e/support/globalTeardown.ts',
  webServer: {
    command: `npm run dev -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PAYMENTS_PROVIDER: 'stripe',
      ENABLE_PAYMENT_DEMO: 'false',
      // Same reasons as the main config: a deterministic Places stub, a raised sign-in
      // limit for seven seeded members on one IP, and a build directory of its own.
      NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'e2e-intercepted-not-a-real-key',
      AUTH_RATE_LIMIT_PER_MINUTE: '100',
      NEXT_BUILD_DIR: '.next-e2e-stripe',
    },
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/, fullyParallel: false },
    {
      name: 'stripe',
      testMatch: /stripe\/.*\.stripe\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
});
