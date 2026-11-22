// Screenshot one route at several moments after navigation, to see what moves.
//   node scripts/design/frames.mjs <route> <phone|desktop> [member] [ms,ms,...]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [route, size = 'phone', member, times = '150,400,800,1500,3000'] = process.argv.slice(2);
const base = process.env.BASE ?? 'http://localhost:3000';
const opts =
  size === 'phone'
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 800 } };
mkdirSync('design/review/frames', { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  ...opts,
  ...(member && member !== '-' ? { storageState: `playwright/.auth/design-${member}.json` } : {}),
});
const page = await context.newPage();
const start = Date.now();
await page.goto(base + route, { waitUntil: 'commit', timeout: 90000 });
for (const t of times.split(',').map(Number)) {
  const wait = t - (Date.now() - start);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `design/review/frames/f-${t}.jpg`, type: 'jpeg', quality: 60 });
}
if (member && member !== '-') await context.storageState({ path: `playwright/.auth/design-${member}.json` });
await browser.close();
console.log('done');
