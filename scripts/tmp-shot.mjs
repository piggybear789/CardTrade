// Temporary: screenshot a page at desktop and phone widths for a design review.
import { chromium } from 'playwright';

const url = process.argv[2];
const out = process.argv[3] ?? 'tmp-shot';
const browser = await chromium.launch();
for (const [name, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['phone', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}-${name}.png`, fullPage: true });
  await page.close();
}
await browser.close();
