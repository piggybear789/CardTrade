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
// The region is CHOSEN on its own step — Australia is the only region open for
// deals, so the step is a confirmation rather than a decision with one option,
// but it is still shown because this is the jurisdiction the member's payouts
// and postage are pinned to. Asserting only "the wizard finished" would also
// pass if the write failed and the step were later changed to continue
// regardless.
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
  // Sign-up refuses without consent — see `acceptedTerms` in AuthForm.
  await page.getByRole('checkbox', { name: /accept the Terms/i }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });
}

async function passWelcome(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Welcome to NoDitto' }),
  ).toBeVisible({ timeout: RENDERED });
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(
    page.getByRole('heading', { name: 'Choose your username' }),
  ).toBeVisible({ timeout: RENDERED });
}

/**
 * Walk the region and intent steps as a buy-only member — the shortest path to a
 * completed profile, because a Buyer needs no Identity_Gate.
 *
 * SCOPED TO THE DIALOG, and that is not tidiness. "Continue" otherwise matches TWO
 * controls: the wizard's button and the Next.js dev-tools overlay `next dev` injects
 * into every page. Clicking the overlay opens its menu while the wizard sits
 * untouched — a failure that looks like the button not working.
 */
async function finishAsBuyer(page: Page) {
  const wizard = page.getByRole('dialog');

  await expect(
    page.getByRole('heading', { name: 'Where are you trading from?' }),
  ).toBeVisible({ timeout: RENDERED });
  await wizard.getByRole('button', { name: /^Australia/ }).click();
  await wizard.getByRole('button', { name: /^Continue|^Saving/ }).click();

  // The intent step is only reachable once the region write succeeded.
  await expect(
    page.getByRole('heading', { name: 'What brings you here?' }),
  ).toBeVisible({ timeout: COLD_ROUTE });
  await wizard.getByText('I want to buy').click();
  await wizard.getByRole('button', { name: /^Continue|^Saving/ }).click();
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

    // The welcome step's first promise. It used to warn that fraud "permanently
    // bans"; the three points were rewritten around what the product does rather
    // than what it punishes, so this anchors on the current copy
    // (`WELCOME_POINTS` in OnboardingWizard) while still proving the step rendered.
    await expect(page.getByText(/Everyone selling is verified/i)).toBeVisible({
      timeout: RENDERED,
    });
    await passWelcome(page);
    await page.getByPlaceholder(/PokeTrader99/).fill(marked('Onboarder'));
    await page.getByRole('button', { name: /^Continue|^Saving/ }).click();

    await finishAsBuyer(page);

    // THE REGRESSION ASSERTION, stated as the absence of the exact copy the bug
    // produced. Asserting only "the wizard advanced" would also pass if the write
    // failed and the step were later changed to continue regardless — which would
    // leave a member with no region and no way to know.
    await expect(page.getByText(/could not be saved/i)).toHaveCount(0);
    // A BUYER IS FINISHED AT THE INTENT STEP. There is no card screen: a card is a
    // hard prerequisite for opening a contract, but demanding one before the member has
    // chosen anything to buy is friction with no purpose — the same deferral argument
    // as collecting bank details only when there is money to pay out. The wizard used
    // to show an optional card step with a "Skip for now" beneath it, i.e. a screen
    // whose best outcome was being dismissed. `initiateCashSale` still enforces the
    // card later with BUYER_NO_PAYMENT_METHOD, which is what makes deferring safe.
    //
    // Onboarding is done when the member is no longer sent back to it. `proxy.ts`
    // redirects to /onboarding from every protected route until
    // `onboarding_completed_at` is set, so reaching another page is the completion
    // assertion — and it also proves the region write persisted, since the wizard
    // cannot be finished without it.
    await expect(page).not.toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });
    expect(await regionCodeForEmail(email)).toBe('AU');
  });

  test('the region step offers only regions open for deals', async ({ page }) => {
    const email = markedEmail('regionchoices');

    await signUpOntoOnboarding(page, email);
    await passWelcome(page);
    await page.getByPlaceholder(/PokeTrader99/).fill(marked('Chooser'));
    await page.getByRole('button', { name: /^Continue|^Saving/ }).click();

    await expect(
      page.getByRole('heading', { name: 'Where are you trading from?' }),
    ).toBeVisible({ timeout: RENDERED });

    // A region in REGIONS is BROWSABLE; only `tradingEnabled` makes it TRADEABLE,
    // and today that is AU alone. Great Britain is in the registry as a browse
    // region, so its presence here would mean a member could pick a jurisdiction the
    // platform cannot settle in.
    await expect(page.getByRole('button', { name: /^Australia/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^United Kingdom/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Great Britain/ })).toHaveCount(0);
  });

  test('an unfinished member is sent back to the wizard from the catalog', async ({
    page,
  }) => {
    const email = markedEmail('browsefirst');

    await signUpOntoOnboarding(page, email);

    // Deliberately WITHOUT finishing the wizard. The catalog is the homepage, so
    // this also proves the gate follows the route rather than the `/listings`
    // path it used to live on.
    await page.goto('/');
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

    await finishAsBuyer(page);

    await expect(page.getByText(/could not be saved/i)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });
  });
});
