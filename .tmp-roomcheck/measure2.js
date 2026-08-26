const { chromium } = require('@playwright/test');

const URL = 'http://localhost:3001/roomcheck-temp';

async function bar(page, label) {
  const info = await page.evaluate(() => {
    const el = document.querySelector('header.sticky');
    const action = document.querySelector('header.sticky button:not([aria-haspopup])');
    const title = document.querySelector('header.sticky h2');
    const sub = document.querySelector('header.sticky p');
    const r = el.getBoundingClientRect();
    const ar = action?.getBoundingClientRect();
    const tr = title?.getBoundingClientRect();
    return {
      barH: Math.round(r.height),
      rows: ar && tr ? (Math.abs(ar.top - tr.top) < 20 ? 1 : 2) : 1,
      action: action ? { text: action.textContent.trim(), w: Math.round(ar.width) } : null,
      titleW: tr ? Math.round(tr.width) : null,
      subline: sub ? sub.textContent.trim() : null,
    };
  });
  console.log(label, JSON.stringify(info));
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await bar(page, 'LONG_ACTION');
  await page.screenshot({ path: '.tmp-roomcheck/thread-long.png' });

  await page.goto(`${URL}?short=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await bar(page, 'SHORT_ACTION');
  await page.screenshot({ path: '.tmp-roomcheck/thread-short.png' });

  await page.goto(`${URL}?details=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const sheet = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const panel = d.querySelector('[role="tabpanel"] > div');
    const r = d.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      h: Math.round(r.height),
      viewportH: window.innerHeight,
      gapBelow: Math.round(window.innerHeight - r.bottom),
      panelScrolls: panel ? getComputedStyle(panel).overflowY : null,
    };
  });
  console.log('SHEET', JSON.stringify(sheet));
  await page.screenshot({ path: '.tmp-roomcheck/sheet.png' });

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
