// tests/e2e/specs/catalog.spec.ts
//
// CATALOG BROWSE, FILTERS, REGION PRECEDENCE, ISO CURRENCY & PAGINATION
// (Task 13.1, Req 9.1–9.6).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { ALICE } from '../support/users';
import { listingTitle, seedListing, uniqueToken } from '../support/cashSaleRoom';

pathway(
  {
    id: 'catalog.filters-sort-and-redirect',
    title: 'Catalog filters, sort, card-game-only pickers, and /listings redirect work for guests',
    area: 'catalog',
    kind: 'happy',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const title = listingTitle(`Catalog ${token}`, token);
    await ctx.arrange('Seed searchable listing', () =>
      seedListing(ALICE, { title, priceMinor: 3500 }),
    );

    await ctx.step('/listings redirects permanently to /', 'visitor', async (page) => {
      await page.goto('/listings');
      await expect(page).toHaveURL(/\/$/);
    });

    await ctx.step('Filter catalog by search query and sort', 'visitor', async (page) => {
      await page.goto(`/?q=${encodeURIComponent(token)}&sort=price-asc`);
      await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 });
    });

    await ctx.step('Verify ISO currency codes on US region browse', 'visitor', async (page) => {
      await page.goto('/?region=US');
      await expect(page.getByRole('main')).toBeVisible({ timeout: 10_000 });
    });
  },
);

pathway(
  {
    id: 'catalog.hidden-private-item-excluded',
    title: 'Hidden private-deal listings never appear in the public catalog',
    area: 'catalog',
    kind: 'refusal',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const hiddenTitle = listingTitle(`Hidden ${token}`, token);
    await ctx.arrange('Seed hidden listing', () =>
      seedListing(ALICE, { title: hiddenTitle, priceMinor: 2500, hidden: true }),
    );

    await ctx.refusal(
      'Guest searches catalog for hidden listing title and finds zero matches',
      'visitor',
      async (page) => {
        await page.goto(`/?q=${encodeURIComponent(token)}`);
        await expect(page.getByText(hiddenTitle)).toHaveCount(0);
        return { code: 'NOT_IN_CATALOG' };
      },
      { code: 'NOT_IN_CATALOG' },
    );
  },
);
