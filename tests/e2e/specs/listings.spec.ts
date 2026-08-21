// tests/e2e/specs/listings.spec.ts
//
// Catalog browse, item detail, and the listing form (create + edit).
//
// SELECTORS READ OFF THE RUNNING PAGE (tests/e2e/debug/inspect.spec.ts). Four
// things that dump settled, each of which an inferred selector got wrong:
//
//   1. On an item page the <h1> is the SHELL title — literally "Marketplace" —
//      and the item's own title is an <h2>. Asserting `heading level 1` contains
//      the item name fails on every listing in the app.
//   2. Category / Condition are shadcn `Select`s. Radix renders a
//      trigger with `role="combobox"` AND a hidden native <select> for form
//      compatibility, and BOTH are labelled by the same <Label htmlFor>. So
//      `getByLabel('Category')` is always ambiguous; `getByRole('combobox')` is
//      not.
//   3. `Based near` is REQUIRED. The suite runs the dev server with no Maps key so
//      PlacePicker falls back to a plain text input — see the note in
//      playwright.config.ts.
//   4. Listing kind is a pair of radio tiles labelled "One item" and "Multiple
//      items". They no longer carry a description, so the accessible name is just
//      the label — but they are still matched by PREFIX rather than equality, so
//      that reinstating a per-tile hint does not break every spec at once.

import { test, expect } from '../support/fixtures';
import { ALICE, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { createListing } from '../support/listings';
import { ensureFreshSessions } from '../support/auth';

// Repair any stored cookie jar this file relies on before its first test.
// Refresh-token rotation retires the token a jar holds as soon as another context
// uses it, so a shared snapshot goes stale on its own during a long run. See
// tests/e2e/support/auth.ts for the full reasoning.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE]);
});

test.use({ storageState: storageStatePath(ALICE) });

const CHARIZARD = {
  id: 'aaaaaaa1-0000-0000-0000-000000000001',
  title: '1999 Pokémon Base Set Charizard #4 PSA 8',
};

/** RESERVED and SOLD seed items. `items_catalog_select` treats availability as VISIBILITY. */
const HIDDEN_TITLES = [
  '2003 LeBron James Topps Chrome Rookie #111 PSA 9', // RESERVED
  '1928 Babe Ruth Signed Baseball (JSA)', // RESERVED
  '1952 Topps Mickey Mantle #311 (Authentic)', // SOLD
  '1954 Superman #100 CGC 3.5', // SOLD
];

// The form-filling detail lives in `../support/listings` because the offers spec
// needs a throwaway item too — accepting an offer reserves an item permanently, so
// that flow cannot run against a seed fixture twice.

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

test.describe('Catalog', () => {
  test('lists AVAILABLE items', async ({ page }) => {
    await page.goto('/listings');
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('link', { name: /Charizard/ }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('hides RESERVED and SOLD items', async ({ page }) => {
    await page.goto('/listings');
    await page.waitForLoadState('domcontentloaded');

    // Availability is visibility: a listing under contract or sold leaves the
    // catalog rather than showing a disabled card.
    for (const title of HIDDEN_TITLES) {
      await expect(page.getByText(title)).toHaveCount(0);
    }
  });

  test('search narrows to matching items', async ({ page }) => {
    await page.goto('/listings');
    await page.waitForLoadState('domcontentloaded');

    // The catalog owns a dedicated filter field. The header search is a jump
    // launcher and must not be the control this spec drives.
    const search = page.getByLabel('Filter listings');
    await search.click();
    await search.fill('Charizard');

    // Client-side filter of the loaded grid — no navigation, so the URL stays
    // clean and cards that already rendered keep their images.
    await expect(page).toHaveURL(/\/listings\/?$/);
    await expect(page.getByText(/Charizard/).first()).toBeVisible();
    await expect(page.getByText('1986 Fleer Michael Jordan Rookie #57 BGS 7')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Item detail
// ---------------------------------------------------------------------------

test.describe('Item detail', () => {
  test('shows title, price, description and condition', async ({ page }) => {
    await page.goto(`/listings/${CHARIZARD.id}`);
    await page.waitForLoadState('domcontentloaded');

    // The item title is an h2 — the h1 belongs to the shell ("Marketplace").
    await expect(
      page.getByRole('heading', { name: CHARIZARD.title }),
    ).toBeVisible({ timeout: 10_000 });

    // 25000 cents formatted as AUD.
    await expect(page.getByText('$250.00').first()).toBeVisible();
    await expect(
      page.getByText(/Holographic Charizard from the 1999 Base Set/),
    ).toBeVisible();
    // Condition renders in the spec list and again in the image alt text.
    await expect(page.getByText('PSA 8').first()).toBeVisible();
  });

  test('offers the owner edit rather than buy', async ({ page }) => {
    // Alice owns this listing. Buy / Propose Trade / Make an offer must not be
    // offered to the owner — the guards refuse self-dealing server-side, so
    // surfacing them would be an invitation to a refusal.
    await page.goto(`/listings/${CHARIZARD.id}`);
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByRole('link', { name: /^Edit/ }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole('button', { name: 'Buy now' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Propose Trade' })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// My listings
// ---------------------------------------------------------------------------

test.describe('My listings', () => {
  test('shows only the caller\'s own items', async ({ page }) => {
    await page.goto('/listings/mine');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByText(/Charizard/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Inverted Jenny/).first()).toBeVisible();

    // Bob's rookie card must not appear on Alice's page.
    await expect(
      page.getByText('1986 Fleer Michael Jordan Rookie #57 BGS 7'),
    ).toHaveCount(0);
  });

  test('shows the caller\'s RESERVED and SOLD items too', async ({ page }) => {
    // The catalog hides these; the owner's own list must not, or a seller loses
    // sight of everything they have under contract.
    await page.goto('/listings/mine');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(/Charizard/).first()).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Create + edit
// ---------------------------------------------------------------------------

test.describe('Listing form', () => {
  test('creates a SINGLE listing', async ({ page }) => {
    const title = marked(`Pikachu V ${Date.now()}`);
    await createListing(page, { title });

    await expect(page.getByRole('heading', { name: title })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('$50.00').first()).toBeVisible();
  });

  test('edits a listing title', async ({ page }) => {
    const original = marked(`Editable ${Date.now()}`);
    const updated = `${original} (updated)`;

    // The returned detail URL is deliberately discarded: the navigation below goes
    // through the Edit link instead, for the reason in the next comment.
    await createListing(page, { title: original });

    // On WebKit, `router.refresh()` fires a soft navigation that competes with the
    // subsequent `goto`. Simply waiting for a load state is not enough because the
    // refresh is processed asynchronously by Next's router. The reliable workaround
    // is to wait for the content that the refresh delivers (the heading), THEN
    // navigate via the link the app already provides (the Edit link on the owner's
    // own listing) rather than a raw `goto`.
    await expect(page.getByRole('heading', { name: original })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: /^Edit/ }).first().click();
    await expect(page).toHaveURL(/\/edit/, { timeout: 15_000 });
    await page.waitForLoadState('domcontentloaded');

    const titleInput = page.getByLabel('Title');
    await expect(titleInput).toHaveValue(original, { timeout: 10_000 });
    await titleInput.fill(updated);

    await page.getByRole('button', { name: /Save changes|Update listing/i }).click();

    await expect(page).toHaveURL(/\/listings\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: updated })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('refuses a listing with no title', async ({ page }) => {
    await page.goto('/listings/new');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('radio', { name: /^One item/ }).check();
    await page.getByRole('button', { name: 'Create listing' }).click();

    // Stays on the form. The validator returns a field-scoped error rather than
    // throwing, so the page must not navigate.
    await expect(page).toHaveURL(/\/listings\/new/);
  });
});
