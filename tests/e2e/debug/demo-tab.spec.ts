import { test, expect } from '../support/fixtures';
import { ALICE, storageStatePath } from '../support/users';

const TRADE_PATH = process.env.TRADE_PATH ?? '';

test('find an interaction that opens the Demo tab', async ({ browser }) => {
  test.skip(!TRADE_PATH, 'set TRADE_PATH=/trades/<id>');

  const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();

  const opened = async () =>
    (await page.getByRole('button', { name: /hackathon test controls/i }).count()) > 0 ||
    (await page.getByRole('button', { name: /Confirm collateral holds/i }).count()) > 0;

  const strategies: Array<[string, () => Promise<void>]> = [
    [
      'dispatchEvent click',
      async () => {
        await page.locator('[role=tab]').filter({ hasText: 'Demo' }).first().dispatchEvent('click');
      },
    ],
    [
      'press Enter',
      async () => {
        const t = page.locator('[role=tab]').filter({ hasText: 'Demo' }).first();
        await t.focus();
        await t.press('Enter');
      },
    ],
    [
      'mouse at coords',
      async () => {
        const box = await page.locator('[role=tab]').filter({ hasText: 'Demo' }).first().boundingBox();
        if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      },
    ],
    [
      'evaluate .click()',
      async () => {
        await page.evaluate(() => {
          const el = Array.from(document.querySelectorAll('[role=tab]')).find(
            (b) => (b.textContent ?? '').trim() === 'Demo',
          ) as HTMLElement | undefined;
          el?.click();
        });
      },
    ],
  ];

  for (const [name, run] of strategies) {
    await page.goto(TRADE_PATH);
    await page
      .getByRole('heading', { name: 'Contract Details' })
      .waitFor({ state: 'visible', timeout: 30_000 });
    try {
      await run();
    } catch (e) {
      console.log(`--- ${name}: threw ${String(e).slice(0, 90)}`);
      continue;
    }
    await page.waitForTimeout(1500);
    console.log(`--- ${name}: demoPanelVisible=${await opened()}`);
    if (await opened()) {
      console.log(`--- WINNER: ${name}`);
      break;
    }
  }

  await ctx.close();
  expect(true).toBe(true);
});
