// tests/e2e/support/auth.ts
//
// Keeping a stored session usable for the length of a full run.
//
// THE PROBLEM. `auth.setup.ts` signs each seeded member in once and saves a cookie
// jar. Specs load that jar instead of re-submitting the sign-in form a hundred
// times, which is the right trade — but the jar is a SNAPSHOT of a rotating
// credential. This project has `refresh_token_rotation_enabled = true` with a
// `security_refresh_token_reuse_interval` of 10 seconds (read from the project's auth
// config). When `@supabase/ssr` refreshes, the used refresh token is retired and its
// replacement is written to that ONE browser context — the file on disk still holds
// the old one. Every later context replays the retired token, and a replay outside
// the 10-second window is treated as theft, which revokes the whole token family.
//
// The symptom is nasty because it is time-dependent rather than logical: nineteen
// tests across six files failed in a ~15 minute full run and every one of those files
// passed on its own, because a per-file run re-authenticates seconds beforehand. It
// cost two wrong diagnoses — `next dev` degrading under load (disproved: identical
// failures against a production build) and a sign-out test revoking the shared
// session (disproved: fixing it changed nothing).
//
// THE FIX is not to explain every revocation but to stop depending on the jar staying
// valid. `ensureFreshSession` checks it and re-signs-in if it has gone stale,
// rewriting the file. Cheap when the jar is good (one navigation), self-healing when
// it is not, and it covers every cause — rotation, expiry, an accidental sign-out, a
// member deleted and reseeded.

import { expect, type Browser } from '@playwright/test';
import { storageStatePath, type SeedUser } from './users';

/**
 * Make sure the stored cookie jar for `user` still authenticates, re-signing in if
 * it does not.
 *
 * Call from `test.beforeAll` in any spec that authenticates from a stored jar. It
 * rewrites `playwright/.auth/<user>.json`, so contexts created afterwards — whether
 * by `test.use({ storageState })` or `browser.newContext` — pick up the repair.
 *
 * `/profile` is the probe because it is protected, cheap, and has no side effects;
 * middleware bounces an unauthenticated visitor to `/sign-in`, which is the whole
 * signal needed.
 */
export async function ensureFreshSession(browser: Browser, user: SeedUser): Promise<void> {
  const statePath = storageStatePath(user);

  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();
  try {
    await page.goto('/profile');
    if (!/\/sign-in/.test(page.url())) {
      // Still good. Re-save so this context's freshly rotated token replaces the
      // retired one on disk, which is what stops the next context replaying it.
      await context.storageState({ path: statePath });
      return;
    }

    // Stale — sign in again and overwrite the jar.
    await page.goto('/sign-in');
    // Wait for scripts: the submit is a JS handler and the button is disabled until
    // the form hydrates (see F15).
    await page.waitForLoadState('load');
    const emailField = page.getByLabel('Email');
    await expect(emailField).toBeEditable({ timeout: 15_000 });
    await emailField.fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/(listings|onboarding)/, { timeout: 30_000 });

    await context.storageState({ path: statePath });
  } finally {
    await context.close();
  }
}

/** {@link ensureFreshSession} for several members, in sequence. */
export async function ensureFreshSessions(
  browser: Browser,
  users: readonly SeedUser[],
): Promise<void> {
  for (const user of users) {
    await ensureFreshSession(browser, user);
  }
}
