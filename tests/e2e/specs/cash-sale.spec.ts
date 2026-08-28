// tests/e2e/specs/cash-sale.spec.ts
//
// The Cash_Sale lifecycle end to end: open a contract, agree handover terms, settle
// payment into escrow, ship, receive, accept, and see the item sold.
//
// SERIAL BY NECESSITY, not for convenience. Each step is only reachable from the
// state the previous one left behind, and the point of the flow is the ORDER: money
// is collected before goods move and released only after the buyer accepts. Running
// these independently would test a set of buttons rather than an escrow.
//
// ON ITS OWN LISTING. Completing a sale flips `items.status` to SOLD permanently,
// and nothing here puts it back. Against a seed item this file would pass once and
// then fail forever — and take the catalog specs with it, since availability is
// visibility. So it lists, negotiates and consumes an item it created, marked, which
// teardown removes.
//
// LABELS AND STRUCTURE READ OFF THE RUNNING ROOM (tests/e2e/debug/inspect.spec.ts):
//   * The room's <h1> is "Sale"; the ITEM title is an h2 and appears twice (header
//     and the Item panel).
//   * The progress rail is a row of BUTTONS whose accessible names are the step
//     names, and the live one is suffixed " — current step". That suffix is the
//     cleanest state assertion in the whole flow: it is what the member reads.
//     Steps: "Set handover terms" → "Payment collected and held" →
//     fulfilment (ship or handover) → complete the purchase.
//   * The buyer pays as soon as terms exist. There is no seller confirm.

import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { createListing, fillPlace, STUB_PLACES } from '../support/listings';
import { fillAndConfirm } from '../support/forms';
import { COLD_ROUTE, RENDERED } from '../support/waiting';
import { ensureFreshSessions } from '../support/auth';

// Repair any stored cookie jar this file relies on before its first test.
// Refresh-token rotation retires the token a jar holds as soon as another context
// uses it, so a shared snapshot goes stale on its own during a long run. See
// tests/e2e/support/auth.ts for the full reasoning.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, BOB]);
});

const PRICE_DOLLARS = '150.00';

/** The rail marks the live step by suffixing its accessible name. */
function currentStep(page: Page, name: string) {
  return page.getByRole('button', { name: `${name} — current step` });
}

/** Expand the collapsed mock-payments panel and fire one of its webhooks. */
async function fireDemo(page: Page, control: string) {
  // Collapsed by default and labelled as test mode so it never reads as a
  // production payment step — so it has to be opened before its controls exist.
  await page.getByRole('button', { name: /Expand hackathon test controls/i }).click();
  const button = page.getByRole('button', { name: control });
  await expect(button).toBeEnabled({ timeout: RENDERED });
  await button.click();
}

test.describe.serial('Cash sale lifecycle', () => {
  const title = marked(`Cash sale target ${Date.now()}`);
  /** Set by the first test; every later step depends on both. */
  let itemId = '';
  let saleUrl = '';

  test('the seller lists an item', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();
  
  const url = await createListing(page, { title, priceDollars: PRICE_DOLLARS });
  itemId = new URL(url).pathname.split('/').pop() ?? '';
  expect(itemId).toMatch(/^[0-9a-f-]{36}$/);
  
  await ctx.close(); });

  test('the buyer opens a contract, which reserves the item', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
  const page = await ctx.newPage();
  
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Buy now' }).click();
  
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  
  // The dialog fetches payment-method status on open and swaps its whole body on
  // the answer, so wait for one of the two possible headings rather than assuming
  // which. Seeded members carry a mock payer but no attached instrument, so a
  // first-time buyer lands on the card form.
  const addCard = dialog.getByRole('heading', { name: 'Add a payment method' });
  const checkout = dialog.getByRole('heading', { name: 'Start a purchase contract' });
  await expect(addCard.or(checkout)).toBeVisible({ timeout: 25_000 });
  if (await addCard.isVisible().catch(() => false)) {
    // Under the mock provider the card form offers a single button, because real
    // card fields are rendered by Stripe in its own iframe and there is nothing
    // for a test to type.
    await dialog.getByRole('button', { name: /Save demo card/i }).click();
    await expect(checkout).toBeVisible({ timeout: 25_000 });
  }
  
  // The seller-identity confirmation is a hard gate: `initiateCashSale` refuses
  // with BUYER_CONFIRMATION_REQUIRED without it, so this is not decoration.
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Reserve item and agree terms' }).click();
  
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  saleUrl = new URL(page.url()).pathname;
  
  // NO MONEY HAS MOVED YET. Opening the contract reserves the goods and starts a
  // negotiation; the buyer pays once handover details are set.
  //
  // The room's title is per-ROLE, not per-contract: the buyer's shell says
  // "Purchase" and the seller's says "Sale" for the same row. Matching either.
  await expect(
    page.getByRole('heading', { name: /^(Purchase|Sale)$/ }).first(),
  ).toBeVisible({ timeout: RENDERED });
  await expect(currentStep(page, 'Set handover terms')).toBeVisible({
    timeout: RENDERED,
  });
  
  await ctx.close(); });

  test('the reserved item leaves the catalog', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();
  
  // Availability is VISIBILITY (0064): a listing under contract leaves the
  // catalog rather than rendering as unavailable.
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('link', { name: new RegExp(escapeRegExp(title)) })).toHaveCount(0);
  
  // The owner still sees it, or a seller would lose sight of everything they have
  // under contract.
  //
  // ASSERTED ON THE ITEM'S OWN PAGE, not by finding it in `/listings/mine`. That list
  // grows for ALICE as the run proceeds - every spec that needs to consume an item
  // creates its own marked listing rather than eating a seeded one - so late in a full
  // run the row this test wants is simply not on the first page, and the assertion
  // failed while passing in isolation (F70). The rule under test is the RLS one, that
  // an owner keeps sight of a reserved item, and the detail page exercises exactly
  // that (`owner_id = auth.uid()`) without depending on where a paginated list happens
  // to put it.
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: title }).first()).toBeVisible({
    timeout: RENDERED,
  });

  await ctx.close(); });


  test('free text alone is refused as a delivery address', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const page = await ctx.newPage();

    await page.goto(saleUrl);
    await page.waitForLoadState('domcontentloaded');

    // "Choose a method" reveals the Terms panel inline; the METHOD TILE then opens the
    // dialog. Two steps, and the first is not the modal trigger.
    await page.getByRole('button', { name: 'Choose a method' }).click();
    const ship = page.getByRole('button', { name: /Ship the item/i }).first();
    await expect(ship).toBeVisible({ timeout: RENDERED });
    await ship.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: RENDERED });

    // THE INVARIANT UNDER TEST. `domain/fulfilment/terms.ts` refuses an unresolved
    // place — a `text:` id — for a delivery address, and it should: a parcel
    // destination has to be a real location, not a string someone typed. Typing a
    // complete, plausible address WITHOUT choosing a suggestion must therefore not be
    // accepted.
    //
    // Worth asserting explicitly because the failure is quiet: the field looks filled,
    // and only the save reveals that nothing usable was captured.
    const address = dialog.getByLabel(/Your delivery address/i);
    await address.fill('12 Test Street, Sydney NSW 2000');
    await dialog.getByRole('button', { name: 'Propose terms' }).click();

    await expect(
      dialog.getByText(/Select a suggested delivery address/i),
    ).toBeVisible({ timeout: RENDERED });

    // Refused, so nothing was committed and the contract is still at terms.
    await page.keyboard.press('Escape');
    await expect(currentStep(page, 'Set handover terms')).toBeVisible({
      timeout: RENDERED,
    });

    await ctx.close();
  });

  test('the buyer proposes delivery terms with a resolved address', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const page = await ctx.newPage();

    await page.goto(saleUrl);
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Choose a method' }).click();
    const ship = page.getByRole('button', { name: /Ship the item/i }).first();
    await expect(ship).toBeVisible({ timeout: RENDERED });
    await ship.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: RENDERED });

    // DELIVERY, not IN_PERSON: the posted path is the one where escrow does real work.
    // A Cash_Sale's in-person path completes on the second handover confirmation
    // instead of opening an inspection window, which is a different set of assertions.
    //
    // The buyer owns the address. Chosen from the intercepted autocomplete so the
    // PlaceValue is RESOLVED — see tests/e2e/support/places.ts.
    await fillPlace(page, /Your delivery address/i, STUB_PLACES.sydney, dialog);

    await dialog.getByRole('button', { name: 'Propose terms' }).click();
    await expect(dialog).toBeHidden({ timeout: 25_000 });

    // Terms proposed, so the buyer can pay.
    await expect(currentStep(page, 'Payment collected and held')).toBeVisible({
      timeout: 25_000,
    });

    await ctx.close();
  });

  test('the buyer pays as soon as terms are set', async ({ browser }) => {
    const buyerCtx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const buyerPage = await buyerCtx.newPage();
    await buyerPage.goto(saleUrl);
    await buyerPage.waitForLoadState('domcontentloaded');
    const buyerPay = buyerPage.getByRole('button', { name: 'Pay now' });
    await expect(buyerPay).toBeVisible({ timeout: RENDERED });
    await buyerPay.click();
    await expect(buyerPay).toHaveCount(0, { timeout: 30_000 });
    await buyerCtx.close();

    const sellerCtx = await browser.newContext({ storageState: storageStatePath(ALICE) });
    const sellerPage = await sellerCtx.newPage();
    await sellerPage.goto(saleUrl);
    await sellerPage.waitForLoadState('domcontentloaded');
    await expect(sellerPage.getByRole('button', { name: 'Confirm terms' })).toHaveCount(0);

    await sellerCtx.close();
  });

  test('payment settles into escrow, held by the platform', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const page = await ctx.newPage();

    await page.goto(saleUrl);
    await page.waitForLoadState('domcontentloaded');

    // THE MOCK PROVIDER CONFIRMS THE PAYMENT ITSELF, shortly after the buyer pays —
    // the room's own log reads "started payment" then "Payment confirmed. The seller
    // can now ship or meet." So by the time this step loads the page, the sale has
    // usually already left PAYMENT_PENDING and the demo panel has retired with it.
    //
    // The panel is therefore fired only if it is still there. An earlier version
    // clicked it unconditionally and hung for the full test budget waiting for a
    // control that had correctly disappeared — a test asserting a fixture's timing
    // rather than the product's behaviour.
    const demoToggle = page.getByRole('button', { name: /Expand hackathon test controls/i });
    if (await demoToggle.count() > 0) {
      // Fires a SIGNED webhook through the real handler rather than writing the
      // column, so the local path is the same translate -> map -> persist path
      // Stripe's own delivery takes.
      await fireDemo(page, 'Simulate payment settled');
    }

    // WHAT ACTUALLY MATTERS: funds are collected into the PLATFORM balance and the
    // contract advances to handover — not forwarded to the seller. That is why this
    // design uses separate charges and transfers rather than destination charges,
    // where the money would be the seller's from the moment of purchase.
    //
    // Asserted through the SELLER'S UNLOCKED ACTION rather than a rail label, because
    // the rail is method-dependent: a DELIVERY sale runs Terms / Payment / Escrow /
    // Ship / Arrive / Done, where an in-person one converges sooner. Shipping becoming
    // available is the same fact stated in a way that does not depend on which
    // fulfilment method the contract took.
    await expect(
      page.getByRole('heading', { name: /Seller ships with tracking/i }),
    ).toBeVisible({ timeout: 40_000 });

    await ctx.close();
  });

  test('the seller ships and the buyer confirms receipt', async ({ browser }) => {
    const sellerCtx = await browser.newContext({ storageState: storageStatePath(ALICE) });
    const sellerPage = await sellerCtx.newPage();
    await sellerPage.goto(saleUrl);
    await sellerPage.waitForLoadState('domcontentloaded');

    // INLINE IN THE ACTION CARD, not in a dialog, and `Record shipment` is DISABLED
    // until both fields hold something. Clicking it first therefore waits forever on a
    // control that will never become enabled — which reads as the app hanging rather
    // than as the test skipping a step.
    //
    // Matched by placeholder because these inputs carry no visible <label>.
    await expect(
      sellerPage.getByRole('heading', { name: /Seller ships with tracking/i }),
    ).toBeVisible({ timeout: 30_000 });

    // FILLED VIA `fillAndConfirm`, which verifies the value reached React state.
    // These are controlled inputs, and on the mobile project the fill landed in the DOM
    // before hydration attached — so state stayed empty, `Record shipment` never
    // enabled, and the failure read as the button being broken.
    await fillAndConfirm(sellerPage.getByPlaceholder(/Carrier/i), 'Australia Post');
    await fillAndConfirm(sellerPage.getByPlaceholder(/Tracking number/i), 'AP123456789AU');

    const record = sellerPage.getByRole('button', { name: 'Record shipment' });
    await expect(record).toBeEnabled({ timeout: RENDERED });
    await record.click();

    // Wait for the write to land before closing this context — a context closed
    // mid-flight aborts the server action, and the next step then blames the buyer's
    // view. Tracking is recorded, so the seller's own input retires.
    await expect(record).toHaveCount(0, { timeout: 30_000 });
    await sellerCtx.close();

    const buyerCtx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const buyerPage = await buyerCtx.newPage();
    await buyerPage.goto(saleUrl);
    await buyerPage.waitForLoadState('domcontentloaded');

    const received = buyerPage.getByRole('button', { name: /I received the item/i });
    await expect(received).toBeVisible({ timeout: 30_000 });
    await received.click();

    // Receipt starts the inspection window; it does NOT release the money. The buyer
    // still has to accept, and that ordering is the whole protection.
    //
    // Asserted via the acceptance control appearing rather than a rail label, for the
    // same method-independence reason as the escrow step.
    await expect(
      buyerPage.getByRole('button', { name: 'Complete purchase' }),
    ).toBeVisible({ timeout: 40_000 });

    await buyerCtx.close();
  });

  test('the buyer accepts and the sale completes', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const page = await ctx.newPage();

    await page.goto(saleUrl);
    await page.waitForLoadState('domcontentloaded');

    const complete = page.getByRole('button', { name: 'Complete purchase' });
    await expect(complete).toBeVisible({ timeout: RENDERED });
    await complete.click();

    // Completing the purchase is the release trigger. Asserting the ABSENCE of the
    // control rather than a success string: the contract is terminal, so every
    // action retires, and copy is the kind of thing that reasonably changes.
    await expect(complete).toHaveCount(0, { timeout: 30_000 });

    await ctx.close();
  });

  test('the item is now sold', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
    const page = await ctx.newPage();

    await page.goto(`/listings/${itemId}`);
    await page.waitForLoadState('domcontentloaded');

    // SOLD, not RESERVED: the terminal state of the goods, and the thing that proves
    // the contract ran to completion rather than merely advancing.
    await expect(page.getByText('Sold').first()).toBeVisible({ timeout: RENDERED });

    await ctx.close();
  });
});

/** Marked titles contain [ and ], which are regex metacharacters. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
