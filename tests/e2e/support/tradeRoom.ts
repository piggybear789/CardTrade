// tests/e2e/support/tradeRoom.ts
//
// Driving a 2-Way Trade through the real UI, plus the service-role reads the trade
// Pathways pair with it (`tests/e2e/specs/trade.spec.ts`, task 9.3).
//
// WHAT IS UI AND WHAT IS NOT. Every member action here goes through the screen the
// member would use: the listing's "Propose trade" dialog, the room's Terms editor,
// the accept dialog, the cash-leg Pay button, the handover and acceptance controls.
// The reads below (`readTrade`, `tradeHolds`, ...) are the database half of an
// `assertState`, and `seedTradeListing` is an `arrange` (the create-listing form is
// covered by `listings.spec.ts`; the precedent is `tests/e2e/stripe/bank-rails.stripe.ts`).
// `mobilePost` calls the mobile write API from a member's own context: it is the
// surface the Flutter client uses, and the only one that can reach a refusal the
// website's UI prevents up front (a Multiple items listing as the offering side, an
// offer across regions, an unverified member opening a trade).
//
// FACTS READ OFF THE COMPONENTS (components/trade/*, components/contract/*,
// components/fulfilment/*):
//   * The listing CTA is "Propose trade" on desktop and an icon button labelled
//     "Propose a trade" in the phone buyer bar. The dialog is "Propose a trade".
//   * Your own listings are tickable inline (`<ul aria-label="Your listings">`, the
//     newest five); a longer inventory is searched in the "Your listings" picker
//     behind the "All your listings" row.
//   * Sending navigates to `/trades/<id>` (TradeOfferForm), racing the dialog's own
//     `router.push('/trades')`, so the trade id is resolved from the database.
//   * The room's state is a badge with `aria-label="Trade state: <label>"`
//     (`StateBadge` -> `ContractStatusBadge`), in the header on desktop and in the
//     chat bar on a phone.
//   * Below the split the details are a sheet opened by the subject line's
//     "Contract details" button and closed by "Close details". Meeting terms live on
//     the "Terms" tab, edited through a dialog titled "Meeting terms" whose trigger is
//     "Set meeting" (no method yet) or "Edit terms".
//   * The meeting time is a `DateTimePicker`: a calendar popover (react-day-picker,
//     each cell `data-day="YYYY-MM-DD"`) that defaults the time to 12:00.
//   * Accept is "Accept terms", which opens "Accept these terms?" whose own
//     "Accept terms" button stays disabled until a card is on file.
//   * Only the LISTING OWNER can "Change cash" (overflow menu "More actions").

import { expect, type Locator, type Page } from '@playwright/test';
import { closeCalendarPopover } from './journeySteps';

import { insertRow, selectRows } from './db';
import { fillPlace } from './listings';
import { STUB_PLACES, stubbedPlaceLabel, type StubbedPlace } from './places';
import { appServerUrl, TRADE_PAIR_A } from './users';
import { testStripe, type TestPlatform } from '../audit/backend/stripe';

/** How long a room action may take to land (server action + Realtime or refresh). */
export const ROOM_ACTION = 45_000;

/** How long Stripe's 3-D Secure frame may take to appear after Pay. */
const CHALLENGE_WAIT = 20_000;

const HOUR_MS = 3_600_000;

// ---------------------------------------------------------------------------
// Arrange: listings
// ---------------------------------------------------------------------------

/** The listing kind as the database spells it. */
export type ListingKind = 'SINGLE' | 'SHOPFRONT';

/** An image path a seeded listing may borrow (cleanup keeps any object still referenced). */
async function borrowedImagePaths(): Promise<string[]> {
  const [row] = await selectRows<{ image_paths: string[] | null }>(
    'items',
    `select=image_paths&id=eq.${TRADE_PAIR_A.aliceItemId}`,
  );
  const paths = row?.image_paths?.slice(0, 1) ?? [];
  return paths.length > 0 ? paths : ['e2e/placeholder.jpg'];
}

/**
 * A listing owned by `ownerId`, inserted with the service role. The title must be
 * `marked(...)` so cleanup removes the row. Currency and the seller flags are derived
 * by the table's own insert triggers from the owner's region and verification.
 *
 * A SHOPFRONT is a "Multiple items" listing: its `priceMinor` is an indicative "from"
 * figure that never sizes anything.
 */
export async function seedTradeListing(
  ownerId: string,
  options: { title: string; priceMinor: number; kind?: ListingKind; place?: StubbedPlace },
): Promise<string> {
  const place = options.place ?? STUB_PLACES.sydney;
  const item = await insertRow<{ id: string }>('items', {
    owner_id: ownerId,
    title: options.title,
    description: 'Created by the e2e trade audit.',
    category: 'Pokémon',
    condition: 'Near Mint',
    fmv_cents: options.priceMinor,
    image_paths: await borrowedImagePaths(),
    listing_kind: options.kind ?? 'SINGLE',
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
// Database reads (the `db` half of an assertState)
// ---------------------------------------------------------------------------

/** The `trades` columns the Pathways read. */
export interface TradeSnapshot {
  id: string;
  state: string;
  currency: string | null;
  terms_version: number;
  initiator_terms_accepted_version: number | null;
  counterpart_terms_accepted_version: number | null;
  initiator_side_minor: number | null;
  counterpart_side_minor: number | null;
  cash_amount_cents: number;
  meeting_at: string | null;
  meeting_location: string | null;
  inspection_deadline_at: string | null;
}

/** One trade row, or a thrown error when it does not exist. */
export async function readTrade(tradeId: string): Promise<TradeSnapshot> {
  const [row] = await selectRows<TradeSnapshot>(
    'trades',
    'select=id,state,currency,terms_version,initiator_terms_accepted_version,' +
      'counterpart_terms_accepted_version,initiator_side_minor,counterpart_side_minor,' +
      `cash_amount_cents,meeting_at,meeting_location,inspection_deadline_at&id=eq.${tradeId}`,
  );
  if (!row) throw new Error(`no trade ${tradeId}`);
  return row;
}

/** The newest trade that has `itemId` on either side, or null. */
export async function tradeIdForItem(itemId: string): Promise<string | null> {
  const links = await selectRows<{ trade_id: string }>('trade_items', `select=trade_id&item_id=eq.${itemId}`);
  const ids = [...new Set(links.map((l) => l.trade_id))];
  if (ids.length === 0) return null;
  const [trade] = await selectRows<{ id: string }>(
    'trades',
    `select=id&id=in.(${ids.join(',')})&order=created_at.desc&limit=1`,
  );
  return trade?.id ?? null;
}

/** The newest trade between exactly these two items, or null. */
export async function tradeIdForItems(firstItemId: string, secondItemId: string): Promise<string | null> {
  const [a, b] = await Promise.all([
    selectRows<{ trade_id: string }>('trade_items', `select=trade_id&item_id=eq.${firstItemId}`),
    selectRows<{ trade_id: string }>('trade_items', `select=trade_id&item_id=eq.${secondItemId}`),
  ]);
  const shared = a.map((r) => r.trade_id).filter((id) => b.some((r) => r.trade_id === id));
  if (shared.length === 0) return null;
  const [trade] = await selectRows<{ id: string }>(
    'trades',
    `select=id&id=in.(${[...new Set(shared)].join(',')})&order=created_at.desc&limit=1`,
  );
  return trade?.id ?? null;
}

/** One collateral hold row. */
export interface HoldSnapshot {
  id: string;
  trader_id: string;
  hold_ref: string | null;
  status: string;
  amount_cents: number;
  expires_at: string | null;
}

/** Every hold on a trade, oldest first. */
export function tradeHolds(tradeId: string): Promise<HoldSnapshot[]> {
  return selectRows<HoldSnapshot>(
    'pre_auth_holds',
    `select=id,trader_id,hold_ref,status,amount_cents,expires_at&trade_id=eq.${tradeId}&order=created_at.asc`,
  );
}

/** Every Trade_Fee row on a trade. */
export function tradeFees(tradeId: string): Promise<Array<{ trader_id: string; status: string; amount_cents: number }>> {
  return selectRows('trade_fees', `select=trader_id,status,amount_cents&trade_id=eq.${tradeId}`);
}

/** The trade's cash leg, or null when it has none (yet). */
export async function tradeCashLeg(
  tradeId: string,
): Promise<{ status: string; amount_minor: number; fx_fee_minor: number; pay_by: string; release_at: string | null } | null> {
  const [row] = await selectRows<{ status: string; amount_minor: number; fx_fee_minor: number; pay_by: string; release_at: string | null }>(
    'trade_cash_settlements',
    `select=status,amount_minor,fx_fee_minor,pay_by,release_at&trade_id=eq.${tradeId}`,
  );
  return row ?? null;
}

/** An item's status, as the catalog guard reads it. */
export async function itemStatus(itemId: string): Promise<string | null> {
  const [row] = await selectRows<{ status: string }>('items', `select=status&id=eq.${itemId}`);
  return row?.status ?? null;
}

/** How many notifications titled `title` link a member to this trade. */
export async function tradeNotificationCount(userId: string, tradeId: string, title: string): Promise<number> {
  const rows = await selectRows<{ id: string }>(
    'notifications',
    `select=id&user_id=eq.${userId}&link=eq.${encodeURIComponent(`/trades/${tradeId}`)}` +
      `&title=eq.${encodeURIComponent(title)}`,
  );
  return rows.length;
}

/** The newest meeting-change proposal on a trade, or null. */
export async function latestHandoverChange(
  tradeId: string,
): Promise<{ id: string; decision: string | null; proposed_by: string } | null> {
  const [row] = await selectRows<{ id: string; decision: string | null; proposed_by: string }>(
    'trade_handover_changes',
    `select=id,decision,proposed_by&trade_id=eq.${tradeId}&order=created_at.desc&limit=1`,
  );
  return row ?? null;
}

/**
 * The PaymentIntent status Stripe TEST reports for a hold (`requires_capture` while
 * live, `canceled` once voided). The client refuses anything but a test key.
 */
export async function stripeHoldStatus(holdRef: string, platform: TestPlatform = 'AU'): Promise<string> {
  const intent = await testStripe(platform).paymentIntents.retrieve(holdRef);
  return intent.status;
}

/** Milliseconds to rewind `iso` by so that it lands `targetFromNowMs` from now. Never negative. */
export function rewindToward(iso: string, targetFromNowMs: number, now: number = Date.now()): number {
  return Math.max(0, Math.trunc(Date.parse(iso) - (now + targetFromNowMs)));
}

/** "2 hours from now", in the units `rewindToward` takes. */
export const hoursFromNow = (hours: number): number => hours * HOUR_MS;

// ---------------------------------------------------------------------------
// Member reads (the `ui` half of an assertState)
// ---------------------------------------------------------------------------

/** The room's state badge as the member sees it ("Negotiating", "Collateral locked", ...). */
export async function roomState(page: Page): Promise<string> {
  const badge = page.locator('[aria-label^="Trade state: "]').filter({ visible: true }).first();
  const label = await badge.getAttribute('aria-label', { timeout: 2_000 }).catch(() => null);
  return label ? label.replace(/^Trade state: /, '') : '';
}

/** Whether the member is still being asked to accept the terms on the table. */
export async function acceptOffered(page: Page): Promise<boolean> {
  return (await page.getByRole('button', { name: 'Accept terms' }).filter({ visible: true }).count()) > 0;
}

/** Minor units out of the first visible money figure in `locator` ("$250.00 AUD" -> 25000). */
export async function visibleMinor(locator: Locator): Promise<number | null> {
  const text = await locator.filter({ visible: true }).first().innerText({ timeout: 2_000 }).catch(() => '');
  const match = /(\d[\d,.\s]*?)[.,](\d{2})(?!\d)/.exec(text);
  if (!match) return null;
  return Number(match[1].replace(/[^\d]/g, '')) * 100 + Number(match[2]);
}

/** The room's headline figure: the header (desktop) or the chat bar price (phone). */
export function roomHeadlineMinor(page: Page): Promise<number | null> {
  return visibleMinor(page.locator('.display-value'));
}

/** Whether a piece of member-facing text is visible on the page. */
export async function textShown(page: Page, text: string | RegExp): Promise<boolean> {
  return (await page.getByText(text).filter({ visible: true }).count()) > 0;
}

// ---------------------------------------------------------------------------
// Member actions
// ---------------------------------------------------------------------------

/** Open a trade room and wait for its state badge. */
export async function openRoom(page: Page, tradeId: string): Promise<void> {
  const targetPath = `/trades/${tradeId}`;
  try {
    await page.goto(targetPath);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('interrupted by another navigation')) throw error;
    await page.waitForURL((url) => url.pathname === targetPath, { timeout: ROOM_ACTION });
  }
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('[aria-label^="Trade state: "]').filter({ visible: true }).first()).toBeVisible({
    timeout: ROOM_ACTION,
  });
}

/** The listing's trade CTA at either viewport. */
export function proposeTradeButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Propose (a )?trade$/ }).filter({ visible: true }).first();
}

/** Open a listing and its "Propose a trade" dialog. Returns the dialog. */
export async function openProposeDialog(page: Page, itemId: string): Promise<Locator> {
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');
  await proposeTradeButton(page).click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Propose a trade' }) });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  return dialog;
}

/** Tick one of your own listings on the offer, inline or through the picker. */
export async function pickOwnListing(page: Page, dialog: Locator, title: string): Promise<void> {
  const inline = dialog.getByRole('list', { name: 'Your listings' }).locator('label').filter({ hasText: title });
  if ((await inline.count()) > 0) {
    await inline.first().getByRole('checkbox').check();
  } else {
    await dialog.getByRole('button', { name: /^All your listings/ }).click();
    const picker = page.getByRole('dialog', { name: 'Your listings' });
    await expect(picker).toBeVisible({ timeout: 10_000 });
    await picker.getByPlaceholder('Search your listings').fill(title);
    await picker.locator('label').filter({ hasText: title }).first().getByRole('checkbox').check();
    await picker.getByRole('button', { name: 'Done' }).click();
    await expect(picker).toBeHidden({ timeout: 10_000 });
  }
  await expect(dialog.getByText(/\(1 selected\)/)).toBeVisible({ timeout: 10_000 });
}

/** Whether one of your listings is offered in the dialog at all (inline or in the picker). */
export async function ownListingOffered(page: Page, dialog: Locator, title: string): Promise<boolean> {
  if ((await dialog.getByRole('list', { name: 'Your listings' }).locator('label').filter({ hasText: title }).count()) > 0) {
    return true;
  }
  const all = dialog.getByRole('button', { name: /^All your listings/ });
  if ((await all.count()) === 0) return false;
  await all.click();
  const picker = page.getByRole('dialog', { name: 'Your listings' });
  await expect(picker).toBeVisible({ timeout: 10_000 });
  await picker.getByPlaceholder('Search your listings').fill(title);
  const found = (await picker.locator('label').filter({ hasText: title }).count()) > 0;
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await expect(picker).toBeHidden({ timeout: 10_000 });
  return found;
}

/** Put cash on the offer through "Add cash" -> "Payment terms". */
export async function addCashToOffer(
  page: Page,
  dialog: Locator,
  cash: { dollars: string; direction: 'add' | 'request' },
): Promise<void> {
  await dialog.getByRole('button', { name: /^Add cash/ }).click();
  const terms = page.getByRole('dialog', { name: 'Payment terms' });
  await expect(terms).toBeVisible({ timeout: 10_000 });
  await terms.getByRole('radio', { name: cash.direction === 'add' ? /I add cash/ : /I request cash/ }).check();
  await terms.locator('#terms-cash').fill(cash.dollars);
  await terms.getByRole('button', { name: 'Save terms' }).click();
  await expect(terms).toBeHidden({ timeout: 10_000 });
}

/**
 * Send the offer and return the new trade's id. The dialog closes and the browser
 * lands in the room; the id is read from the database because the dialog's own
 * `router.push('/trades')` races the navigation to the room.
 */
export async function sendOffer(page: Page, dialog: Locator, requestedItemId: string, offeredItemId: string): Promise<string> {
  const send = dialog.getByRole('button', { name: 'Send offer' });
  await expect(send).toBeEnabled({ timeout: 10_000 });
  await send.click();
  await expect(dialog).toBeHidden({ timeout: ROOM_ACTION });
  let tradeId: string | null = null;
  await expect
    .poll(async () => (tradeId = await tradeIdForItems(requestedItemId, offeredItemId)), {
      message: 'the trade exists',
      timeout: 30_000,
    })
    .not.toBeNull();
  // Let the dialog's own `router.push('/trades')` settle before `openRoom` navigates
  // to `/trades/${tradeId}`, so WebKit does not abort an in-flight chunk fetch.
  await page.waitForURL((url) => url.pathname === '/trades' || url.pathname.startsWith('/trades/'), { timeout: 10_000 }).catch(() => undefined);
  await page.waitForLoadState('load').catch(() => undefined);
  await openRoom(page, tradeId!);
  return tradeId!;
}

/** Open the details (a sheet below the split) and select one of its tabs. */
export async function openDetailsTab(page: Page, tab: RegExp): Promise<void> {
  const target = page.getByRole('tab', { name: tab }).filter({ visible: true }).first();
  if (!(await target.isVisible().catch(() => false))) {
    const details = page.getByRole('button', { name: 'Contract details' }).filter({ visible: true }).first();
    if (await details.isVisible().catch(() => false)) await details.click();
  }
  await expect(target).toBeVisible({ timeout: 15_000 });
  await target.click();
}

/** Close the details sheet when there is one. */
export async function closeDetails(page: Page): Promise<void> {
  const done = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('tablist', { name: 'Contract details' }) })
    .getByRole('button', { name: 'Done', exact: true });
  if (await done.isVisible().catch(() => false)) {
    await done.click();
    await expect(done).toBeHidden({ timeout: 10_000 });
  }
}

/** `YYYY-MM-DD` for today plus `days`, in the local timezone the browser also runs in. */
export function localDay(days: number, from: Date = new Date()): string {
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** Pick a day in the meeting calendar. The time defaults to 12:00. */
async function pickMeetingDay(page: Page, dialog: Locator, iso: string): Promise<void> {
  const trigger = dialog.locator('#trade-meeting-at');
  await trigger.click();
  const day = page.locator(`[data-day="${iso}"]:not([data-outside]) button`).first();
  for (let i = 0; i < 2 && !(await day.isVisible().catch(() => false)); i += 1) {
    await page.getByRole('button', { name: /next month/i }).filter({ visible: true }).first().click();
  }
  await day.click();
  // The modal calendar stays open after a pick and hides the dialog from role queries;
  // Escape closed the dialog with it, so it is closed by a click outside (journeySteps).
  await closeCalendarPopover(page, day);
  await expect(trigger).not.toHaveText(/Choose date and time/, { timeout: 5_000 });
}

/**
 * Set or edit the face-to-face meeting on the Terms tab: a resolved place from the
 * Places stub and a day `daysAhead` from today at 12:00. Leaves the details closed.
 * Returns whatever toast or state the save produced for the caller to assert.
 */
export async function saveMeetingTerms(
  page: Page,
  meeting: { place: StubbedPlace; daysAhead: number },
): Promise<void> {
  await openDetailsTab(page, /^Terms/);
  await page.getByRole('button', { name: /^(Set meeting|Edit terms)$/ }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Meeting terms' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByText('Face to face', { exact: true }).click();
  await fillPlace(page, /Meeting place/, meeting.place, dialog);
  await pickMeetingDay(page, dialog, localDay(meeting.daysAhead));
  await dialog.getByRole('button', { name: 'Save terms' }).click();
}

/** {@link saveMeetingTerms}, then wait for the dialog to close and the details with it. */
export async function setMeeting(page: Page, meeting: { place: StubbedPlace; daysAhead: number }): Promise<void> {
  await saveMeetingTerms(page, meeting);
  await expect(page.getByRole('dialog', { name: 'Meeting terms' })).toBeHidden({ timeout: ROOM_ACTION });
  await closeDetails(page);
}

/** Open "Accept these terms?" from the negotiation panel. Returns the dialog. */
export async function openAcceptDialog(page: Page): Promise<Locator> {
  const acceptBtn = page.getByRole('button', { name: 'Accept terms' }).filter({ visible: true }).first();
  if (!(await acceptBtn.isVisible().catch(() => false))) {
    await openDetailsTab(page, /^Terms/);
  }
  await acceptBtn.click();
  const dialog = page.getByRole('dialog', { name: 'Accept these terms?' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

/** The accept dialog's own confirm button. */
export function acceptConfirmButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: 'Accept terms' });
}

/** Confirm in the accept dialog and wait for it to close. */
export async function confirmAccept(dialog: Locator): Promise<void> {
  const confirm = acceptConfirmButton(dialog);
  await expect(confirm).toBeEnabled({ timeout: 20_000 });
  await confirm.click();
  await expect(dialog).toBeHidden({ timeout: ROOM_ACTION });
}

/** Accept the terms on the table, start to finish. */
export async function acceptTerms(page: Page): Promise<void> {
  await confirmAccept(await openAcceptDialog(page));
  await closeDetails(page);
}

/**
 * The listing owner revises the cash (and, on a Multiple items trade, the cards out of
 * the listing) through "More actions" -> "Change cash".
 */
export async function changeCash(page: Page, revision: { dollars: string; goods?: string }): Promise<void> {
  await page.getByRole('button', { name: 'More actions' }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Change cash' }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Change cash' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  if (revision.goods !== undefined) await dialog.locator('#trade-counterpart-goods').fill(revision.goods);
  await dialog.locator('#trade-cash').fill(revision.dollars);
  await dialog.getByRole('button', { name: 'Save cash' }).click();
  await expect(dialog).toBeHidden({ timeout: ROOM_ACTION });
}

/**
 * Pay the trade's cash leg ("Pay <total>") and finish Stripe's 3-D Secure check when
 * the issuer asks for one. Resolves once the room says the cash is paid.
 */
export async function payCashLeg(page: Page, total: string): Promise<void> {
  await page.getByRole('button', { name: `Pay ${total}` }).filter({ visible: true }).first().click();
  const paid = page.getByText(/^Cash of .+ paid$/).filter({ visible: true }).first();
  const deadline = Date.now() + ROOM_ACTION + CHALLENGE_WAIT;
  while (Date.now() < deadline) {
    if (await paid.isVisible().catch(() => false)) return;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const complete = frame
        .locator('#test-source-authorize-3ds')
        .or(frame.getByRole('button', { name: /^complete( authentication)?$/i }))
        .first();
      if (await complete.isVisible().catch(() => false)) {
        await complete.click();
        break;
      }
    }
    await page.waitForTimeout(500);
  }
  await expect(paid).toBeVisible({ timeout: 5_000 });
}

/** Confirm the face-to-face handover ("We met and swapped"). */
export async function confirmHandover(page: Page): Promise<void> {
  const trigger = page.getByRole('button', { name: 'Confirm handover' }).filter({ visible: true }).first();
  await trigger.click();
  const confirm = page.getByRole('button', { name: 'We met and swapped' });
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.click();
  await expect(confirm).toBeHidden({ timeout: ROOM_ACTION });
}

/** Accept the item without evidence. */
export async function acceptItem(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Accept item' }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Accept what you received' });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Accept without evidence' }).click();
  await expect(dialog).toBeHidden({ timeout: ROOM_ACTION });
}

// ---------------------------------------------------------------------------
// The mobile write API, from a member's own context
// ---------------------------------------------------------------------------

/** What a mobile route returned. */
export interface MobileReply {
  status: number;
  body: { ok?: boolean; error?: string; message?: string; tradeId?: string } | null;
}

/**
 * POST to `app/api/mobile/<route>` with the member's own session cookies (the routes
 * accept a cookie session first, then a bearer token), on the main App_Server.
 */
export async function mobilePost(page: Page, route: string, body: unknown): Promise<MobileReply> {
  const response = await page.request.post(`${appServerUrl('main')}/api/mobile/${route}`, { data: body });
  const json = (await response.json().catch(() => null)) as MobileReply['body'];
  return { status: response.status(), body: json };
}

/** The opening-offer body `openTradeNegotiation` takes, goods for goods, no cash. */
export function openOfferBody(counterpartItemId: string, offeredItemId: string): Record<string, unknown> {
  return {
    counterpartItemId,
    offer: { kind: 'existing', itemId: offeredItemId },
    terms: { cashAmountCents: 0, cashDirection: 'PROPOSER_PAYS', declaredValueCents: null, handoverMethod: null, message: '' },
  };
}
