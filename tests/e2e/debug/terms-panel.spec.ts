import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';

const TRADE_PATH = process.env.TRADE_PATH ?? '';

test('dump the Terms tab panel body for both traders', async ({ browser }) => {
  test.skip(!TRADE_PATH, 'set TRADE_PATH=/trades/<id>');

  for (const who of [ALICE, BOB]) {
    const ctx = await browser.newContext({ storageState: storageStatePath(who) });
    const page = await ctx.newPage();
    await page.goto(TRADE_PATH);
    await page.getByRole('heading', { name: 'Contract Details' }).waitFor({ timeout: 30_000 });

    await page.locator('[role=tab]').filter({ hasText: 'Terms' }).first().dispatchEvent('click');
    await page.waitForTimeout(12000); // give Realtime time to replace the server row

    const body = await page.evaluate(() => {
      const selected = document.querySelector('[role=tab][aria-selected="true"]');
      const panel = document.querySelector('[role=tabpanel]');
      return {
        selectedTab: (selected?.textContent ?? '').trim(),
        panelText: (panel as HTMLElement | null)?.innerText?.slice(0, 900) ?? '(no tabpanel)',
        panelButtons: panel
          ? Array.from(panel.querySelectorAll('button')).map((b) =>
              (b.textContent ?? '').replace(/\s+/g, ' ').trim(),
            )
          : [],
      };
    });

    console.log(`=== ${who.displayName} ===`);
    console.log(`--- selectedTab: ${body.selectedTab}`);
    console.log(`--- panelButtons: ${JSON.stringify(body.panelButtons)}`);
    console.log(`--- panelText: ${JSON.stringify(body.panelText)}`);

    await ctx.close();
  }
  expect(true).toBe(true);
});
