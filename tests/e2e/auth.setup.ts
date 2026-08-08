// tests/e2e/auth.setup.ts
//
// Logs in each seeded user once via the real AuthForm and saves the resulting
// session as a storageState file, so the 26 downstream specs authenticate by
// loading a cookie jar instead of re-submitting the sign-in form 100+ times.
// @supabase/ssr keeps the session in cookies (not localStorage), and
// middleware.ts refreshes+rewrites those cookies on every protected
// navigation, so a stored session behaves exactly like a real browser's
// cookie jar for as long as this suite runs.
import { test as setup, expect } from '@playwright/test';
import { SEED_USERS, storageStatePath } from './support/users';

for (const user of SEED_USERS) {
  setup(`authenticate as ${user.email}`, async ({ page }) => {
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
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Fail with the real reason if the handler still did not run, rather than
    // reporting a generic redirect timeout thirty seconds later.
    await expect(
      page,
      'the form submitted natively as GET — hydration had not completed (see F15)',
    ).not.toHaveURL(/[?&]password=/);

    // AuthForm redirects to /listings (or a preserved redirectTo) on success.
    await expect(page).toHaveURL(/\/(listings|onboarding)/, { timeout: 20_000 });

    await page.context().storageState({ path: storageStatePath(user) });
  });
}
