// tests/e2e/support/cashSaleRoom.ts
//
// Helpers for the cash-sale lifecycle Pathways (`specs/cash-sale.spec.ts`, task 9.1):
// arranging a listing, driving the contract room through the controls a member uses,
// and reading the same state two ways, from the database (service role) and from what
// the member sees, so every `assertState` pairs the two (Req 6.7).
//
// SELECTORS COME FROM THE COMPONENTS, not from guesses:
//   * status: `CashSaleStatusBadge` renders `aria-label="Sale status: <label>"` with
//     the labels in `components/sales/CashSaleStatusBadge.tsx` (mirrored below);
//   * the Buy dialog: `components/listings/BuyButton.tsx`;
//   * the Pay dialog: `ConfirmDialog` titled "Accept these terms and pay?" in
//     `components/sales/CashSaleView.tsx`, confirm label "Accept terms and pay <total>";
//   * terms: the Terms tab's method tiles ("Ship the item", "Meet face to face") and
//     `CashSaleTermsDialog` ("Propose terms" / "Save changes");
//   * the detail tabs: `ContractDetailList` (`role="tab"`); below `md` they sit in a
//     sheet opened by the "Contract details" button in `ContractChat`.
//
// MEMBER API CALLS. A few refusal codes are never reachable from a web control because
// the UI hides the control first (Buy Now with no card shows "Add a card to continue";
// Cancel is not offered after payment). Those are asserted through the mobile write API
// (`app/api/mobile/cash-sale/*`), which delegates to the SAME server action the room
// calls. The request goes from the member's own page (`page.request`), so it carries
// that member's session cookie, which `authenticateMobileRequest` reads first.

import { randomBytes } from 'node:crypto';

import { expect, type Frame, type Locator, type Page } from '@playwright/test';

import { insertRow, selectRows } from './db';
import { marked } from './marker';
import { fillPlace, STUB_PLACES } from './listings';
import type { StubbedPlace } from './places';
import { completeThreeDSecure, openBuyCheckout } from './payments';
import { closeCalendarPopover } from './journeySteps';
import { TRADE_PAIR_A, type SeedUser } from './users';
import { COLD_ROUTE, RENDERED } from './waiting';

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

/** `cash_sales.status`. */
export type CashSaleStatus =
  | 'AGREEMENT'
  | 'PAYMENT_PENDING'
  | 'ESCROW_HELD'
  | 'IN_TRANSIT'
  | 'HANDOVER'
  | 'INSPECTION'
  | 'COMPLETED'
  | 'DISPUTED'
  | 'CANCELLED'
  | 'FAILED'
  | 'REFUNDED'
  | 'RETURN_PENDING'
  | 'RETURN_IN_TRANSIT';

/**
 * The badge label for each status, copied from `CASH_SALE_STATUS_MAP`
 * (`components/sales/CashSaleStatusBadge.tsx`). Copied rather than imported because
 * that module imports the contract components (React, 'use client'), which the
 * Playwright process should not load. A drift shows up as a UI read of `unknown:<label>`.
 */
const STATUS_LABELS: Readonly<Record<CashSaleStatus, string>> = {
  AGREEMENT: 'Agreeing terms',
  PAYMENT_PENDING: 'Stripe pending',
  ESCROW_HELD: 'Funds confirmed',
  IN_TRANSIT: 'In transit',
  HANDOVER: 'Handover',
  INSPECTION: 'Inspection',
  COMPLETED: 'Completed',
  DISPUTED: 'Disputed',
  CANCELLED: 'Cancelled',
  FAILED: 'Stripe failed',
  REFUNDED: 'Refunded',
  RETURN_PENDING: 'Return required',
  RETURN_IN_TRANSIT: 'Return in transit',
};

const STATUS_BY_LABEL = new Map(Object.entries(STATUS_LABELS).map(([status, label]) => [label, status]));

/**
 * The status the member sees: the room's first visible status badge, mapped back to
 * the enum. `none` when no badge is on screen, `unknown:<label>` for a label the map
 * above does not know.
 */
export async function uiSaleStatus(page: Page): Promise<string> {
  const badge = page.locator('[aria-label^="Sale status: "]').filter({ visible: true }).first();
  if ((await badge.count()) === 0) return 'none';
  const aria = (await badge.getAttribute('aria-label').catch(() => null)) ?? '';
  const label = aria.replace(/^Sale status: /, '').trim();
  return STATUS_BY_LABEL.get(label) ?? `unknown:${label}`;
}

// ---------------------------------------------------------------------------
// Arranging records
// ---------------------------------------------------------------------------

/** A short unique token, so a title can be searched for and a tracking number is fresh. */
export function uniqueToken(): string {
  return `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

/** A marked listing title carrying `token`, which the catalog search finds it by. */
export function listingTitle(label: string, token: string): string {
  return marked(`${label} ${token}`);
}

/**
 * A fresh tracking number for one Pathway run. One number is one contract (0144), so
 * every run and viewport needs its own.
 */
export function trackingNumber(): string {
  return `ND${Date.now()}${randomBytes(2).toString('hex').toUpperCase()}AU`;
}

/**
 * A listing owned by a seed seller, inserted with the service role (the design's
 * `seedListing`). The create form is `listings.spec.ts`'s subject; here the listing is
 * only the precondition. The table's insert triggers still derive the currency and the
 * seller flags from the owner's region and verification, and the title is marked so
 * cleanup removes the item and its contracts.
 *
 * The photo is a SEED item's path (Trade Pair A). Cleanup keeps any object a non-marked
 * row still references, so sharing it never deletes the seed's image.
 */
export async function seedListing(
  owner: SeedUser,
  options: {
    title: string;
    priceMinor: number;
    kind?: 'SINGLE' | 'SHOPFRONT';
    place?: StubbedPlace;
    hidden?: boolean;
  },
): Promise<string> {
  const place = options.place ?? STUB_PLACES.sydney;
  const [photo] = await selectRows<{ image_paths: string[] | null }>(
    'items',
    `select=image_paths&id=eq.${TRADE_PAIR_A.aliceItemId}`,
  );
  const imagePaths = photo?.image_paths?.slice(0, 1) ?? [];
  if (imagePaths.length === 0) {
    throw new Error('seedListing: the seed item trade-pair-a-alice has no photo; run `npm run dev:db:reset`');
  }
  const item = await insertRow<{ id: string }>('items', {
    owner_id: owner.id,
    title: options.title,
    description: 'Created by the e2e audit suite (cash-sale lifecycle).',
    category: 'Pokémon',
    condition: 'Near Mint',
    fmv_cents: options.priceMinor,
    image_paths: imagePaths,
    listing_kind: options.kind ?? 'SINGLE',
    hidden: options.hidden ?? false,
    location_label: `${place.mainText}, ${place.secondaryText}`,
    location_place_id: place.placeId,
    location_country_code: place.countryCode,
    location_lat: place.lat,
    location_lng: place.lng,
    location_precision: 'suburb',
  });
  return item.id;
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

/** The `cash_sales` columns these Pathways read. */
export interface SaleRow {
  id: string;
  item_id: string;
  status: CashSaleStatus;
  agreed_price_cents: number;
  amount_cents: number;
  shipping_cost_cents: number;
  currency: string;
  terms_version: number;
  buyer_terms_accepted_version: number | null;
  seller_terms_accepted_version: number | null;
  fulfillment_method: 'DELIVERY' | 'IN_PERSON' | null;
  delivery_address_configured: boolean;
  shipping_notes: string | null;
  meeting_at: string | null;
  transfer_id: string | null;
  payment_requested_at: string | null;
  payment_settled_at: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  carrier_delivered_at: string | null;
  tracking_flagged_at: string | null;
  tracking_flag_reason: string | null;
  inspection_deadline_at: string | null;
  buyer_handover_confirmed_at: string | null;
  seller_handover_confirmed_at: string | null;
  completed_at: string | null;
  auto_completed: boolean;
  seller_payout_status: 'NOT_DUE' | 'PENDING' | 'SETTLED' | 'FAILED';
  seller_payout_ref: string | null;
  seller_payout_release_at: string | null;
  seller_payout_hold_reason: string | null;
  from_shopfront: boolean;
}

const SALE_COLUMNS: readonly (keyof SaleRow)[] = [
  'id', 'item_id', 'status', 'agreed_price_cents', 'amount_cents', 'shipping_cost_cents', 'currency',
  'terms_version', 'buyer_terms_accepted_version', 'seller_terms_accepted_version', 'fulfillment_method',
  'delivery_address_configured', 'shipping_notes', 'meeting_at', 'transfer_id', 'payment_requested_at',
  'payment_settled_at', 'tracking_number', 'shipped_at', 'carrier_delivered_at', 'tracking_flagged_at',
  'tracking_flag_reason', 'inspection_deadline_at', 'buyer_handover_confirmed_at',
  'seller_handover_confirmed_at', 'completed_at', 'auto_completed', 'seller_payout_status',
  'seller_payout_ref', 'seller_payout_release_at', 'seller_payout_hold_reason', 'from_shopfront',
];

/** One sale, read with the service role. Throws when it does not exist. */
export async function saleRow(saleId: string): Promise<SaleRow> {
  const [row] = await selectRows<SaleRow>('cash_sales', `select=${SALE_COLUMNS.join(',')}&id=eq.${saleId}`);
  if (!row) throw new Error(`no cash sale ${saleId}`);
  return row;
}

/** Every sale on one listing, newest first. */
export async function salesForItem(itemId: string): Promise<Array<Pick<SaleRow, 'id' | 'status'>>> {
  return selectRows('cash_sales', `select=id,status&item_id=eq.${itemId}&order=created_at.desc`);
}

/** A listing's status (`items.status`). */
export async function itemStatus(itemId: string): Promise<string | null> {
  const [row] = await selectRows<{ status: string }>('items', `select=status&id=eq.${itemId}`);
  return row?.status ?? null;
}

/** The lines a contract covers (`cash_sale_items`), in their stored order. */
export async function saleLines(saleId: string): Promise<Array<{ quantity: number; unit_price_cents: number }>> {
  return selectRows('cash_sale_items', `select=quantity,unit_price_cents&cash_sale_id=eq.${saleId}&order=sort_order.asc`);
}

/** Whole hours from now until `iso`, rounded up; null when there is no instant. */
export function hoursUntil(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  return Math.ceil((Date.parse(iso) - now) / 3_600_000);
}

/**
 * The inspection window the member sees, in whole hours, from the room's
 * `InspectionCountdown` heading ("Inspection window · 6 days left"). The banner rounds
 * DOWN ("6 days" for anything from 144 to 167 hours), so this reports the next whole
 * unit up, which is what {@link hoursUntil} gives for the stored deadline while the
 * window is in its first hour. Null when no countdown is rendered.
 */
export async function uiInspectionWindowHours(page: Page, freshWindowHours?: number): Promise<number | null> {
  const banner = page.getByText(/^Inspection window · /).first();
  if ((await banner.count()) === 0) return null;
  const text = ((await banner.textContent().catch(() => null)) ?? '').trim();
  // [low, high]: the whole hours remaining the label allows. The banner's clock is
  // floored to the MINUTE (`minuteNow`), so in a window's first minute it can read a
  // full unit: "7 days left" for a 168-hour window, "1 day left" for a 24-hour one.
  // `high` is therefore inclusive.
  let low: number;
  let high: number;
  const days = /(\d+) days? left/.exec(text);
  const hours = /(\d+) hours? left/.exec(text);
  if (days) {
    low = Number(days[1]) * 24;
    high = low + 24;
  } else if (hours) {
    low = Number(hours[1]);
    high = low + 1;
  } else {
    return -1;
  }
  // A freshly opened window of the expected length is consistent with the label when
  // it lies in the range; report it as that length so `assertState` compares like
  // with like. Anything outside the range is reported as the range's top, and fails.
  if (freshWindowHours !== undefined && freshWindowHours >= low && freshWindowHours <= high) return freshWindowHours;
  return high;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/** The sale id out of a `/sales/<id>` URL. */
export function saleIdFromUrl(url: string): string {
  const match = /\/sales\/([0-9a-f-]{36})/.exec(url);
  if (!match) throw new Error(`no sale id in ${url}`);
  return match[1];
}

/** Open a listing's detail page. */
export async function openListing(page: Page, itemId: string): Promise<void> {
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');
}

/** Open a contract room and wait for its status badge. */
export async function openSale(page: Page, saleId: string): Promise<void> {
  const targetPath = `/sales/${saleId}`;
  try {
    await page.goto(targetPath);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('interrupted by another navigation')) throw error;
    await page.waitForURL((url) => url.pathname === targetPath, { timeout: COLD_ROUTE });
  }
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('[aria-label^="Sale status: "]').filter({ visible: true }).first()).toBeVisible({
    timeout: COLD_ROUTE,
  });
}

/**
 * Show one of the room's detail tabs ("Status", "Item", "Items", "Terms", "Payment",
 * "Protection", "History"). Below `md` the tabs live in a sheet opened by the
 * "Contract details" button, so that is opened first when no tab is visible.
 */
export async function openSection(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name, exact: true }).filter({ visible: true }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Contract details' }).filter({ visible: true }).first().click();
  }
  await expect(tab).toBeVisible({ timeout: RENDERED });
  await tab.click();
}

/** Close the phone "Contract details" sheet if it is open over the dock. */
export async function closeDetailsSheetIfOpen(page: Page): Promise<void> {
  const done = page
    .getByRole('dialog')
    .getByRole('button', { name: 'Done', exact: true })
    .filter({ visible: true })
    .first();
  if (await done.isVisible().catch(() => false)) {
    await done.click();
    await expect(done).toBeHidden({ timeout: RENDERED });
  }
}

/** The dock's ⋯ menu ("More actions"), opened. Returns the popover. */
export async function openMoreActions(page: Page): Promise<Locator> {
  await closeDetailsSheetIfOpen(page);
  await page.getByRole('button', { name: 'More actions' }).filter({ visible: true }).first().click();
  const menu = page.locator('[data-radix-popper-content-wrapper]').last();
  await expect(menu).toBeVisible({ timeout: RENDERED });
  return menu;
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * Whether the catalog lists the listing titled `title`, searched by its unique
 * `token`. Reloads until the answer is `expected` or the timeout passes, because the
 * catalog is server-rendered and may be cached for a moment after a write. Returns the
 * last answer read.
 */
export async function catalogListsTitle(
  page: Page,
  token: string,
  title: string,
  expected: boolean,
  timeoutMs = 45_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let seen = !expected;
  for (;;) {
    await page.goto(`/?q=${encodeURIComponent(token)}`);
    await page.waitForLoadState('domcontentloaded');
    // Let the grid render before counting: an absent tile and an unrendered grid
    // read the same. The landmark is what the grid renders into, so wait for it.
    await page.getByRole('main').first().waitFor({ state: 'visible', timeout: 15_000 });
    seen = (await page.getByRole('link', { name: new RegExp(escapeRegExp(title)) }).count()) > 0;
    if (seen === expected || Date.now() > deadline) return seen;
    await page.waitForTimeout(1_000);
  }
}

// ---------------------------------------------------------------------------
// Opening a contract
// ---------------------------------------------------------------------------

/** Buy Now on a SINGLE listing, through the real dialog. Returns the new sale id. */
export async function reserveSingle(page: Page, itemId: string): Promise<string> {
  await openListing(page, itemId);
  const dialog = await openBuyCheckout(page);
  const reserve = dialog.getByRole('button', { name: 'Reserve item and agree terms' });
  await expect(reserve).toBeEnabled({ timeout: 25_000 });
  await reserve.click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  return saleIdFromUrl(page.url());
}

/**
 * A request on a Multiple items listing: the buyer describes what they want and names
 * a price (`ContractRequestFields`), then opens the contract. Returns the sale id.
 *
 * The trigger is "Buy now" on desktop and "Request" in the phone buyer bar.
 */
export async function requestFromShopfront(
  page: Page,
  itemId: string,
  request: { description: string; priceDollars: string },
): Promise<string> {
  await openListing(page, itemId);
  await page.getByRole('button', { name: /^(Buy( now)?|Request)$/ }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Start a purchase contract' })).toBeVisible({ timeout: 25_000 });
  await dialog.getByLabel('What you want').fill(request.description);
  await dialog.getByLabel('Your offer').fill(request.priceDollars);
  const open = dialog.getByRole('button', { name: 'Open contract and agree terms' });
  await expect(open).toBeEnabled({ timeout: 25_000 });
  await open.click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  return saleIdFromUrl(page.url());
}

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/** Reveal the Terms panel's method tiles (the dock's "Set delivery details", else the tab). */
async function showMethodTiles(page: Page): Promise<void> {
  await closeDetailsSheetIfOpen(page);
  const setDetails = page.getByRole('button', { name: 'Set delivery details' }).filter({ visible: true }).first();
  if (await setDetails.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await setDetails.click();
  } else {
    await openSection(page, 'Terms');
  }
}

/** The buyer proposes DELIVERY with a resolved address from the stubbed autocomplete. */
export async function proposeDelivery(page: Page, place: StubbedPlace = STUB_PLACES.sydney): Promise<void> {
  await showMethodTiles(page);
  const ship = page.getByRole('button', { name: /Ship the item/i }).filter({ visible: true }).first();
  await expect(ship).toBeVisible({ timeout: RENDERED });
  await ship.click();
  // Scoped to the terms dialog by its accessible name. On a phone the "Contract details"
  // sheet is also a dialog and stays open after the terms are saved (and contains a
  // "Handover terms" section heading), so `.filter({ has: heading })` matched both.
  const dialog = page.getByRole('dialog', { name: /handover terms/i });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await fillPlace(page, /Your delivery address/i, place, dialog);
  await dialog.getByRole('button', { name: 'Propose terms' }).click();
  await expect(dialog).toBeHidden({ timeout: 25_000 });
  await closeDetailsSheetIfOpen(page);
}

/** `YYYY-MM-DD` in the browser's local calendar, `days` from today. */
async function localIsoDate(page: Page, days: number): Promise<{ iso: string; sameMonth: boolean }> {
  return page.evaluate((offset) => {
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      iso: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`,
      sameMonth: day.getMonth() === now.getMonth(),
    };
  }, days);
}

/**
 * The buyer proposes IN_PERSON: a resolved meeting point and a meeting `daysAhead`
 * days out at the picker's default time (12:00 local). The picker offers half-hour
 * slots between 07:00 and 22:00 only, so a meeting less than an hour away cannot be
 * picked at every time of day; a Pathway that needs one moves `meeting_at` afterwards.
 */
export async function proposeInPerson(
  page: Page,
  daysAhead: number,
  place: StubbedPlace = STUB_PLACES.sydney,
): Promise<void> {
  await showMethodTiles(page);
  const meet = page.getByRole('button', { name: /Meet face to face/i }).filter({ visible: true }).first();
  await expect(meet).toBeVisible({ timeout: RENDERED });
  await meet.click();
  const dialog = page.getByRole('dialog', { name: /handover terms/i });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await fillPlace(page, /Meeting place/i, place, dialog);

  // The date: react-day-picker marks each day cell with `data-day="YYYY-MM-DD"`.
  const { iso, sameMonth } = await localIsoDate(page, daysAhead);
  await dialog.locator('#sale-meeting-at').click();
  const day = page.locator(`[data-day="${iso}"] button, button[data-day="${iso}"]`).filter({ visible: true }).first();
  if (!sameMonth && !(await day.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /next month/i }).filter({ visible: true }).first().click();
  }
  await expect(day).toBeVisible({ timeout: RENDERED });
  await day.click();
  // The modal calendar stays open after a pick and, while open, hides the terms
  // dialog from role queries; Escape closed the dialog with it. Closed by a click
  // outside instead (journeySteps). The time defaults to 12:00.
  await closeCalendarPopover(page, day);
  await expect(dialog.getByRole('combobox', { name: 'Meeting time' })).not.toHaveText(/^Time$/, { timeout: RENDERED });

  await dialog.getByRole('button', { name: 'Propose terms' }).click();
  await expect(dialog).toBeHidden({ timeout: 25_000 });
  await closeDetailsSheetIfOpen(page);
}

// ---------------------------------------------------------------------------
// Paying
// ---------------------------------------------------------------------------

/** The Pay confirmation dialog. */
export function payDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Accept these terms and pay?' });
}

/** Open the Pay dialog from the dock and wait until its card is read. Returns the dialog. */
export async function openPayDialog(page: Page): Promise<Locator> {
  await closeDetailsSheetIfOpen(page);
  const pay = page.getByRole('button', { name: /^Accept terms and pay$/ }).filter({ visible: true }).first();
  await expect(pay).toBeEnabled({ timeout: COLD_ROUTE });
  await pay.click();
  const dialog = payDialog(page);
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await expect(dialog.getByRole('button', { name: /^Accept terms and pay / })).toBeEnabled({ timeout: 30_000 });
  return dialog;
}

/** The "Complete" control of Stripe's test 3-D Secure page, in whichever frame holds it. */
async function challengeFrame(page: Page): Promise<Frame | null> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const complete = frame
      .locator('#test-source-authorize-3ds')
      .or(frame.getByRole('button', { name: /^complete( authentication)?$/i }))
      .first();
    if (await complete.isVisible().catch(() => false)) return frame;
  }
  return null;
}

/** Wait until Stripe shows its 3-D Secure challenge. Throws if none appears in time. */
export async function waitForChallenge(page: Page, timeoutMs = 60_000): Promise<void> {
  await expect
    .poll(async () => (await challengeFrame(page)) !== null, {
      message: 'the Stripe 3-D Secure challenge appears',
      timeout: timeoutMs,
      intervals: [500, 1_000, 2_000],
    })
    .toBe(true);
}

/**
 * Pay by the buyer's saved card: open the Pay dialog, confirm, and, when the issuer
 * asks for 3-D Secure (`decideThreeDS` requests it for a buyer's first purchases),
 * pass Stripe's test challenge. Resolves once the room has left AGREEMENT /
 * PAYMENT_PENDING, i.e. the payment is held. Returns the total the dialog showed.
 */
export async function payByCard(page: Page): Promise<string> {
  // Reuses a Pay dialog a previous step left open (the step that reads the fee copy).
  const open = payDialog(page);
  const dialog = (await open.isVisible().catch(() => false)) ? open : await openPayDialog(page);
  const confirm = dialog.getByRole('button', { name: /^Accept terms and pay / });
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  // innerText: `PendingLabel` keeps a `visibility: hidden` copy of the label.
  const label = (await confirm.innerText()).trim();
  await confirm.click();

  let challenged = false;
  await expect
    .poll(
      async () => {
        const status = await uiSaleStatus(page);
        if (status !== 'AGREEMENT' && status !== 'PAYMENT_PENDING' && status !== 'none') return status;
        if (!challenged && (await challengeFrame(page))) {
          challenged = true;
          await completeThreeDSecure(page);
        }
        return status;
      },
      { message: 'the payment is held', timeout: 120_000, intervals: [1_000, 2_000, 3_000] },
    )
    .toMatch(/^(ESCROW_HELD|HANDOVER)$/);
  return label.replace(/^Accept terms and pay /, '');
}

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

/** The seller records a shipment in `RecordShipmentDialog` (Australia Post). */
export async function recordShipment(page: Page, tracking: string): Promise<void> {
  await page.getByRole('button', { name: 'Add tracking' }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await dialog.locator('#ship-carrier').click();
  await page.getByRole('option', { name: 'Australia Post' }).click();
  const field = dialog.locator('#ship-tracking');
  await expect(field).toBeVisible({ timeout: RENDERED });
  await expect(async () => {
    await field.fill('');
    await field.fill(tracking);
    await expect(field).toHaveValue(tracking, { timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  const record = dialog.getByRole('button', { name: 'Record shipment' });
  await expect(record).toBeEnabled({ timeout: RENDERED });
  await record.click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

/** Press "Confirm handover" and confirm the dialog ("We met and …"). */
export async function confirmHandover(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm handover' }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Confirm the handover happened?' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await dialog.getByRole('button', { name: /^We met and / }).click();
  await expect(dialog).toBeHidden({ timeout: RENDERED });
}

/** The buyer accepts the goods ("Complete purchase" → "Complete without evidence"). */
export async function completePurchase(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Complete purchase' }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await dialog.getByRole('button', { name: 'Complete without evidence' }).click();
}

/** Cancel the contract from the ⋯ menu ("Cancel" → "Cancel contract"). */
export async function cancelFromRoom(page: Page): Promise<void> {
  const menu = await openMoreActions(page);
  await menu.getByRole('button', { name: 'Cancel', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel this contract?' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await dialog.getByRole('button', { name: 'Cancel contract' }).click();
  await expect(dialog).toBeHidden({ timeout: RENDERED });
}

// ---------------------------------------------------------------------------
// Member API
// ---------------------------------------------------------------------------

/** What a `/api/mobile/cash-sale/*` endpoint returns (an `ActionResult`). */
export interface MemberApiResult {
  status: number;
  ok: boolean;
  error?: string;
  message?: string;
  body: Record<string, unknown>;
}

/**
 * Call a mobile cash-sale endpoint AS the member whose page this is: the request
 * carries the page context's session cookie. Delegates to the same server action the
 * web room calls (`app/api/mobile/cash-sale/<path>/route.ts`).
 */
export async function memberCashSaleApi(
  page: Page,
  path: 'initiate' | 'cancel' | 'update-items',
  body: Record<string, unknown>,
): Promise<MemberApiResult> {
  const response = await page.request.post(`/api/mobile/cash-sale/${path}`, { data: body });
  const json = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  return {
    status: response.status(),
    ok: json.ok === true,
    ...(typeof json.error === 'string' ? { error: json.error } : {}),
    ...(typeof json.message === 'string' ? { message: json.message } : {}),
    body: json,
  };
}

/** Marked titles contain [ and ], which are regex metacharacters. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
