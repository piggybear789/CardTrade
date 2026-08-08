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
//     Steps: "Propose handover terms" → "Review and accept the proposal" →
//     "Payment clears into escrow" → "Both confirm the handover" →
//     "Buyer accepts the item".
//   * Acceptance is asymmetric copy: the buyer's button is
//     "Accept & pay $X with Stripe", the seller's is "Accept terms". They are the
//     same transition and must not be matched by one pattern.

import { test, expect, type Page } from '@playwright/test';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { createListing } from '../support/listings';
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
  // negotiation; collection happens only once both parties accept terms.
  //
  // The room's title is per-ROLE, not per-contract: the buyer's shell says
  // "Purchase" and the seller's says "Sale" for the same row. Matching either.
  await expect(
    page.getByRole('heading', { name: /^(Purchase|Sale)$/ }).first(),
  ).toBeVisible({ timeout: RENDERED });
  await expect(currentStep(page, 'Propose handover terms')).toBeVisible({
    timeout: RENDERED,
  });
  
  await ctx.close(); });

  test('the reserved item leaves the catalog', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();
  
  // Availability is VISIBILITY (0064): a listing under contract leaves the
  // catalog rather than rendering as unavailable.
  await page.goto('/listings');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('link', { name: new RegExp(escapeRegExp(title)) })).toHaveCount(0);
  
  // The owner still sees it, or a seller would lose sight of everything they have
  // under contract.
  await page.goto('/listings/mine');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByText(title).first()).toBeVisible({ timeout: RENDERED });
  
  await ctx.close(); });

  test('the delivery address says it cannot be entered, rather than offering a dead field', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const page = await ctx.newPage();

    await page.goto(saleUrl);
    await page.waitForLoadState('domcontentloaded');

    // "Choose a method" reveals the Terms panel inline; the METHOD TILE then opens
    // the "Propose handover terms" dialog. Two steps, and the first is not the modal
    // trigger — a spec that waits for `role=dialog` straight after it waits forever
    // while the tiles sit visible on the page.
    await page.getByRole('button', { name: 'Choose a method' }).click();
    const ship = page.getByRole('button', { name: /Ship the item/i }).first();
    await expect(ship).toBeVisible({ timeout: RENDERED });
    await ship.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: RENDERED });

    // THIS IS THE F13 GUARD, and it asserts the honest failure rather than the happy
    // path. `domain/fulfilment/terms.ts` refuses a `text:` place for a delivery
    // address, and this suite runs with no Maps key, so no value can be accepted.
    //
    // The field used to render as a normal, fillable input. A member typed a complete
    // address, pressed save, and got "Select a suggested delivery address before
    // saving." — an instruction that cannot be followed, because with no key there
    // are no suggestions. Now the field is disabled and says why.
    //
    // Asserting the DISABLED state and the explanation, not the absence of the field:
    // hiding the requirement would read as a step that vanished rather than a
    // deployment that is not finished.
    const address = dialog.getByLabel(/Your delivery address/i);
    await expect(address).toBeDisabled();
    await expect(dialog.getByText(/Address search is not configured/i)).toBeVisible();

    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // BLOCKED BELOW THIS LINE, and the blocker is a real product dependency rather
  // than a selector problem. Recorded as F13 in FINDINGS.md.
  //
  // Agreeing handover terms for a DELIVERY requires a delivery address RESOLVED by
  // Google Places. Typing a complete, valid address is refused with "Select a
  // suggested delivery address before saving." — correctly, for a residential
  // address a free-text string is not a place. But this suite deliberately runs the
  // dev server with no Maps key so the rest of the listing flow is deterministic
  // (see playwright.config.ts), which means PlacePicker is in its free-text
  // fallback and can never produce a resolved place.
  //
  // So the consequence is not "these assertions need tuning": WITHOUT A MAPS KEY NO
  // CONTRACT THAT NEEDS AN ADDRESS CAN BE COMPLETED AT ALL, by a test or a person.
  // Every step past terms-agreement — escrow settlement, shipping, receipt,
  // acceptance, release — is unreachable behind it.
  //
  // Two ways to unblock, neither free:
  //   1. Run the suite WITH `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and drive the
  //      autocomplete listbox. Costs a live Google dependency in every run, and an
  //      earlier attempt hung on clicking a provider-rendered option.
  //   2. Intercept the Places request with `page.route()` and serve a fixed
  //      suggestion. Deterministic and offline, but pins the test to the provider's
  //      response shape.
  //
  // (2) is the better trade and is the next piece of work here. Until then these are
  // `fixme` rather than deleted, so the gap stays visible in every run's summary
  // instead of looking like coverage that was never scoped.
  // ---------------------------------------------------------------------------

  test.fixme('the buyer proposes delivery terms', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const page = await ctx.newPage();

    await page.goto(saleUrl);
    await page.waitForLoadState('domcontentloaded');

    // "Choose a method" reveals the Terms panel inline; the METHOD TILE then opens
    // the "Propose handover terms" dialog. Two steps, and the first one is not the
    // modal trigger — a spec that waits for `role=dialog` straight after it waits
    // forever while the tiles sit visible on the page.
    await page.getByRole('button', { name: 'Choose a method' }).click();
    const ship = page.getByRole('button', { name: /Ship the item/i }).first();
    await expect(ship).toBeVisible({ timeout: RENDERED });
    await ship.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: RENDERED });
    await expect(
      dialog.getByRole('heading', { name: 'Propose handover terms' }),
    ).toBeVisible();

    // Delivery is preselected once the tile is chosen. THIS is the blocked step: the
    // field demands a resolved place and free text is refused.
    await dialog.getByLabel(/Your delivery address/i).fill('12 Test Street, Sydney NSW 2000');
    await dialog.getByRole('button', { name: 'Propose terms' }).click();

    await expect(currentStep(page, 'Review and accept the proposal')).toBeVisible({
      timeout: 25_000,
    });

    await ctx.close();
  });

  test.fixme('both parties accept the terms', async ({ browser }) => {
    // ASYMMETRIC COPY for the same transition: the buyer is told what they are
    // paying and through whom, the seller only agrees.
    const buyerCtx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const buyerPage = await buyerCtx.newPage();
    await buyerPage.goto(saleUrl);
    await buyerPage.waitForLoadState('domcontentloaded');
    await buyerPage.getByRole('button', { name: /Accept & pay .* with Stripe/i }).click();
    await buyerCtx.close();

    const sellerCtx = await browser.newContext({ storageState: storageStatePath(ALICE) });
    const sellerPage = await sellerCtx.newPage();
    await sellerPage.goto(saleUrl);
    await sellerPage.waitForLoadState('domcontentloaded');
    await sellerPage.getByRole('button', { name: 'Accept terms' }).click();

    // Both accepted: the contract is frozen at the Commitment_Point and the payment
    // is now owed.
    await expect(currentStep(sellerPage, 'Payment clears into escrow')).toBeVisible({
      timeout: 20_000,
    });

    await sellerCtx.close();
  });

  test.fixme('payment settles into escrow', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
  const page = await ctx.newPage();
  
  await page.goto(saleUrl);
  await page.waitForLoadState('domcontentloaded');
  
  // Fires a SIGNED webhook through the real handler rather than writing the
  // column, so the local path is the same translate → map → persist path Stripe's
  // own delivery takes.
  await fireDemo(page, 'Simulate payment settled');
  
  // Funds are held by the platform, not forwarded to the seller — that is the
  // whole point of separate charges and transfers. The rail moves on to handover.
  await expect(currentStep(page, 'Both confirm the handover')).toBeVisible({
    timeout: 25_000,
  });
  
  await ctx.close(); });

  test.fixme('the seller ships and the buyer confirms receipt', async ({ browser }) => { const sellerCtx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const sellerPage = await sellerCtx.newPage();
  await sellerPage.goto(saleUrl);
  await sellerPage.waitForLoadState('domcontentloaded');
  
  await sellerPage.getByRole('button', { name: 'Record shipment' }).click();
  const shipDialog = sellerPage.getByRole('dialog');
  if (await shipDialog.isVisible().catch(() => false)) {
    await shipDialog.getByLabel(/Carrier/i).fill('Australia Post');
    await shipDialog.getByLabel(/Tracking/i).fill('AP123456789AU');
    await shipDialog.getByRole('button', { name: /Record shipment|Save/i }).click();
    await expect(shipDialog).toBeHidden({ timeout: 20_000 });
  }
  await sellerCtx.close();
  
  const buyerCtx = await browser.newContext({ storageState: storageStatePath(BOB) });
  const buyerPage = await buyerCtx.newPage();
  await buyerPage.goto(saleUrl);
  await buyerPage.waitForLoadState('domcontentloaded');
  
  const received = buyerPage.getByRole('button', { name: 'I received the item' });
  await expect(received).toBeVisible({ timeout: 25_000 });
  await received.click();
  
  // Receipt starts the inspection window; it does NOT release the money. The
  // buyer still has to accept.
  await expect(currentStep(buyerPage, 'Buyer accepts the item')).toBeVisible({
    timeout: 25_000,
  });
  
  await buyerCtx.close(); });

  test.fixme('the buyer accepts and the sale completes', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
  const page = await ctx.newPage();
  
  await page.goto(saleUrl);
  await page.waitForLoadState('domcontentloaded');
  
  const accept = page.getByRole('button', { name: 'Accept the item' });
  await expect(accept).toBeVisible({ timeout: RENDERED });
  await accept.click();
  
  // Acceptance is the release trigger. Every action retires because the contract
  // is terminal — asserting the ABSENCE of the accept control rather than looking
  // for a success string, which is copy that may reasonably change.
  await expect(accept).toHaveCount(0, { timeout: 25_000 });
  
  await ctx.close(); });

  test.fixme('the item is now sold', async ({ browser }) => { const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();
  
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');
  
  await expect(page.getByText('Sold').first()).toBeVisible({ timeout: RENDERED });
  
  await ctx.close(); });
});

/** Marked titles contain `[` and `]`, which are regex metacharacters. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
