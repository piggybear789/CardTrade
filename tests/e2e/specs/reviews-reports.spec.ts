// tests/e2e/specs/reviews-reports.spec.ts
//
// REVIEWS AFTER COMPLETION & LISTING/USER REPORTS (Task 14.3, Req 20.1–20.3).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { selectRows } from '../support/db';
import { rewind } from '../audit/backend/timeTravel';
import { ALICE, BOB, FRANK_ADMIN, persona } from '../support/users';
import { STUB_PLACES } from '../support/listings';
import {
  completePurchase,
  listingTitle,
  openListing,
  openSale,
  payByCard,
  proposeInPerson,
  confirmHandover,
  reserveSingle,
  saleRow,
  seedListing,
  uniqueToken,
} from '../support/cashSaleRoom';

pathway(
  {
    id: 'reviews-reports.review-and-report-flow',
    title: 'Buyer leaves a review on completed sale and reports a listing to admin queue',
    area: 'reviews-reports',
    kind: 'happy',
    provider: 'stripe',
    timeout: 240_000,
    members: {
      buyer: persona('review-buyer', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      seller: ALICE,
      staff: FRANK_ADMIN,
    },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const itemId = await ctx.arrange('Seed listing', () =>
      seedListing(ALICE, { title: listingTitle(`Review ${token}`, token), priceMinor: 3000 }),
    );
    let saleId = '';
    await ctx.step('Propose in-person meeting', ['buyer', 'seller'], async (_p, pages) => {
      await openListing(pages.buyer, itemId);
      saleId = await reserveSingle(pages.buyer, itemId);
      await openSale(pages.seller, saleId);
      await proposeInPerson(pages.seller, 1, STUB_PLACES.sydney);
    });
    await ctx.simulated(
      'Bring meeting time within the handover confirmation window',
      { mechanism: 'moved-timestamp', reason: 'A handover can be confirmed only from an hour before the meeting.' },
      async () => {
        const sale = await saleRow(saleId);
        const by = Date.parse(sale.meeting_at!) - (Date.now() + 30 * 60_000);
        await rewind('cash_sales', saleId, ['meeting_at'], Math.max(0, Math.floor(by)));
      },
    );
    await ctx.step('Complete in-person cash sale', ['buyer', 'seller'], async (_p, pages) => {
      await openSale(pages.buyer, saleId);
      await payByCard(pages.buyer);
      await confirmHandover(pages.buyer);
      await expect(
        pages.buyer.getByRole('button', { name: 'Handover confirmed' }).filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await openSale(pages.seller, saleId);
      await confirmHandover(pages.seller);
      await expect(
        pages.seller.locator('[aria-label="Sale status: Inspection"]').filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await openSale(pages.buyer, saleId);
      await completePurchase(pages.buyer);
      await expect(
        pages.buyer.locator('[aria-label="Sale status: Completed"]').filter({ visible: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
    });

    await ctx.step('Buyer leaves 5-star review', 'buyer', async (page) => {
      await openSale(page, saleId);
      await page.getByRole('button', { name: /Leave a review|Leave review|Rate/i }).filter({ visible: true }).first().click();
      await page.getByRole('radio', { name: /5 stars/i }).click();
      await page.getByLabel(/Comment/i).fill(`Smooth handover ${token}`);
      await page.getByRole('button', { name: /Submit review/i }).click();
    });

    await ctx.assertState('Review appears on sale room and in DB', {
      member: 'buyer',
      db: async () => {
        const rows = await selectRows<{ rating: number }>('reviews', `select=rating&source_id=eq.${saleId}`);
        return rows[0]?.rating ?? 0;
      },
      ui: async (page) => {
        if (!page.url().includes(`/sales/${saleId}`)) {
          await openSale(page, saleId);
        } else {
          await page.reload();
        }
        await expect(page.getByText(/Reviewed/i).first()).toBeVisible({ timeout: 15_000 });
        return 5;
      },
      expect: 5,
    });
  },
);

pathway(
  {
    id: 'reviews-reports.report-does-not-notify-target',
    title: 'Reporting a listing queues it for staff without notifying the seller',
    area: 'reviews-reports',
    kind: 'refusal',
    provider: 'stripe',
    members: { reporter: BOB, seller: ALICE },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const itemId = await ctx.arrange('Seed listing', () =>
      seedListing(ALICE, { title: listingTitle(`Report ${token}`, token), priceMinor: 2500 }),
    );

    await ctx.step('Reporter submits listing report', 'reporter', async (page) => {
      await openListing(page, itemId);
      await page.getByRole('button', { name: 'Report listing' }).filter({ visible: true }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.locator('#report-reason').click();
      await page.getByRole('option').first().click();
      await dialog.locator('#report-details').fill(`Suspected counterfeit ${token}`);
      await dialog.getByRole('button', { name: /Submit report/i }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    });

    await ctx.refusal(
      'Seller receives zero notifications for the report',
      'seller',
      async () => {
        const rows = await selectRows<{ id: string }>(
          'notifications',
          `select=id&user_id=eq.${ALICE.id}&body=ilike.*${token}*`,
        );
        expect(rows.length).toBe(0);
        return { code: 'NO_TARGET_NOTIFICATION' };
      },
      { code: 'NO_TARGET_NOTIFICATION' },
    );
  },
);
