// tests/e2e/support/cashSalePayments.ts
//
// Helpers for `specs/cash-sale-payments.spec.ts` (task 9.2): the Pay step of a cash
// sale against REAL Stripe test mode, by card (with and without 3-D Secure, declined,
// re-priced) and by every offered bank rail. Kept out of the shared harness on
// purpose: other specs are migrated at the same time, and these helpers encode the
// Pay-step specifics only that spec needs.
//
// Folded in from `tests/e2e/stripe/bank-rails.stripe.ts` (retired in task 18.1): the
// listing insert, Buy Now, the delivery proposal, the Pay dialog's rail choice, the
// Payment Element bank fields and the bank redirect. Its patch-and-restore of seed
// profiles is gone: buyers and the cross-border seller are Personas, created per
// Pathway, so no shared seed member is ever repointed.
//
// WHY PERSONAS FOR EVERY PAYING BUYER. `acceptCashSaleTerms` is limited to 10 calls an
// hour per member across instances (`lib/rateLimitDb.ts`), with no e2e bypass. Every
// Pathway here presses Pay at least once on each viewport, so a seed buyer shared with
// the lifecycle specs would exhaust its budget part-way through a run.

import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type Stripe from 'stripe';
import { expect, type Frame, type Locator, type Page } from '@playwright/test';

import { insertRow, selectRows, updateRows } from './db';
import { fillPlace, STUB_PLACES, stubbedPlaceLabel } from './listings';
import type { StubbedPlace } from './places';
import { COLD_ROUTE, RENDERED } from './waiting';
import { closeDetailsSheetIfOpen } from './cashSaleRoom';
import { openBuyCheckout, saveCardInPaymentElement, PAYMENT_ELEMENT_FRAME } from './payments';
import { DE_FIXTURE_ACCOUNT, ENTRY_CARDS, type EntryCard } from '../audit/stripeFixtures';
import { testStripe, type TestPlatform } from '../audit/backend/stripe';
import {
  serviceFeeForMethod,
  storedPaymentMethod,
  totalForMethod,
  type MethodPricingFacts,
  type PaymentMethodKind,
} from '../../../domain/payments/paymentMethods';
import { formatMoney } from '../../../lib/format';

/** The repository root. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** The `cash_sales` columns the payment Pathways read. */
export interface SaleRow {
  id: string;
  item_id: string;
  status: string;
  currency: string;
  agreed_price_cents: number;
  shipping_cost_cents: number;
  platform_fee_cents: number;
  amount_cents: number;
  payment_method_kind: string | null;
  transfer_id: string | null;
  terms_version: number;
  payment_attempt: number | null;
}

const SALE_COLUMNS =
  'id,item_id,status,currency,agreed_price_cents,shipping_cost_cents,platform_fee_cents,amount_cents,' +
  'payment_method_kind,transfer_id,terms_version,payment_attempt';

/** One sale, read with the service role. Throws when it does not exist. */
export async function saleRow(saleId: string): Promise<SaleRow> {
  const [row] = await selectRows<SaleRow>('cash_sales', `select=${SALE_COLUMNS}&id=eq.${saleId}`);
  if (!row) throw new Error(`no cash sale ${saleId}`);
  return row;
}

/** The sale's status, for `assertState` DB reads. */
export async function saleStatus(saleId: string): Promise<string> {
  return (await saleRow(saleId)).status;
}

/** An item's status, for `assertState` DB reads. */
export async function itemStatus(itemId: string): Promise<string> {
  const [row] = await selectRows<{ status: string }>('items', `select=status&id=eq.${itemId}`);
  if (!row) throw new Error(`no item ${itemId}`);
  return row.status;
}

/** An item's title, so a Pathway can find its own listing by search. */
export async function itemTitle(itemId: string): Promise<string> {
  const [row] = await selectRows<{ title: string }>('items', `select=title&id=eq.${itemId}`);
  if (!row) throw new Error(`no item ${itemId}`);
  return row.title;
}

/**
 * Searches the catalog for the item's own title, as a member browsing would. Reading the
 * page is the step; {@link visibleInCatalog} reads what came back.
 */
export async function searchCatalogFor(page: Page, title: string): Promise<void> {
  await page.goto(`/?q=${encodeURIComponent(title)}`);
  await page.waitForLoadState('domcontentloaded');
}

/**
 * 'AVAILABLE' when the item's tile is a link on the catalog page the member is looking
 * at, else 'NOT_LISTED'. Only a link counts: the search box and the "no results" copy
 * both repeat the query (F12).
 */
export async function visibleInCatalog(page: Page, itemId: string): Promise<string> {
  const tile = page.locator(`a[href="/listings/${itemId}"]`).filter({ visible: true }).first();
  return (await tile.isVisible().catch(() => false)) ? 'AVAILABLE' : 'NOT_LISTED';
}

/** The pricing facts the domain fee functions read, from a sale row. */
export function pricingOf(row: SaleRow): MethodPricingFacts {
  return {
    agreedPriceCents: row.agreed_price_cents,
    shippingCostCents: row.shipping_cost_cents,
    platformFeeCents: row.platform_fee_cents,
    amountCents: row.amount_cents,
    currency: row.currency,
    paymentMethod: storedPaymentMethod(row.payment_method_kind),
  };
}

/** What paying `row` with `method` charges, and its service fee, by the app's own functions. */
export function expectedCharge(row: SaleRow, method: PaymentMethodKind): { feeMinor: number; totalMinor: number; total: string; fee: string } {
  const pricing = pricingOf(row);
  const feeMinor = serviceFeeForMethod(pricing, method);
  const totalMinor = totalForMethod(pricing, method);
  return { feeMinor, totalMinor, fee: formatMoney(feeMinor, row.currency), total: formatMoney(totalMinor, row.currency) };
}

/** The Stripe TEST platform a contract currency is collected on. */
export function platformForCurrency(currency: string): TestPlatform {
  return currency.toLowerCase() === 'aud' ? 'AU' : 'US';
}

/** The sale's PaymentIntent on its platform, with the latest charge expanded. */
export async function saleIntent(row: SaleRow): Promise<Stripe.PaymentIntent> {
  if (!row.transfer_id) throw new Error(`cash sale ${row.id} has no PaymentIntent`);
  return testStripe(platformForCurrency(row.currency)).paymentIntents.retrieve(row.transfer_id, {
    expand: ['latest_charge'],
  });
}

/** What Stripe actually took for the sale: 0 when no intent exists. */
export async function amountReceived(row: SaleRow): Promise<number> {
  if (!row.transfer_id) return 0;
  return (await saleIntent(row)).amount_received ?? 0;
}

// ---------------------------------------------------------------------------
// Arranging members and listings
// ---------------------------------------------------------------------------

/**
 * Makes a verified seller Persona disclosable to buyers: the one-tap consent to their
 * verified name being shown (`merchant_identity_disclosure_consented_at`), which a
 * real seller gives on the listing form and `personaProfileRow` does not set. With
 * `payout`, also points `merchant_ref` at a test connected account and marks payouts
 * live, the state `canReceiveFunds` reads (a cross-border sale is charged on behalf of
 * that account, so Stripe needs it live before the buyer can pay).
 */
export async function arrangeSellerPersona(
  profileId: string,
  payout: { merchantRef: string } | null = null,
): Promise<void> {
  const now = new Date().toISOString();
  await updateRows('profiles', `id=eq.${profileId}`, {
    merchant_identity_disclosure_consented_at: now,
    ...(payout
      ? {
          merchant_ref: payout.merchantRef,
          merchant_status: 'APPROVED',
          merchant_settlements_enabled: true,
          payee_identity_mismatch_at: null,
        }
      : {}),
  });
}

/**
 * A SINGLE listing owned by `ownerId`, inserted directly. What these Pathways test is
 * the Pay step, so the listing is arranged rather than driven through the create form
 * (`listings.spec.ts` covers that). Currency and the seller flags are still derived by
 * the table's own insert triggers from the owner's region and verification. The title
 * must be marked so teardown removes the item and its sale.
 */
export async function seedListing(
  ownerId: string,
  opts: { title: string; priceMinor: number; place?: StubbedPlace },
): Promise<string> {
  const place = opts.place ?? STUB_PLACES.sydney;
  const [photo] = await selectRows<{ image_paths: string[] }>(
    'items',
    'select=image_paths&hidden=eq.false&order=created_at.desc&limit=1',
  );
  const item = await insertRow<{ id: string }>('items', {
    owner_id: ownerId,
    title: opts.title,
    description: 'Created by the cash-sale payments audit.',
    category: 'Pokémon',
    condition: 'Near Mint',
    fmv_cents: opts.priceMinor,
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

// ---------------------------------------------------------------------------
// The DE fixture account
// ---------------------------------------------------------------------------

const DE_LOCK_DIR = path.resolve(REPO_ROOT, 'test-results', '.locks', 'de-fixture-account');
/** A lock older than this is from a crashed worker and is taken over. */
const DE_LOCK_STALE_MS = 12 * 60_000;

/**
 * Takes the ONE German test connected account for a seller Persona, for the EU bank
 * rails (charged on behalf of a German seller). `profiles.merchant_ref` is UNIQUE, so
 * two Pathways (or one Pathway on both viewports) cannot hold it at once: this takes a
 * cross-worker file lock first, then moves the account off whichever finished Persona
 * held it last. Returns the release function; call it in a `finally`.
 */
export async function takeDeFixtureAccount(profileId: string, waitMs = 8 * 60_000): Promise<() => void> {
  mkdirSync(path.dirname(DE_LOCK_DIR), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(DE_LOCK_DIR);
      writeFileSync(path.join(DE_LOCK_DIR, 'owner'), `${process.pid} ${profileId} ${new Date().toISOString()}\n`);
      break;
    } catch {
      try {
        if (Date.now() - statSync(DE_LOCK_DIR).mtimeMs > DE_LOCK_STALE_MS) {
          rmSync(DE_LOCK_DIR, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) throw new Error('timed out waiting for the DE fixture account lock');
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  const release = () => rmSync(DE_LOCK_DIR, { recursive: true, force: true });
  try {
    await updateRows('profiles', `merchant_ref=eq.${DE_FIXTURE_ACCOUNT}&id=neq.${profileId}`, { merchant_ref: null });
    await arrangeSellerPersona(profileId, { merchantRef: DE_FIXTURE_ACCOUNT });
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

// ---------------------------------------------------------------------------
// Server Action refusal codes
// ---------------------------------------------------------------------------

/** Action error codes (kebab) whose domain code is not a plain case change. */
const DOMAIN_CODES: Readonly<Record<string, string>> = {
  'no-payment-method': 'BUYER_NO_PAYMENT_METHOD',
};

/** `card-repriced` -> `CARD_REPRICED`, the orchestrator's `CashSaleError`. */
export function domainCode(actionCode: string): string {
  return DOMAIN_CODES[actionCode] ?? actionCode.toUpperCase().replace(/-/g, '_');
}

/** The last `{ ok: false, error }` in a set of Server Action response bodies. */
export function lastActionError(bodies: readonly string[]): string | null {
  let found: string | null = null;
  for (const body of bodies) {
    for (const match of body.matchAll(/"ok":false,"error":"([a-z-]+)"/g)) found = match[1];
  }
  return found;
}

/**
 * Runs `act` while recording every Server Action response on `page`, then waits for
 * one that returned `{ ok: false, error }` and returns that error as the domain code
 * (`CARD_REPRICED`). The room and the Buy dialog show only copy, so this is how a
 * refusal Pathway observes the CODE the server sent (Req 6.5).
 */
export async function captureActionRefusal(
  page: Page,
  act: () => Promise<void>,
  timeout = 60_000,
): Promise<{ code: string }> {
  // READ IN THE PAGE, CHUNK BY CHUNK. A Server Action's response is a Flight stream:
  // the result row arrives first and the revalidated tree after it, and the stream can
  // stay open long after the client has the result (observed on the Pay refusals: the
  // headers and the result arrived in under a second, the body never completed and the
  // browser reported ERR_ABORTED when the context closed). Playwright's
  // `response.text()` waits for the WHOLE body, so it never resolved. Instead `fetch`
  // is wrapped for the length of `act`, and a clone of each action response is read as
  // it streams.
  await page.evaluate(() => {
    const w = window as unknown as { __e2eActionBodies?: string[]; __e2eFetch?: typeof fetch };
    w.__e2eActionBodies = [];
    if (w.__e2eFetch) return;
    const original = window.fetch.bind(window);
    w.__e2eFetch = original;
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (!headers.has('next-action') || !response.body) return response;
      const index = (w.__e2eActionBodies ??= []).push('') - 1;
      const reader = response.clone().body!.getReader();
      const decoder = new TextDecoder();
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            w.__e2eActionBodies![index] += decoder.decode(value, { stream: true });
          }
        } catch {
          // An aborted stream keeps what was read.
        }
      })();
      return response;
    };
  });
  const bodies = async (): Promise<string[]> =>
    page
      .evaluate(() => (window as unknown as { __e2eActionBodies?: string[] }).__e2eActionBodies ?? [])
      .catch(() => []);
  try {
    await act();
    await expect
      .poll(async () => lastActionError(await bodies()), { message: 'a Server Action returned a refusal', timeout })
      .not.toBeNull();
    return { code: domainCode(lastActionError(await bodies())!) };
  } finally {
    await page
      .evaluate(() => {
        const w = window as unknown as { __e2eFetch?: typeof fetch };
        if (w.__e2eFetch) window.fetch = w.__e2eFetch;
        delete w.__e2eFetch;
      })
      .catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// What the member sees
// ---------------------------------------------------------------------------

/** `CASH_SALE_STATUS_MAP` labels (components/sales/CashSaleStatusBadge.tsx), reversed. */
const STATUS_BY_LABEL: Readonly<Record<string, string>> = {
  'Agreeing terms': 'AGREEMENT',
  'Stripe pending': 'PAYMENT_PENDING',
  'Funds confirmed': 'ESCROW_HELD',
  'In transit': 'IN_TRANSIT',
  Handover: 'HANDOVER',
  Inspection: 'INSPECTION',
  Completed: 'COMPLETED',
  Disputed: 'DISPUTED',
  Cancelled: 'CANCELLED',
  'Stripe failed': 'FAILED',
  Refunded: 'REFUNDED',
  'Return required': 'RETURN_PENDING',
  'Return in transit': 'RETURN_IN_TRANSIT',
};

/**
 * The sale status the room's badge shows (`aria-label="Sale status: <label>"`), as the
 * enum value, or `unknown:<label>` / `none`. For `assertState` UI reads.
 */
export async function visibleSaleStatus(page: Page): Promise<string> {
  const badge = page.locator('[aria-label^="Sale status: "]').filter({ visible: true }).first();
  const label = await badge.getAttribute('aria-label', { timeout: 2_000 }).catch(() => null);
  if (!label) return 'none';
  const text = label.slice('Sale status: '.length);
  return STATUS_BY_LABEL[text] ?? `unknown:${text}`;
}

/** 'AVAILABLE' when the member can open Buy on the listing page, else 'NOT_BUYABLE'. */
export async function visibleListingBuyable(page: Page): Promise<string> {
  const buy = page.getByRole('button', { name: /^Buy( now)?$/ }).filter({ visible: true }).first();
  return (await buy.isVisible().catch(() => false)) ? 'AVAILABLE' : 'NOT_BUYABLE';
}

/** The sale id from a contract-room URL. */
export function saleIdFrom(page: Page): string {
  const id = new URL(page.url()).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`not a contract room URL: ${page.url()}`);
  return id;
}

// ---------------------------------------------------------------------------
// Buy Now, terms, Pay
// ---------------------------------------------------------------------------

/**
 * Buy Now on a listing through the real dialog. With `addCard`, the buyer has none yet:
 * "Add a card to continue" opens Payment Element, the card is typed into Stripe's
 * iframe and saved (finishing its 3-D Secure setup check when it asks for one). Then
 * "Reserve item and agree terms", landing in the contract room. Returns the dialog's
 * last state only through the URL.
 */
export async function buyNow(page: Page, itemId: string, addCard: EntryCard | null = null): Promise<string> {
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');
  const dialog = await openBuyCheckout(page);
  if (addCard) {
    const add = dialog.getByRole('button', { name: 'Add a card to continue' });
    await expect(add).toBeVisible({ timeout: 25_000 });
    await add.click();
    await expect(dialog.getByRole('heading', { name: 'Add a payment method' })).toBeVisible({ timeout: 20_000 });
    await saveCardInPaymentElement(page, dialog, addCard, 'complete');
    await expect(dialog.getByRole('button', { name: 'Change' })).toBeVisible({ timeout: 45_000 });
  }
  await reserve(dialog);
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  return saleIdFrom(page);
}

/** Presses the Buy dialog's reserve button once it is enabled (the card read is back). */
export async function reserve(dialog: Locator): Promise<void> {
  const button = dialog.getByRole('button', { name: 'Reserve item and agree terms' });
  await expect(button).toBeEnabled({ timeout: 25_000 });
  await button.click();
}

/**
 * Saves a card through the profile's "Payment method" row, as a member adding one
 * from their account would (another device, or ahead of any purchase). The card goes
 * into Stripe's iframe; `completeCardSetup` records its fingerprint as a risk signal.
 */
export async function saveCardFromProfile(page: Page, card: EntryCard = ENTRY_CARDS.success): Promise<void> {
  await page.goto('/profile');
  await page.waitForLoadState('domcontentloaded');
  const row = page.getByRole('button', { name: /^Payment method/ }).filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: COLD_ROUTE });
  await row.click();
  const dialog = page.getByRole('dialog', { name: 'Add a payment method' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await saveCardInPaymentElement(page, dialog, card, 'complete');
  await expect(dialog).toBeHidden({ timeout: 45_000 });
}

/** The buyer's delivery address, chosen from the stubbed autocomplete. */
export async function proposeDelivery(page: Page, place: StubbedPlace = STUB_PLACES.sydney): Promise<void> {
  const setDelivery = page.getByRole('button', { name: /Set delivery details|Choose a method/i }).filter({ visible: true }).first();
  if (await setDelivery.isVisible({ timeout: 10_000 }).catch(() => false)) await setDelivery.click();
  else await page.getByRole('tab', { name: 'Terms' }).click();
  const ship = page.getByRole('button', { name: /Ship the item/i }).filter({ visible: true }).first();
  await expect(ship).toBeVisible({ timeout: RENDERED });
  await ship.click();
  // Scoped by heading: on a phone the "Contract details" sheet is also a dialog and
  // stays open after the terms are saved (see cashSaleRoom.ts proposeDelivery).
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /handover terms/i }) });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await fillPlace(page, /Your delivery address/i, place, dialog);
  await dialog.getByRole('button', { name: 'Propose terms' }).click();
  await expect(dialog).toBeHidden({ timeout: 25_000 });
  await closeDetailsSheetIfOpen(page);
}

/** The dock's Pay button ("Accept terms and pay", or "Verify ID to pay" over the limit). */
export function payButton(page: Page): Locator {
  return page.getByRole('button', { name: /^(Accept terms and pay|Verify ID to pay)$/ }).filter({ visible: true }).first();
}

/** The Pay confirmation dialog. */
export function payDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Accept these terms and pay?' });
}

/** Opens the Pay dialog from the dock and waits for the buyer's card to be read. */
export async function openPayDialog(page: Page): Promise<Locator> {
  await closeDetailsSheetIfOpen(page);
  const pay = payButton(page);
  await expect(pay).toBeEnabled({ timeout: COLD_ROUTE });
  await pay.click();
  const dialog = payDialog(page);
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  return dialog;
}

/** The card confirm button inside the Pay dialog ("Accept terms and pay <total>"). */
export function cardConfirm(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: /^Accept terms and pay \S/ });
}

/** The total the card confirm button shows, e.g. "$154.35 AUD", once the card is read. */
export async function shownCardTotal(dialog: Locator): Promise<string> {
  const button = cardConfirm(dialog);
  await expect(button).toBeEnabled({ timeout: 30_000 });
  // innerText, not textContent: `PendingLabel` lays the resting and the pending label
  // in one grid cell and hides the other with `visibility: hidden`, so textContent
  // reads the label twice ("Accept terms and pay $X AUDAccept terms and pay $X AUD").
  const text = (await button.innerText()).replace(/\s+/g, ' ').trim();
  const match = /^Accept terms and pay (.+)$/.exec(text);
  if (!match) throw new Error(`unexpected Pay button text: ${text}`);
  return match[1];
}

/** Chooses a bank rail in the Pay dialog and continues to the bank step. */
export async function chooseRail(dialog: Locator, rail: RegExp, opts: { proceed?: boolean } = {}): Promise<void> {
  await expect(dialog.getByText('How do you want to pay?')).toBeVisible({ timeout: RENDERED });
  await dialog.getByRole('radio', { name: rail }).check();
  const next = dialog.getByRole('button', { name: /^Accept terms, continue to / });
  await expect(next).toBeEnabled({ timeout: RENDERED });
  if (opts.proceed === false) return;
  await next.click();
}

/**
 * Continues from the Pay dialog to the chosen rail's bank step. Split from
 * {@link chooseRail} so a step can read the fee copy while the Pay dialog, which states
 * every rail's rate, is still open.
 */
export async function continueToRail(dialog: Locator): Promise<void> {
  const next = dialog.getByRole('button', { name: /^Accept terms, continue to / });
  await expect(next).toBeEnabled({ timeout: RENDERED });
  await next.click();
}

/** The Payment Element inside the bank dialog. */
export function bankField(page: Page) {
  return page.locator('[role="dialog"]').frameLocator(PAYMENT_ELEMENT_FRAME).first();
}

/**
 * Fills whatever Stripe's Payment Element asks for on a bank rail: the account holder's
 * name (iDEAL, Bancontact, EPS, Przelewy24, PayTo), an email (Przelewy24), a bank
 * (EPS and Przelewy24 show a select, the first test bank is chosen), and PayTo's BSB
 * and account number. Stripe decides the fields per rail and country, so each is
 * filled only when shown.
 */
export async function fillBankDetails(page: Page, opts: { name: string; email?: string; payto?: boolean }): Promise<void> {
  const frame = bankField(page);
  const name = frame.locator('#payment-nameInput, #Field-nameInput').first();
  await expect(name).toBeVisible({ timeout: 30_000 });
  await name.fill(opts.name);
  const email = frame.locator('#payment-emailInput, #Field-emailInput').first();
  if (await email.isVisible().catch(() => false)) await email.fill(opts.email ?? 'e2e-bank@example.com');
  const bank = frame.locator('select').first();
  if (await bank.isVisible().catch(() => false)) {
    const values = await bank.locator('option').evaluateAll((options) =>
      options.map((o) => (o as HTMLOptionElement).value).filter((v) => v),
    );
    if (values[0]) await bank.selectOption(values[0]);
  }
  if (opts.payto) {
    await frame.locator('#payment-bsbNumberInput').fill('000000');
    await frame.locator('#payment-accountNumberInput').fill('000123456');
  }
}

/** Stripe's hosted test bank page: authorise, then wait to land back in the room. */
export async function authoriseAtTestBank(page: Page): Promise<void> {
  await page.waitForURL((url) => !url.href.startsWith('http://localhost'), { timeout: 45_000 });
  await page
    .getByRole('button', { name: /authori[sz]e/i })
    .or(page.getByRole('link', { name: /authori[sz]e/i }))
    .first()
    .click({ timeout: 30_000 });
  await page.waitForURL(/localhost:\d+\/sales\/[0-9a-f-]{36}/, { timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// 3-D Secure, when it may or may not come
// ---------------------------------------------------------------------------

async function challengeFrame(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const button = frame
      .locator('#test-source-authorize-3ds')
      .or(frame.getByRole('button', { name: /^complete( authentication)?$/i }))
      .first();
    if (await button.isVisible().catch(() => false)) return frame;
  }
  return null;
}

/**
 * Whether Stripe's test 3-D Secure challenge appears within `withinMs`. For the
 * decline Pathway, where whether the issuer asks for a check before declining depends
 * on the test card, and the decline is what is asserted.
 */
export async function challengeAppears(page: Page, withinMs = 12_000): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (await challengeFrame(page)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
