const { chromium } = require('@playwright/test');

const URL = 'http://localhost:3001/roomcheck-temp';

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 200));
  });

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const shell = await page.evaluate(() => {
    const bar = document.querySelector('header.sticky');
    const back = document.querySelector('a[aria-label="Back"]');
    const tablist = document.querySelector('[role="tablist"][aria-label="Contract workspace"]');
    const composer = document.querySelector('form textarea')?.closest('form');
    const log = document.querySelector('[role="log"]');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) };
    };
    return {
      bar: box(bar),
      back: box(back),
      oldTabStripPresent: Boolean(tablist),
      summaryCardPresent: Boolean(
        [...document.querySelectorAll('h2')].some((h) => /total/.test(h.parentElement?.textContent || '')) &&
          document.querySelectorAll('h2').length > 2,
      ),
      log: box(log),
      composer: box(composer),
      headings: [...document.querySelectorAll('h1,h2,h3')].map((h) => ({
        tag: h.tagName,
        text: (h.textContent || '').trim().slice(0, 46),
      })),
    };
  });
  console.log('THREAD', JSON.stringify(shell, null, 2));
  await page.screenshot({ path: '.tmp-roomcheck/thread.png' });

  // Open the details sheet from the subject line.
  await page.locator('button:has-text("Contract details")').first().click();
  await page.waitForTimeout(700);

  const sheet = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { open: false };
    const r = dialog.getBoundingClientRect();
    const tabs = [...dialog.querySelectorAll('[role="tab"]')].map((t) =>
      (t.textContent || '').trim(),
    );
    const cards = dialog.querySelectorAll('.shadow-market').length;
    return {
      open: true,
      url: location.search,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      h: Math.round(r.height),
      tabs,
      nestedCards: cards,
      hasOwnHeading: /Contract Details/.test(dialog.textContent || ''),
      title: (dialog.querySelector('h2,[id^="radix"]')?.textContent || '').trim().slice(0, 50),
    };
  });
  console.log('SHEET', JSON.stringify(sheet, null, 2));
  await page.screenshot({ path: '.tmp-roomcheck/sheet.png' });

  // Android back should close the sheet, not leave the room.
  await page.goBack();
  await page.waitForTimeout(700);
  const afterBack = await page.evaluate(() => ({
    dialog: Boolean(document.querySelector('[role="dialog"]')),
    path: location.pathname,
    search: location.search,
  }));
  console.log('AFTER_BACK', JSON.stringify(afterBack));

  // Deep link straight into the sheet.
  await page.goto(`${URL}?details=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const deep = await page.evaluate(() => ({
    dialog: Boolean(document.querySelector('[role="dialog"]')),
    search: location.search,
  }));
  console.log('DEEP_LINK', JSON.stringify(deep));

  // Desktop: split must come back, with no sheet affordance.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const desktop = await page.evaluate(() => {
    const grid = [...document.querySelectorAll('div')].find((d) =>
      getComputedStyle(d).gridTemplateColumns.includes(' '),
    );
    return {
      splitColumns: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      backVisible: Boolean(document.querySelector('a[aria-label="Back"]')?.checkVisibility?.()),
      detailsButton: Boolean(document.querySelector('button[aria-haspopup="dialog"]')),
      hasDetailsCardHeading: /Contract Details/.test(document.body.textContent || ''),
    };
  });
  console.log('DESKTOP', JSON.stringify(desktop, null, 2));
  await page.screenshot({ path: '.tmp-roomcheck/desktop.png' });

  console.log('ERRORS', JSON.stringify(errors.slice(0, 8), null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
