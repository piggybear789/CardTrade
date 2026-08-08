import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';

/**
 * Point this at an existing trade and compare what each party can see.
 *
 * Set TRADE_PATH to a /trades/<id> that is past terms agreement.
 */
const TRADE_PATH = process.env.TRADE_PATH ?? '';

test('compare the two parties views of the same trade room', async ({ browser }) => {
  test.skip(!TRADE_PATH, 'set TRADE_PATH=/trades/<id>');

  for (const who of [ALICE, BOB]) {
    const ctx = await browser.newContext({ storageState: storageStatePath(who) });
    const page = await ctx.newPage();

    const errors: string[] = [];
    const bad: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`);
    });
    page.on('response', (r) => {
      if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(-70)}`);
    });

    await page.goto(TRADE_PATH);
    // Wait generously for the room's own panel, which arrives after the header.
    await page
      .getByRole('heading', { name: 'Contract Details' })
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {});

    const dump = await page.evaluate(() => {
      const vis = (el: Element) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 || r.height > 0;
      };
      const txt = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70);
      return {
        headings: Array.from(document.querySelectorAll('h1,h2,h3')).filter(vis).map(txt),
        railButtons: Array.from(document.querySelectorAll('button[aria-label]'))
          .filter(vis)
          .map((el) => el.getAttribute('aria-label') ?? '')
          .filter((n) => /trader|parcel|hold|collateral|address|tracking|accept/i.test(n)),
        tabs: Array.from(document.querySelectorAll('button'))
          .filter(vis)
          .map(txt)
          .filter((t) => ['Exchange', 'Stripe', 'Collateral', 'History', 'Demo'].includes(t)),
        bodyLen: document.body.innerText.length,
        noGoods: document.body.innerText.includes('putting up no goods'),
        exchangeText: (document.body.innerText.match(/You (give|receive)[\s\S]{0,160}/g) ?? []).join(' || ').slice(0, 320),
      };
    });

    console.log(`=== ${who.displayName} ===`);
    console.log(`--- headings: ${JSON.stringify(dump.headings)}`);
    console.log(`--- rail: ${JSON.stringify(dump.railButtons)}`);
    console.log(`--- tabs: ${JSON.stringify(dump.tabs)}`);
    console.log(`--- bodyLen: ${dump.bodyLen}`);
    console.log(`--- errors: ${JSON.stringify(errors.slice(0, 4))}`);
    console.log(`--- >=400: ${JSON.stringify(bad.slice(0, 4))}`);

    await ctx.close();
  }
  expect(true).toBe(true);
});
