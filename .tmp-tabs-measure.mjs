import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch({ channel: 'msedge' }))
  .catch(() => chromium.launch());

for (const w of [320, 360, 390, 768, 1024, 1280]) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: 860 },
    deviceScaleFactor: 2,
  });
  const p0 = await ctx.newPage();
  await p0.goto(`${BASE}/sign-in`, { waitUntil: 'load', timeout: 60000 });
  await p0.getByLabel('Email').fill('alice@example.com');
  await p0.getByLabel('Password').fill('password123');
  await p0.getByRole('button', { name: 'Sign in' }).click();
  await p0.waitForURL((u) => !/\/sign-in/.test(u.pathname), { timeout: 60000 });
  await p0.close();

  const page = await ctx.newPage();
  await page.goto(`${BASE}/profile?tab=payouts`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(900);
  const rows = await page.evaluate(() => {
    const track = document.querySelector('nav[aria-label="Account sections"] ul');
    const tr = track.getBoundingClientRect();
    return {
      track: { x: +tr.x.toFixed(1), r: +tr.right.toFixed(1) },
      overflowX: track.scrollWidth > track.clientWidth + 1,
      items: Array.from(
        document.querySelectorAll('nav[aria-label="Account sections"] li a'),
      ).map((a) => {
        const span = a.querySelector('span:not([aria-hidden])');
        const ar = a.getBoundingClientRect();
        const sr = span.getBoundingClientRect();
        return {
          t: span.textContent.trim(),
          aw: +ar.width.toFixed(1),
          sw: +sr.width.toFixed(1),
          clipped: span.scrollWidth > span.clientWidth + 1,
          lead: +(sr.x - ar.x).toFixed(1),
          trail: +(ar.right - sr.right).toFixed(1),
        };
      }),
    };
  });
  console.log(`w=${w}`, JSON.stringify(rows));
  await page.screenshot({
    path: `.tmp-tabs-w${w}.png`,
    clip: await page
      .locator('nav[aria-label="Account sections"]')
      .boundingBox()
      .then((b) => ({ x: b.x, y: b.y - 4, width: b.width, height: b.height + 12 })),
    scale: 'css',
  });
  await ctx.close();
}

await browser.close();
