import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.MOBILE_PASS_BASE ?? 'http://localhost:3001';
const ITEM_ID = 'e2e00000-0000-4000-8000-00000000c001';
const OUT = join(process.cwd(), 'ux-review', 'captures', 'signed-in-mobile');
mkdirSync(OUT, { recursive: true });

const browser = await chromium
  .launch({ channel: 'chrome', headless: true })
  .catch(() => chromium.launch({ channel: 'msedge', headless: true }));
const context = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-AU' });
const page = await context.newPage();

await page.goto(`${BASE}/listings/${ITEM_ID}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, 'detail-listing-guest.png'), fullPage: false });

const facts = await page.evaluate(() => {
  const visible = (el) => el && el.getClientRects().length > 0;
  const texts = [...document.querySelectorAll('button, a, p, h2')]
    .filter(visible)
    .map((el) => (el.textContent || '').trim())
    .filter(Boolean);
  return {
    gold: [...document.querySelectorAll('p')].find((el) => el.className.includes('text-gold'))?.textContent?.trim() ?? null,
    signIn: texts.some((t) => /Sign in to buy/i.test(t)),
    hub: texts.includes('Browse'),
    back: texts.some((t) => /Back to listings/.test(t)),
    seller: texts.find((t) => t === 'test' || t === 'You'),
  };
});

console.log(JSON.stringify(facts, null, 2));
await browser.close();
