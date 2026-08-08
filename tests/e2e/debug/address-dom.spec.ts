import { test, expect } from '../support/fixtures';
import { ALICE, storageStatePath } from '../support/users';

const TRADE_PATH = process.env.TRADE_PATH ?? '';

test('is the delivery address panel in the DOM at all', async ({ browser }) => {
  test.skip(!TRADE_PATH, 'set TRADE_PATH=/trades/<id>');

  const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();
  await page.goto(TRADE_PATH);
  await page.getByRole('heading', { name: 'Contract Details' }).waitFor({ timeout: 30_000 });

  // Select the Terms tab first - tab content only renders while active.
  await page.locator('[role=tab]').filter({ hasText: 'Terms' }).first().dispatchEvent('click');
  await page.waitForTimeout(1200);

  const found = await page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const tabs = Array.from(document.querySelectorAll('[role=tab]')).map((t) => ({
      text: (t.textContent ?? '').trim(),
      selected: t.getAttribute('aria-selected'),
      hidden: (t as HTMLElement).offsetParent === null,
    }));
    const buttons = Array.from(document.querySelectorAll('button')).map((b) => ({
      text: (b.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
      hidden: (b as HTMLElement).offsetParent === null,
    }));
    return {
      tabs,
      htmlHasAddAddress: html.includes('Add address'),
      htmlHasYourDeliveryAddress: html.includes('Your delivery address'),
      htmlHasTermsLabel: html.includes('>Terms<'),
      hiddenButtonsWithAddress: buttons.filter((b) => /address/i.test(b.text)),
      allButtonTexts: buttons.map((b) => `${b.hidden ? '(hidden) ' : ''}${b.text}`).filter((t) => t.length > 2),
    };
  });

  console.log(`--- tabs: ${JSON.stringify(found.tabs)}`);
  console.log(`--- html contains "Add address": ${found.htmlHasAddAddress}`);
  console.log(`--- html contains "Your delivery address": ${found.htmlHasYourDeliveryAddress}`);
  console.log(`--- html contains a Terms tab label: ${found.htmlHasTermsLabel}`);
  console.log(`--- buttons mentioning address: ${JSON.stringify(found.hiddenButtonsWithAddress)}`);
  console.log(`--- all buttons: ${JSON.stringify(found.allButtonTexts)}`);

  await ctx.close();
  expect(true).toBe(true);
});
