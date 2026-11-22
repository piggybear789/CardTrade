// Visual audit: viewport screenshots of every public route at desktop and phone width.
// Never full-page, so every image stays well under any size limit.
//   node scripts/design/audit.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:3000';
const out = 'design/review/audit';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

await desktop.goto(base + '/', { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
const listing = await desktop.evaluate(() => document.querySelector('a[href^="/listings/"]')?.getAttribute('href'));
const seller = await desktop.evaluate(() => document.querySelector('a[href^="/sellers/"]')?.getAttribute('href'));

const routes = [
  ['home', '/'],
  ['listing', listing],
  ['seller', seller],
  ['references', '/references'],
  ['ref-profile', '/references/serialcollect'],
  ['trusted', '/trusted-sellers'],
  ['help', '/help'],
  ['safety', '/safety'],
  ['terms', '/terms'],
  ['signin', '/sign-in'],
  ['signup', '/sign-up'],
  ['deals', '/deals'],
  ['report-scam', '/report-scam'],
].filter(([, r]) => r);

for (const [name, route] of routes) {
  for (const [label, page] of [['d', desktop], ['p', phone]]) {
    await page.goto(base + route, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}-${label}.jpg`, type: 'jpeg', quality: 70 });
  }
  console.log(name, route);
}
await browser.close();
