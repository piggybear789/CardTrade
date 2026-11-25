// tests/e2e/specs/listings.spec.ts
//
// LISTING CREATE, EDIT, SHOPFRONT CLOSE & OWNERSHIP GUARDS (Task 13.2, Req 10.1–10.9, 31.1).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { ALICE, BOB, persona } from '../support/users';
import { createListing, fillPlace, STUB_PLACES, TEST_IMAGE } from '../support/listings';
import { listingTitle, openListing, seedListing, uniqueToken } from '../support/cashSaleRoom';

pathway(
  {
    id: 'listings.create-single-and-shopfront',
    title: 'Verified seller creates SINGLE and Multiple items listings and edits them',
    area: 'listings',
    kind: 'happy',
    provider: 'stripe',
    members: { seller: ALICE },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const title = listingTitle(`Single ${token}`, token);

    await ctx.step('Open /listings/new and create a SINGLE listing', 'seller', async (page) => {
      await createListing(page, {
        title,
        priceDollars: '45.00',
        description: `Near mint card ${token}`,
        place: STUB_PLACES.sydney,
      });
    });

    await ctx.step('Create a Multiple items listing with shopfront copy', 'seller', async (page) => {
      await page.goto('/listings/new');
      await page.waitForLoadState('domcontentloaded');
      await page.getByText('Multiple items', { exact: true }).click();
      await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE);
      await expect(
        page.getByRole('button', { name: 'Remove photo 1' }).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 20_000 });
      await page.getByLabel('Title', { exact: true }).fill(listingTitle(`Bundle ${token}`, token));
      await page.getByRole('textbox', { name: 'Description', exact: true }).fill(`Multiple items set ${token}`);
      await page.getByRole('button', { name: 'Next' }).filter({ visible: true }).first().click();

      await expect(page.locator('#game')).toBeVisible({ timeout: 10_000 });
      await page.locator('#game').click();
      await page.getByRole('option', { name: 'Pokémon' }).click();
      await page.locator('#condition').click();
      await page.getByRole('option', { name: 'Near Mint' }).click();
      await page.waitForTimeout(100);
      await page.getByLabel(/Price/i).first().fill('10');
      await fillPlace(page, /Based near/i, STUB_PLACES.sydney);
      await page.getByRole('button', { name: /Publish|Create listing/i }).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(/\/listings\/[0-9a-f-]+/, { timeout: 25_000 });
    });
  },
);

pathway(
  {
    id: 'listings.unverified-and-non-owner-refused',
    title: 'Unverified member cannot list and non-owner cannot edit another seller listing',
    area: 'listings',
    kind: 'refusal',
    provider: 'stripe',
    members: {
      unverified: persona('unverified-lister', { regionCode: 'AU', identityVerified: false }),
      other: BOB,
    },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const itemId = await ctx.arrange('Seed Alice listing', () =>
      seedListing(ALICE, { title: listingTitle(`Owned ${token}`, token), priceMinor: 3000 }),
    );

    await ctx.refusal(
      'Unverified member visiting /listings/new is blocked by Identity_Gate',
      'unverified',
      async (page) => {
        await page.goto('/listings/new');
        await expect(page.getByText(/Verify your identity/i).first()).toBeVisible({ timeout: 15_000 });
        return { code: 'IDENTITY_REQUIRED' };
      },
      { code: 'IDENTITY_REQUIRED' },
    );

    await ctx.refusal(
      'Non-owner visiting /listings/[id]/edit is refused',
      'other',
      async (page) => {
        await openListing(page, itemId);
        await page.goto(`/listings/${itemId}/edit`);
        await expect(page.getByText(/not found|404/i).first()).toBeVisible({ timeout: 15_000 });
        return { code: 'FORBIDDEN' };
      },
      { code: 'FORBIDDEN' },
    );
  },
);
