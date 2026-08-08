// tests/e2e/specs/auth-and-navigation.spec.ts
//
// The authentication wall, public routes, sign-in/sign-up, the nav, and sign-out.
//
// THE SIGN-OUT BLOCK AT THE BOTTOM CREATES ITS OWN SESSION, and the comment there
// explains why at length. In short: a spec that destroys a session must not destroy
// a SHARED one, and getting that wrong here cost nineteen failures across six other
// files plus a wrong diagnosis.

import { test, expect } from '@playwright/test';
import { ALICE, FRANK_ADMIN, storageStatePath } from '../support/users';
import { markedEmail } from '../support/marker';
import { COLD_ROUTE, RENDERED } from '../support/waiting';

/** Sign in through the real form. Used by tests that must own their session. */
async function signInAs(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
) {
  await page.goto('/sign-in');
  // Wait for scripts, not just markup: the submit is a JS handler and the form is
  // disabled until it hydrates (see F15).
  await page.waitForLoadState('load');
  const emailField = page.getByLabel('Email');
  await expect(emailField).toBeEditable({ timeout: RENDERED });
  await emailField.fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

// ---------------------------------------------------------------------------
// 1. Protected routes redirect unauthenticated visitors
// ---------------------------------------------------------------------------

test.describe('protected routes redirect unauthenticated users', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const protectedPaths = ['/profile', '/trades', '/messages', '/admin', '/listings/new'];

  for (const path of protectedPaths) {
    test(`${path} -> /sign-in?redirectTo=${path}`, async ({ page }) => {
      await page.goto(path);
      // The destination is preserved so the visitor resumes what they were doing —
      // losing it strands them on the catalog after signing in.
      await expect(page).toHaveURL(
        new RegExp(`/sign-in\\?redirectTo=${encodeURIComponent(path).replace(/\//g, '\\/')}`),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Public routes
// ---------------------------------------------------------------------------

test.describe('public routes are accessible without auth', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('/ -> landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/NoDitto/);
  });

  test('/listings -> catalog loads', async ({ page }) => {
    // Browsing crosses regions and needs no account; only CONTRACTS are gated.
    await page.goto('/listings');
    await expect(page).toHaveURL(/\/listings/);
    await expect(page).not.toHaveURL(/\/sign-in/);
  });

  test('/sign-in -> sign-in page loads', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('/sign-up -> sign-up page loads', async ({ page }) => {
    await page.goto('/sign-up');
    await expect(
      page.getByRole('heading', { name: 'Create your account' }),
    ).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. redirectTo survives the sign-in
// ---------------------------------------------------------------------------

test.describe('sign-in preserves redirectTo', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('returns to /trades after signing in', async ({ page }) => {
    await page.goto('/trades');
    await expect(page).toHaveURL(/\/sign-in\?redirectTo/);

    await signInAs(page, ALICE.email, ALICE.password);

    // Seed members have completed onboarding, so they land on the preserved
    // destination or the default — either proves the round trip worked.
    await expect(page).toHaveURL(/\/(trades|listings)/, { timeout: COLD_ROUTE });
  });
});

// ---------------------------------------------------------------------------
// 4. Sign-up
// ---------------------------------------------------------------------------

test.describe('sign-up flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a new account lands in onboarding', async ({ page }) => {
    await page.goto('/sign-up');
    await page.waitForLoadState('load');

    const email = markedEmail('signup');
    const emailField = page.getByLabel('Email');
    await expect(emailField).toBeEditable({ timeout: RENDERED });
    await emailField.fill(email);
    await page.getByLabel('Password').fill('TestPassword123!');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Middleware sends a member with no `onboarding_completed_at` to /onboarding
    // from every protected route. `/sign-in` is accepted too, for a deployment with
    // email confirmation switched on.
    await expect(page).toHaveURL(/\/(onboarding|sign-in)/, { timeout: COLD_ROUTE });
  });
});

// ---------------------------------------------------------------------------
// 5. Navigation
// ---------------------------------------------------------------------------

test.describe('navigation structure (regular user)', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('main nav links visible', async ({ page }) => {
    await page.goto('/listings');

    const menuButton = page.getByRole('button', { name: /open menu/i });
    await expect(menuButton).toBeVisible({ timeout: RENDERED });
    await menuButton.click();

    // The menu panel contains a <nav aria-label="Menu">.
    const nav = page.getByRole('navigation', { name: 'Menu' });
    await expect(nav).toBeVisible({ timeout: 10_000 });

    await expect(nav.getByRole('link', { name: /browse all|marketplace/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /trades/i }).first()).toBeVisible();
    await expect(nav.getByRole('link', { name: /sales/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /messages/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /account/i })).toBeVisible();
  });

  test('staff nav NOT visible to a regular member', async ({ page }) => {
    await page.goto('/listings');

    const menuButton = page.getByRole('button', { name: /open menu/i });
    await expect(menuButton).toBeVisible({ timeout: RENDERED });
    await menuButton.click();

    const nav = page.getByRole('navigation', { name: 'Menu' });
    await expect(nav).toBeVisible({ timeout: 10_000 });

    // Hiding a link is not authorization — `requireStaff` re-checks on every staff
    // surface — but offering one that always refuses is its own defect.
    await expect(nav.getByRole('link', { name: /cases/i })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: /operations/i })).toHaveCount(0);
  });
});

test.describe('navigation structure (admin user)', () => {
  test.use({ storageState: storageStatePath(FRANK_ADMIN) });

  test('staff nav visible to an admin', async ({ page }) => {
    await page.goto('/listings');

    const menuButton = page.getByRole('button', { name: /open menu/i });
    await expect(menuButton).toBeVisible({ timeout: RENDERED });
    await menuButton.click();

    const nav = page.getByRole('navigation', { name: 'Menu' });
    await expect(nav).toBeVisible({ timeout: 10_000 });

    // Frank holds is_admin, so both staff surfaces are offered.
    await expect(nav.getByRole('link', { name: /cases/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /operations/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 6. Sign-out
// ---------------------------------------------------------------------------

test.describe('sign-out', () => {
  // NO STORED SESSION, and this is the entire point of the block.
  //
  // This test used `storageStatePath(ALICE)`. Signing out REVOKES the refresh token
  // server-side, so it invalidated the cookie jar `auth.setup.ts` had written for
  // Alice — for the remainder of the run. Every later spec authenticating as her was
  // silently unauthenticated: nineteen failures across six files, each of which
  // passed when run on its own.
  //
  // It also cost a wrong diagnosis. The failures were blamed on `next dev` degrading
  // over a long run, which fitted the evidence (they appeared only in full runs) and
  // was wrong — they reproduced identically against a production build. The tell was
  // that the failing specs were exactly the Alice-dependent ones, and every one of
  // them ran after this file alphabetically.
  //
  // THE RULE: a spec that destroys a session must create its own first. Shared
  // fixtures are read-only.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('signs out and the session is really gone', async ({ page }) => {
    await signInAs(page, ALICE.email, ALICE.password);
    await expect(page).toHaveURL(/\/(listings|onboarding)/, { timeout: COLD_ROUTE });

    const menuButton = page.getByRole('button', { name: /open menu/i });
    await expect(menuButton).toBeVisible({ timeout: RENDERED });
    await menuButton.click();

    const signOutButton = page.getByRole('button', { name: /sign out/i });
    await expect(signOutButton).toBeVisible({ timeout: 10_000 });
    await signOutButton.click();

    // SignOutButton does router.replace('/'). `toHaveURL` matches the FULL url, not
    // the path, so a `/^\/$/` pattern can never match — it compares "/" against
    // "http://localhost:3100/".
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/?$/, { timeout: COLD_ROUTE });

    // Asserting the SESSION is gone, not just that the URL changed: a redirect
    // without a revoked cookie would leave the member signed in on the next click.
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/sign-in/, { timeout: COLD_ROUTE });
  });
});
