// tests/e2e/specs/onboarding.spec.ts
//
// The one-time member onboarding wizard, and specifically the write that was
// broken: `profiles.region_code`.
//
// WHAT THIS GUARDS. 0065 added `profiles.region_code` but never granted UPDATE
// on the column to `authenticated`. `setTradingRegion` writes through the
// cookie-bound client, so the write was refused by column privilege, the action
// fell into its `persistence-error` branch, and the step showed "Your region
// could not be saved. Please retry." Retrying could not help.
//
// The picker is gone — Australia is the only live region and is written
// silently on Continue — but the grant still has to hold. Asserting only
// "the wizard finished" would also pass if the write failed and the step were
// later changed to continue regardless.
//
// THIS TEST MUST SIGN UP A NEW MEMBER. It cannot use a seeded one: onboarding
// runs once, every fixture profile already has `onboarding_completed_at` set,
// and the 0070 trigger refuses clearing a region by design.
//
// The account is created with `markedEmail()` so teardown removes it and its
// auth user (`scripts/e2e/cleanup-test-data.ts` matches `profiles.contact_email`
// on `e2e-`).

import type { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { marked, markedEmail } from '../support/marker';
import { COLD_ROUTE, RENDERED } from '../support/waiting';
import { deleteRows, profileIdByEmail, selectRows } from '../support/db';

/** Signing up must not inherit a seeded session. */
test.use({ storageState: { cookies: [], origins: [] } });

async function signUpOntoOnboarding(page: Page, email: string) {
  await page.goto('/sign-up');
  await page.waitForLoadState('domcontentloaded');

  const emailField = page.getByLabel('Email');
  await expect(emailField).toBeEditable({ timeout: RENDERED });
  await emailField.fill(email);
  await page.getByLabel('Password').fill('TestPassword123!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });
}

async function passWelcome(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Welcome to NoDitto' }),
  ).toBeVisible({ timeout: RENDERED });
  await page.getByRole('button', { name: /accept the rules/i }).click();
  await expect(
    page.getByRole('heading', { name: 'Choose a name' }),
  ).toBeVisible({ timeout: RENDERED });
}

async function regionCodeForEmail(email: string): Promise<string | null> {
  const rows = await selectRows<{ region_code: string | null }>(
    'profiles',
    `select=region_code&contact_email=eq.${encodeURIComponent(email)}`,
  );
  return rows[0]?.region_code ?? null;
}

test.describe('Onboarding', () => {
  test('a new member can finish and is written to Australia', async ({ page }) => {
    const email = markedEmail('onboarding');

    await signUpOntoOnboarding(page, email);

    await expect(page.getByText(/the ban follows you/i)).toBeVisible({
      timeout: RENDERED,
    });
    await passWelcome(page);
    await page.getByPlaceholder(/PokeTrader99/).fill(marked('Onboarder'));
    await page.getByRole('button', { name: /^Continue|^Saving/ }).click();

    // THE REGRESSION ASSERTION, stated as the absence of the exact copy the bug
    // produced. The region is no longer chosen on screen, but the write still
    // has to land.
    await expect(page.getByText(/could not be saved/i)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });
    expect(await regionCodeForEmail(email)).toBe('AU');
  });

  test('the wizard does not offer a region picker', async ({ page }) => {
    const email = markedEmail('regionchoices');

    await signUpOntoOnboarding(page, email);
    await expect(
      page.getByRole('heading', { name: 'Welcome to NoDitto' }),
    ).toBeVisible({ timeout: RENDERED });

    // A region in REGIONS is BROWSABLE; only `tradingEnabled` makes it
    // TRADEABLE. There is no picker: Australia is assigned on Continue. A
    // visible GB tile here would mean a member could pick a jurisdiction the
    // platform cannot settle in.
    await expect(page.getByRole('button', { name: /^Australia/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^United Kingdom/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Great Britain/ })).toHaveCount(0);

    await passWelcome(page);
    await expect(page.getByRole('button', { name: /^Australia/ })).toHaveCount(0);
  });

  test('an unfinished member is sent back to the wizard from the catalog', async ({
    page,
  }) => {
    const email = markedEmail('browsefirst');

    await signUpOntoOnboarding(page, email);

    // Deliberately WITHOUT finishing the wizard.
    await page.goto('/listings');
    await expect(page).toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });

    await page.goto('/offers');
    await expect(page).toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });
  });

  test('the wizard has no guest escape', async ({ page }) => {
    const email = markedEmail('escapehatch');

    await signUpOntoOnboarding(page, email);

    const wizard = page.getByRole('dialog');
    await expect(wizard.getByRole('button', { name: /sign out/i })).toHaveCount(0);
    await expect(wizard.getByRole('link', { name: /browse listings/i })).toHaveCount(0);

    await passWelcome(page);
    await expect(wizard.getByRole('button', { name: /sign out/i })).toHaveCount(0);
    await expect(wizard.getByRole('link', { name: /browse listings/i })).toHaveCount(0);
  });

  test('onboarding still completes when the member has no profile row', async ({
    page,
  }) => {
    // THE BUG THIS PINS. A profile row is created at sign-up and at the OAuth
    // callback, and nothing repaired one that went missing afterwards. An
    // already-signed-in member never passes through the callback again, so they
    // were sent here to onboard, the UPDATE matched zero rows, and `.single()`
    // reported PostgREST's "Cannot coerce the result to a single JSON object"
    // — shown verbatim, on a screen with no way to browse or sign out.
    //
    // Deleting the row is the only honest way to arrange this: no screen can
    // do it, which is exactly why the state went untested.
    const email = markedEmail('noprofile');

    await signUpOntoOnboarding(page, email);

    const profileId = await profileIdByEmail(email);
    expect(profileId, 'sign-up should have created a profile to delete').toBeTruthy();

    const removed = await deleteRows('profiles', `id=eq.${profileId}`);
    expect(removed).toBe(1);
    expect(await profileIdByEmail(email)).toBeNull();

    // Now walk the wizard. The session is still valid; only the row is gone.
    //
    // THE REPAIR IS ASSERTED AT LOAD, not at the end. Writing the repair into
    // `completeOnboarding` alone was not enough and this test is what showed
    // it: the first write is `setTradingRegion` when they submit a name, which
    // would still have hit a row that did not exist. The fix moved to
    // `app/onboarding/layout.tsx`, which every step is downstream of.
    await page.reload();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });

    const repairedId = await profileIdByEmail(email);
    expect(
      repairedId,
      'loading onboarding should have re-provisioned the missing profile',
    ).toBeTruthy();

    await passWelcome(page);
    await page.getByPlaceholder(/PokeTrader99/).fill(marked('Repaired'));

    // THE REGRESSION ASSERTION. Named exactly, because the complaint was that
    // this string reached a member.
    await expect(page.getByText(/coerce/i)).toHaveCount(0);
    await expect(page.getByText(/single JSON object/i)).toHaveCount(0);

    await page.getByRole('button', { name: /^Continue|^Saving/ }).click();
    await expect(page.getByText(/could not be saved/i)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });
  });
});
