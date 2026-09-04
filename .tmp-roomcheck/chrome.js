const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://localhost:3001/roomcheck-temp', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const out = await page.evaluate(() => {
    const bar = document.querySelector('header.sticky');
    const section = bar.closest('section');
    const cs = getComputedStyle(section);
    const bs = getComputedStyle(bar);
    return {
      section: {
        borderTopWidth: cs.borderTopWidth,
        borderLeftWidth: cs.borderLeftWidth,
        borderRadius: cs.borderTopLeftRadius,
        background: cs.backgroundColor,
        boxShadow: cs.boxShadow,
      },
      bar: {
        position: bs.position,
        background: bs.backgroundColor,
        borderBottomWidth: bs.borderBottomWidth,
        paddingLeft: bs.paddingLeft,
      },
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
