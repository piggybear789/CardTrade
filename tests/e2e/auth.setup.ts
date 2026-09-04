// tests/e2e/auth.setup.ts
//
// Logs in each seeded user once via the real AuthForm and saves the resulting
// session as a storageState file, so the 26 downstream specs authenticate by
// loading a cookie jar instead of re-submitting the sign-in form 100+ times.
// @supabase/ssr keeps the session in cookies (not localStorage), and
// proxy.ts refreshes+rewrites those cookies on every protected
// navigation, so a stored session behaves exactly like a real browser's
// cookie jar for as long as this suite runs.
import { test as setup, expect } from '@playwright/test';
import { SEED_USERS, storageStatePath } from './support/users';

// THE SIGN-IN RATE LIMITER APPLIES TO THIS SUITE TOO, and it is not incidental.
//
// `authLimiter` (lib/rateLimiters.ts) allows 5 attempts per minute, keyed by IP when
// nobody is signed in yet (rateLimitIdentifier falls back to `ip:`). This project logs
// in SEED_USERS serially from one address, so the 6th and 7th logins — frank and grace,
// the two staff personas — were refused with "Too many attempts", their storageState
// files were never written, and because `desktop` and `mobile` both declare
// `dependencies: ['setup']`, all 210 remaining tests were reported as "did not run".
//
// Deterministic, and it presents as an app bug rather than a budget: the failure is a
// URL assertion timing out on /sign-in, with the real reason only visible in the page
// snapshot.
//
// Fixed HERE rather than by raising the limit or exempting the suite, because the limit
// is real behaviour worth exercising, and an exemption would mean the one credential
// path most worth protecting is the one path never tested with its protection on.
const RATE_LIMIT_MESSAGE = /too many attempts/i;
const RATE_LIMIT_COOLDOWN_MS = 65_000; // the limiter's 1m window, plus slack

for (const user of SEED_USERS) {
  setup(`authenticate as ${user.email}`, async ({ page }) => {
    // A cooldown can consume a whole minute on top of the sign-in itself.
    setup.setTimeout(180_000);

    await page.goto('/sign-in');

    // WAIT FOR SCRIPTS, not just for the markup. `AuthForm` is a Client Component
    // whose submit is handled in JS; the <form> carries no `action`, so a submit
    // that lands BEFORE hydration degrades to a native GET against the current URL.
    // Observed once as a setup failure landing on
    // `/sign-in?email=alice%40example.com&password=password123` — the credentials
    // serialised into the query string. `domcontentloaded` is not enough for this
    // and `toBeEditable()` is not either: an input is editable before React has
    // attached anything to the form.
    await page.waitForLoadState('load');

    const emailInput = page.getByLabel('Email');
    await expect(emailInput).toBeEditable({ timeout: 15_000 });

    await emailInput.fill(user.email);
    await page.getByLabel('Password').fill(user.password);

    // Two attempts is enough: a cooldown outlasts the limiter's whole window, so a
    // second refusal means something other than throttling.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.getByRole('button', { name: 'Sign in' }).click();

      // Fail with the real reason if the handler still did not run, rather than
      // reporting a generic redirect timeout thirty seconds later.
      await expect(
        page,
        'the form submitted natively as GET — hydration had not completed (see F15)',
      ).not.toHaveURL(/[?&]password=/);

      // Race the success redirect against the limiter's own error, so a refusal is
      // recognised in a second instead of after the 20s URL budget expires.
      const rateLimited = page.getByRole('alert').filter({ hasText: RATE_LIMIT_MESSAGE });
      await expect
        .poll(
          async () =>
            /\/(listings|onboarding)/.test(new URL(page.url()).pathname)
              ? 'signed-in'
              : (await rateLimited.count()) > 0
                ? 'rate-limited'
                : 'pending',
          { timeout: 20_000 },
        )
        .not.toBe('pending');

      if (/\/(listings|onboarding)/.test(new URL(page.url()).pathname)) break;

      expect(attempt, 'sign-in was rate limited twice — the cooldown did not help').toBe(1);
      await page.waitForTimeout(RATE_LIMIT_COOLDOWN_MS);
    }

    // AuthForm redirects to /listings (or a preserved redirectTo) on success.
    await expect(page).toHaveURL(/\/(listings|onboarding)/, { timeout: 20_000 });

    await page.context().storageState({ path: storageStatePath(user) });
  });
}
