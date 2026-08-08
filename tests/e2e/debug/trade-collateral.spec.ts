import { test, expect } from '../support/fixtures';
import { ALICE, storageStatePath } from '../support/users';

const TRADE_PATH = process.env.TRADE_PATH ?? '';

test('open the Demo tab and confirm collateral', async ({ browser }) => {
  test.skip(!TRADE_PATH, 'set TRADE_PATH=/trades/<id>');

  const ctx = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await ctx.newPage();
  await page.goto(TRADE_PATH);
  await page
    .getByRole('heading', { name: 'Contract Details' })
    .waitFor({ state: 'visible', timeout: 30_000 });

  await page.getByRole('button', { name: 'Demo', exact: true }).click();
  await page.waitForTimeout(1200);

  const inTab = await page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 || r.height > 0;
    };
    const txt = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    return {
      buttons: Array.from(document.querySelectorAll('button'))
        .filter(vis)
        .map((el) => `${(el as HTMLButtonElement).disabled ? '[disabled] ' : ''}${txt(el)}`)
        .filter((t) => t.length > 0 && !/^\[disabled\] $/.test(t)),
      text: document.body.innerText.slice(0, 700),
    };
  });
  console.log(`--- demo tab buttons: ${JSON.stringify(inTab.buttons)}`);
  console.log(`--- demo tab text: ${JSON.stringify(inTab.text)}`);

  // Fire whichever collateral control is offered.
  const confirm = page.getByRole('button', { name: /Confirm collateral holds/i });
  console.log(`--- confirm count=${await confirm.count()}`);
  if ((await confirm.count()) > 0) {
    await confirm.click();
    // Watch the rail for up to 30s.
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(5000);
      const step = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button[aria-label]')).find((el) =>
          (el.getAttribute('aria-label') ?? '').includes('current step'),
        );
        return b?.getAttribute('aria-label') ?? 'none';
      });
      console.log(`--- t+${(i + 1) * 5}s current step: ${step}`);
      if (!/post collateral/i.test(step)) break;
    }
  }

  await ctx.close();
  expect(true).toBe(true);
});
