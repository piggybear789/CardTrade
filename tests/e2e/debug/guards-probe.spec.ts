// Throwaway probe: discover actual text on the region warning and identity gate
// prompt so the real guards spec asserts on what exists.

import { test, expect } from '../support/fixtures';
import { ALICE, BOB, DAVE, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';

test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, BOB, DAVE]);
});

// 1. Region warning on listing page — Alice (AU) views Bob's item.
//    Since both are AU there's no warning. We need a mismatched user.
//    Let's check what the page shows to a normal AU user first.
test('probe listing actions for AU buyer', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
  const page = await ctx.newPage();
  // Alice's charizard
  await page.goto('/listings/aaaaaaa1-0000-0000-0000-000000000001');
  await page.waitForLoadState('domcontentloaded');
  
  // Look for all role=status elements (that's where regionGateNotice renders)
  const statusElements = await page.locator('[role="status"]').allTextContents();
  console.log('STATUS ELEMENTS:', JSON.stringify(statusElements));
  
  // Look for Buy now button
  const buyBtn = page.getByRole('button', { name: 'Buy now' });
  const hasBuy = await buyBtn.count();
  console.log('HAS BUY BUTTON:', hasBuy);
  
  // Look for Propose Trade
  const tradeBtn = page.getByRole('button', { name: 'Propose Trade' });
  const hasTrade = await tradeBtn.count();
  console.log('HAS TRADE BUTTON:', hasTrade);
  
  await ctx.close();
});

// 2. Identity gate on /listings/new for an unverified member.
//    Dave is seeded as VERIFIED. We can't test this without an unverified member.
//    Let's probe what the new listing page shows for a verified user to confirm structure.
test('probe new listing page for verified user', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();
  await page.goto('/listings/new');
  await page.waitForLoadState('domcontentloaded');
  
  // Should see the form since Alice is verified
  const h1 = await page.getByRole('heading', { level: 1 }).allTextContents();
  console.log('H1 HEADINGS:', JSON.stringify(h1));
  const h3 = await page.getByRole('heading', { level: 3 }).allTextContents();
  console.log('H3 HEADINGS:', JSON.stringify(h3));
  
  // Check for ItemForm presence
  const titleField = page.getByLabel('Title');
  const hasTitle = await titleField.count();
  console.log('HAS TITLE FIELD:', hasTitle);
  
  await ctx.close();
});

// 3. Let's also check what the Propose Trade dialog shows when opened
test('probe propose trade dialog', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: storageStatePath(BOB) });
  const page = await ctx.newPage();
  // Alice's charizard, viewed by Bob
  await page.goto('/listings/aaaaaaa1-0000-0000-0000-000000000001');
  await page.waitForLoadState('domcontentloaded');
  
  // Look for the trade button (it's a ListingActionIcon which is a button)
  const tradeBtn = page.getByRole('button', { name: 'Propose Trade' });
  await expect(tradeBtn).toBeVisible({ timeout: 15_000 });
  await tradeBtn.click();
  
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  
  // Check the dialog heading and content
  const dialogHeadings = await dialog.getByRole('heading').allTextContents();
  console.log('TRADE DIALOG HEADINGS:', JSON.stringify(dialogHeadings));
  
  // Since Bob IS verified, he should see the trade offer form, not the gate prompt
  const dialogText = await dialog.textContent();
  console.log('TRADE DIALOG TEXT (first 500):', dialogText?.substring(0, 500));
  
  await ctx.close();
});
