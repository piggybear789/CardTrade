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

import { expect, test, type Browser } from '@playwright/test';
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

    // THE REPAIR PATH IS RATE LIMITED TOO, and it is the one place that hurts most.
    //
    // `authLimiter` (lib/rateLimiters.ts) allows 5 attempts per minute keyed by IP
    // when nobody is signed in yet. This helper runs from `beforeAll` in most spec
    // files, so under `fullyParallel` several workers repair several members at the
    // same moment and trip it — and then the repair itself fails, leaving exactly the
    // stale jar it exists to fix. The spec carries on and its next context loads a
    // signed-out page, which surfaces far away as a missing control: `ensureSavedCard`
    // waiting forever for "Buy now" on a listing page rendered for a guest.
    //
    // Same treatment as auth.setup.ts: recognise the limiter's own message and back
    // off past its window rather than widening the limit for everyone.
    const rateLimited = page.getByRole('alert').filter({ hasText: /too many attempts/i });

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.getByRole('button', { name: 'Sign in' }).click();

      await expect
        .poll(
          async () =>
            /\/(listings|onboarding)/.test(new URL(page.url()).pathname)
              ? 'signed-in'
              : (await rateLimited.count()) > 0
                ? 'rate-limited'
                : 'pending',
          { timeout: 30_000 },
        )
        .not.toBe('pending');

      if (/\/(listings|onboarding)/.test(new URL(page.url()).pathname)) break;

      expect(
        attempt,
        `session repair for ${user.email} was rate limited twice — the cooldown did not help`,
      ).toBe(1);
      await page.waitForTimeout(65_000); // the limiter's 1m window, plus slack
    }

    await expect(page).toHaveURL(/\/(listings|onboarding)/, { timeout: 30_000 });

    await context.storageState({ path: statePath });
  } finally {
    await context.close();
  }
}

/**
 * {@link ensureFreshSession} for several members, in sequence.
 *
 * Raises the calling hook's budget, because a repair may have to sit out the auth
 * limiter's one-minute window (see the loop above) and several members are repaired
 * one after another. At the default 90s a rate-limited repair would be killed
 * mid-cooldown and reported as the hook hanging.
 */
export async function ensureFreshSessions(
  browser: Browser,
  users: readonly SeedUser[],
): Promise<void> {
  test.setTimeout(90_000 + users.length * 100_000);

  for (const user of users) {
    await ensureFreshSession(browser, user);
  }
}
