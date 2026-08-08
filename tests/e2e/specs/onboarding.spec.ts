// tests/e2e/specs/onboarding.spec.ts
//
// The one-time member onboarding wizard, and specifically the step that was broken:
// choosing a trading region.
//
// WHAT THIS GUARDS. 0065 added `profiles.region_code` and this wizard step, but
// never granted UPDATE on the column to `authenticated`. `setTradingRegion` writes
// through the cookie-bound client, so the write was refused by column privilege, the
// action fell into its `persistence-error` branch, and the step showed "Your region
// could not be saved. Please retry." Retrying could not help.
//
// It presented as a transient save failure and was not one. Because 0065 also made
// an ABSENT region a refusal rather than a pass, a member who could not clear this
// step could not buy, sell or trade at all — so a missing one-line grant closed the
// entire product to every new signup. Fixed by migration 0070, which adds the grant
// and mirrors the action's rules in a trigger, since granting the column makes the
// action's own guard bypassable by a direct PATCH.
//
// THIS TEST MUST SIGN UP A NEW MEMBER. It cannot use a seeded one: onboarding runs
// once, every fixture profile already has `onboarding_completed_at` set, and the 0070
// trigger refuses clearing a region by design. A fresh account is the only way to
// reach the step at all — which is also why the bug survived, since nothing in the
// suite created one.
//
// The account is created with `markedEmail()` so teardown removes it and its auth
// user (`scripts/e2e/cleanup-test-data.ts` matches `profiles.contact_email` on
// `e2e-`).

import { test, expect } from '@playwright/test';
import { marked, markedEmail } from '../support/marker';
import { COLD_ROUTE, RENDERED } from '../support/waiting';

/** Signing up must not inherit a seeded session. */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Onboarding', () => {
  test('a new member can set a trading region and finish', async ({ page }) => {
    const email = markedEmail('onboarding');

    await page.goto('/sign-up');
    await page.waitForLoadState('domcontentloaded');

    const emailField = page.getByLabel('Email');
    await expect(emailField).toBeEditable({ timeout: RENDERED });
    await emailField.fill(email);
    await page.getByLabel('Password').fill('TestPassword123!');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Middleware sends a member with no `onboarding_completed_at` here from any
    // protected route, so landing on it IS the signup assertion.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });

    // Step 1 — welcome.
    await expect(
      page.getByRole('heading', { name: 'Welcome to NoDitto' }),
    ).toBeVisible({ timeout: RENDERED });
    await page.getByRole('button', { name: 'Get started' }).click();

    // Step 2 — public alias.
    await page.getByPlaceholder(/PokeTrader99/).fill(marked('Onboarder'));
    await page.getByRole('button', { name: 'Continue' }).click();

    // Step 3 — THE STEP THAT WAS BROKEN.
    await expect(
      page.getByRole('heading', { name: 'Where are you trading from?' }),
    ).toBeVisible({ timeout: RENDERED });

    // Region tiles are buttons carrying `aria-pressed`, and each accessible name
    // runs the label together with its description ("Australia Buy, sell and trade
    // in AUD with other members in Australia."), so it is matched by prefix.
    //
    // Only `tradingEnabled` regions are listed. If AU ever stops being one this
    // assertion fails loudly, which is correct: a wizard offering a region the
    // platform cannot settle in is the 0060 mistake.
    const australia = page.getByRole('button', { name: /^Australia/ });
    await expect(australia).toBeVisible();
    await australia.click();
    await expect(australia).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: /^Continue|^Saving/ }).click();

    // THE REGRESSION ASSERTION, stated as the absence of the exact copy the bug
    // produced. Asserting only "the wizard advanced" would also pass if the write
    // failed and the step were later changed to continue regardless — which would
    // leave a member with no region and no way to know.
    await expect(page.getByText(/could not be saved/i)).toHaveCount(0);

    // Advanced to the intent step, which is only reachable once the region write
    // succeeded.
    await expect(page.getByText('I want to buy')).toBeVisible({ timeout: 20_000 });

    // Step 4 — intent. A buy-only member needs no Identity_Gate, so this is the
    // shortest path to a completed profile.
    //
    // SCOPED TO THE DIALOG, and that is not tidiness. "Next" previously matched TWO
    // controls here: the wizard's button and the Next.js dev-tools overlay that
    // `next dev` injects into the bottom-left of every page. `.last()` clicked the
    // overlay and opened its menu while the wizard sat untouched — a failure that
    // looks like the button not working. The overlay does not exist in a production
    // build, which is one more argument for F14; scoping is the fix that works either
    // way.
    //
    // The buyer path now says "Continue" like every other step (it said "Next"). The
    // seller path deliberately still says "Verify Identity", because that action
    // leaves for Stripe rather than advancing the wizard.
    const wizard = page.getByRole('dialog');
    await wizard.getByText('I want to buy').click();
    await wizard.getByRole('button', { name: 'Continue' }).click();

    // Step 5 — saved card, and it is OPTIONAL here on purpose. A card is a hard
    // prerequisite for opening a contract, but demanding one before the member has
    // chosen anything to buy is friction with no purpose — the same deferral
    // argument as collecting bank details only when there is money to pay out.
    // Skipping is therefore the path worth asserting: onboarding must complete
    // without a card, and `initiateCashSale` enforces it later with
    // BUYER_NO_PAYMENT_METHOD.
    await expect(
      wizard.getByRole('heading', { name: 'Add a payment card' }),
    ).toBeVisible({ timeout: RENDERED });
    await wizard.getByRole('button', { name: /Skip for now/ }).click();

    // Onboarding is done when the member is no longer sent back to it. Middleware
    // redirects to /onboarding from every protected route until
    // `onboarding_completed_at` is set, so reaching another page is the completion
    // assertion — and it also proves the region write persisted, since the wizard
    // cannot be finished without it.
    await expect(page).not.toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });
  });

  test('the region step offers only regions open for deals', async ({ page }) => {
    const email = markedEmail('regionchoices');

    await page.goto('/sign-up');
    await page.waitForLoadState('domcontentloaded');
    const emailField = page.getByLabel('Email');
    await expect(emailField).toBeEditable({ timeout: RENDERED });
    await emailField.fill(email);
    await page.getByLabel('Password').fill('TestPassword123!');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });

    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByPlaceholder(/PokeTrader99/).fill(marked('Chooser'));
    await page.getByRole('button', { name: 'Continue' }).click();

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
});
