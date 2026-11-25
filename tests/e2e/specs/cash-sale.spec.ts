// tests/e2e/specs/cash-sale.spec.ts
//
// THE CASH_SALE LIFECYCLE as audit Pathways (task 9.1, Req 13.1–13.4, 13.12–13.18,
// 31.1, 34.2), on the main server against REAL Stripe test mode. Payment methods,
// card tiers and the money-path refusals that are about the Pay step live in
// `cash-sale-payments.spec.ts` (task 9.2).
//
// EVERY PATHWAY OWNS ITS RECORDS (Req 34.2, F70). Each one arranges its own marked
// listing and opens its own contract, and the buyer is a Persona created for the run
// (a fresh account with a Stripe test card saved on the AU platform), so no Pathway
// consumes a seed item, races another worker for a seed buyer's session, or depends
// on the order files run in. Sellers are seed members, because a seller needs the
// Identity_Gate, a disclosure and a payable Connect fixture account
// (`audit/stripe-bindings.setup.ts`); they are spread over Alice, Carol, Dave and Erin
// so parallel workers rarely share one.
//
// STATE IS READ TWICE (Req 6.7). Each `assertState` reads the database with the service
// role AND what the member sees (the room's status badge, `aria-label="Sale status:
// …"`, the inspection countdown, the Items tab), and both must agree.
//
// SIMULATED EVENTS (Req 4.7) are labelled with their mechanism:
//   * carrier delivery: a Ship24-shaped event to the real webhook route with the
//     sandbox bearer secret (`signed-fixture`);
//   * elapsed time (an inspection window, the new-seller holdback, the 30-minute
//     unfinished payment, a meeting brought forward): `rewind(...)` on the sale row
//     (`moved-timestamp`), followed by the Job_Endpoint or Cron_Function that reads it.
// Job_Endpoint and Cron_Function calls themselves are `arrange` steps: they are the
// scheduler's work, not a member's, and nothing about them is simulated.
//
// NOT COVERED HERE, AND WHY (reported to the checkpoint): `TRACKING_PREDATES_PAYMENT`
// and the "already delivered when entered" flag (`DELIVERED_AT_REGISTRATION`) are
// decided inside `recordCashSaleShipment` from the server's own Ship24 registration
// (`Ship24TrackingService.registerShipment`), a live call to api.ship24.com that no
// webhook fixture reaches. The "delivered before it shipped" flag
// (`DELIVERED_BEFORE_SHIPMENT`), which the webhook DOES decide, is covered instead.
//
// ACCEPTANCES ON A CASH SALE. Since 0099 nothing writes `buyer_terms_accepted_version`
// or `seller_terms_accepted_version`: paying is the commitment. What "voids both
// acceptances" means to a member is that a Pay dialog opened on the old terms is closed
// and refused ("The seller changed the terms. Review them before paying."), and the
// database shows the terms version bumped with both acceptance columns null. A
// fulfilment-only change keeps the buyer able to pay without anyone re-confirming.

import type { Page } from '@playwright/test';

import { expect } from '../support/fixtures';
import { pathway, type PathwayContext } from '../audit/pathway';
import { rewind, DAY_MS, HOUR_MS } from '../audit/backend/timeTravel';
import { runJobOk } from '../audit/backend/jobs';
import { runCron } from '../audit/backend/cron';
import { ship24Delivered } from '../audit/backend/ship24';
import { testStripe } from '../audit/backend/stripe';
import { MEMBER_FIXTURES } from '../audit/stripeFixtures';
import { ALICE, CAROL, DAVE, ERIN, persona, type SeedUser } from '../support/users';
import { STUB_PLACES } from '../support/listings';
import {
  cancelFromRoom,
  catalogListsTitle,
  completePurchase,
  confirmHandover,
  hoursUntil,
  itemStatus,
  listingTitle,
  memberCashSaleApi,
  openListing,
  openMoreActions,
  openPayDialog,
  openSale,
  openSection,
  payByCard,
  payDialog,
  proposeDelivery,
  proposeInPerson,
  recordShipment,
  requestFromShopfront,
  reserveSingle,
  saleLines,
  saleRow,
  salesForItem,
  seedListing,
  trackingNumber,
  uiInspectionWindowHours,
  uiSaleStatus,
  uniqueToken,
  waitForChallenge,
} from '../support/cashSaleRoom';

// ---------------------------------------------------------------------------
// Shared values
// ---------------------------------------------------------------------------

/** A buyer with a domestic (AU-issued) Stripe test card saved, created for the run. */
const cardBuyer = (label: string) => persona(label, { savedCard: true });

/** A member with no card, for catalog views and the no-card refusal. */
const plainMember = (label: string) => persona(label);

/** The listing price these Pathways use, in AUD cents. Under every 3-D Secure "always" threshold. */
const PRICE_MINOR = 4_500;

/** A paid Pathway: two members, Stripe round trips, a challenge, and jobs. */
const PAID_TIMEOUT = 360_000;
const UNPAID_TIMEOUT = 180_000;

/** The 7-day inspection window of a posted sale, and the 24-hour in-person one, in hours. */
const POSTED_WINDOW_HOURS = 7 * 24;
const IN_PERSON_WINDOW_HOURS = 24;

/** `formatMoney(cents, 'aud')` as the room prints it, e.g. "$55.00 AUD". */
function aud(cents: number): string {
  return `$${(cents / 100).toFixed(2)} AUD`;
}

/** The seed records every Pathway here relies on (the photo is Trade Pair A's). */
function seedFor(seller: SeedUser): string[] {
  return [seller.email.split('@')[0], 'trade-pair-a-alice'];
}

/** A sale's status, read both ways: the row, and the badge the member sees. */
function statusIs(
  ctx: PathwayContext<string>,
  name: string,
  member: string,
  saleId: () => string,
  expected: string,
  timeout?: number,
): Promise<void> {
  return ctx.assertState(name, {
    member,
    db: async () => (await saleRow(saleId())).status,
    ui: async (page) => {
      const s = await uiSaleStatus(page);
      if (s === expected) return s;
      await page.waitForTimeout(2_000);
      const s2 = await uiSaleStatus(page);
      if (s2 === expected) return s2;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
      return uiSaleStatus(page);
    },
    expect: expected,
    ...(timeout ? { timeout } : {}),
  });
}

/**
 * The common opening of a posted sale: the buyer reserves the listing, proposes
 * delivery to a resolved address, and pays by their saved card, passing 3-D Secure
 * when the issuer asks. Ends with the sale held (ESCROW_HELD), read both ways.
 */
async function reserveDeliverAndPay(
  ctx: PathwayContext<'buyer' | 'seller'>,
  itemId: () => string,
  setSale: (id: string) => void,
  saleId: () => string,
): Promise<void> {
  await ctx.step('Buyer presses Buy now and reserves the listing', 'buyer', async (page) => {
    setSale(await reserveSingle(page, itemId()));
  });
  await ctx.step('Buyer proposes delivery to a resolved address', 'buyer', (page) => proposeDelivery(page));
  // Two steps, so the fee copy is read while the Pay dialog that states it is open:
  // after paying, the rate lives only on the Payment tab, which is not on screen.
  await ctx.step(
    'Buyer opens Pay and reads the service fee and the total',
    'buyer',
    async (page) => {
      // The plain room URL closes the phone's details sheet, which covers the dock.
      await openSale(page, saleId());
      await openPayDialog(page);
    },
    { copy: { fee: { currency: 'aud', method: 'CARD' } }, moneySurface: 'contract' },
  );
  await ctx.step('Buyer pays by their saved card (3-D Secure when the issuer asks)', 'buyer', async (page) => {
    await payByCard(page);
  });
  await statusIs(ctx, 'The payment is held by the platform', 'buyer', saleId, 'ESCROW_HELD', 60_000);
}

// ---------------------------------------------------------------------------
// Buy Now
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale.buy-now.no-card',
    title: 'Buy Now without a saved card is refused (BUYER_NO_PAYMENT_METHOD)',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    members: { buyer: plainMember('no-card-buyer') },
    viewports: 'both',
    requiresSeed: seedFor(ALICE),
    timeout: UNPAID_TIMEOUT,
  },
  async ({ step, arrange, refusal, assertState }) => {
    let itemId = '';
    await arrange('Alice has a single card listed', async () => {
      itemId = await seedListing(ALICE, { title: listingTitle('No card target', uniqueToken()), priceMinor: PRICE_MINOR });
    });

    await step('Buyer opens Buy now and is asked to add a card first', 'buyer', async (page) => {
      await openListing(page, itemId);
      await page.getByRole('button', { name: /^Buy( now)?$/ }).filter({ visible: true }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Start a purchase contract' })).toBeVisible({ timeout: 25_000 });
      // `BuyButton`: with no card the footer's control is the way forward, and the card
      // row explains why. No reserve control is offered at all.
      await expect(dialog.getByText('Add a card to reserve')).toBeVisible({ timeout: 25_000 });
      await expect(dialog.getByRole('button', { name: 'Add a card to continue' })).toBeEnabled();
      await expect(dialog.getByRole('button', { name: 'Reserve item and agree terms' })).toHaveCount(0);
    });

    // The web dialog never sends a reserve without a card, so the server's own refusal
    // is asserted through the mobile endpoint that calls the same `initiateCashSale`.
    await refusal(
      'The server refuses to reserve for a buyer with no card',
      'buyer',
      async (page) => {
        const result = await memberCashSaleApi(page, 'initiate', {
          itemId,
          // Any non-empty version: the card check runs before the identity check.
          sellerIdentityVersion: 'e2e-not-read',
          buyerConfirmedSellerIdentity: true,
        });
        return { code: result.error };
      },
      // `mapError`: BUYER_NO_PAYMENT_METHOD → 'no-payment-method'.
      { code: 'no-payment-method' },
    );

    await assertState('Nothing was reserved', {
      member: 'buyer',
      db: async () => ({ item: await itemStatus(itemId), sales: (await salesForItem(itemId)).length }),
      ui: async (page) => {
        await page.keyboard.press('Escape');
        const buy = page.getByRole('button', { name: /^Buy( now)?$/ }).filter({ visible: true }).first();
        return { item: (await buy.isVisible().catch(() => false)) ? 'AVAILABLE' : 'not offered', sales: 0 };
      },
      expect: { item: 'AVAILABLE', sales: 0 },
    });
  },
);

pathway(
  {
    id: 'cash-sale.buy-now.reserves-single',
    title: 'Buy Now on a single card opens a contract and takes the listing off the catalog',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: cardBuyer('reserving-buyer'), seller: ALICE, viewer: plainMember('catalog-viewer') },
    viewports: 'both',
    requiresSeed: seedFor(ALICE),
    timeout: UNPAID_TIMEOUT,
  },
  async ({ step, arrange, assertState }) => {
    const token = uniqueToken();
    const title = listingTitle('Reserve target', token);
    let itemId = '';
    let saleId = '';

    await arrange('Alice has a single card listed', async () => {
      itemId = await seedListing(ALICE, { title, priceMinor: PRICE_MINOR });
    });

    await step('Another member finds the listing in the catalog', 'viewer', async (page) => {
      expect(await catalogListsTitle(page, token, title, true), 'the listing is in the catalog before Buy now').toBe(true);
    });

    await step('Buyer presses Buy now and reserves the card', 'buyer', async (page) => {
      saleId = await reserveSingle(page, itemId);
    });

    await assertState('A contract opens in AGREEMENT and no money has moved', {
      member: 'buyer',
      db: async () => {
        const sale = await saleRow(saleId);
        return { status: sale.status, collected: sale.transfer_id !== null };
      },
      ui: async (page) => ({
        status: await uiSaleStatus(page),
        // Before payment the room's next step is the terms ("Set delivery details"),
        // and it offers no "Complete payment" for an outstanding charge.
        collected:
          !(await page.getByRole('button', { name: 'Set delivery details' }).filter({ visible: true }).first().isVisible().catch(() => false)) ||
          (await page.getByRole('button', { name: 'Complete payment' }).count()) > 0,
      }),
      expect: { status: 'AGREEMENT', collected: false },
    });

    await assertState('The reserved card leaves the catalog for other members', {
      member: 'viewer',
      db: async () => ({ listed: (await itemStatus(itemId)) === 'AVAILABLE' }),
      ui: async (page) => ({ listed: await catalogListsTitle(page, token, title, false, 5_000) }),
      expect: { listed: false },
      timeout: 60_000,
    });

    await step('The seller still sees their reserved listing', 'seller', async (page) => {
      await openListing(page, itemId);
      await expect(page.getByRole('heading', { name: title }).first()).toBeVisible({ timeout: 15_000 });
    });
  },
);

// ---------------------------------------------------------------------------
// Multiple items and terms
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale.multiple-items.line-items',
    title: 'A request on a Multiple items listing is priced by its lines, and replacing a line voids the terms',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: cardBuyer('lot-buyer'), seller: DAVE },
    viewports: 'both',
    requiresSeed: seedFor(DAVE),
    timeout: PAID_TIMEOUT,
  },
  async ({ step, arrange, assertState }) => {
    const title = listingTitle('Multiple items target', uniqueToken());
    let itemId = '';
    let saleId = '';
    let versionBeforeEdit = 0;

    await arrange('Dave lists Multiple items', async () => {
      itemId = await seedListing(DAVE, { title, priceMinor: 2_000, kind: 'SHOPFRONT' });
    });

    await step(
      'Buyer opens the listing, labelled Multiple items',
      'buyer',
      async (page) => {
        await openListing(page, itemId);
        // Visible-filtered: the listing renders its phone and desktop panes both, and
        // the first match in the document is the one CSS hides at this viewport.
        await expect(page.getByText(/Multiple items/).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
      },
      { copy: { shopfront: true } },
    );

    await step(
      'Buyer describes the cards they want and names a price',
      'buyer',
      async (page) => {
        saleId = await requestFromShopfront(page, itemId, {
          description: 'The two holo Charizards on page 3',
          priceDollars: '40.00',
        });
      },
      { copy: { shopfront: true } },
    );

    /** The Items tab's agreed price, as the member sees it, when it shows `cents`. */
    const shownPrice = (cents: number) => async (page: Page) => {
      await openSection(page, 'Items');
      const panel = page.getByRole('tabpanel').filter({ visible: true }).first();
      const text = (await panel.innerText().catch(() => '')) ?? '';
      return text.includes(aud(cents)) ? aud(cents) : `not shown (${aud(cents)})`;
    };
    /** The row's price, when it equals the sum of its lines. */
    const pricedByLines = async () => {
      const sale = await saleRow(saleId);
      const lines = await saleLines(saleId);
      const sum = lines.reduce((total, line) => total + line.quantity * line.unit_price_cents, 0);
      return sale.agreed_price_cents === sum ? aud(sum) : `price ${sale.agreed_price_cents} != lines ${sum}`;
    };

    await assertState('The contract is priced at its one line, and nothing is held', {
      member: 'buyer',
      db: async () => ({ price: await pricedByLines(), item: await itemStatus(itemId) }),
      ui: async (page) => ({ price: await shownPrice(4_000)(page), item: 'AVAILABLE' }),
      expect: { price: aud(4_000), item: 'AVAILABLE' },
    });

    await step('Buyer proposes delivery to a resolved address', 'buyer', (page) => proposeDelivery(page), {
      copy: { shopfront: true },
    });

    // The room edits one written line; a contract of several lines is what the data
    // model and the mobile client send, so the sum is checked with two.
    await step('Buyer splits the request into two lines (1 × A$30.00, 2 × A$12.50)', 'buyer', async (page) => {
      const { terms_version } = await saleRow(saleId);
      const result = await memberCashSaleApi(page, 'update-items', {
        cashSaleId: saleId,
        expectedTermsVersion: terms_version,
        lineItems: [
          { description: 'Holo Charizard, page 3', condition: null, quantity: 1, unitPriceCents: 3_000 },
          { description: 'Reverse holo Pikachu', condition: null, quantity: 2, unitPriceCents: 1_250 },
        ],
      });
      expect(result, 'update-items accepted the two lines').toMatchObject({ ok: true });
      await page.reload();
    });

    await assertState('The price is the sum of the lines', {
      member: 'buyer',
      db: pricedByLines,
      ui: shownPrice(5_500),
      expect: aud(5_500),
    });

    await step(
      'Buyer opens Pay on the current terms',
      'buyer',
      async (page) => {
        await openSale(page, saleId);
        versionBeforeEdit = (await saleRow(saleId)).terms_version;
        await openPayDialog(page);
      },
      { copy: { fee: { currency: 'aud', method: 'CARD' }, shopfront: true }, moneySurface: 'contract' },
    );

    await step('Seller replaces the lines with one card at A$50.00', 'seller', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Items');
      await page.getByRole('button', { name: 'Edit', exact: true }).filter({ visible: true }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Change what this contract covers' });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog.getByLabel('What this contract covers').fill('One holo Charizard, page 3');
      await dialog.getByLabel('Price', { exact: true }).fill('50.00');
      await dialog.getByRole('button', { name: 'Save items' }).click();
      await expect(dialog).toBeHidden({ timeout: 25_000 });
    });

    await step('The buyer’s open Pay dialog closes: the terms they were shown changed', 'buyer', async (page) => {
      await expect(payDialog(page)).toBeHidden({ timeout: 30_000 });
      await expect(
        page
          .getByText('The seller changed the terms. Review them before paying.')
          .or(page.getByText(/updated the items this contract covers\./i))
          .first(),
      ).toBeVisible({ timeout: 30_000 });
    });

    await assertState('Replacing a line voids both acceptances and re-prices the contract', {
      member: 'buyer',
      db: async () => {
        const sale = await saleRow(saleId);
        const voided =
          sale.terms_version > versionBeforeEdit &&
          sale.buyer_terms_accepted_version === null &&
          sale.seller_terms_accepted_version === null;
        return { voided, price: await pricedByLines() };
      },
      ui: async (page) => ({
        // What voiding means to the buyer: the dialog they had open is gone.
        voided: !(await payDialog(page).isVisible().catch(() => false)),
        price: await shownPrice(5_000)(page),
      }),
      expect: { voided: true, price: aud(5_000) },
    });
  },
);

pathway(
  {
    id: 'cash-sale.terms.fulfilment-only-change',
    title: 'A fulfilment-only change keeps the buyer able to pay without re-confirming',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: cardBuyer('terms-buyer'), seller: ERIN },
    viewports: 'both',
    requiresSeed: seedFor(ERIN),
    timeout: PAID_TIMEOUT,
  },
  async (ctx) => {
    const { step, arrange, assertState } = ctx;
    let itemId = '';
    let saleId = '';
    let before: { price: number; buyer: number | null; seller: number | null } | null = null;

    await arrange('Erin has a single card listed', async () => {
      itemId = await seedListing(ERIN, { title: listingTitle('Terms target', uniqueToken()), priceMinor: PRICE_MINOR });
    });
    await step('Buyer presses Buy now and reserves the card', 'buyer', async (page) => {
      saleId = await reserveSingle(page, itemId);
    });
    await step('Buyer proposes delivery to a resolved address', 'buyer', (page) => proposeDelivery(page));

    const payable = {
      db: async () => {
        const sale = await saleRow(saleId);
        const kept =
          before === null ||
          (sale.agreed_price_cents === before.price &&
            sale.buyer_terms_accepted_version === before.buyer &&
            sale.seller_terms_accepted_version === before.seller);
        return {
          status: sale.status,
          payable: sale.fulfillment_method === 'DELIVERY' && sale.delivery_address_configured && kept,
        };
      },
      ui: async (page: Page) => {
        const pay = page.getByRole('button', { name: /^Accept terms and pay$/ }).filter({ visible: true }).first();
        return { status: await uiSaleStatus(page), payable: await pay.isEnabled().catch(() => false) };
      },
    };

    await assertState('The buyer can pay on the proposed terms', {
      member: 'buyer',
      ...payable,
      expect: { status: 'AGREEMENT', payable: true },
    });

    await arrange('Record the price and both acceptances before the change', async () => {
      const sale = await saleRow(saleId);
      before = {
        price: sale.agreed_price_cents,
        buyer: sale.buyer_terms_accepted_version,
        seller: sale.seller_terms_accepted_version,
      };
    });

    await step('Seller changes only the shipping notes', 'seller', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Terms');
      await page.getByRole('button', { name: 'Edit terms' }).filter({ visible: true }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Edit handover terms' });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await dialog.getByLabel(/Shipping notes/).fill('Sent in a top loader, tracked.');
      await dialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(dialog).toBeHidden({ timeout: 25_000 });
    });

    await step('Buyer reopens the room', 'buyer', async (page) => {
      await openSale(page, saleId);
      // 0101: a fulfilment edit asks nobody to confirm again.
      await expect(page.getByText(/confirm again/i)).toHaveCount(0);
    });

    await assertState('The change kept the price and both acceptances, and the buyer can still pay', {
      member: 'buyer',
      ...payable,
      expect: { status: 'AGREEMENT', payable: true },
    });

    // The fee copy is read with the Pay dialog open; after paying it is only on the
    // Payment tab, which is not on screen.
    await step(
      'Buyer opens Pay on the changed terms and reads the service fee',
      'buyer',
      async (page) => {
        await openPayDialog(page);
      },
      { copy: { fee: { currency: 'aud', method: 'CARD' } }, moneySurface: 'contract' },
    );
    await step('Buyer pays by their saved card on the changed terms', 'buyer', async (page) => {
      await payByCard(page);
    });
    await statusIs(ctx, 'The payment is held by the platform', 'buyer', () => saleId, 'ESCROW_HELD', 60_000);
  },
);

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale.delivery.lifecycle',
    title: 'A posted cash sale runs from payment to delivery, acceptance and the seller payout',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: cardBuyer('delivery-buyer'), seller: CAROL },
    viewports: 'both',
    requiresSeed: seedFor(CAROL),
    timeout: PAID_TIMEOUT,
  },
  async (ctx) => {
    const { step, simulated, arrange, assertState } = ctx;
    const tracking = trackingNumber();
    let itemId = '';
    let saleId = '';

    await arrange('Carol has a single card listed', async () => {
      itemId = await seedListing(CAROL, { title: listingTitle('Delivery target', uniqueToken()), priceMinor: PRICE_MINOR });
    });

    await reserveDeliverAndPay(ctx, () => itemId, (id) => (saleId = id), () => saleId);

    await step('Seller records the shipment with a tracking number', 'seller', async (page) => {
      await openSale(page, saleId);
      await recordShipment(page, tracking);
    });
    await statusIs(ctx, 'The sale is in transit', 'seller', () => saleId, 'IN_TRANSIT');

    await simulated(
      'The carrier reports the parcel delivered (Ship24 webhook)',
      { mechanism: 'signed-fixture', reason: 'Ship24 has no test mode; the event goes to the real route with the sandbox bearer secret.' },
      () => ship24Delivered(tracking),
    );

    await step('Buyer opens the room', 'buyer', (page) => openSale(page, saleId));
    await assertState('Carrier delivery starts a 7-day inspection window', {
      member: 'buyer',
      db: async () => {
        const sale = await saleRow(saleId);
        return { status: sale.status, windowHours: hoursUntil(sale.inspection_deadline_at) };
      },
      ui: async (page) => ({ status: await uiSaleStatus(page), windowHours: await uiInspectionWindowHours(page, POSTED_WINDOW_HOURS) }),
      expect: { status: 'INSPECTION', windowHours: POSTED_WINDOW_HOURS },
    });

    await step('Buyer completes the purchase', 'buyer', (page) => completePurchase(page));
    await statusIs(ctx, 'The sale is completed', 'buyer', () => saleId, 'COMPLETED');

    await step('The seller sees the card sold', 'seller', async (page) => {
      await openListing(page, itemId);
      // The listing renders a "Sold" badge per breakpoint; the first match in the DOM can
      // be the hidden copy, so take the one this viewport shows.
      await expect(page.getByText('Sold').filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    });

    // THE PAYOUT. A seller with fewer than three qualifying sales waits out the
    // new-seller holdback (7 days from collection, `releasePolicy.ts`), so the first
    // drain defers it (PAYOUT_HELD, not a failure). Moving the collection instant back
    // past the holdback lets the next drain transfer for real.
    await arrange('The :47 payout job runs', () => runJobOk('cash-sale-payouts'));
    const first = await saleRow(saleId);
    if (first.seller_payout_status !== 'SETTLED') {
      await step('Seller opens the room’s Payment tab', 'seller', async (page) => {
        await openSale(page, saleId);
        await openSection(page, 'Payment');
      });
      await assertState('The payout is held while the new-seller holdback applies (PAYOUT_HELD)', {
        member: 'seller',
        db: async () => {
          const sale = await saleRow(saleId);
          const held =
            sale.seller_payout_status === 'PENDING' &&
            (sale.seller_payout_hold_reason !== null ||
              (sale.seller_payout_release_at !== null && Date.parse(sale.seller_payout_release_at) > Date.now()));
          return held ? 'HELD' : `${sale.seller_payout_status} (release ${sale.seller_payout_release_at ?? 'none'})`;
        },
        ui: async (page) =>
          (await page.getByText('Queued for release to your payout account.').first().isVisible().catch(() => false))
            ? 'HELD'
            : 'not shown',
        expect: 'HELD',
      });

      await simulated(
        'Eight days pass: the new-seller holdback ends',
        { mechanism: 'moved-timestamp', reason: 'The holdback is 7 days from collection.' },
        async () => {
          const sale = await saleRow(saleId);
          const columns = ['payment_settled_at', ...(sale.seller_payout_release_at ? ['seller_payout_release_at'] : [])];
          await rewind('cash_sales', saleId, columns, 8 * DAY_MS);
        },
      );
      await arrange('The :47 payout job runs again', () => runJobOk('cash-sale-payouts'));
    }

    await step('Seller opens the room’s Payment tab', 'seller', async (page) => {
      await openSale(page, saleId);
      await openSection(page, 'Payment');
    });
    await assertState('The seller is paid', {
      member: 'seller',
      db: async () => (await saleRow(saleId)).seller_payout_status,
      ui: async (page) =>
        (await page.getByText(/^Sent to your payout account\./).first().isVisible().catch(() => false))
          ? 'SETTLED'
          : 'not shown',
      expect: 'SETTLED',
    });

    await arrange('Stripe test mode holds a transfer of price plus postage to Carol’s account', async () => {
      const sale = await saleRow(saleId);
      expect(sale.seller_payout_ref, 'the payout recorded a Stripe transfer').toMatch(/^tr_/);
      const transfer = await testStripe('AU').transfers.retrieve(sale.seller_payout_ref!);
      expect({ amount: transfer.amount, currency: transfer.currency, destination: transfer.destination }).toEqual({
        amount: sale.agreed_price_cents + sale.shipping_cost_cents,
        currency: 'aud',
        destination: MEMBER_FIXTURES[CAROL.id].connectedAccount,
      });
    });
  },
);

pathway(
  {
    id: 'cash-sale.delivery.flagged-delivered-before-shipment',
    title: 'Tracking delivered before the shipment is flagged and starts no inspection clock',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    members: { buyer: cardBuyer('flagged-buyer'), seller: DAVE },
    viewports: 'both',
    requiresSeed: seedFor(DAVE),
    timeout: PAID_TIMEOUT,
  },
  async (ctx) => {
    const { step, simulated, arrange, assertState } = ctx;
    const tracking = trackingNumber();
    let itemId = '';
    let saleId = '';

    await arrange('Dave has a single card listed', async () => {
      itemId = await seedListing(DAVE, { title: listingTitle('Flagged target', uniqueToken()), priceMinor: PRICE_MINOR });
    });
    await reserveDeliverAndPay(ctx, () => itemId, (id) => (saleId = id), () => saleId);

    await step('Seller records a tracking number', 'seller', async (page) => {
      await openSale(page, saleId);
      await recordShipment(page, tracking);
    });

    await simulated(
      'The carrier reports that number delivered two days ago (Ship24 webhook)',
      { mechanism: 'signed-fixture', reason: 'A stale, already-delivered number: the delivery predates the shipment.' },
      () => ship24Delivered(tracking, { deliveredAt: new Date(Date.now() - 2 * DAY_MS) }),
    );

    const flagged = {
      db: async () => {
        const sale = await saleRow(saleId);
        return {
          status: sale.status,
          flagged: sale.tracking_flagged_at !== null && sale.tracking_flag_reason === 'DELIVERED_BEFORE_SHIPMENT',
          clock: sale.inspection_deadline_at !== null,
        };
      },
    };

    await step('Seller reopens the room', 'seller', (page) => openSale(page, saleId));
    await assertState('The sale is flagged for staff and no inspection clock runs (seller)', {
      member: 'seller',
      ...flagged,
      ui: async (page) => ({
        status: await uiSaleStatus(page),
        flagged: await page
          .getByText(/Your tracking shows this parcel was already delivered/)
          .first()
          .isVisible()
          .catch(() => false),
        clock: (await uiInspectionWindowHours(page)) !== null,
      }),
      expect: { status: 'IN_TRANSIT', flagged: true, clock: false },
    });

    await step('Buyer opens the room', 'buyer', (page) => openSale(page, saleId));
    await assertState('The buyer is told support is checking the delivery', {
      member: 'buyer',
      ...flagged,
      ui: async (page) => ({
        status: await uiSaleStatus(page),
        flagged: await page
          .getByText(/The seller.s tracking shows delivered\. Support is checking it/)
          .first()
          .isVisible()
          .catch(() => false),
        clock: (await uiInspectionWindowHours(page)) !== null,
      }),
      expect: { status: 'IN_TRANSIT', flagged: true, clock: false },
    });
  },
);

pathway(
  {
    id: 'cash-sale.inspection.auto-complete',
    title: 'An inspection window that lapses completes the sale through the pg_cron body',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: cardBuyer('lapsing-buyer'), seller: CAROL },
    viewports: 'both',
    requiresSeed: seedFor(CAROL),
    timeout: PAID_TIMEOUT,
  },
  async (ctx) => {
    const { step, simulated, arrange, assertState } = ctx;
    const tracking = trackingNumber();
    let itemId = '';
    let saleId = '';

    await arrange('Carol has a single card listed', async () => {
      itemId = await seedListing(CAROL, { title: listingTitle('Auto-complete target', uniqueToken()), priceMinor: PRICE_MINOR });
    });
    await reserveDeliverAndPay(ctx, () => itemId, (id) => (saleId = id), () => saleId);

    await step('Seller records the shipment', 'seller', async (page) => {
      await openSale(page, saleId);
      await recordShipment(page, tracking);
    });
    await simulated(
      'The carrier reports the parcel delivered (Ship24 webhook)',
      { mechanism: 'signed-fixture', reason: 'Ship24 has no test mode.' },
      () => ship24Delivered(tracking),
    );
    await statusIs(ctx, 'The buyer’s inspection window is open', 'seller', () => saleId, 'INSPECTION');

    await simulated(
      'Seven days pass without the buyer acting',
      { mechanism: 'moved-timestamp', reason: 'The inspection window is 7 days.' },
      () => rewind('cash_sales', saleId, ['inspection_deadline_at'], POSTED_WINDOW_HOURS * HOUR_MS + 10 * 60_000),
    );
    await arrange('The :07 pg_cron body auto_complete_due_cash_sales runs', () => runCron('auto_complete_due_cash_sales'));

    await step('Buyer opens the room', 'buyer', (page) => openSale(page, saleId));
    await assertState('The sale completed on its own', {
      member: 'buyer',
      db: async () => {
        const sale = await saleRow(saleId);
        return { status: sale.status, auto: sale.auto_completed };
      },
      ui: async (page) => ({ status: await uiSaleStatus(page), auto: true }),
      expect: { status: 'COMPLETED', auto: true },
    });
  },
);

// ---------------------------------------------------------------------------
// In person
// ---------------------------------------------------------------------------

/** Reserve, propose a meeting `daysAhead` days out, optionally bring it forward, and pay. */
async function reserveMeetAndPay(
  ctx: PathwayContext<'buyer' | 'seller'>,
  itemId: () => string,
  setSale: (id: string) => void,
  saleId: () => string,
  options: { bringMeetingForward: boolean },
): Promise<void> {
  await ctx.step('Buyer presses Buy now and reserves the card', 'buyer', async (page) => {
    setSale(await reserveSingle(page, itemId()));
  });
  await ctx.step('Buyer proposes to meet at a resolved place in three days', 'buyer', (page) =>
    proposeInPerson(page, 3, STUB_PLACES.sydney),
  );
  if (options.bringMeetingForward) {
    // The picker offers 07:00–22:00 half-hour slots only, so "within the hour" cannot
    // be picked at every time of day. Moved while the sale is still in AGREEMENT,
    // because the terms trigger locks `meeting_at` once payment starts.
    await ctx.simulated(
      'The meeting is brought forward to 30 minutes from now',
      { mechanism: 'moved-timestamp', reason: 'A handover can be confirmed only from an hour before the meeting.' },
      async () => {
        const sale = await saleRow(saleId());
        const by = Date.parse(sale.meeting_at!) - (Date.now() + 30 * 60_000);
        await rewind('cash_sales', saleId(), ['meeting_at'], Math.max(0, Math.floor(by)));
      },
    );
  }
  // The fee copy is read while the Pay dialog that states it is open.
  await ctx.step(
    'Buyer opens Pay and reads the service fee and the total',
    'buyer',
    async (page) => {
      await openSale(page, saleId());
      await openPayDialog(page);
    },
    { copy: { fee: { currency: 'aud', method: 'CARD' } }, moneySurface: 'contract' },
  );
  await ctx.step('Buyer pays by their saved card (3-D Secure when the issuer asks)', 'buyer', async (page) => {
    await payByCard(page);
  });
  await statusIs(ctx, 'The payment is held and the handover is next', 'buyer', saleId, 'HANDOVER', 60_000);
}

pathway(
  {
    id: 'cash-sale.in-person.handover-24h',
    title: 'Both confirming an in-person handover opens a 24-hour inspection window',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: cardBuyer('meeting-buyer'), seller: ERIN },
    viewports: 'both',
    requiresSeed: seedFor(ERIN),
    timeout: PAID_TIMEOUT,
  },
  async (ctx) => {
    const { step, arrange, assertState } = ctx;
    let itemId = '';
    let saleId = '';

    await arrange('Erin has a single card listed', async () => {
      itemId = await seedListing(ERIN, { title: listingTitle('Meeting target', uniqueToken()), priceMinor: PRICE_MINOR });
    });
    await reserveMeetAndPay(ctx, () => itemId, (id) => (saleId = id), () => saleId, { bringMeetingForward: true });

    await step('Seller confirms the handover', 'seller', async (page) => {
      await openSale(page, saleId);
      await confirmHandover(page);
      await expect(page.getByRole('button', { name: 'Handover confirmed' }).filter({ visible: true }).first()).toBeVisible({
        timeout: 30_000,
      });
    });
    await statusIs(ctx, 'One confirmation is not enough', 'seller', () => saleId, 'HANDOVER');

    await step('Buyer confirms the handover', 'buyer', async (page) => {
      await openSale(page, saleId);
      await confirmHandover(page);
    });

    await assertState('Both confirmations open a 24-hour inspection window', {
      member: 'buyer',
      db: async () => {
        const sale = await saleRow(saleId);
        return { status: sale.status, windowHours: hoursUntil(sale.inspection_deadline_at) };
      },
      ui: async (page) => ({ status: await uiSaleStatus(page), windowHours: await uiInspectionWindowHours(page, IN_PERSON_WINDOW_HOURS) }),
      expect: { status: 'INSPECTION', windowHours: IN_PERSON_WINDOW_HOURS },
      timeout: 45_000,
    });
  },
);

pathway(
  {
    id: 'cash-sale.in-person.handover-too-early',
    title: 'Confirming a handover more than an hour before the meeting is refused (HANDOVER_TOO_EARLY)',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    members: { buyer: cardBuyer('early-buyer'), seller: ALICE },
    viewports: 'both',
    requiresSeed: seedFor(ALICE),
    timeout: PAID_TIMEOUT,
  },
  async (ctx) => {
    const { step, arrange, assertState, refusal } = ctx;
    let itemId = '';
    let saleId = '';

    await arrange('Alice has a single card listed', async () => {
      itemId = await seedListing(ALICE, { title: listingTitle('Early handover target', uniqueToken()), priceMinor: PRICE_MINOR });
    });
    await reserveMeetAndPay(ctx, () => itemId, (id) => (saleId = id), () => saleId, { bringMeetingForward: false });

    await step('Seller opens the room three days before the meeting', 'seller', (page) => openSale(page, saleId));
    await refusal(
      'Seller tries to confirm the handover now',
      'seller',
      async (page) => {
        await confirmHandover(page);
      },
      // `errorCopy.ts` 'handover-too-early', shown as a toast.
      { message: 'You can confirm the handover from an hour before the meeting.' },
    );

    await assertState('Nothing was confirmed', {
      member: 'seller',
      db: async () => {
        const sale = await saleRow(saleId);
        return { status: sale.status, confirmed: sale.seller_handover_confirmed_at !== null };
      },
      ui: async (page) => ({
        status: await uiSaleStatus(page),
        confirmed: await page.getByRole('button', { name: 'Handover confirmed' }).filter({ visible: true }).first().isVisible().catch(() => false),
      }),
      expect: { status: 'HANDOVER', confirmed: false },
    });
  },
);

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale.cancel.in-agreement',
    title: 'Cancelling in AGREEMENT ends the contract and puts the card back in the catalog',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: cardBuyer('cancelled-buyer'), seller: DAVE, viewer: plainMember('cancel-viewer') },
    viewports: 'both',
    requiresSeed: seedFor(DAVE),
    timeout: UNPAID_TIMEOUT,
  },
  async (ctx) => {
    const { step, arrange, assertState } = ctx;
    const token = uniqueToken();
    const title = listingTitle('Cancel target', token);
    let itemId = '';
    let saleId = '';

    await arrange('Dave has a single card listed', async () => {
      itemId = await seedListing(DAVE, { title, priceMinor: PRICE_MINOR });
    });
    await step('Buyer presses Buy now and reserves the card', 'buyer', async (page) => {
      saleId = await reserveSingle(page, itemId);
    });
    await step('The reserved card is not in the catalog', 'viewer', async (page) => {
      expect(await catalogListsTitle(page, token, title, false), 'reserved, so not listed').toBe(false);
    });

    await step('Seller cancels the contract', 'seller', async (page) => {
      await openSale(page, saleId);
      await cancelFromRoom(page);
    });
    await statusIs(ctx, 'The contract is cancelled', 'seller', () => saleId, 'CANCELLED');

    await assertState('The card is back in the catalog', {
      member: 'viewer',
      db: async () => ({ listed: (await itemStatus(itemId)) === 'AVAILABLE' }),
      ui: async (page) => ({ listed: await catalogListsTitle(page, token, title, true, 5_000) }),
      expect: { listed: true },
      timeout: 60_000,
    });
  },
);

pathway(
  {
    id: 'cash-sale.cancel.refused-after-payment',
    title: 'A paid sale cannot be cancelled',
    area: 'cash-sale',
    kind: 'refusal',
    provider: 'stripe',
    members: { buyer: cardBuyer('paid-buyer'), seller: ERIN },
    viewports: 'both',
    requiresSeed: seedFor(ERIN),
    timeout: PAID_TIMEOUT,
  },
  async (ctx) => {
    const { step, arrange, refusal } = ctx;
    let itemId = '';
    let saleId = '';

    await arrange('Erin has a single card listed', async () => {
      itemId = await seedListing(ERIN, { title: listingTitle('Paid cancel target', uniqueToken()), priceMinor: PRICE_MINOR });
    });
    await reserveDeliverAndPay(ctx, () => itemId, (id) => (saleId = id), () => saleId);

    await step('Buyer finds no Cancel in the room’s menu', 'buyer', async (page) => {
      const menu = await openMoreActions(page);
      await expect(menu.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
    });

    // The room offers no control, so the server's own refusal is asserted through the
    // mobile endpoint that calls the same `cancelCashSaleAgreement`.
    await refusal(
      'The server refuses to cancel a paid sale',
      'buyer',
      async (page) => {
        const result = await memberCashSaleApi(page, 'cancel', { cashSaleId: saleId, reason: 'Changed my mind' });
        return { code: result.error };
      },
      // `cancelAgreement` returns INVALID_STATE outside AGREEMENT → 'invalid-state'.
      { code: 'invalid-state' },
    );
    await statusIs(ctx, 'The sale is still held', 'buyer', () => saleId, 'ESCROW_HELD');
  },
);

// ---------------------------------------------------------------------------
// The unfinished payment
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'cash-sale.payment.unfinished-abandoned',
    title: 'A payment check left unfinished for 30 minutes is cancelled and the sale is payable again',
    area: 'cash-sale',
    kind: 'happy',
    provider: 'stripe',
    members: { buyer: cardBuyer('walkaway-buyer'), seller: ALICE },
    // A card that demands 3-D Secure on every payment, so the check is certain to be
    // left open.
    personaOptions: { buyer: { card: 'pm_card_threeDSecure2Required' } },
    viewports: 'both',
    requiresSeed: seedFor(ALICE),
    timeout: PAID_TIMEOUT,
  },
  async ({ step, simulated, arrange, assertState }) => {
    let itemId = '';
    let saleId = '';
    let intentId = '';

    await arrange('Alice has a single card listed', async () => {
      itemId = await seedListing(ALICE, { title: listingTitle('Walk-away target', uniqueToken()), priceMinor: PRICE_MINOR });
    });
    await step('Buyer presses Buy now and reserves the card', 'buyer', async (page) => {
      saleId = await reserveSingle(page, itemId);
    });
    await step('Buyer proposes delivery to a resolved address', 'buyer', (page) => proposeDelivery(page));

    await step('Buyer starts paying, gets the 3-D Secure check, and walks away', 'buyer', async (page) => {
      const dialog = await openPayDialog(page);
      await dialog.getByRole('button', { name: /^Accept terms and pay / }).click();
      await waitForChallenge(page);
      // Leaving the room is walking away: nothing answers the challenge.
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
    });

    await step('Buyer comes back to the room', 'buyer', (page) => openSale(page, saleId));
    await assertState('The payment is waiting on the unfinished check', {
      member: 'buyer',
      db: async () => {
        const sale = await saleRow(saleId);
        intentId = sale.transfer_id ?? '';
        return { status: sale.status, started: intentId.startsWith('pi_') };
      },
      ui: async (page) => ({
        status: await uiSaleStatus(page),
        started: await page.getByRole('button', { name: 'Complete payment' }).filter({ visible: true }).first().isVisible().catch(() => false),
      }),
      expect: { status: 'PAYMENT_PENDING', started: true },
    });

    await simulated(
      'Thirty-one minutes pass with the check unfinished',
      { mechanism: 'moved-timestamp', reason: 'The :47 sweep cancels a check left for 30 minutes.' },
      () => rewind('cash_sales', saleId, ['payment_requested_at'], 31 * 60_000),
    );
    await arrange('The :47 job sweeps abandoned payments', () => runJobOk('cash-sale-payouts'));

    await step('Buyer reopens the room', 'buyer', (page) => openSale(page, saleId));
    await assertState('The sale is back in AGREEMENT and payable again', {
      member: 'buyer',
      db: async () => {
        const sale = await saleRow(saleId);
        return { status: sale.status, payable: sale.delivery_address_configured };
      },
      ui: async (page) => ({
        status: await uiSaleStatus(page),
        payable: await page.getByRole('button', { name: /^Accept terms and pay$/ }).filter({ visible: true }).first().isEnabled().catch(() => false),
      }),
      expect: { status: 'AGREEMENT', payable: true },
    });

    await arrange('Stripe test mode shows the payment cancelled with nothing charged', async () => {
      expect(intentId, 'the unfinished PaymentIntent id was read').toMatch(/^pi_/);
      const intent = await testStripe('AU').paymentIntents.retrieve(intentId);
      expect({ status: intent.status, received: intent.amount_received }).toEqual({ status: 'canceled', received: 0 });
    });
  },
);
