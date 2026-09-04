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
import { isSignedInDestination } from './support/auth';
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
// TWO DEFENCES, deliberately. The limit stays 5 in production because it is real
// behaviour worth keeping; the suite's own server raises it to 100/min via
// `AUTH_RATE_LIMIT_PER_MINUTE` (see `playwright.config.ts`), which is what makes a
// serial run of SEED_USERS pass. The cooldown below is the backstop for a run against
// a server without that override — it recognises the limiter's own message and waits
// out its window rather than exempting the credential path from its own protection.
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
      //
      // Both branches go through `isSignedInDestination`, the same predicate the final
      // assertion below uses. A regex on `/\/(listings|onboarding)/` used to stand here
      // and is now wrong: the catalog moved to `/` and `next.config.ts` permanently
      // redirects `/listings`, so it never matches a successful sign-in and the poll
      // would report one as 'pending' until it timed out.
      const rateLimited = page.getByRole('alert').filter({ hasText: RATE_LIMIT_MESSAGE });
      const signedIn = () => isSignedInDestination(new URL(page.url()));

      await expect
        .poll(
          async () =>
            signedIn()
              ? 'signed-in'
              : (await rateLimited.count()) > 0
                ? 'rate-limited'
                : 'pending',
          { timeout: 20_000 },
        )
        .not.toBe('pending');

      if (signedIn()) break;

      expect(attempt, 'sign-in was rate limited twice — the cooldown did not help').toBe(1);
      await page.waitForTimeout(RATE_LIMIT_COOLDOWN_MS);
    }

    await expect(page).toHaveURL(isSignedInDestination, { timeout: 20_000 });

    await page.context().storageState({ path: storageStatePath(user) });
  });
}
