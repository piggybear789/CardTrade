// tests/e2e/stripe/bank-rails.stripe.ts
//
// Paying a cash sale from the bank (0158) in the REAL app against REAL Stripe test mode:
// the Pay dialog's rail choice and its fee lines, the bank approval in Stripe's Payment
// Element, Stripe's own test bank page, the redirect back into the contract room, and
// the sale landing in escrow with the row priced for the rail.
//
//   npx playwright test -c playwright.stripe.config.ts
//
// Two rails cover the two shapes the room handles:
//   * PayTo (AU)  — approved in place; Stripe.js polls until it succeeds.
//   * iDEAL (EUR) — a redirect to the bank and back to `/sales/<id>?payment=return`,
//                   charged on behalf of a German seller's connected account.
//
// ARRANGE AND RESTORE. Seeded members carry MOCK provider refs (`payer_…`, `mch_seed_…`),
// which real Stripe rejects. Each block points its two members at real test objects for
// the run — a test Customer with a saved test card for the buyer (Buy Now still asks for
// one) and, for iDEAL, a real German test connected account for the seller — and puts
// every original value back in `afterAll`, even when a test fails.
//
// No webhooks reach localhost, so this exercises the read-back path, which is the
// reliable one by design (the webhook is the backstop).

import Stripe from 'stripe';
import type { Browser, Page } from '@playwright/test';

import { test, expect } from '../support/fixtures';
import { ALICE, BOB, UMA_US_SELLER, VICTOR_US_BUYER, storageStatePath, type SeedUser } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { envValue, insertRow, selectRows, updateRows } from '../support/db';
import { marked } from '../support/marker';
import { fillPlace, STUB_PLACES, stubbedPlaceLabel } from '../support/listings';
import { COLD_ROUTE, RENDERED } from '../support/waiting';

/** The German test seller on the US platform, with the EU bank-rail capabilities. */
const DE_CONNECTED_ACCOUNT = 'acct_1UQ1EbDBt8PZ9Rx1';

type ProfilePatch = Record<string, string | null>;
const RESTORE_COLUMNS = 'id,region_code,payer_id,payment_source_id,payment_method_label,merchant_ref';

function stripeFor(region: 'AU' | 'US'): Stripe {
  const key = envValue(region === 'US' ? 'STRIPE_SECRET_KEY_US' : 'STRIPE_SECRET_KEY') ?? '';
  if (!key.startsWith('sk_test_')) throw new Error(`refusing: the ${region} key is not a test key`);
  return new Stripe(key);
}

/** A Stripe test Customer with a saved test card, as a buyer who added one would have. */
async function realBuyerCard(stripe: Stripe, card: string): Promise<{ payerId: string; sourceId: string }> {
  const customer = await stripe.customers.create({ description: 'NoDitto e2e buyer (bank rails)' });
  const pm = await stripe.paymentMethods.attach(card, { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  return { payerId: customer.id, sourceId: pm.id };
}

/** Patch members for the run and return a function that puts every value back. */
async function arrange(patches: Array<{ user: SeedUser; patch: ProfilePatch }>): Promise<() => Promise<void>> {
  const originals: Array<{ id: string; row: Record<string, unknown> }> = [];
  for (const { user } of patches) {
    const [row] = await selectRows('profiles', `select=${RESTORE_COLUMNS}&id=eq.${user.id}`);
    if (!row) throw new Error(`no profile for ${user.email}`);
    originals.push({ id: user.id, row });
  }
  for (const { user, patch } of patches) {
    await updateRows('profiles', `id=eq.${user.id}`, patch);
  }
  return async () => {
    for (const { id, row } of originals) {
      const { id: _id, ...values } = row;
      await updateRows('profiles', `id=eq.${id}`, values);
    }
  };
}

/**
 * A single listing owned by `owner`, inserted directly. What this file tests is the Pay
 * step, so the listing is arranged rather than driven through the create form (which
 * `listings.spec.ts` covers). The currency and the seller flags are still derived by
 * the table's own insert triggers from the owner's region and verification. The title
 * is marked, so teardown removes the item and its sale.
 */
async function seedListing(owner: SeedUser, title: string, priceMinor: number, place: typeof STUB_PLACES.sydney): Promise<string> {
  const [photo] = await selectRows<{ image_paths: string[] }>(
    'items',
    'select=image_paths&hidden=eq.false&order=created_at.desc&limit=1',
  );
  const item = await insertRow<{ id: string; currency: string }>('items', {
    owner_id: owner.id,
    title,
    description: 'Created by the real-Stripe bank-rail e2e.',
    category: 'Pokémon',
    condition: 'Near Mint',
    fmv_cents: priceMinor,
    image_paths: photo?.image_paths?.slice(0, 1) ?? ['e2e/placeholder.jpg'],
    listing_kind: 'SINGLE',
    location_label: stubbedPlaceLabel(place),
    location_place_id: place.placeId,
    location_country_code: place.countryCode,
    location_lat: place.lat,
    location_lng: place.lng,
    location_precision: 'suburb',
  });
  return item.id;
}

async function asUser(browser: Browser, user: SeedUser): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ storageState: storageStatePath(user) });
  const page = await ctx.newPage();
  return { page, close: () => ctx.close() };
}

/** Buy Now on a listing, through the real dialog, landing in the contract room. */
async function openContract(page: Page, itemId: string): Promise<string> {
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Buy now' }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Start a purchase contract' })).toBeVisible({ timeout: 25_000 });
  await dialog.getByRole('button', { name: 'Reserve item and agree terms' }).click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  return new URL(page.url()).pathname;
}

/** The buyer's delivery address, chosen from the stubbed autocomplete. */
async function proposeDelivery(page: Page, place: typeof STUB_PLACES.sydney): Promise<void> {
  const setDelivery = page.getByRole('button', { name: /Set delivery details|Choose a method/i });
  if (await setDelivery.isVisible({ timeout: 10_000 }).catch(() => false)) await setDelivery.click();
  else await page.getByRole('tab', { name: 'Terms' }).click();
  const ship = page.getByRole('button', { name: /Ship the item/i }).first();
  await expect(ship).toBeVisible({ timeout: RENDERED });
  await ship.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await fillPlace(page, /Your delivery address/i, place, dialog);
  await dialog.getByRole('button', { name: 'Propose terms' }).click();
  await expect(dialog).toBeHidden({ timeout: 25_000 });
}

/** Open Pay, check every option is priced, choose `rail`, and continue to the bank. */
async function chooseRail(
  page: Page,
  rail: RegExp,
  expectRates: { card: string; bank: string },
): Promise<void> {
  const pay = page.getByRole('button', { name: /^Accept terms and pay$/ }).first();
  await expect(pay).toBeVisible({ timeout: RENDERED });
  await pay.click();
  const dialog = page.getByRole('dialog', { name: 'Accept these terms and pay?' });
  await expect(dialog.getByText('How do you want to pay?')).toBeVisible({ timeout: RENDERED });

  // Every option states its rate, its fee and its total before anything is chosen.
  const card = dialog.getByRole('radio', { name: /^Card/ });
  const bank = dialog.getByRole('radio', { name: rail });
  await expect(card).toBeChecked();
  await expect(dialog.getByText(new RegExp(`Service fee ${escape(expectRates.card)}`))).toBeVisible();
  await expect(dialog.getByText(new RegExp(`Service fee ${escape(expectRates.bank)}`))).toBeVisible();
  await expect(dialog.getByText('Lowest fee')).toBeVisible();

  await bank.check();
  await expect(dialog.getByRole('button', { name: /^Accept terms, continue to / })).toBeEnabled();
  await page.screenshot({ path: `test-results/stripe/pay-dialog-${rail.source.replace(/\W+/g, '')}.png` });
  await dialog.getByRole('button', { name: /^Accept terms, continue to / }).click();
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The Payment Element inside the bank dialog. */
function paymentField(page: Page) {
  return page.frameLocator('iframe[title="Secure payment input frame"]').first();
}

/** Wait for the room to show the payment held and the seller's next step. */
async function expectHeld(page: Page): Promise<void> {
  // The step is stated in the dock and again in the Status panel, so either one is it.
  await expect(
    page.getByRole('heading', { name: /(Post it and add the tracking number|Waiting for .+ to post it)/i }).first(),
  ).toBeAttached({ timeout: 90_000 });
}

async function saleRow(saleUrl: string) {
  const id = saleUrl.split('/').pop()!;
  const [row] = await selectRows<{
    status: string;
    payment_method_kind: string | null;
    platform_fee_cents: number;
    amount_cents: number;
    agreed_price_cents: number;
    shipping_cost_cents: number;
    transfer_id: string | null;
    currency: string;
  }>(
    'cash_sales',
    `select=status,payment_method_kind,platform_fee_cents,amount_cents,agreed_price_cents,shipping_cost_cents,transfer_id,currency&id=eq.${id}`,
  );
  return row;
}

// ═══ PayTo: approved in place ═══════════════════════════════════════════════════════

test.describe.serial('PayTo, in the real room, against Stripe test mode', () => {
  const title = marked(`PayTo rail ${Date.now()}`);
  let restore: (() => Promise<void>) | null = null;
  let itemId = '';
  let saleUrl = '';

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE, BOB]);
    const buyer = await realBuyerCard(stripeFor('AU'), 'pm_card_au');
    restore = await arrange([
      { user: BOB, patch: { payer_id: buyer.payerId, payment_source_id: buyer.sourceId, payment_method_label: 'Visa ending 0000' } },
    ]);
  });
  test.afterAll(async () => {
    await restore?.();
  });

  test('the seller lists, the buyer opens a contract and sets delivery', async ({ browser }) => {
    itemId = await seedListing(ALICE, title, 15_000, STUB_PLACES.sydney);

    const buyer = await asUser(browser, BOB);
    saleUrl = await openContract(buyer.page, itemId);
    await proposeDelivery(buyer.page, STUB_PLACES.sydney);
    await buyer.close();
  });

  test('the buyer sees card and PayTo priced, pays with PayTo, and the sale is held', async ({ browser }) => {
    const buyer = await asUser(browser, BOB);
    await buyer.page.goto(saleUrl);
    await buyer.page.waitForLoadState('domcontentloaded');

    // A$150.00, no postage: card 3% + A$0.60 = A$5.10, PayTo 2.5% + A$0.60 = A$4.35.
    await chooseRail(buyer.page, /^PayTo/, { card: '3% + $0.60 AUD: $5.10 AUD', bank: '2.5% + $0.60 AUD: $4.35 AUD' });

    const bankDialog = buyer.page.getByRole('dialog', { name: 'Pay with PayTo' });
    await expect(bankDialog).toBeVisible({ timeout: 30_000 });
    await expect(bankDialog.getByText(/Approve \$154\.35 AUD in your bank, including the \$4\.35 AUD service fee/)).toBeVisible();
    const field = paymentField(buyer.page);
    await field.locator('#payment-nameInput').fill('Bob Carter');
    await field.locator('#payment-bsbNumberInput').fill('000000');
    await field.locator('#payment-accountNumberInput').fill('000123456');
    await bankDialog.getByRole('button', { name: /^Pay \$154\.35 AUD with PayTo$/ }).click();

    await expectHeld(buyer.page);
    await buyer.page.screenshot({ path: 'test-results/stripe/payto-held.png' });

    const row = await saleRow(saleUrl);
    expect(row.status).toBe('ESCROW_HELD');
    expect(row.payment_method_kind).toBe('PAYTO');
    expect(row.platform_fee_cents).toBe(435);
    expect(row.amount_cents).toBe(15_435);

    const intent = await stripeFor('AU').paymentIntents.retrieve(row.transfer_id!, { expand: ['latest_charge'] });
    expect(intent.status).toBe('succeeded');
    expect(intent.amount_received).toBe(15_435);
    expect((intent.latest_charge as Stripe.Charge).payment_method_details?.type).toBe('payto');

    // The room says how it was paid, and what was charged, on its Payment tab.
    await expect(buyer.page.getByText('$154.35 AUD total').first()).toBeVisible();
    await buyer.page.getByRole('tab', { name: 'Payment' }).click();
    await expect(buyer.page.getByText(/Buyer paid by PayTo, in AUD/).first()).toBeVisible({ timeout: RENDERED });
    await buyer.page.screenshot({ path: 'test-results/stripe/payto-payment-tab.png' });
    await buyer.close();
  });
});

// ═══ iDEAL: a redirect to the bank and back ═════════════════════════════════════════

test.describe.serial('iDEAL, in the real room, against Stripe test mode', () => {
  const title = marked(`iDEAL rail ${Date.now()}`);
  let restore: (() => Promise<void>) | null = null;
  let itemId = '';
  let saleUrl = '';

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [UMA_US_SELLER, VICTOR_US_BUYER]);
    const buyer = await realBuyerCard(stripeFor('US'), 'pm_card_visa');
    // A German seller paid through a real German test account, and a Dutch buyer.
    restore = await arrange([
      { user: UMA_US_SELLER, patch: { region_code: 'DE', merchant_ref: DE_CONNECTED_ACCOUNT } },
      {
        user: VICTOR_US_BUYER,
        patch: { region_code: 'NL', payer_id: buyer.payerId, payment_source_id: buyer.sourceId, payment_method_label: 'Visa ending 4242' },
      },
    ]);
  });
  test.afterAll(async () => {
    await restore?.();
  });

  test('a German seller lists in EUR, a Dutch buyer opens a contract and sets delivery', async ({ browser }) => {
    itemId = await seedListing(UMA_US_SELLER, title, 15_000, STUB_PLACES.berlin);
    const [item] = await selectRows<{ currency: string }>('items', `select=currency&id=eq.${itemId}`);
    expect(item?.currency, 'the listing takes the German seller’s currency').toBe('eur');

    const buyer = await asUser(browser, VICTOR_US_BUYER);
    saleUrl = await openContract(buyer.page, itemId);
    await proposeDelivery(buyer.page, STUB_PLACES.amsterdam);
    await buyer.close();
  });

  test('the buyer pays with iDEAL, approves at the bank, returns, and the sale is held', async ({ browser }) => {
    const buyer = await asUser(browser, VICTOR_US_BUYER);
    await buyer.page.goto(saleUrl);
    await buyer.page.waitForLoadState('domcontentloaded');

    // EUR 150.00, no postage: card 3% + 0.60 = 5.10, iDEAL 1.5% + 0.60 = 2.85.
    await chooseRail(buyer.page, /^iDEAL/, { card: '3% + €0.60 EUR: €5.10 EUR', bank: '1.5% + €0.60 EUR: €2.85 EUR' });

    const bankDialog = buyer.page.getByRole('dialog', { name: /Pay with iDEAL/ });
    await expect(bankDialog).toBeVisible({ timeout: 30_000 });
    await expect(bankDialog.getByText(/Approve €152\.85 EUR in your bank, including the €2\.85 EUR service fee/)).toBeVisible();
    await paymentField(buyer.page).locator('#payment-nameInput').fill('Victor Reyes');
    await bankDialog.getByRole('button', { name: /^Pay €152\.85 EUR with iDEAL/ }).click();

    // Stripe's test bank page, then back into the room.
    await buyer.page.waitForURL((url) => !url.href.startsWith('http://localhost'), { timeout: 45_000 });
    await buyer.page.screenshot({ path: 'test-results/stripe/ideal-bank-page.png' });
    await buyer.page
      .getByRole('button', { name: /authori[sz]e/i })
      .or(buyer.page.getByRole('link', { name: /authori[sz]e/i }))
      .first()
      .click({ timeout: 30_000 });
    await buyer.page.waitForURL(/\/sales\/[0-9a-f-]{36}/, { timeout: 60_000 });

    await expectHeld(buyer.page);
    // The return marker is dropped once handled, so a reload cannot repeat it.
    expect(new URL(buyer.page.url()).search).toBe('');
    await buyer.page.screenshot({ path: 'test-results/stripe/ideal-held.png' });

    const row = await saleRow(saleUrl);
    expect(row.currency).toBe('eur');
    expect(row.status).toBe('ESCROW_HELD');
    expect(row.payment_method_kind).toBe('IDEAL');
    expect(row.platform_fee_cents).toBe(285);
    expect(row.amount_cents).toBe(15_285);

    const intent = await stripeFor('US').paymentIntents.retrieve(row.transfer_id!, { expand: ['latest_charge'] });
    expect(intent.status).toBe('succeeded');
    expect(intent.amount_received).toBe(15_285);
    expect(intent.on_behalf_of).toBe(DE_CONNECTED_ACCOUNT);
    expect((intent.latest_charge as Stripe.Charge).payment_method_details?.type).toBe('ideal');
    await buyer.close();
  });
});
