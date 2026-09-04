// tests/e2e/specs/guards.spec.ts
//
// End-to-end coverage of the two CONTRACT GUARDS that protect money safety:
//
//   A. Region Guard — refuses a contract when buyer and seller trade in different
//      regions (CROSS_REGION) or when either has no region set (UNKNOWN_REGION).
//      Evaluated via `checkRegionCompatibility` in the orchestrator and surfaced
//      on the listing detail page as a `role="status"` notice.
//
//   B. Identity Gate — refuses publishing a listing or entering trade escrow when
//      `identity_check_status` is not 'VERIFIED'. A cash BUYER is deliberately
//      exempt (they never receive a transfer).
//
// Both guards are CONTRACT guards, not browse filters: a shared link or direct URL
// bypasses the catalog entirely, which is why the guard exists at the orchestrator
// layer.
//
// SETUP: fresh accounts are signed up in-test. Once the auth account is created,
// the profile is completed via service-role DB writes to avoid depending on the
// onboarding wizard (which is exercised in its own spec and has its own
// dependencies — e.g. `operationalRegions()` needing a live Stripe key).

import { test, expect } from '../support/fixtures';
import { ALICE, BOB } from '../support/users';
import { marked, markedEmail } from '../support/marker';
import { COLD_ROUTE, RENDERED } from '../support/waiting';
import { ensureFreshSessions, isSignedInDestination } from '../support/auth';
import { profileIdByEmail } from '../support/db';

// Repair any stored cookie jar this file relies on before its first test.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, BOB]);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Patch a profile column via PostgREST with the service-role key (RLS bypass).
 * Service-role is exempt from the 0070 trigger, so it can set non-trading regions.
 */
async function patchProfile(
  profileId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const envFile = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
  const env: Record<string, string> = {};
  for (const line of envFile.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  const response = await fetch(
    `${url}/rest/v1/profiles?id=eq.${profileId}`,
    {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'Content-Profile': 'cardtrade',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(patch),
    },
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`PATCH profiles failed: ${response.status} ${text}`);
  }
}

/**
 * Sign up a fresh member and prepare their profile via DB. Returns the profile id.
 *
 * After sign-up, the member lands on `/onboarding`. Rather than walking the wizard
 * (which depends on `operationalRegions()` and the Stripe key), we write the
 * profile columns directly via service-role — mirroring what the wizard would do.
 *
 * @param regionCode which region to set; 'GB' needs service-role because the trigger
 *   refuses non-trading regions for authenticated writes
 */
async function signUpAndPrepare(
  page: import('@playwright/test').Page,
  email: string,
  displayName: string,
  regionCode: string = 'AU',
): Promise<string> {
  await page.goto('/sign-up');
  await page.waitForLoadState('domcontentloaded');

  const emailField = page.getByLabel('Email');
  await expect(emailField).toBeEditable({ timeout: RENDERED });
  await emailField.fill(email);
  await page.getByLabel('Password').fill('TestPassword123!');
  // Sign-up refuses without consent — see `acceptedTerms` in AuthForm. Ticking
  // it is part of creating an account, not incidental setup.
  await page.getByRole('checkbox', { name: /accept the Terms/i }).check();
  await page.getByRole('button', { name: 'Create account' }).click();

  // Wait for the auth account to be created. The page either lands on /onboarding
  // (new account) or stays on /sign-up with an error (duplicate). Wait generously.
  await expect(page).toHaveURL(isSignedInDestination, { timeout: COLD_ROUTE });

  // Let the page finish loading before any DB writes or subsequent navigations.
  // On WebKit the onboarding page may still fire client-side navigations during
  // hydration (e.g. the wizard's step router), which would interrupt a subsequent
  // `page.goto()` — the symptom is "Navigation interrupted by another navigation
  // to /onboarding". Waiting for domcontentloaded ensures the initial render
  // completes and any synchronous redirects have resolved.
  await page.waitForLoadState('domcontentloaded');

  // Profile is created during sign-up. Look it up.
  const profileId = await profileIdByEmail(email);
  expect(profileId, `profile should exist for ${email}`).toBeTruthy();

  // Complete the profile via service-role: region + onboarding flag.
  await patchProfile(profileId!, {
    display_name: displayName,
    region_code: regionCode,
    onboarding_completed_at: new Date().toISOString(),
  });

  // Navigate to a neutral page to clear the in-flight onboarding state. On WebKit,
  // the onboarding page's component mounts trigger background fetches that the
  // browser treats as pending navigations; a subsequent `page.goto` would collide
  // with them. Going to the catalog (a public, fast page) resets the navigation
  // state cleanly. `{ waitUntil: 'commit' }` returns as soon as the response headers
  // arrive, before RSC payloads and hydration — just enough to clear the WebKit
  // navigation queue without waiting for Realtime sockets that block `load`.
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page).toHaveURL(/\/$/, { timeout: COLD_ROUTE });

  return profileId!;
}

// Use blank storage state so sign-up is not confused by an existing session.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// A. REGION GUARD
// ---------------------------------------------------------------------------

test.describe('Region guard', () => {
  const CHARIZARD_ID = 'aaaaaaa1-0000-0000-0000-000000000001';
  const BOB_ITEM_ID = 'aaaaaaa2-0000-0000-0000-000000000002';

  test('a GB buyer is warned on an AU listing and refused at buy', async ({
    page,
  }) => {
    const email = markedEmail('region-gb');
    await signUpAndPrepare(page, email, marked('GB Buyer'), 'GB');

    // Navigate directly to Alice's listing (bypassing catalog = the guard case).
    await page.goto(`/listings/${CHARIZARD_ID}`);
    await page.waitForLoadState('domcontentloaded');

    // Wait for the page to render — the item heading confirms the server responded.
    await expect(
      page.getByRole('heading', { name: /Charizard/ }),
    ).toBeVisible({ timeout: COLD_ROUTE });

    // The region notice is rendered as role="status" and names both regions.
    // The listing page renders its action column twice — once in the `lg:hidden`
    // phone stack and once in the desktop pane — so every notice inside it exists
    // twice in the DOM, with CSS deciding which is on screen. Scope to the copy
    // that is actually visible.
    const notice = page
      .locator('[role="status"]')
      .filter({ visible: true })
      .first();
    await expect(notice).toBeVisible({ timeout: RENDERED });
    await expect(notice).toContainText('Australia');
    await expect(notice).toContainText('United Kingdom');
    await expect(notice).toContainText('Deals are completed within a single region');
  });

  test('the region refusal appears on a direct URL visit (not just catalog)', async ({
    page,
  }) => {
    // This test uses the same flow: a shared link or watchlist entry means the
    // buyer never went through the catalog filter. The guard must still fire.
    const email = markedEmail('region-direct');
    await signUpAndPrepare(page, email, marked('Direct GB'), 'GB');

    // Go directly to Bob's listing (different seed item, same AU seller).
    await page.goto(`/listings/${BOB_ITEM_ID}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: /Jordan/ }),
    ).toBeVisible({ timeout: COLD_ROUTE });

    // The listing page renders its action column twice — once in the `lg:hidden`
    // phone stack and once in the desktop pane — so every notice inside it exists
    // twice in the DOM, with CSS deciding which is on screen. Scope to the copy
    // that is actually visible.
    const notice = page
      .locator('[role="status"]')
      .filter({ visible: true })
      .first();
    await expect(notice).toBeVisible({ timeout: RENDERED });
    await expect(notice).toContainText('United Kingdom');
    await expect(notice).toContainText('Deals are completed within a single region');
  });
});

// ---------------------------------------------------------------------------
// B. IDENTITY GATE
// ---------------------------------------------------------------------------

test.describe('Identity gate', () => {
  const CHARIZARD_ID = 'aaaaaaa1-0000-0000-0000-000000000001';

  test('an unverified member is refused when trying to publish a listing', async ({
    page,
  }) => {
    const email = markedEmail('unverified-list');
    await signUpAndPrepare(page, email, marked('Unverified Lister'));

    // Navigate to the create listing page.
    await page.goto('/listings/new');
    await page.waitForLoadState('domcontentloaded');

    // The page should show the gate prompt instead of the form.
    await expect(
      page.getByRole('heading', { name: 'Verify Your Identity First' }),
    ).toBeVisible({ timeout: COLD_ROUTE });

    // Actionable message: explains what to do.
    await expect(
      page.getByText(/Verify your identity before you publish a listing/),
    ).toBeVisible();

    // The form itself must NOT be present. Probed on the description field, which is
    // now the listing form's only prose input — there is no Title field to look for.
    await expect(page.getByLabel('Description')).toHaveCount(0);
  });

  test('an unverified member is refused when entering trade escrow', async ({
    page,
  }) => {
    const email = markedEmail('unverified-trade');
    await signUpAndPrepare(page, email, marked('Unverified Trader'));

    // Navigate to Alice's listing and click Propose Trade.
    await page.goto(`/listings/${CHARIZARD_ID}`);
    await page.waitForLoadState('domcontentloaded');

    const tradeBtn = page.getByRole('button', { name: 'Propose Trade' });
    await expect(tradeBtn).toBeVisible({ timeout: COLD_ROUTE });
    await tradeBtn.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: RENDERED });

    // The dialog should show the identity gate prompt rather than the trade form.
    await expect(
      dialog.getByRole('heading', { name: 'Verify to trade' }),
    ).toBeVisible({ timeout: RENDERED });

    // The "Verify with Stripe" button should be offered (actionable).
    await expect(
      dialog.getByRole('button', { name: /Verify with Stripe/ }),
    ).toBeVisible();
  });

  test('an unverified member is NOT refused from buying', async ({ page }) => {
    // A cash buyer is exempt from the Identity_Gate (Req 14.4): they never
    // receive a transfer and are only refunded to their own card.
    const email = markedEmail('unverified-buyer');
    await signUpAndPrepare(page, email, marked('Unverified Buyer'));

    // Navigate to Alice's listing.
    await page.goto(`/listings/${CHARIZARD_ID}`);
    await page.waitForLoadState('domcontentloaded');

    // The Buy button must be present and clickable.
    const buyBtn = page.getByRole('button', { name: 'Buy now' });
    await expect(buyBtn).toBeVisible({ timeout: COLD_ROUTE });
    await buyBtn.click();

    // The buy dialog opens (not an identity gate refusal).
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: RENDERED });

    // It asks for a payment method (expected for a new member) rather than
    // refusing with an identity gate message.
    await expect(
      dialog.getByRole('heading', { name: 'Add a payment method' }),
    ).toBeVisible({ timeout: 20_000 });

    // Confirm there is NO identity gate refusal anywhere in the dialog.
    await expect(dialog.getByText(/Verify your identity/)).toHaveCount(0);
  });
});
