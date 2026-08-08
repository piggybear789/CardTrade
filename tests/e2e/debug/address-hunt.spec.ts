import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { createListing } from '../support/listings';
import { ensureSavedCard } from '../support/payments';

/**
 * Drives a trade to COLLATERAL_LOCKED, then hunts for the delivery-address control and
 * tries to complete that step. Debug config, so nothing is torn down afterwards.
 */
test('reach the address step and find its control', async ({ browser }) => {
  const stamp = Date.now();
  const aliceTitle = marked(`Addr mine ${stamp}`);
  const bobTitle = marked(`Addr theirs ${stamp}`);

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

  // Propose + accept.
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

  await bob.goto('/trades');
  await bob.waitForLoadState('domcontentloaded');
  await bob.getByRole('link').filter({ hasText: aliceTitle }).first().click();
  await bob.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 40_000 });
  const tradePath = new URL(bob.url()).pathname;
  console.log(`--- TRADE=${tradePath}`);
  const accept = bob.getByRole('button', { name: /Accept terms|Accept & continue/i }).first();
  await accept.click();
  await expect(accept).toHaveCount(0, { timeout: 30_000 });

  // Collateral from both.
  for (const page of [alice, bob]) {
    await page.goto(tradePath);
    await page.getByRole('heading', { name: 'Contract Details' }).waitFor({ timeout: 30_000 });
    await page.locator('[role=tab]').filter({ hasText: 'Demo' }).first().dispatchEvent('click');
    const expand = page.getByRole('button', { name: /Expand hackathon test controls/i });
    if ((await expand.count()) > 0) await expand.click();
    const confirm = page.getByRole('button', { name: /Confirm collateral holds/i });
    if ((await confirm.count()) > 0) {
      await confirm.click();
      await page.waitForTimeout(7000);
    }
  }

  // Now hunt for the address control on Alice's page.
  await alice.goto(tradePath);
  await alice.getByRole('heading', { name: 'Contract Details' }).waitFor({ timeout: 30_000 });

  const hunt = await alice.evaluate(() => {
    const all = Array.from(document.querySelectorAll('button, [role=tab], summary'));
    const named = all.map((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 50),
      aria: el.getAttribute('aria-label'),
      visible: (() => {
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      })(),
    }));
    return {
      addressish: named.filter((n) => /address/i.test(`${n.text} ${n.aria ?? ''}`)),
      tabs: named.filter((n) => n.role === 'tab').map((n) => n.text),
      hasAddText: document.body.innerText.includes('Add address'),
      hasDeliveryAddr: document.body.innerText.includes('delivery address'),
      bodySample: document.body.innerText.slice(0, 1200),
    };
  });
  console.log(`--- addressish controls: ${JSON.stringify(hunt.addressish)}`);
  console.log(`--- tabs: ${JSON.stringify(hunt.tabs)}`);
  console.log(`--- hasAddAddressText=${hunt.hasAddText} hasDeliveryAddrText=${hunt.hasDeliveryAddr}`);

  // If not present, walk every tab and look again.
  if (hunt.addressish.length === 0) {
    for (const tabName of hunt.tabs) {
      await alice.locator('[role=tab]').filter({ hasText: tabName }).first().dispatchEvent('click');
      await alice.waitForTimeout(900);
      const found = await alice.evaluate(() =>
        Array.from(document.querySelectorAll('button'))
          .map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter((t) => /add address|change|address/i.test(t)),
      );
      console.log(`--- tab "${tabName}": address controls ${JSON.stringify(found)}`);
      if (found.length > 0) break;
    }
  }

  await aliceCtx.close();
  await bobCtx.close();
});
