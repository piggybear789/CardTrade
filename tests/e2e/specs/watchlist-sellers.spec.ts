// tests/e2e/specs/watchlist-sellers.spec.ts
//
// WATCHLIST TOGGLE & PUBLIC SELLER PAGE PATHWAYS (Task 13.3, Req 11.1–11.3).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { selectRows } from '../support/db';
import { ALICE, BOB } from '../support/users';
import { listingTitle, openListing, seedListing, uniqueToken } from '../support/cashSaleRoom';

pathway(
  {
    id: 'watchlist-sellers.watch-toggle-and-seller-page',
    title: 'Member toggles watchlist on a listing and views the public seller profile',
    area: 'watchlist-sellers',
    kind: 'happy',
    provider: 'stripe',
    members: { member: BOB },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const itemId = await ctx.arrange('Seed listing', () =>
      seedListing(ALICE, { title: listingTitle(`Watch ${token}`, token), priceMinor: 3000 }),
    );

    await ctx.step('Toggle Save / Watch on listing', 'member', async (page) => {
      await openListing(page, itemId);
      await page.getByRole('button', { name: /^Save item/i }).filter({ visible: true }).first().click();
      await expect(
        page.getByRole('button', { name: /^Remove from saved items/i }).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
    });

    await ctx.assertState('Watchlist row exists and /saved lists the item', {
      member: 'member',
      db: async () => {
        const rows = await selectRows<{ item_id: string }>(
          'watchlist',
          `select=item_id&user_id=eq.${BOB.id}&item_id=eq.${itemId}`,
        );
        return rows.length;
      },
      ui: async (page) => {
        await page.goto('/saved');
        return (await page.locator(`a[href="/listings/${itemId}"]`).count()) > 0 ? 1 : 0;
      },
      expect: 1,
    });

    await ctx.step('Open public seller page', 'member', async (page) => {
      await page.goto(`/sellers/${ALICE.id}`);
      await expect(page.getByText(ALICE.displayName).first()).toBeVisible({ timeout: 10_000 });
    });
  },
);

pathway(
  {
    id: 'watchlist-sellers.guest-save-routed-to-signin',
    title: 'Guest attempting to watch or open /saved is routed to sign-in',
    area: 'watchlist-sellers',
    kind: 'refusal',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Guest visiting /saved is redirected to /sign-in',
      'visitor',
      async (page) => {
        await page.goto('/saved');
        await expect(page).toHaveURL(/\/sign-in\?redirectTo=%2Fsaved/, { timeout: 15_000 });
        return { code: 'UNAUTHENTICATED' };
      },
      { code: 'UNAUTHENTICATED' },
    );
  },
);
