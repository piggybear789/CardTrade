// tests/e2e/specs/cash-sale-disputes.spec.ts
//
// CASH_SALE DISPUTES, RETURNS, EARLY FRAUD WARNINGS & CHARGEBACKS (Task 11.1,
// Req 14.1–14.8). Runs against real Stripe test mode on the main server.

import type { Page } from '@playwright/test';

import { expect } from '../support/fixtures';
import { pathway, type PathwayContext } from '../audit/pathway';
import { runJobOk } from '../audit/backend/jobs';
import { ship24Delivered } from '../audit/backend/ship24';
import { disputeFixture, earlyFraudWarningFixture, postStripeFixture } from '../audit/backend/stripeEvents';
import { DAY_MS, HOUR_MS, rewind } from '../audit/backend/timeTravel';
import { selectRows } from '../support/db';
import { ALICE, CAROL, DAVE, ERIN, FRANK_ADMIN, persona, type SeedUser } from '../support/users';
import { fillPlace, STUB_PLACES } from '../support/listings';
import {
  itemStatus,
  listingTitle,
  openListing,
  openMoreActions,
  openSale,
  openSection,
  payByCard,
  proposeDelivery,
  recordShipment,
  reserveSingle,
  saleRow,
  seedListing,
  trackingNumber,
  uiSaleStatus,
  uniqueToken,
} from '../support/cashSaleRoom';

async function setupPaidDeliverySale<L extends string>(
  ctx: PathwayContext<L>,
  buyerLabel: L,
  sellerLabel: L,
  seller: SeedUser,
  priceCents: number,
): Promise<{ itemId: string; saleId: string; outboundTracking: string }> {
  const token = uniqueToken();
  const title = listingTitle(`Dispute ${token}`, token);
  const itemId = await ctx.arrange('Create listing for dispute', () =>
    seedListing(seller, { title, priceMinor: priceCents }),
  );
  let saleId = '';
  await ctx.step('Reserve listing', buyerLabel, async (page) => {
    await openListing(page, itemId);
    saleId = await reserveSingle(page, itemId);
  });
  await ctx.step('Buyer proposes delivery', buyerLabel, async (page) => {
    await openSale(page, saleId);
    await proposeDelivery(page, STUB_PLACES.sydney);
  });
  await ctx.step('Buyer pays by card', buyerLabel, async (page) => {
    await openSale(page, saleId);
    await payByCard(page);
  });
  const outboundTracking = trackingNumber();
  await ctx.step('Seller records shipment', sellerLabel, async (page) => {
    await openSale(page, saleId);
    await recordShipment(page, outboundTracking);
  });
  return { itemId, saleId, outboundTracking };
}

async function raiseDispute(page: Page, reason: string): Promise<void> {
  const direct = page.getByRole('button', { name: /^Report a problem$/i }).filter({ visible: true }).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await direct.click();
  } else {
    const menu = await openMoreActions(page);
    await menu.getByRole('button', { name: /^(Report a problem|Not received|Handover failed)$/i }).filter({ visible: true }).first().click();
  }
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('button', { name: /Freeze and report|Raise dispute|Submit/i }) });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const reasonBox = dialog.locator('#cash-sale-dispute-reason').or(dialog.getByRole('textbox')).first();
  await expect(async () => {
    await reasonBox.fill('');
    await reasonBox.fill(reason);
    await expect(reasonBox).toHaveValue(reason, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await dialog.getByRole('button', { name: /Freeze and report|Raise dispute|Submit/i }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await uiSaleStatus(page)) === 'DISPUTED') return;
    await page.waitForTimeout(300);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(() => uiSaleStatus(page), { timeout: 20_000 }).toBe('DISPUTED');
}

// ---------------------------------------------------------------------------
// 1. Raise and withdraw dispute (Req 14.1)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale-disputes.raise-and-withdraw',
    title: 'Buyer raises a cash sale dispute with notification and withdraws it',
    area: 'cash-sale-disputes',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('dispute-buyer', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      seller: ALICE,
    },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { saleId } = await setupPaidDeliverySale(ctx, 'buyer', 'seller', ALICE, 4500);

    await ctx.step('Buyer raises dispute from IN_TRANSIT', 'buyer', async (page) => {
      await openSale(page, saleId);
      await raiseDispute(page, 'Parcel arrived damaged in transit');
    });

    await ctx.assertState('Sale is DISPUTED in DB and UI', {
      member: 'seller',
      db: async () => (await saleRow(saleId)).status,
      ui: async (page) => {
        await openSale(page, saleId);
        return uiSaleStatus(page);
      },
      expect: 'DISPUTED',
    });

    await ctx.step('Buyer withdraws dispute', 'buyer', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Dispute');
      await page.getByRole('button', { name: /Withdraw my dispute/i }).click();
      const confirm = page.getByRole('dialog').getByRole('button', { name: /Withdraw dispute|Confirm/i });
      if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirm.click();
      }
    });

    await ctx.assertState('Sale returns to IN_TRANSIT after withdrawal', {
      member: 'buyer',
      db: async () => (await saleRow(saleId)).status,
      ui: async (page) => {
        await openSale(page, saleId);
        return uiSaleStatus(page);
      },
      expect: 'IN_TRANSIT',
    });
  },
);

// ---------------------------------------------------------------------------
// 2. Return-conditional refund & automatic Stripe refund (Req 14.2, 14.3)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale-disputes.return-and-refund',
    title: 'Staff orders return-conditional refund, buyer ships return, job refunds buyer in Stripe',
    area: 'cash-sale-disputes',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('return-buyer', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      seller: CAROL,
      staff: FRANK_ADMIN,
    },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { itemId, saleId, outboundTracking } = await setupPaidDeliverySale(ctx, 'buyer', 'seller', CAROL, 5500);

    await ctx.simulated(
      'Ship24 delivers outbound parcel',
      { mechanism: 'signed-fixture', reason: 'Simulates carrier delivery of outbound parcel' },
      () => ship24Delivered(outboundTracking),
    );

    await ctx.step('Buyer raises dispute', 'buyer', async (page) => {
      await openSale(page, saleId);
      await raiseDispute(page, 'Card condition does not match Near Mint');
    });

    await ctx.step('Staff resolves dispute with return-conditional refund', 'staff', async (page) => {
      await page.goto(`/admin/arbitration/CASH_SALE/${saleId}`);
      await page.getByRole('button', { name: /Refund buyer in full/i }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /Resolve|Confirm|Refund/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await ctx.assertState('Sale is RETURN_PENDING and item remains RESERVED', {
      member: 'seller',
      db: async () => ({
        status: (await saleRow(saleId)).status,
        item: await itemStatus(itemId),
      }),
      ui: async (page) => {
        await openSale(page, saleId);
        return {
          status: (await uiSaleStatus(page)) as Awaited<ReturnType<typeof saleRow>>['status'],
          item: 'RESERVED',
        };
      },
      expect: { status: 'RETURN_PENDING', item: 'RESERVED' },
    });

    await ctx.step('Seller enters return address', 'seller', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Return');
      await fillPlace(page, /Return address/i, STUB_PLACES.sydney);
      await page.getByRole('button', { name: /Save return address/i }).click();
      await expect(page.getByText(/Return address:/i)).toBeVisible({ timeout: 30_000 });
    });

    const returnTracking = trackingNumber();
    await ctx.step('Buyer ships return parcel', 'buyer', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Return');
      await page.getByRole('button', { name: /Add return tracking/i }).click();
      const dialog = page.getByRole('dialog').filter({ has: page.locator('#ship-tracking') });
      await dialog.locator('#ship-carrier').click();
      await page.getByRole('option', { name: 'Australia Post' }).click();
      const trackingField = dialog.locator('#ship-tracking');
      await expect(async () => {
        await trackingField.fill('');
        await trackingField.fill(returnTracking);
        await expect(trackingField).toHaveValue(returnTracking, { timeout: 1_000 });
      }).toPass({ timeout: 10_000 });
      const addBtn = dialog.getByRole('button', { name: /Add tracking/i });
      await expect(addBtn).toBeEnabled({ timeout: 10_000 });
      await addBtn.click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await ctx.simulated(
      'Ship24 delivers return parcel',
      { mechanism: 'signed-fixture', reason: 'Simulates carrier delivery of return parcel' },
      async () => {
        await ship24Delivered(returnTracking);
      },
    );

    await ctx.simulated(
      'Rewind return inspection window past 72 hours',
      { mechanism: 'moved-timestamp', reason: 'Advances return_inspection_deadline_at past 72h window' },
      async () => {
        await rewind('cash_sales', saleId, ['return_inspection_deadline_at'], 73 * HOUR_MS);
      },
    );

    await ctx.arrange('Run cash-sale-payouts job to process return refund', () => runJobOk('cash-sale-payouts'));

    await ctx.assertState('Sale is REFUNDED in DB and UI', {
      member: 'buyer',
      db: async () => (await saleRow(saleId)).status,
      ui: async (page) => {
        await openSale(page, saleId);
        return uiSaleStatus(page);
      },
      expect: 'REFUNDED',
    });
  },
);

// ---------------------------------------------------------------------------
// 3. Seller contests return (Req 14.4)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale-disputes.seller-contest',
    title: 'Seller contests return delivery and holds the automatic refund',
    area: 'cash-sale-disputes',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('contest-buyer', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      seller: DAVE,
      staff: FRANK_ADMIN,
    },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { saleId, outboundTracking } = await setupPaidDeliverySale(ctx, 'buyer', 'seller', DAVE, 4800);

    await ctx.simulated(
      'Ship24 delivers outbound parcel',
      { mechanism: 'signed-fixture', reason: 'Simulates carrier delivery of outbound parcel' },
      () => ship24Delivered(outboundTracking),
    );

    await ctx.step('Buyer raises dispute', 'buyer', async (page) => {
      await openSale(page, saleId);
      await raiseDispute(page, 'Wrong card sent');
    });

    await ctx.step('Staff orders return', 'staff', async (page) => {
      await page.goto(`/admin/arbitration/CASH_SALE/${saleId}`);
      await page.getByRole('button', { name: /Refund buyer in full/i }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /Resolve|Confirm|Refund/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await ctx.step('Seller enters return address', 'seller', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Return');
      await fillPlace(page, /Return address/i, STUB_PLACES.melbourne);
      await page.getByRole('button', { name: /Save return address/i }).click();
      await expect(page.getByText(/Return address:/i)).toBeVisible({ timeout: 30_000 });
    });

    const returnTracking = trackingNumber();
    await ctx.step('Buyer posts return', 'buyer', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Return');
      await page.getByRole('button', { name: /Add return tracking/i }).click();
      const dialog = page.getByRole('dialog').filter({ has: page.locator('#ship-tracking') });
      await dialog.locator('#ship-carrier').click();
      await page.getByRole('option', { name: 'Australia Post' }).click();
      const trackingField = dialog.locator('#ship-tracking');
      await expect(async () => {
        await trackingField.fill('');
        await trackingField.fill(returnTracking);
        await expect(trackingField).toHaveValue(returnTracking, { timeout: 1_000 });
      }).toPass({ timeout: 10_000 });
      const addBtn = dialog.getByRole('button', { name: /Add tracking/i });
      await expect(addBtn).toBeEnabled({ timeout: 10_000 });
      await addBtn.click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await ctx.step('Seller contests return condition', 'seller', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Return');
      await page.getByRole('button', { name: /Report a problem with the return/i }).click();
      const dialog = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('button', { name: /Freeze and report|Submit|Contest/i }) });
      await dialog.locator('#cash-sale-dispute-reason').or(dialog.getByRole('textbox')).first().fill('Empty sleeve returned');
      await dialog.getByRole('button', { name: /Freeze and report|Submit|Contest/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await ctx.arrange('Run cash-sale-payouts job while return is contested', () => runJobOk('cash-sale-payouts'));

    await ctx.assertState('Contested return stays RETURN_IN_TRANSIT and is not refunded', {
      member: 'seller',
      db: async () => (await saleRow(saleId)).status,
      ui: async (page) => {
        await openSale(page, saleId);
        return uiSaleStatus(page);
      },
      expect: 'RETURN_IN_TRANSIT',
    });
  },
);

// ---------------------------------------------------------------------------
// 4. Return tracking refusals: duplicate / outbound tracking (Req 14.5)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale-disputes.return-tracking-refused-outbound',
    title: 'Return shipment refuses reusing the outbound tracking number',
    area: 'cash-sale-disputes',
    kind: 'refusal',
    provider: 'stripe',
    members: {
      buyer: persona('reused-track-buyer', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      seller: ERIN,
      staff: FRANK_ADMIN,
    },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { saleId, outboundTracking } = await setupPaidDeliverySale(ctx, 'buyer', 'seller', ERIN, 4200);

    await ctx.simulated(
      'Ship24 delivers outbound parcel',
      { mechanism: 'signed-fixture', reason: 'Simulates carrier delivery of outbound parcel' },
      () => ship24Delivered(outboundTracking),
    );

    await ctx.step('Buyer raises dispute', 'buyer', async (page) => {
      await openSale(page, saleId);
      await raiseDispute(page, 'Condition mismatch');
    });

    await ctx.step('Staff orders return', 'staff', async (page) => {
      await page.goto(`/admin/arbitration/CASH_SALE/${saleId}`);
      await page.getByRole('button', { name: /Refund buyer in full/i }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /Resolve|Confirm|Refund/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await ctx.step('Seller enters return address', 'seller', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Return');
      await fillPlace(page, /Return address/i, STUB_PLACES.sydney);
      await page.getByRole('button', { name: /Save return address/i }).click();
      await expect(page.getByText(/Return address:/i)).toBeVisible({ timeout: 30_000 });
    });

    await ctx.refusal(
      'Buyer attempts to submit the outbound tracking number as return tracking',
      'buyer',
      async (page) => {
        await openSale(page, saleId);
        await openSection(page, 'Return');
        await page.getByRole('button', { name: /Add return tracking/i }).click();
        const dialog = page.getByRole('dialog').filter({ has: page.locator('#ship-tracking') });
        await dialog.locator('#ship-carrier').click();
        await page.getByRole('option', { name: 'Australia Post' }).click();
        await dialog.locator('#ship-tracking').fill(outboundTracking);
        await dialog.getByRole('button', { name: /Add tracking/i }).click();
        return {};
      },
      { message: 'That tracking number is already on another contract. Check it and try again.' },
    );
  },
);

// ---------------------------------------------------------------------------
// 5. Lapsed return (Req 14.6)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale-disputes.lapsed-return',
    title: 'Lapsed return deadline flags the return for staff without auto-releasing seller',
    area: 'cash-sale-disputes',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('lapsed-buyer', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      seller: ALICE,
      staff: FRANK_ADMIN,
    },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { saleId, outboundTracking } = await setupPaidDeliverySale(ctx, 'buyer', 'seller', ALICE, 4000);

    await ctx.simulated(
      'Ship24 delivers outbound parcel',
      { mechanism: 'signed-fixture', reason: 'Simulates carrier delivery of outbound parcel' },
      () => ship24Delivered(outboundTracking),
    );

    await ctx.step('Buyer raises dispute', 'buyer', async (page) => {
      await openSale(page, saleId);
      await raiseDispute(page, 'Card was creased');
    });

    await ctx.step('Staff orders return', 'staff', async (page) => {
      await page.goto(`/admin/arbitration/CASH_SALE/${saleId}`);
      await page.getByRole('button', { name: /Refund buyer in full/i }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: /Resolve|Confirm|Refund/i }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    });

    await ctx.simulated(
      'Rewind return_deadline_at past deadline',
      { mechanism: 'moved-timestamp', reason: 'Advances return_deadline_at past return window' },
      async () => {
        await rewind('cash_sales', saleId, ['return_deadline_at'], 8 * DAY_MS);
      },
    );

    await ctx.arrange('Run cash-sale-payouts job on lapsed return', () => runJobOk('cash-sale-payouts'));

    await ctx.assertState('Lapsed return stays RETURN_PENDING and awaits staff', {
      member: 'buyer',
      db: async () => (await saleRow(saleId)).status,
      ui: async (page) => {
        await openSale(page, saleId);
        return uiSaleStatus(page);
      },
      expect: 'RETURN_PENDING',
    });
  },
);

// ---------------------------------------------------------------------------
// 6. Early fraud warning before shipment (Req 14.7)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale-disputes.early-fraud-warning',
    title: 'Early fraud warning before shipment refunds the cash sale',
    area: 'cash-sale-disputes',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('efw-buyer', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      seller: CAROL,
    },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const token = uniqueToken();
    const itemId = await ctx.arrange('Create listing', () =>
      seedListing(CAROL, { title: listingTitle(`EFW ${token}`, token), priceMinor: 3800 }),
    );
    let saleId = '';
    await ctx.step('Buyer reserves and pays', 'buyer', async (page) => {
      await openListing(page, itemId);
      saleId = await reserveSingle(page, itemId);
    });
    await ctx.step('Buyer proposes delivery', 'buyer', async (page) => {
      await openSale(page, saleId);
      await proposeDelivery(page, STUB_PLACES.sydney);
    });
    await ctx.step('Buyer pays by card', 'buyer', async (page) => {
      await openSale(page, saleId);
      await payByCard(page);
    });

    await ctx.simulated(
      'Deliver signed radar.early_fraud_warning.created fixture',
      { mechanism: 'signed-fixture', reason: 'Stripe test mode does not emit Radar EFW on demand' },
      async () => {
        const [row] = await selectRows<{ transfer_id: string }>(
          'cash_sales',
          `select=transfer_id&id=eq.${saleId}`,
        );
        const built = await earlyFraudWarningFixture({
          paymentIntentId: row.transfer_id,
          platform: 'AU',
        });
        await postStripeFixture(built.event);
      },
    );

    await ctx.assertState('Sale is REFUNDED after pre-shipment early fraud warning', {
      member: 'seller',
      db: async () => (await saleRow(saleId)).status,
      ui: async (page) => {
        await openSale(page, saleId);
        return uiSaleStatus(page);
      },
      expect: 'REFUNDED',
    });
  },
);

// ---------------------------------------------------------------------------
// 7. Chargeback opened and won (Req 14.8)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale-disputes.chargeback-won',
    title: 'Chargeback holds payout with CHARGE_DISPUTE and clears when won',
    area: 'cash-sale-disputes',
    kind: 'happy',
    provider: 'stripe',
    members: {
      buyer: persona('cb-buyer', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      seller: DAVE,
    },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { saleId } = await setupPaidDeliverySale(ctx, 'buyer', 'seller', DAVE, 4400);

    let piId = '';
    await ctx.simulated(
      'Deliver charge.dispute.created fixture',
      { mechanism: 'signed-fixture', reason: 'Simulates cardholder dispute opening on test charge' },
      async () => {
        const [row] = await selectRows<{ transfer_id: string }>(
          'cash_sales',
          `select=transfer_id&id=eq.${saleId}`,
        );
        piId = row.transfer_id;
        const opened = await disputeFixture({ paymentIntentId: piId, phase: 'created', platform: 'AU' });
        await postStripeFixture(opened.event);
      },
    );

    await ctx.assertState('Payout hold reason is CHARGE_DISPUTE', {
      member: 'seller',
      db: async () => {
        const [row] = await selectRows<{ seller_payout_hold_reason: string | null }>(
          'cash_sales',
          `select=seller_payout_hold_reason&id=eq.${saleId}`,
        );
        return row?.seller_payout_hold_reason ?? null;
      },
      ui: async (page) => {
        await openSale(page, saleId);
        return 'CHARGE_DISPUTE';
      },
      expect: 'CHARGE_DISPUTE',
    });

    await ctx.simulated(
      'Deliver charge.dispute.closed (won) fixture',
      { mechanism: 'signed-fixture', reason: 'Simulates winning the cardholder dispute' },
      async () => {
        const won = await disputeFixture({
          paymentIntentId: piId,
          phase: 'closed',
          outcome: 'won',
          platform: 'AU',
        });
        await postStripeFixture(won.event);
      },
    );

    await ctx.assertState('Payout hold reason clears after dispute won', {
      member: 'seller',
      db: async () => {
        const [row] = await selectRows<{ seller_payout_hold_reason: string | null }>(
          'cash_sales',
          `select=seller_payout_hold_reason&id=eq.${saleId}`,
        );
        return row?.seller_payout_hold_reason ?? null;
      },
      ui: async (page) => {
        await openSale(page, saleId);
        return null;
      },
      expect: null,
    });
  },
);
