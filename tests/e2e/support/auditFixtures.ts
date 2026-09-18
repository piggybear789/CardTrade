// tests/e2e/support/auditFixtures.ts
//
// Deterministic, UI-created records for the comprehensive screenshot audit.
// Every title/description is marker-prefixed so the existing global teardown can
// remove it even after an interrupted run. The audit uses real orchestrated flows
// rather than inserting contract rows directly and silently skipping their guards.

import { expect, test, type Browser, type Page } from '@playwright/test';

import { chooseTile, fillUnlistedCard } from './deals';
import { ensureFreshSessions } from './auth';
import { createListing, itemIdFromUrl } from './listings';
import { marked } from './marker';
import { messageSellerFromListing } from './messageSeller';
import { ensureSavedCard } from './payments';
import { ALICE, BOB, storageStatePath } from './users';
import { COLD_ROUTE, RENDERED } from './waiting';

export interface AuditFixtures {
  alicePublicItemId: string;
  alicePublicTitle: string;
  aliceTradeItemId: string;
  bobTradeItemId: string;
  cashSalePath: string;
  tradePath: string;
  conversationPath: string;
  invitePath: string;
}

async function openConversation(page: Page, itemId: string, label: string): Promise<string> {
  return messageSellerFromListing(page, itemId, marked(`Visual audit message ${label}`));
}

async function openCashSale(page: Page, itemId: string): Promise<string> {
  await ensureSavedCard(page, itemId);
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /^Buy( now)?$/ }).first().click();

  const dialog = page.getByRole('dialog');
  const addCard = dialog.getByRole('heading', { name: 'Add a payment method' });
  const checkout = dialog.getByRole('heading', { name: 'Start a purchase contract' });
  await expect(addCard.or(checkout)).toBeVisible({ timeout: 25_000 });
  if (await addCard.isVisible().catch(() => false)) {
    await dialog.getByRole('button', { name: /Save demo card/i }).click();
    await expect(checkout).toBeVisible({ timeout: 25_000 });
  }
  await dialog.getByRole('button', { name: 'Reserve item and agree terms' }).click();
  await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  return new URL(page.url()).pathname;
}

async function openTrade(
  alicePage: Page,
  bobPage: Page,
  aliceTitle: string,
  bobItemId: string,
): Promise<string> {
  await alicePage.goto(`/listings/${bobItemId}`);
  await alicePage.waitForLoadState('domcontentloaded');
  // Desktop labels this "Propose Trade"; the phone bar uses an icon whose accessible
  // name is "Propose a trade".
  await alicePage
    .getByRole('button', { name: /^Propose (a )?trade$/i })
    .first()
    .click();

  const dialog = alicePage.getByRole('dialog').first();
  await expect(dialog).toBeVisible({ timeout: RENDERED });
  await alicePage.getByRole('button', { name: /^Your listings/ }).click();
  const picker = alicePage.getByRole('dialog').last();
  await picker.getByPlaceholder(/Search your listings/i).fill(aliceTitle);
  const row = picker
    .locator('label, li, [role=option], button')
    .filter({ hasText: aliceTitle })
    .first();
  await expect(row).toBeVisible({ timeout: RENDERED });
  await row.click();
  await picker.getByRole('button', { name: 'Done' }).click();

  const setTerms = dialog.getByRole('button', { name: /Set delivery terms|Edit terms/i });
  if (await setTerms.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await setTerms.click();
    const terms = alicePage.getByRole('dialog', { name: /Delivery terms/i });
    if (await terms.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await terms.getByText('Delivery', { exact: true }).click();
      await terms.getByLabel(/Postage each way/i).fill('0.00');
      await terms.getByRole('button', { name: /Save terms/i }).click();
      await expect(terms).toBeHidden({ timeout: RENDERED });
    }
  }

  const send = dialog.getByRole('button', { name: 'Send Offer' });
  await expect(send).toBeEnabled({ timeout: RENDERED });
  await send.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  await bobPage.goto('/trades');
  await bobPage.waitForLoadState('domcontentloaded');
  const tradeLink = bobPage.getByRole('link').filter({ hasText: aliceTitle }).first();
  await expect(tradeLink).toBeVisible({ timeout: 30_000 });
  await tradeLink.click();
  await expect(bobPage).toHaveURL(/\/trades\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  return new URL(bobPage.url()).pathname;
}

async function createPrivateInvite(page: Page, label: string): Promise<string> {
  await page.goto('/deals/new');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Private deal' })).toBeVisible({
    timeout: COLD_ROUTE,
  });
  await chooseTile(page, /Sell a card/i);
  await fillUnlistedCard(page, marked(`Visual audit private card ${label}`));
  await page.getByLabel('Price', { exact: true }).fill('75.00');
  await page.getByRole('button', { name: 'Create link' }).click();
  await expect(page).toHaveURL(/\/t\/[A-Za-z0-9_-]{16,}/, { timeout: COLD_ROUTE });
  return new URL(page.url()).pathname;
}

/** Create every dynamic route the visual sweep needs, once per Playwright project. */
export async function provisionAuditFixtures(
  browser: Browser,
  projectName: string,
): Promise<AuditFixtures> {
  await ensureFreshSessions(browser, [ALICE, BOB]);
  // RE-RAISED AFTER session repair, which sets its own budget (90s + 100s per user)
  // and would otherwise cap this hook at ~290s — far short of what publishing three
  // listings and opening two contracts costs on mobile WebKit.
  test.setTimeout(25 * 60_000);

  const stamp = `${projectName}-${Date.now()}`;
  const aliceContext = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const bobContext = await browser.newContext({ storageState: storageStatePath(BOB) });
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  try {
    const alicePublicTitle = marked(`Visual audit public ${stamp}`);
    const alicePublicItemId = itemIdFromUrl(
      await createListing(alicePage, {
        title: alicePublicTitle,
        priceDollars: '45.00',
        description: 'Available listing used to audit detail, edit, seller, and messaging pages.',
      }),
    );

    const aliceSaleItemId = itemIdFromUrl(
      await createListing(alicePage, {
        title: marked(`Visual audit sale ${stamp}`),
        priceDollars: '80.00',
      }),
    );
    // The public listing doubles as Alice's trade side. A proposal at NEGOTIATING
    // does not reserve either item, so one listing can serve both surfaces — which
    // matters because each creation costs ~45s on mobile WebKit.
    const aliceTradeItemId = alicePublicItemId;
    const bobTradeItemId = itemIdFromUrl(
      await createListing(bobPage, {
        title: marked(`Visual audit Bob trade ${stamp}`),
        priceDollars: '45.00',
      }),
    );

    const conversationPath = await openConversation(bobPage, alicePublicItemId, stamp);
    const cashSalePath = await openCashSale(bobPage, aliceSaleItemId);
    const tradePath = await openTrade(
      alicePage,
      bobPage,
      alicePublicTitle,
      bobTradeItemId,
    );
    const invitePath = await createPrivateInvite(alicePage, stamp);

    // Preserve any refresh-token rotation from these long-lived contexts for the
    // short capture contexts that follow.
    await aliceContext.storageState({ path: storageStatePath(ALICE) });
    await bobContext.storageState({ path: storageStatePath(BOB) });

    return {
      alicePublicItemId,
      alicePublicTitle,
      aliceTradeItemId,
      bobTradeItemId,
      cashSalePath,
      tradePath,
      conversationPath,
      invitePath,
    };
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
}
