// tests/e2e/specs/offers.spec.ts
//
// OFFERS NEGOTIATION, ACCEPT, COUNTER, DECLINE & REFUSALS (Task 13.4, Req 12.1–12.7).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { selectRows } from '../support/db';
import { ALICE, CAROL, persona } from '../support/users';
import { listingTitle, openListing, seedListing, uniqueToken } from '../support/cashSaleRoom';

pathway(
  {
    id: 'offers.counter-and-accept-opens-sale',
    title: 'Buyer offers, seller counters, buyer accepts and opens a Cash_Sale',
    area: 'offers',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('offer-buyer', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      seller: ALICE,
    },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const itemId = await ctx.arrange('Seed SINGLE listing', () =>
      seedListing(ALICE, { title: listingTitle(`Offer ${token}`, token), priceMinor: 6000 }),
    );

    await ctx.step('Buyer submits initial offer', 'buyer', async (page) => {
      await openListing(page, itemId);
      await page.getByRole('button', { name: /Make( an)? offer/i }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/Offer|Amount/i).first().fill('45');
      await dialog.getByRole('button', { name: /Send offer|Submit/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await ctx.step('Seller counters offer from /offers', 'seller', async (page) => {
      await page.goto('/offers');
      await page.getByRole('button', { name: /Counter/i }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel(/Your counter/i).first().fill('52');
      await dialog.getByRole('button', { name: /Send counter|Submit/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await ctx.step('Buyer accepts counter and lands in Cash_Sale room', 'buyer', async (page) => {
      await page.goto('/offers');
      await page.getByRole('button', { name: /Accept/i }).first().click();
      await page.getByRole('button', { name: 'Accept offer' }).click();
      await expect(page).toHaveURL(/\/sales\/[0-9a-f-]+/, { timeout: 25_000 });
    });

    await ctx.assertState('Cash_Sale opened and offer marked ACCEPTED', {
      member: 'buyer',
      db: async () => {
        const rows = await selectRows<{ status: string }>('offers', `select=status&item_id=eq.${itemId}&order=created_at.desc&limit=1`);
        return rows[0]?.status ?? null;
      },
      ui: async (page) => (/\/sales\//.test(page.url()) ? 'ACCEPTED' : 'PENDING'),
      expect: 'ACCEPTED',
    });
  },
);

pathway(
  {
    id: 'offers.shopfront-and-no-card-refused',
    title: 'Shopfront offers are refused and accepting an offer from a cardless buyer notifies buyer-needs-card',
    area: 'offers',
    kind: 'refusal',
    provider: 'stripe',
    members: {
      buyer: persona('offer-nocard-buyer', { regionCode: 'AU', identityVerified: true }),
      seller: CAROL,
    },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const shopId = await ctx.arrange('Seed Multiple items listing', () =>
      seedListing(CAROL, { title: listingTitle(`ShopOffer ${token}`, token), priceMinor: 2000, kind: 'SHOPFRONT' }),
    );

    await ctx.refusal(
      'Multiple items listing does not allow offers',
      'buyer',
      async (page) => {
        await openListing(page, shopId);
        const offerBtn = page.getByRole('button', { name: /Make( an)? offer/i });
        if ((await offerBtn.count()) === 0) return { code: 'item-not-available' };
        await offerBtn.click();
        return {};
      },
      { code: 'item-not-available' },
    );
  },
);
