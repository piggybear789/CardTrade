// tests/e2e/support/journeySteps.ts
//
// The member actions and readings the two LIFECYCLE JOURNEYS are built from
// (`tests/e2e/specs/journeys.spec.ts`, task 9.4, Req 29.3 and 36.5). Each helper is one
// thing a member does or sees in the real contract rooms, written against the current
// components:
//
//   cash sale   `components/sales/CashSaleView.tsx`, `CashSaleTermsDialog.tsx`,
//               `components/fulfilment/RecordShipmentDialog.tsx`, `SavedAddressField.tsx`,
//               `components/contract/AcceptWithPhotoDialog.tsx`
//   trade       `components/trade/ProposeTradeDialog.tsx`, `TradeOfferForm.tsx`,
//               `TradeHandoverTermsEditor.tsx`, `TradeNegotiationPanel.tsx`,
//               `ActionBar.tsx`, `HoldStatus.tsx` (via `ContractHoldList`)
//   both rooms  `components/contract/ContractDetailList.tsx` (the tab strip),
//               `ContractLiveRow.tsx` (the phone details sheet), `ContractStatusBadge.tsx`
//
// Deliberately NOT here: anything that simulates an event (a Ship24 fixture, a rewind).
// Those stay inline in the spec inside `simulated()`, where the source-scan guard
// (Req 4.7) looks for them.
//
// The journeys lead the highlight reel, so every action ends with {@link beat}: a short,
// fixed pause that lets the recording show the result before the next action starts.
// It is pacing for the video, never a wait for the app; every state is still asserted.

import { expect, type Frame, type Locator, type Page } from '@playwright/test';

import { testStripe } from '../audit/backend/stripe';
import { selectRows } from './db';
import { fillPlace, STUB_PLACES } from './listings';
import { completeThreeDSecure } from './payments';
import { fillAndConfirm } from './forms';
import type { StubbedPlace } from './places';
import { COLD_ROUTE, RENDERED } from './waiting';

// ---------------------------------------------------------------------------
// Pacing and small locator helpers
// ---------------------------------------------------------------------------

/** How long the video lingers on a result before the next action (ms), when pacing is on. */
export const JOURNEY_BEAT_MS = 1_500;

/**
 * Highlight-reel pacing (`E2E_HIGHLIGHT=1`). Off in normal runs: the beat is a fixed
 * sleep that makes no assertion and adds about 1.5 s per call, so a lifecycle Pathway
 * spent tens of seconds waiting for nothing. Every state the beat used to "let the
 * recording show" is still asserted by the step that follows it.
 */
const HIGHLIGHT_PACING = process.env.E2E_HIGHLIGHT === '1';

/** A deliberate pause so the recording reads at a human pace. A no-op unless `E2E_HIGHLIGHT=1`. */
export async function beat(page: Page, ms: number = JOURNEY_BEAT_MS): Promise<void> {
  if (!HIGHLIGHT_PACING) return;
  await page.waitForTimeout(ms);
}

/** Escapes a string for use inside a RegExp (marked titles contain `[` and `]`). */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The first instance of `locator` that is on screen (rooms render some controls twice). */
export function onScreen(locator: Locator): Locator {
  return locator.filter({ visible: true }).first();
}

/** A token unique enough to name one listing or parcel in a shared sandbox. */
export function journeyNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------------------------------------------------------------------------
// Contract room chrome (both rooms)
// ---------------------------------------------------------------------------

/**
 * Selects a contract details tab ("Terms", "Payment", "Collateral", …).
 *
 * Desktop draws the tab strip beside the chat. Below the split the room IS the chat and
 * the strip lives in a bottom sheet, opened from the subject line's "Contract details"
 * overlay button (`ContractChat`), so the sheet is opened first when no tab is on screen.
 */
export async function openDetailTab(page: Page, label: string): Promise<Locator> {
  const tab = page.getByRole('tab', { name: label, exact: true }).filter({ visible: true }).first();
  if (!(await tab.isVisible().catch(() => false))) {
    await onScreen(page.getByRole('button', { name: 'Contract details' })).click();
    await expect(tab, `the "${label}" tab is reachable`).toBeVisible({ timeout: RENDERED });
  }
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: RENDERED });
  return onScreen(page.getByRole('tabpanel'));
}

/** Closes the phone details sheet when it is open, so the action dock is reachable again. */
export async function closeDetailsSheet(page: Page): Promise<void> {
  const done = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('tablist', { name: 'Contract details' }) })
    .getByRole('button', { name: 'Done', exact: true });
  if (await done.isVisible().catch(() => false)) {
    await done.click();
    await expect(done).toBeHidden({ timeout: RENDERED });
  }
}

/** Reads the status badge's label (`aria-label="<kind>: <label>"`), or null when none is shown. */
async function badgeLabel(page: Page, kind: 'Sale status' | 'Trade state'): Promise<string | null> {
  const badge = onScreen(page.locator(`[aria-label^="${kind}: "]`));
  const label = await badge.getAttribute('aria-label', { timeout: 2_000 }).catch(() => null);
  return label ? label.slice(kind.length + 2) : null;
}

/** `CASH_SALE_STATUS_MAP` labels (components/sales/CashSaleStatusBadge.tsx), read back to the enum. */
const SALE_STATUS_BY_LABEL: Readonly<Record<string, string>> = {
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

/** `TRADE_STATUS_MAP` labels (components/trade/StateBadge.tsx), read back to the enum. */
const TRADE_STATE_BY_LABEL: Readonly<Record<string, string>> = {
  Negotiating: 'NEGOTIATING',
  'Collateral pending': 'COLLATERAL_PENDING',
  'Collateral locked': 'COLLATERAL_LOCKED',
  'In transit': 'IN_TRANSIT',
  Inspection: 'INSPECTION',
  Completed: 'COMPLETED',
  Disputed: 'DISPUTED',
  'Fraud resolved': 'FRAUD_RESOLVED',
  Cancelled: 'CANCELLED',
};

/** The Cash_Sale status the member's room shows, as the enum value (or `unknown:<label>`). */
export async function shownSaleStatus(page: Page): Promise<string | null> {
  const label = await badgeLabel(page, 'Sale status');
  return label === null ? null : (SALE_STATUS_BY_LABEL[label] ?? `unknown:${label}`);
}

/** The Trade_State the member's room shows, as the enum value (or `unknown:<label>`). */
export async function shownTradeState(page: Page): Promise<string | null> {
  const label = await badgeLabel(page, 'Trade state');
  return label === null ? null : (TRADE_STATE_BY_LABEL[label] ?? `unknown:${label}`);
}

// ---------------------------------------------------------------------------
// Database reads (service role, sandbox schema only)
// ---------------------------------------------------------------------------

/** One column set of a `cash_sales` row. */
export async function saleRow<T extends Record<string, unknown>>(saleId: string, columns: string): Promise<T> {
  const rows = await selectRows<T>('cash_sales', `select=${columns}&id=eq.${encodeURIComponent(saleId)}`);
  if (rows.length !== 1) throw new Error(`cash sale ${saleId}: expected one row, found ${rows.length}`);
  return rows[0];
}

/** One column set of a `trades` row. */
export async function tradeRow<T extends Record<string, unknown>>(tradeId: string, columns: string): Promise<T> {
  const rows = await selectRows<T>('trades', `select=${columns}&id=eq.${encodeURIComponent(tradeId)}`);
  if (rows.length !== 1) throw new Error(`trade ${tradeId}: expected one row, found ${rows.length}`);
  return rows[0];
}

/** The trade `initiatorId` opened against `counterpartItemId` (the newest, if several). */
export async function tradeIdFor(initiatorId: string, counterpartItemId: string): Promise<string | null> {
  const rows = await selectRows<{ id: string }>(
    'trades',
    `select=id&initiator_id=eq.${encodeURIComponent(initiatorId)}` +
      `&counterpart_item_id=eq.${encodeURIComponent(counterpartItemId)}&order=created_at.desc&limit=1`,
  );
  return rows[0]?.id ?? null;
}

/** A trade's collateral holds as stored: id, provider ref and status. */
export async function tradeHolds(tradeId: string): Promise<Array<{ id: string; hold_ref: string | null; status: string }>> {
  return selectRows('pre_auth_holds', `select=id,hold_ref,status&trade_id=eq.${encodeURIComponent(tradeId)}`);
}

/**
 * Each hold's status as the database AND Stripe test mode agree on it, sorted.
 *
 * A hold reads `VOIDED` only when the row says VOIDED and its PaymentIntent is
 * `canceled` in Stripe; `ACTIVE` only when the row is ACTIVE and the intent is
 * `requires_capture`. Anything else is reported as `<row>/<stripe>`, so a void the
 * database recorded but Stripe never performed fails the assertion visibly.
 */
export async function holdStatusesInStripe(tradeId: string): Promise<string[]> {
  const stripe = testStripe('AU');
  const holds = await tradeHolds(tradeId);
  const statuses: string[] = [];
  for (const hold of holds) {
    if (!hold.hold_ref) {
      statuses.push(`${hold.status}/no-provider-ref`);
      continue;
    }
    const intent = await stripe.paymentIntents.retrieve(hold.hold_ref);
    const agreed =
      (hold.status === 'VOIDED' && intent.status === 'canceled') ||
      (hold.status === 'ACTIVE' && intent.status === 'requires_capture');
    statuses.push(agreed ? hold.status : `${hold.status}/${intent.status}`);
  }
  return statuses.sort();
}

// ---------------------------------------------------------------------------
// Cash sale: buyer
// ---------------------------------------------------------------------------

/**
 * On a listing page, opens the Buy dialog and reserves the item with the saved card.
 * Returns the new sale's id from the room URL it lands on.
 */
export async function reserveWithBuyNow(page: Page): Promise<string> {
  // "Buy now" on desktop, "Buy" in the phone buyer bar.
  await onScreen(page.getByRole('button', { name: /^Buy( now)?$/ })).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Start a purchase contract' })).toBeVisible({ timeout: 25_000 });
  // The disclosure the buy path depends on: the seller's provider-verified identity.
  await expect(dialog.getByText(/^Seller verified as /)).toBeVisible({ timeout: RENDERED });
  const reserve = dialog.getByRole('button', { name: 'Reserve item and agree terms' });
  await expect(reserve, 'the buyer has a saved card, so the reserve button is offered').toBeEnabled({ timeout: 25_000 });
  await beat(page);
  await reserve.click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  const id = new URL(page.url()).pathname.split('/').pop();
  if (!id) throw new Error(`no sale id in ${page.url()}`);
  return id;
}

/**
 * Picks the buyer's delivery address inside the handover-terms dialog: a saved address
 * when the address book has one (prefilled or chosen), else the stubbed Places search.
 */
async function chooseDeliveryAddress(page: Page, dialog: Locator, place: StubbedPlace): Promise<void> {
  const saved = dialog.getByRole('group', { name: 'Choose a saved address' });
  const search = dialog.getByLabel(/Your delivery address/i);
  await expect(saved.or(search).first(), 'the delivery address field has loaded').toBeVisible({ timeout: RENDERED });
  if (await saved.isVisible().catch(() => false)) {
    const radios = saved.getByRole('radio');
    const count = await radios.count();
    for (let i = 0; i < count; i += 1) {
      if (await radios.nth(i).isChecked()) return;
    }
    // Nothing prefilled: the first saved address is a real, resolved place.
    await radios.first().check();
    return;
  }
  await fillPlace(page, /Your delivery address/i, place, dialog);
}

/**
 * The buyer proposes delivery and gives a resolved address, from the room's
 * "Set delivery details" step. Leaves the room with the Pay step showing.
 */
export async function proposeDeliveryTerms(page: Page, place: StubbedPlace = STUB_PLACES.sydney): Promise<void> {
  await onScreen(page.getByRole('button', { name: 'Set delivery details' })).click();
  await onScreen(page.getByRole('button', { name: /^Ship the item$/ })).click();
  const dialog = page.getByRole('dialog', { name: 'Set handover terms' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await chooseDeliveryAddress(page, dialog, place);
  await beat(page);
  await dialog.getByRole('button', { name: 'Propose terms' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await closeDetailsSheet(page);
  await expect(onScreen(page.getByRole('button', { name: 'Accept terms and pay' }))).toBeEnabled({ timeout: 30_000 });
  await beat(page);
}

/** The "Complete" control on Stripe's test 3-D Secure page, in any frame. */
function challengeComplete(frame: Frame): Locator {
  return frame
    .locator('#test-source-authorize-3ds')
    .or(frame.getByRole('button', { name: /^complete( authentication)?$/i }))
    .first();
}

async function challengeShowing(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    if (await challengeComplete(frame).isVisible().catch(() => false)) return true;
  }
  return false;
}

/**
 * Opens the Pay dialog, which itemises the price, postage, the buyer protection fee with its
 * rate ("3% + A$0.60 …") and the total charged now. Leaves it OPEN, so the step's fee
 * copy check reads the dialog rather than the room behind it.
 */
export async function openPayDialog(page: Page): Promise<Locator> {
  await closeDetailsSheet(page);
  await onScreen(page.getByRole('button', { name: 'Accept terms and pay' })).click();
  const dialog = page.getByRole('dialog', { name: 'Accept these terms and pay?' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await expect(dialog.getByRole('button', { name: /^Accept terms and pay / })).toBeVisible({ timeout: RENDERED });
  await beat(page);
  return dialog;
}

/**
 * Pays the agreed total from the saved card through the room's Pay dialog, opening it
 * first unless {@link openPayDialog} already has.
 *
 * A new buyer is asked for 3-D Secure (`domain/payments/scaPolicy.ts` requests `any`
 * for the first purchases), and whether Stripe's test mode then shows a challenge
 * depends on the card. So this waits for EITHER the challenge, which it passes, or the
 * room reaching `ESCROW_HELD` without one.
 */
export async function payByCardInRoom(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Accept these terms and pay?' });
  if (!(await dialog.isVisible().catch(() => false))) await openPayDialog(page);
  const confirm = dialog.getByRole('button', { name: /^Accept terms and pay / });
  // Disabled until the dialog has read the saved card back from Stripe.
  await expect(confirm).toBeEnabled({ timeout: 30_000 });
  await beat(page);
  await confirm.click();

  // Written inside the poll's closure, so declared with the full union rather than
  // narrowed to its initial value.
  let outcome = 'waiting' as 'challenge' | 'held' | 'waiting';
  await expect
    .poll(
      async () => {
        if (await challengeShowing(page)) outcome = 'challenge';
        else if ((await shownSaleStatus(page)) === 'ESCROW_HELD') outcome = 'held';
        else outcome = 'waiting';
        return outcome;
      },
      { message: 'the payment is either challenged or held', timeout: 90_000, intervals: [500, 1_000, 2_000] },
    )
    .not.toBe('waiting');
  if (outcome === 'challenge') {
    await beat(page, 750);
    await completeThreeDSecure(page);
  }
  await beat(page);
}

/** The buyer completes the purchase from the inspection step, without evidence. */
export async function completePurchase(page: Page): Promise<void> {
  await closeDetailsSheet(page);
  await onScreen(page.getByRole('button', { name: 'Complete purchase' })).click();
  const dialog = page.getByRole('dialog', { name: 'Complete purchase' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await beat(page);
  await dialog.getByRole('button', { name: 'Complete without evidence' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await beat(page);
}

// ---------------------------------------------------------------------------
// Cash sale: seller
// ---------------------------------------------------------------------------

/** The seller records the parcel with a listed carrier and a tracking number. */
export async function recordCashSaleShipment(page: Page, trackingNumber: string): Promise<void> {
  await closeDetailsSheet(page);
  await onScreen(page.getByRole('button', { name: 'Add tracking' })).click();
  const dialog = page.getByRole('dialog', { name: 'Record shipment' });
  // The dock's "Add tracking" must open the dialog on every viewport. On a phone it
  // does not (F77): the dialog is mounted inside the Status panel, which lives in the
  // closed details sheet. Asserted SOFTLY so the defect fails the Pathway, and then the
  // member's workaround (the same button inside Contract details) keeps the journey
  // going so the later steps are still exercised.
  const opened = await dialog
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  expect.soft(opened, 'the dock\'s "Add tracking" opens Record shipment (F77)').toBe(true);
  if (!opened) {
    // Opening the sheet mounts the Status panel, and with it the dialog the dock
    // already asked to open, so it appears by itself (observed on WebKit).
    await onScreen(page.getByRole('button', { name: 'Contract details' })).click();
  }
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  // A Radix Select: the trigger carries the id, the hidden native select shares the label.
  await dialog.locator('#ship-carrier').click();
  await page.getByRole('option', { name: 'Australia Post', exact: true }).click();
  await fillAndConfirm(dialog.locator('#ship-tracking'), trackingNumber);
  const record = dialog.getByRole('button', { name: 'Record shipment' });
  await expect(record).toBeEnabled({ timeout: RENDERED });
  await beat(page);
  await record.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await beat(page);
}

/**
 * The seller's release state, read off the Payment tab (`SellerReleaseStatus` in
 * CashSaleView) and mapped to `cash_sales.seller_payout_status`.
 */
export async function shownSellerPayout(page: Page): Promise<string> {
  try {
    const panel = await openDetailTab(page, 'Payment');
    const text = (await panel.innerText({ timeout: 5_000 })).replace(/\s+/g, ' ');
    if (text.includes('Sent to your payout account')) return 'SETTLED';
    if (text.includes('Queued for release to your payout account')) return 'PENDING';
    if (text.includes('Not sent yet')) return 'FAILED';
    if (text.includes('Released to you once the buyer completes the purchase')) return 'NOT_DUE';
    return 'not-shown';
  } finally {
    await closeDetailsSheet(page);
  }
}

// ---------------------------------------------------------------------------
// Trade
// ---------------------------------------------------------------------------

/**
 * From the counterpart's listing page, proposes a swap offering `myTitle` (one of the
 * proposer's own listings). Lands in the new trade's room.
 */
export async function proposeSwap(page: Page, myTitle: string): Promise<void> {
  // "Propose trade" on desktop, the icon's "Propose a trade" in the phone buyer bar.
  await onScreen(page.getByRole('button', { name: /^Propose (a )?trade$/i })).click();
  const dialog = page.getByRole('dialog', { name: 'Propose a trade' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });

  const title = new RegExp(escapeRegExp(myTitle));
  const inline = dialog.getByRole('list', { name: 'Your listings' }).getByRole('checkbox', { name: title });
  // The newest five listings are tickable in place; a busy sandbox can push this one
  // into the searchable picker instead.
  if (await inline.isVisible().catch(() => false)) {
    await inline.check();
  } else {
    await dialog.getByRole('button', { name: /All your listings/ }).click();
    const picker = page.getByRole('dialog', { name: 'Your listings' });
    await picker.getByPlaceholder('Search your listings').fill(myTitle);
    await picker.getByRole('checkbox', { name: title }).check();
    await picker.getByRole('button', { name: 'Done' }).click();
    await expect(picker).toBeHidden({ timeout: RENDERED });
  }
  await expect(dialog.getByText(/You give\s*\(1 selected\)/)).toBeVisible({ timeout: RENDERED });
  await beat(page);
  await dialog.getByRole('button', { name: 'Send offer' }).click();
  await expect(page).toHaveURL(/\/trades(\/[0-9a-f-]{36})?$/, { timeout: COLD_ROUTE });
}

/** The meeting the journey agrees: the first half-hour slot at least 75 minutes away. */
interface MeetingSlot {
  /** `YYYY-MM-DD` in the browser's own timezone, as the calendar's `data-day` reads. */
  day: string;
  /** The time option's label, formatted the way `DateTimePicker` formats it. */
  label: string;
}

/**
 * Computed IN THE BROWSER, so the day and the time label use the page's timezone and
 * locale exactly as `components/ui/date-time-picker.tsx` does. The picker offers 07:00
 * to 22:00 in half hours, so the slot never lies more than about ten hours out, well
 * inside the 24-hour lead in which the hourly job places collateral.
 */
async function nextMeetingSlot(page: Page): Promise<MeetingSlot> {
  return page.evaluate(() => {
    const t = new Date(Date.now() + 75 * 60_000);
    t.setSeconds(0, 0);
    const minutes = t.getMinutes();
    if (minutes > 30) t.setHours(t.getHours() + 1, 0);
    else if (minutes > 0) t.setMinutes(30);
    if (t.getHours() < 7) t.setHours(7, 0);
    if (t.getHours() > 22 || (t.getHours() === 22 && t.getMinutes() > 0)) {
      t.setDate(t.getDate() + 1);
      t.setHours(7, 0);
    }
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      day: `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`,
      label: new Date(2026, 0, 1, t.getHours(), t.getMinutes()).toLocaleTimeString('en-AU', {
        hour: 'numeric',
        minute: '2-digit',
      }),
    };
  });
}

/**
 * Closes the meeting calendar after a day is picked, the way a member does: a click
 * outside it, on the terms dialog's own title.
 *
 * The calendar is a MODAL Radix popover (`components/ui/date-time-picker.tsx`) and stays
 * open after a pick. While it is open Radix hides the terms dialog from the
 * accessibility tree, so `getByRole('dialog')` finds nothing, and the popover's outside
 * pointer block would swallow the click on the time select. Escape was tried and closed
 * the whole terms dialog with the popover. The title is clicked by coordinates because
 * the modal popover sets `pointer-events: none` outside itself, which Playwright's
 * actionability check reads as "intercepted"; Radix dismisses on the pointerdown.
 *
 * @param day the picked day's button, visible exactly while the popover is open
 */
export async function closeCalendarPopover(page: Page, day: Locator): Promise<void> {
  if (!(await day.isVisible().catch(() => false))) return;
  // On a phone the popover can cover the title, so the point clicked is the first
  // candidate inside the dialog that is NOT inside the popover.
  const dialogBox = await page.locator('[role="dialog"]').first().boundingBox();
  const popoverBox = await page.locator('[data-radix-popper-content-wrapper]').last().boundingBox();
  if (!dialogBox) throw new Error('no terms dialog to click outside the calendar');
  const inside = (x: number, y: number) =>
    popoverBox !== null &&
    x >= popoverBox.x && x <= popoverBox.x + popoverBox.width &&
    y >= popoverBox.y && y <= popoverBox.y + popoverBox.height;
  const candidates: Array<[number, number]> = [
    // Left edge only: the top right holds the dialog's Close button.
    [dialogBox.x + 6, dialogBox.y + 6],
    [dialogBox.x + 6, dialogBox.y + dialogBox.height / 2],
    [dialogBox.x + 6, dialogBox.y + dialogBox.height - 6],
  ];
  const point = candidates.find(([x, y]) => !inside(x, y));
  if (!point) throw new Error('the calendar covers the whole terms dialog');
  await page.mouse.click(point[0], point[1]);
  await expect(day, 'the calendar closed').toBeHidden({ timeout: RENDERED });
}

/**
 * Sets face-to-face terms from the Terms tab: a resolved meeting place and the next
 * meeting slot. Trades are face to face only, and accepting needs both.
 */
export async function setMeetingTerms(page: Page, place: StubbedPlace = STUB_PLACES.sydney): Promise<void> {
  await openDetailTab(page, 'Terms');
  await onScreen(page.getByRole('button', { name: /^(Set meeting|Edit terms)$/ })).click();
  const dialog = page.getByRole('dialog', { name: 'Meeting terms' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  // The radio is `sr-only` inside its tile and the tile's icon sits over it, so the
  // tile's label is what a member clicks (and what receives the pointer).
  const faceToFace = dialog.getByRole('radio', { name: /^Face to face/ });
  if (!(await faceToFace.isChecked())) await dialog.getByText('Face to face', { exact: true }).click();
  await expect(faceToFace).toBeChecked({ timeout: RENDERED });
  await fillPlace(page, /Meeting place/, place, dialog);

  const slot = await nextMeetingSlot(page);
  await dialog.locator('#trade-meeting-at').click();
  const dayButton = page.locator(`[data-day="${slot.day}"]:not([data-outside]) button`).first();
  await dayButton.click();

  await closeCalendarPopover(page, dayButton);
  await expect(dialog.locator('#trade-meeting-at')).not.toHaveText(/Choose date and time/, { timeout: RENDERED });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Meeting time' }).click();
  await page.getByRole('option', { name: slot.label, exact: true }).click();
  await beat(page);

  await dialog.getByRole('button', { name: 'Save terms' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await closeDetailsSheet(page);
  await beat(page);
}

/**
 * Opens the Accept dialog, which states what accepting costs: no fee, and the trade
 * collateral as a temporary card hold. Leaves it OPEN, so the step's copy check reads it.
 */
export async function reviewTradeAcceptance(page: Page): Promise<Locator> {
  await closeDetailsSheet(page);
  await onScreen(page.getByRole('button', { name: 'Accept terms' })).click();
  const dialog = page.getByRole('dialog', { name: 'Accept these terms?' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await expect(dialog.getByText('Trade collateral')).toBeVisible({ timeout: RENDERED });
  await beat(page);
  return dialog;
}

/** Accepts the terms from the open Accept dialog (the saved card is read back first). */
export async function confirmTradeAcceptance(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Accept these terms?' });
  const accept = dialog.getByRole('button', { name: 'Accept terms' });
  await expect(accept, 'the saved card has been read, so Accept is offered').toBeEnabled({ timeout: 30_000 });
  await accept.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await beat(page);
}

/** "We met and swapped": the face-to-face handover confirmation. */
export async function confirmTradeHandover(page: Page): Promise<void> {
  await closeDetailsSheet(page);
  await onScreen(page.getByRole('button', { name: 'Confirm handover' })).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm the handover happened?' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await beat(page);
  await dialog.getByRole('button', { name: 'We met and swapped' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await beat(page);
}

/** Accepts what the trader received, without evidence. */
export async function acceptTradeItem(page: Page): Promise<void> {
  await closeDetailsSheet(page);
  await onScreen(page.getByRole('button', { name: 'Accept item' })).click();
  const dialog = page.getByRole('dialog', { name: 'Accept what you received' });
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await beat(page);
  await dialog.getByRole('button', { name: 'Accept without evidence' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await beat(page);
}

/** `ContractHoldList` badge labels, read back to `hold_status`. */
const HOLD_STATUS_BY_LABEL: Readonly<Record<string, string>> = {
  Active: 'ACTIVE',
  // The trade Collateral tab calls a live hold "Held" (2026-11-27).
  Held: 'ACTIVE',
  Released: 'VOIDED',
  'Partially captured': 'PARTIALLY_CAPTURED',
  'Fully captured': 'FULLY_CAPTURED',
  Failed: 'FAILED',
  'Expired — no longer protected': 'EXPIRED',
};

/** Each hold's status as the Collateral tab shows it, sorted, as `hold_status` values. */
export async function shownHoldStatuses(page: Page): Promise<string[]> {
  try {
    const panel = await openDetailTab(page, 'Collateral');
    const badges = panel
      .getByRole('list', { name: 'What each trader has on the line' })
      .locator('[aria-label^="Hold status: "]');
    const labels = await badges.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label') ?? ''));
    return labels
      .map((label) => label.slice('Hold status: '.length))
      .map((label) => HOLD_STATUS_BY_LABEL[label] ?? `unknown:${label}`)
      .sort();
  } finally {
    await closeDetailsSheet(page);
  }
}
