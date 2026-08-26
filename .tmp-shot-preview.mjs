// Temporary: screenshot the settings design harness at phone + desktop widths.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3001';
const OUT = 'ux-review/captures/settings-redesign';
mkdirSync(OUT, { recursive: true });

const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch({ channel: 'msedge' }))
  .catch(() => chromium.launch());

const errors = [];
const phone = await browser.newContext({ ...devices['iPhone 14'] });
const page = await phone.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`${BASE}/dev/settings-preview`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/phone-all.png`, fullPage: true });
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
console.log(`phone overflowX=${overflow} height=${await page.evaluate(() => document.documentElement.scrollHeight)}`);

const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const dpage = await desk.newPage();
await dpage.goto(`${BASE}/dev/settings-preview`, { waitUntil: 'networkidle', timeout: 60000 });
await dpage.waitForTimeout(800);
await dpage.screenshot({ path: `${OUT}/desktop-all.png`, fullPage: true });
console.log('desktop done');

if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 5).join(' | '));
await browser.close();
