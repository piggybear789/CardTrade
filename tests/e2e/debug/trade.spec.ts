import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { createListing } from '../support/listings';
import { ensureSavedCard } from '../support/payments';

/** Dump the interactive controls of whatever is on screen. */
async function controls(page: import('@playwright/test').Page, label: string) {
  await page.getByRole('heading', { name: '2-way trade' }).first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
  const report = await page.evaluate(() => {
    const name = (el: Element) => {
      const aria = el.getAttribute('aria-label');
      if (aria) return `[aria] ${aria}`;
      const ph = (el as HTMLInputElement).placeholder;
      if (ph) return `[ph] ${ph}`;
      return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70);
    };
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    };
    const pick = (sel: string) =>
      Array.from(document.querySelectorAll(sel))
        .filter(vis)
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}${(el as HTMLButtonElement).disabled ? '[disabled]' : ''} "${name(el)}"`,
        );
    return {
      headings: pick('h1,h2,h3,h4'),
      buttons: pick('button'),
      badges: Array.from(document.querySelectorAll('[class*=badge], [data-slot=badge]'))
        .filter(vis)
        .map((el) => (el.textContent ?? '').trim()),
    };
  });
  console.log(`--- [${label}] headings: ${JSON.stringify(report.headings)}`);
  console.log(`--- [${label}] buttons: ${JSON.stringify(report.buttons)}`);
  console.log(`--- [${label}] badges: ${JSON.stringify(report.badges)}`);
}

test('get a trade to collateral and dump the Demo tab', async ({ browser }) => {
  const stamp = Date.now();
  const aliceTitle = marked(`Probe mine ${stamp}`);
  const bobTitle = marked(`Probe theirs ${stamp}`);

  // Both list.
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

  // Alice proposes.
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

  // Bob opens and accepts.
  await bob.goto('/trades');
  await bob.waitForLoadState('domcontentloaded');
  await bob.getByRole('link').filter({ hasText: aliceTitle }).first().click();
  await bob.waitForURL(/\/trades\/[0-9a-f-]{36}/, { timeout: 40_000 });
  const tradeUrl = new URL(bob.url()).pathname;
  console.log(`--- tradeUrl=${tradeUrl}`);
  await controls(bob, 'bob-before-accept');

  const accept = bob.getByRole('button', { name: /Accept terms|Accept & continue/i }).first();
  await accept.click();
  await expect(accept).toHaveCount(0, { timeout: 30_000 });
  await controls(bob, 'bob-after-accept');

  // Alice's view, and the Demo tab.
  await alice.goto(tradeUrl);
  await alice.waitForLoadState('domcontentloaded');
  await controls(alice, 'alice-after-bob-accept');

  const demoTab = alice.getByRole('button', { name: 'Demo' });
  console.log(`--- Demo tab count=${await demoTab.count()}`);
  if ((await demoTab.count()) > 0) {
    await demoTab.click();
    await alice.waitForTimeout(1200);
    await controls(alice, 'alice-demo-tab');
  }

  await aliceCtx.close();
  await bobCtx.close();
});
