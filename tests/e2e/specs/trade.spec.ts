// tests/e2e/specs/trade.spec.ts
//
// The 2-Way Trade escrow lifecycle, plus the proposal surface.
//
// SERIAL BY NECESSITY. Each step is only reachable from the state the previous one
// left, and the ORDER is the product: collateral is authorised on both sides before
// either party posts, and released only after both accept. Running these
// independently would test a set of buttons rather than an escrow.
//
// ON ITS OWN LISTINGS, both sides. A completed trade changes both items permanently
// and the seed pair would then be spent — the spec would pass once and fail forever,
// taking the catalog specs with it because availability is visibility. So each trader
// lists something marked, which teardown removes.
//
// BOTH TRADERS NEED A SAVED CARD. Trade collateral is a real authorisation for 100%
// of FMV against EACH side (`resolveTradeBonds` bonds both regardless of
// verification, because a fraud finding can pay either party), and `acceptTradeTerms`
// refuses without an instrument. That is why `ensureSavedCard` runs for both.
//
// FLOW FACTS READ OFF THE RUNNING APP (tests/e2e/debug/trade.spec.ts):
//   * "Propose Trade" opens a dialog headed "Offer a trade".
//   * Its own-items picker is a SECOND dialog — `getByRole('dialog').last()` — with a
//     "Search your listings" box. Item rows carry NO accessible name, so a row is
//     found by the title text it contains. Confirmed with "Done", after which the
//     section button reads "Your listings1 selected".
//   * Sending does NOT navigate. The dialog closes and the page stays put; the trade
//     appears in the COUNTERPARTY's /trades list, whose row link reads
//     "Your item <theirs>↔Their item <yours>".

import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { createListing, fillPlace, STUB_PLACES } from '../support/listings';
import { ensureSavedCard } from '../support/payments';
import { ensureFreshSessions } from '../support/auth';
import { COLD_ROUTE, RENDERED } from '../support/waiting';

test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, BOB]);
});

/** Equal FMV on both sides: a trade is a swap of equal Fair Market Value. */
const FMV_DOLLARS = '250.00';

/*
 * A `currentStep()` helper lived here, matching the rail's "— current step" suffix.
 * It went unused: the trade rail's labels are METHOD-DEPENDENT, so asserting on them
 * couples a test to the handover method rather than to the thing being checked.
 * These tests assert on unlocked actions and action-card headings instead — the same
 * conclusion cash-sale.spec.ts reached for the same reason.
 */

test.describe.serial('Trade escrow lifecycle', () => {
  const aliceTitle = marked(`Trade mine ${Date.now()}`);
  const bobTitle = marked(`Trade theirs ${Date.now()}`);
  let aliceItemId = '';
  let bobItemId = '';
  let tradeUrl = '';

  test('both traders list an item of equal value', async ({ browser }) => {
    const aliceCtx = await browser.newContext({ storageState: storageStatePath(ALICE) });
    const alicePage = await aliceCtx.newPage();
    aliceItemId =
      new URL(await createListing(alicePage, { title: aliceTitle, priceDollars: FMV_DOLLARS }))
        .pathname.split('/')
        .pop() ?? '';
    await aliceCtx.close();

    const bobCtx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const bobPage = await bobCtx.newPage();
    bobItemId =
      new URL(await createListing(bobPage, { title: bobTitle, priceDollars: FMV_DOLLARS }))
        .pathname.split('/')
        .pop() ?? '';
    await bobCtx.close();

    expect(aliceItemId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bobItemId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('both traders have a card, which collateral requires', async ({ browser }) => {
    // A saved card is a HARD prerequisite for trade escrow on BOTH sides, not just the
    // payer's — collateral authorises against each trader. `acceptTradeTerms` surfaces
    // that as an actionable message rather than a generic failure, and this test is
    // what makes the later steps reachable at all.
    const aliceCtx = await browser.newContext({ storageState: storageStatePath(ALICE) });
    const alicePage = await aliceCtx.newPage();
    await ensureSavedCard(alicePage, bobItemId);
    await aliceCtx.close();

    const bobCtx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const bobPage = await bobCtx.newPage();
    await ensureSavedCard(bobPage, aliceItemId);
    await bobCtx.close();
  });

  test('the proposer offers a swap and it reaches the counterparty', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
    const page = await ctx.newPage();

    await page.goto(`/listings/${bobItemId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: 'Propose Trade' }).click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: RENDERED });
    await expect(
      dialog.getByRole('heading', { name: /Propose a trade|Offer a trade/i }),
    ).toBeVisible();

    // Nothing offered yet, so the proposal cannot be sent: a trade with no goods on
    // one side is not a trade.
    await expect(dialog.getByRole('button', { name: 'Send Offer' })).toBeDisabled();

    // The picker is a SECOND dialog stacked on the first.
    await page.getByRole('button', { name: /^Your listings/ }).click();
    const picker = page.getByRole('dialog').last();
    await expect(picker).toBeVisible({ timeout: RENDERED });
    await picker.getByPlaceholder(/Search your listings/i).fill(aliceTitle);

    // Rows carry no accessible name, so match the one holding the title.
    const row = picker
      .locator('label, li, [role=option], button')
      .filter({ hasText: aliceTitle })
      .first();
    await expect(row).toBeVisible({ timeout: RENDERED });
    await row.click();
    await picker.getByRole('button', { name: 'Done' }).click();

    // Confirmed by the offer summary, not by the section button's name. The button
    // renders "Your listings" and "1 selected" as separate nodes, so its accessible
    // name is whitespace-joined — a `/^Your listings1 selected/` pattern looks right
    // and never matches.
    await expect(dialog.getByText(/You offer\s*\(1 selected\)/i)).toBeVisible({
      timeout: RENDERED,
    });
    await expect(dialog.getByText(aliceTitle).first()).toBeVisible();

    // If terms are not yet set to Delivery, set them.
    const setTermsBtn = dialog.getByRole('button', { name: /Set delivery terms|Edit terms/i });
    if (await setTermsBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await setTermsBtn.click();
      const termsDialog = page.getByRole('dialog', { name: /Delivery terms/i });
      if (await termsDialog.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await termsDialog.getByText('Delivery', { exact: true }).click();
        await termsDialog.getByLabel(/Postage each way/i).fill('0.00');
        await termsDialog.getByRole('button', { name: /Save terms/i }).click();
        await expect(termsDialog).toBeHidden({ timeout: 15_000 });
      }
    }

    const send = dialog.getByRole('button', { name: 'Send Offer' });
    await expect(send).toBeEnabled({ timeout: RENDERED });
    await send.click();

    // Sending does not navigate; the dialog closing is the local signal.
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await ctx.close();

    // The counterparty is where the trade actually shows up.
    const bobCtx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const bobPage = await bobCtx.newPage();
    await bobPage.goto('/trades');
    await bobPage.waitForLoadState('domcontentloaded');

    const tradeLink = bobPage.getByRole('link').filter({ hasText: aliceTitle }).first();
    await expect(tradeLink).toBeVisible({ timeout: 30_000 });
    await tradeLink.click();
    await expect(bobPage).toHaveURL(/\/trades\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
    tradeUrl = new URL(bobPage.url()).pathname;

    await bobCtx.close();
  });

  test('the counterparty accepts, which asks both sides for collateral', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
    const page = await ctx.newPage();

    await page.goto(tradeUrl);
    await page.waitForLoadState('domcontentloaded');

    const accept = page.getByRole('button', { name: /Accept terms|Accept & continue/i }).first();
    await expect(accept).toBeVisible({ timeout: 25_000 });
    await accept.click();

    // The accept trigger opens a confirmation dialog with cost disclosure; confirm in the dialog
    const confirm = page.getByRole('dialog');
    await expect(confirm).toBeVisible({ timeout: 10_000 });
    await confirm.getByRole('button', { name: 'Accept terms' }).click();

    // Waited for, not fired and forgotten: closing the context mid-flight aborts the
    // action and the next step blames the wrong thing.
    await expect(confirm).toBeHidden({ timeout: 30_000 });
    await expect(accept).toHaveCount(0, { timeout: 30_000 });

    await ctx.close();
  });

  test('collateral locks on both sides', async ({ browser }) => {
    // FIRED ONCE PER TRADER, and the result awaited in the LAST session while it is
    // still open.
    //
    // Two things had to be got right here, and each produced the same silent
    // non-advance:
    //   1. The demo control confirms the CALLER'S authorisation. Collateral is a hold
    //      against EACH trader — `resolveTradeBonds` bonds both regardless of
    //      verification, because a fraud finding can pay either side — so one
    //      confirmation leaves the trade waiting on the other half.
    //   2. Closing a context shortly after the click aborts the in-flight server
    //      action before it can POST the webhook. The dev server reports that as
    //      `uncaughtException: ECONNRESET`; the room just sits there.
    const traders = [ALICE, BOB];

    for (const [index, trader] of traders.entries()) {
      const ctx = await browser.newContext({ storageState: storageStatePath(trader) });
      const page = await ctx.newPage();

      await page.goto(tradeUrl);
      await page.waitForLoadState('domcontentloaded');
      await expect(
        page.getByRole('heading', { name: /Trade with|Contract Details/i }).first(),
      ).toBeVisible({
        timeout: 30_000,
      });

      // THE DEMO CONTROLS ARE A TAB HERE, not the collapsible panel the Cash_Sale room
      // uses. Same purpose — fire the collateral webhooks Stripe would deliver, through
      // the real handler — but reached differently, which is worth stating because the
      // two rooms otherwise look alike.
      //
      // OPENED WITH `dispatchEvent`, not `click()`. The tab is a visible, enabled
      // `role="tab"` with `pointer-events: auto` and nothing covering it — verified by
      // `elementFromPoint` — and yet both a normal and a FORCED Playwright click time
      // out on it, while a synthetic click works immediately.
      await page.locator('[role=tab]').filter({ hasText: 'Demo' }).first().dispatchEvent('click');

      const expand = page.getByRole('button', { name: /Expand hackathon test controls/i });
      await expect(expand).toBeVisible({ timeout: RENDERED });
      await expand.click();

      const confirm = page.getByRole('button', { name: /Confirm collateral holds/i });
      await expect(confirm).toBeEnabled({ timeout: RENDERED });
      await confirm.click();

      if (index === traders.length - 1) {
        // COLLATERAL IS AN UNCAPTURED AUTHORISATION: no money moves and none of it
        // enters the platform balance — the platform holds a claim, not funds. Both
        // sides are now authorised, so the trade leaves the holds step.
        //
        // RELOADED BEFORE ASSERTING. The state genuinely advances — verified directly
        // in the database, `trades.state = 'COLLATERAL_LOCKED'` with two
        // `pre_auth_holds` rows and a `webhook_logs` row — but the room keeps showing
        // "Collateral pending" until the page is fetched again. The webhook is a
        // server-to-server delivery, so nothing in this tab knows to re-render.
        //
        // Recorded as a finding rather than hidden by the reload: a trader watching the
        // room after posting collateral sees no change, and the demo panel is not the
        // only thing that drives this transition — a real Stripe delivery would land
        // the same way.
        await page.waitForTimeout(6000);
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        await expect(page.getByText('Collateral pending')).toHaveCount(0, {
          timeout: 60_000,
        });
      } else {
        // Give this delivery time to land before the context goes away. A state
        // assertion is not available yet — the trade only advances once BOTH sides are
        // in — so this is the one place a settle wait is the honest option.
        await page.waitForTimeout(8000);
      }

      await ctx.close();
    }
  });

  test('each trader records a postal address of record', async ({ browser }) => {
    // TWO ROWS IN `trade_delivery_details`, because a swap posts in BOTH directions —
    // and deliberately not on `trades`, which is Realtime-published. Each address is
    // readable by the other trader only from COLLATERAL_LOCKED.
    for (const trader of [ALICE, BOB]) {
      const ctx = await browser.newContext({ storageState: storageStatePath(trader) });
      const page = await ctx.newPage();
      await page.goto(tradeUrl);
      await page.waitForLoadState('domcontentloaded');

      // The Terms tab holds the DeliveryAddressPanel. ContractDetailList is a
      // single-selection tabbed interface; the Exchange tab is open by default, so
      // Terms must be selected first. Same `dispatchEvent` approach as the Demo tab
      // (F22) since tab clicks have been unreliable in this room.
      await page.locator('[role=tab]').filter({ hasText: 'Terms' }).first().dispatchEvent('click');

      // If the trade handover method is not yet agreed, agree Delivery terms first.
      const setTermsBtn = page.getByRole('button', { name: /Set delivery terms|Edit terms/i });
      if (await setTermsBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await setTermsBtn.click();
        const termsDialog = page.getByRole('dialog', { name: /Delivery terms/i });
        await expect(termsDialog).toBeVisible({ timeout: 10_000 });
        const labelChoice = termsDialog.locator('label').filter({ hasText: 'Delivery' });
        if (await labelChoice.isVisible().catch(() => false)) {
          await labelChoice.click();
        } else {
          await termsDialog.getByText('Delivery', { exact: true }).click();
        }
        await termsDialog.getByLabel(/Postage each way/i).fill('0.00');
        const saveTerms = termsDialog.getByRole('button', { name: /Save terms/i });
        await expect(saveTerms).toBeEnabled({ timeout: 10_000 });
        await saveTerms.click();
        await expect(termsDialog).toBeHidden({ timeout: 15_000 });
      }

      const add = page
        .getByRole('button', { name: /Add delivery address|Add address|Change delivery address/i })
        .first();
      await expect(add).toBeVisible({ timeout: 30_000 });
      await add.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: RENDERED });
      // Resolved, not free text — `domain/fulfilment/terms.ts` refuses a `text:` place
      // for an address, here as in a Cash_Sale.
      await fillPlace(page, /Delivery address/i, STUB_PLACES.melbourne, dialog);
      await dialog.getByRole('button', { name: /Save|Confirm/i }).first().click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });

      await ctx.close();
    }
  });

  test('both traders post, then both confirm receipt', async ({ browser }) => {
    // A swap posts in BOTH directions, which is why there are two of each step and why
    // the state only advances on the SECOND of each pair.
    for (const trader of [ALICE, BOB]) {
      const ctx = await browser.newContext({ storageState: storageStatePath(trader) });
      const page = await ctx.newPage();
      await page.goto(tradeUrl);
      await page.waitForLoadState('domcontentloaded');

      const record = page.getByRole('button', { name: 'Record shipment' }).first();
      await expect(record).toBeVisible({ timeout: 30_000 });
      await record.click();

      // Opens a dialog with carrier + tracking number fields
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: RENDERED });
      await dialog.getByLabel(/Carrier/i).fill('Australia Post');
      await dialog.getByLabel(/Tracking number/i).fill(`AP${Date.now()}AU`);

      const submit = dialog.getByRole('button', { name: 'Record shipment' });
      await expect(submit).toBeEnabled({ timeout: RENDERED });
      await submit.click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });

      await ctx.close();
    }

    for (const trader of [ALICE, BOB]) {
      const ctx = await browser.newContext({ storageState: storageStatePath(trader) });
      const page = await ctx.newPage();
      await page.goto(tradeUrl);
      await page.waitForLoadState('domcontentloaded');

      const received = page
        .getByRole('button', { name: /I received|Record receipt|Confirm receipt/i })
        .first();
      await expect(received).toBeVisible({ timeout: 30_000 });
      await received.click();
      await expect(received).toHaveCount(0, { timeout: 30_000 });

      await ctx.close();
    }
  });

  test('both accept and the trade completes, releasing collateral', async ({ browser }) => {
    for (const trader of [ALICE, BOB]) {
      const ctx = await browser.newContext({ storageState: storageStatePath(trader) });
      const page = await ctx.newPage();
      await page.goto(tradeUrl);
      await page.waitForLoadState('domcontentloaded');

      const accept = page
        .getByRole('button', { name: /Accept item|Accept the item|Everything is fine/i })
        .first();
      await expect(accept).toBeVisible({ timeout: 30_000 });
      await accept.click();
      const confirm = page.getByRole('dialog');
      if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await confirm.getByRole('button', { name: /Complete without evidence|Accept without evidence/i }).click();
      }
      await expect(accept).toHaveCount(0, { timeout: 30_000 });

      await ctx.close();
    }

    // COMPLETED is terminal. Both holds are voided rather than captured — the trade
    // moved goods, not money — so what proves completion is that no action remains.
    const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
    const page = await ctx.newPage();
    await page.goto(tradeUrl);
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByRole('button', { name: /Record shipment|I received|Accept item/i }),
    ).toHaveCount(0, { timeout: 30_000 });
    await ctx.close();
  });
});
