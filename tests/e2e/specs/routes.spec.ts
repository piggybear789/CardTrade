// tests/e2e/specs/routes.spec.ts
//
// Smoke coverage for six routes that previously had zero e2e tests:
// /purchases, /saved, /sellers/[id], /messages/[id], /sales, /account-suspended.
//
// Each test visits the route, asserts the page renders its expected headings and
// key affordances, and — where the route is protected — confirms authentication
// gating by structure, not by a separate unauthenticated probe (those add wall
// time for little confidence).
//
// SELECTORS PROBED FROM THE RUNNING APP (2024-08-08), not guessed from source:
//   /purchases   — h1 "Purchases" (×2, shell), h2/h3 "No Purchases Yet"
//   /saved       — h1 "Saved" (×2), h2/h3 "No Saved Listings Yet"
//   /sellers/[id]— h1 "Seller" (shell), h2 = display name, h2 "Available listings"
//   /messages/[id]— h1 "Messages" (shell), h2 = counterparty name, textarea placeholder "Write a message…"
//   /sales       — h1 "Sales" (×2), h2/h3 "No Sales Yet", link "Create New Listing"
//   /account-suspended — h1 "Account permanently suspended", link "Return to home"

import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { ensureFreshSessions } from '../support/auth';
import { COLD_ROUTE, RENDERED } from '../support/waiting';

// Stored sessions go stale mid-run due to refresh-token rotation — repair them
// before anything that depends on being signed in.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, BOB]);
});

// ─── /purchases ──────────────────────────────────────────────────────────────

test.describe('/purchases', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('loads for an authenticated buyer', async ({ page }) => {
    await page.goto('/purchases');
    await page.waitForLoadState('domcontentloaded');

    // Shell renders the page title as h1 twice — always .first().
    await expect(
      page.getByRole('heading', { name: 'Purchases' }).first(),
    ).toBeVisible({ timeout: RENDERED });

    // SectionFilter tabs are present — links whose text starts with Active/Past.
    await expect(page.getByRole('link', { name: /^Active/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Past/ })).toBeVisible();
  });
});

// ─── /saved ──────────────────────────────────────────────────────────────────

test.describe('/saved', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('loads for an authenticated member', async ({ page }) => {
    await page.goto('/saved');
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: 'Saved' }).first(),
    ).toBeVisible({ timeout: RENDERED });

    // The empty state is the expected baseline for a seeded user with no watchlist.
    await expect(
      page.getByRole('heading', { name: /No Saved Listings/i }),
    ).toBeVisible();
  });
});

// ─── /sellers/[id] ───────────────────────────────────────────────────────────

test.describe('/sellers/[id]', () => {
  test.use({ storageState: storageStatePath(BOB) });

  test('shows the seller profile with listings and reviews sections', async ({ page }) => {
    // Visit Alice's public seller profile as Bob.
    await page.goto(`/sellers/${ALICE.id}`);
    await page.waitForLoadState('domcontentloaded');

    // Shell h1 is "Seller" (×2) — use .first().
    await expect(
      page.getByRole('heading', { name: 'Seller' }).first(),
    ).toBeVisible({ timeout: RENDERED });

    // The seller's display name is an h2.
    await expect(
      page.getByRole('heading', { name: ALICE.displayName }),
    ).toBeVisible();

    // Section headings for the two content blocks.
    await expect(
      page.getByRole('heading', { name: 'Available listings' }),
    ).toBeVisible();
    // "Reviews" heading (sometimes with a count suffix) — the empty-state "No
    // Reviews Yet" heading also matches a loose regex, so use the id the page
    // renders on the section heading.
    await expect(page.locator('#reviews-heading')).toBeVisible();

    // Breadcrumb navigation back to listings.
    await expect(
      page.locator('[aria-label="Breadcrumb"]'),
    ).toBeVisible();

    // Report affordance (Bob is not Alice, so the button is present).
    await expect(
      page.getByRole('button', { name: 'Report user' }),
    ).toBeVisible();
  });
});

// ─── /messages/[id] ──────────────────────────────────────────────────────────

test.describe('/messages/[id]', () => {
  test('loads a conversation thread', async ({ browser }) => {
    // Create a fresh conversation: Bob messages Alice about her listing.
    const body = marked(`routes-probe ${Date.now()}`);
    const bobCtx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const bobPage = await bobCtx.newPage();

    await bobPage.goto(`/listings/aaaaaaa1-0000-0000-0000-000000000001`);
    await bobPage.waitForLoadState('domcontentloaded');

    const composer = bobPage.getByLabel('Send seller a message');
    await expect(composer).toBeEnabled({ timeout: RENDERED });
    await composer.click();
    await composer.fill(body);
    await bobPage.getByRole('button', { name: 'Send' }).click();

    // Landing in the thread proves the conversation was created.
    await expect(bobPage).toHaveURL(/\/messages\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });

    // Shell h1 is "Messages" (×2).
    await expect(
      bobPage.getByRole('heading', { name: 'Messages' }).first(),
    ).toBeVisible({ timeout: RENDERED });

    // Counterparty name is an h2.
    await expect(
      bobPage.getByRole('heading', { name: ALICE.displayName }),
    ).toBeVisible();

    // The thread composer is ready.
    await expect(
      bobPage.getByPlaceholder(/Write a message/i),
    ).toBeVisible();

    // The message body itself is visible in the thread.
    await expect(bobPage.getByText(body)).toBeVisible();

    await bobCtx.close();
  });
});

// ─── /sales ──────────────────────────────────────────────────────────────────

test.describe('/sales', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('loads for an authenticated seller', async ({ page }) => {
    await page.goto('/sales');
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: 'Sales' }).first(),
    ).toBeVisible({ timeout: RENDERED });

    // SectionFilter tabs.
    await expect(page.getByRole('link', { name: /^Active/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Past/ })).toBeVisible();

    // Primary action in the rail / section header.
    await expect(
      page.getByRole('link', { name: 'Create New Listing' }).first(),
    ).toBeVisible();
  });
});

// ─── /account-suspended ──────────────────────────────────────────────────────

test.describe('/account-suspended', () => {
  // Public page — no auth needed. Uses a fresh context (no storageState override).

  test('renders the suspension notice', async ({ page }) => {
    await page.goto('/account-suspended');
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: 'Account permanently suspended' }),
    ).toBeVisible({ timeout: RENDERED });

    // The explanation paragraph.
    await expect(
      page.getByText(/permanently suspended after a staff-confirmed/),
    ).toBeVisible();

    // Escape hatch back to the public homepage.
    await expect(
      page.getByRole('link', { name: 'Return to home' }),
    ).toBeVisible();
  });
});
