import { chromium } from 'playwright';

const OUT = 'ux-review/captures/violet-theme';
const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch({ channel: 'msedge' }))
  .catch(() => chromium.launch());

const ctx = await browser.newContext({
  viewport: { width: 1536, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
await page.goto('http://localhost:3000/', {
  waitUntil: 'networkidle',
  timeout: 60000,
});
await page.waitForTimeout(1500);

const card = page.locator('.group.rounded-lg').first();

// Resting, then hovered over the PHOTO — the region that previously failed to
// reach the link at all.
await page.screenshot({ path: `${OUT}/hover-rest.png`, scale: 'css' });
const cover = await card.boundingBox();
await page.mouse.move(cover.x + cover.width / 2, cover.y + 80);
await page.waitForTimeout(450);
await page.screenshot({ path: `${OUT}/hover-active.png`, scale: 'css' });

const probe = await page.evaluate(() => {
  const c = document.querySelector('.group.rounded-lg');
  const r = c.getBoundingClientRect();
  // What does the browser actually hit over the middle of the photo?
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + 80);
  return {
    hitTag: hit?.tagName,
    hitCursor: getComputedStyle(hit).cursor,
    cardCursor: getComputedStyle(c).cursor,
    restShadow: getComputedStyle(c).boxShadow,
  };
});
console.log(JSON.stringify(probe, null, 2));

await browser.close();
