import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { createListing } from '../support/listings';
import { ensureSavedCard } from '../support/payments';

/**
 * Runs list -> propose -> accept -> confirm collateral, then PRINTS THE TRADE ID and
 * leaves everything in place. The debug config has no globalTeardown, so the rows
 * survive for a DB inspection — which the real suite cannot offer, because its
 * teardown deletes the trade before it can be examined.
 */
test('leave a trade at collateral for inspection', async ({ browser }) => {
  const stamp = Date.now();
  const aliceTitle = marked(`Hold probe mine ${stamp}`);
  const bobTitle = marked(`Hold probe theirs ${stamp}`);

  const aliceCtx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const alice = await aliceCtx.newPage();
  const aliceItem = new URL(
    await createListing(alice, { title: aliceTitle, priceDollars: '250.00' }),
  ).pathname
    .split('/')
    .pop()!;

  const bobCtx = await browser.newContext({ storageState: storageStatePath(BOB) });
  const bob = await bobCtx.newPage();
  const bobItem = new URL(
    await createListing(bob, { title: bobTitle, priceDollars: '250.00' }),
  ).pathname
    .split('/')
    .pop()!;

  await ensureSavedCard(alice, bobItem);
  await ensureSavedCard(bob, aliceItem);

  // Propose.
  await alice.goto(`/listings/${bobItem}`);
  await alice.waitForLoadState('domcontentloaded');
  await alice.getByRole('button', { name: 'Propose Trade' }).click();
  const dialog = alice.getByRole('dialog').first();
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await alice.getByRole('button', { name: /^Your listings/ }).click();
  const picker = alice.getByRole('dialog').last();
  await picker.getByPlaceholder(/Search your listings/i).fill(aliceTitle);
  await picker.locator('label, li, [role=option], button').filter({ hasText: aliceTitle }).first().click();
  await picker.getByRole('button', { name: 'Done' }).click();
  await alice.getByText('Delivery', { exact: true }).click();
  await alice.getByRole('button', { name: 'Send Offer' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Accept as Bob.
  await bob.goto('/trades');
  await bob.waitForLoadState('domcontentloaded');
  await bob.getByRole('link').filter({ hasText: aliceTitle }).first().click();
  await bob.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 40_000 });
  const tradeId = new URL(bob.url()).pathname.split('/').pop()!;
  console.log(`--- TRADE_ID=${tradeId}`);

  const accept = bob.getByRole('button', { name: /Accept terms|Accept & continue/i }).first();
  await accept.click();
  await expect(accept).toHaveCount(0, { timeout: 30_000 });

  // Confirm collateral from both sessions, capturing any toast text.
  for (const [who, page] of [
    ['alice', alice],
    ['bob', bob],
  ] as const) {
    await page.goto(`/trades/${tradeId}`);
    await page.getByRole('heading', { name: 'Contract Details' }).waitFor({ timeout: 30_000 });
    await page.locator('[role=tab]').filter({ hasText: 'Demo' }).first().dispatchEvent('click');
    const expand = page.getByRole('button', { name: /Expand hackathon test controls/i });
    console.log(`--- ${who} expand count=${await expand.count()}`);
    if ((await expand.count()) > 0) await expand.click();
    const confirm = page.getByRole('button', { name: /Confirm collateral holds/i });
    console.log(`--- ${who} confirm count=${await confirm.count()} enabled=${await confirm.first().isEnabled().catch(() => 'n/a')}`);
    if ((await confirm.count()) > 0) {
      await confirm.first().click();
      await page.waitForTimeout(5000);
      const toasts = await page.locator('[data-sonner-toast]').allTextContents();
      console.log(`--- ${who} toasts: ${JSON.stringify(toasts)}`);
    }
  }

  await aliceCtx.close();
  await bobCtx.close();
});
