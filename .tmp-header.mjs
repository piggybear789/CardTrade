// TEMPORARY. Confirms the panel heading is visually hidden on phones and
// visible from md up, and that it stays in the accessibility tree. Delete after.
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome' });

async function check(width, height, out) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: width < 768,
    hasTouch: width < 768,
  });
  await page.goto('http://localhost:3000/roomcheck-temp', {
    waitUntil: 'networkidle',
  });

  if (width < 1024) {
    await page.getByRole('button', { name: 'Contract details' }).click();
    await page.waitForTimeout(400);
  }

  const heading = page.getByRole('heading', { name: 'Item', exact: true });
  const result = {
    width,
    // Present for assistive tech either way.
    inA11yTree: await heading.count(),
    visuallyVisible: await heading.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }),
    tabpanelAccessibleName: await page
      .locator('[role="tabpanel"]')
      .first()
      .evaluate((el) => {
        const id = el.getAttribute('aria-labelledby');
        return id ? document.getElementById(id)?.textContent?.trim() : null;
      }),
  };
  await page.screenshot({ path: out });
  await page.close();
  return result;
}

console.log(JSON.stringify(await check(390, 844, '.tmp-h-phone.png'), null, 2));
console.log(JSON.stringify(await check(1280, 900, '.tmp-h-desktop.png'), null, 2));
await browser.close();
