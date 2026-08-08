// tests/e2e/support/listings.ts
//
// Creating a listing through the real form, shared by every spec that needs a
// throwaway item.
//
// WHY A HELPER RATHER THAN REUSING SEED ITEMS. Some flows change an item's status
// permanently: accepting an offer opens a Cash_Sale, which flips
// `items.status` to RESERVED, and nothing in the suite puts it back. A spec built
// on a seed item therefore passes exactly once and fails on every later run with
// "no longer available" — and it takes the catalog specs with it, because
// `items_catalog_select` treats availability as visibility, so the item silently
// leaves the catalog other tests assert on.
//
// So flows that consume an item create their own, marked, and teardown deletes it.
// Flows that only READ an item (browse, detail, messaging) use the seed fixtures.

import { expect, type Page } from '@playwright/test';
import path from 'node:path';

/** 1×1 PNG. Listing images are required (1–10). */
const TEST_IMAGE = path.resolve(__dirname, '..', 'fixtures', 'test-image.png');

export interface CreateListingOptions {
  /** Marked title — pass `marked(...)` so teardown can find the row. */
  title: string;
  /** Dollars, as typed into the form. Converted to integer cents by the form. */
  priceDollars?: string;
  description?: string;
}

/**
 * Fill the create-listing form and submit, returning the new item's detail URL.
 *
 * Field notes that are not guessable from the component source:
 *
 *  - Listing kind is a pair of radio tiles whose accessible name is the whole
 *    tile including its description, so it is matched by prefix. SINGLE is chosen
 *    because a SHOPFRONT is never reserved and never sold (0064) and so behaves
 *    differently in every downstream assertion.
 *  - Category / Subcategory / Condition are shadcn `Select`s. Radix renders the
 *    trigger AND a hidden native <select>, both labelled by the same
 *    `<Label htmlFor>`, so `getByLabel` is permanently ambiguous. The trigger
 *    carries the id, so `#category` / `#subcategory` / `#condition` are used.
 *    Subcategory stays disabled until a category is picked.
 *  - `Based near` is REQUIRED. The suite runs with no Maps key so PlacePicker
 *    falls back to a plain text input — see playwright.config.ts.
 *  - The file input is visually hidden behind an "Add photos" button; the button
 *    only opens the OS picker, so the input is driven directly.
 */
export async function createListing(
  page: Page,
  { title, priceDollars = '50.00', description = 'Created by the e2e suite.' }: CreateListingOptions,
): Promise<string> {
  await page.goto('/listings/new');
  await page.waitForLoadState('domcontentloaded');

  await page.getByRole('radio', { name: /^One item/ }).check();

  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill(description);

  await page.locator('#category').click();
  await page.getByRole('option', { name: 'Trading Cards' }).click();
  await page.locator('#subcategory').click();
  await page.getByRole('option', { name: 'Pokémon' }).click();
  await page.locator('#condition').click();
  await page.getByRole('option', { name: 'Near Mint' }).click();

  await page.getByLabel('Price').fill(priceDollars);
  await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE);
  await page.getByLabel(/Based near/).fill('Sydney NSW');

  await page.getByRole('button', { name: 'Create listing' }).click();

  await expect(page).toHaveURL(/\/listings\/[0-9a-f-]{36}/, { timeout: 30_000 });
  return page.url();
}

/** The item id out of a detail URL produced by {@link createListing}. */
export function itemIdFromUrl(url: string): string {
  const id = new URL(url).pathname.split('/').pop();
  if (!id) throw new Error(`No item id in ${url}`);
  return id;
}
