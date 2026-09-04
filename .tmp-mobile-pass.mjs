import { chromium, devices } from 'playwright';

const BASE = process.env.MOBILE_PASS_BASE ?? 'http://localhost:3001';

function chromeTargets(page) {
  return page.evaluate(() => {
    const names = [
      'NoDitto home',
      'Search listings',
      'Search marketplace',
      'Open menu',
      'Sign up',
      'Filters',
      'Forgot password?',
      'Create an account',
      'Back to home',
    ];
    return names.flatMap((name) => {
      const el =
        document.querySelector(`[aria-label="${name}"]`) ||
        [...document.querySelectorAll('a, button')].find(
          (node) => node.textContent?.trim() === name,
        );
      if (!el) return [];
      const r = el.getBoundingClientRect();
      return [{ name, w: Math.round(r.width), h: Math.round(r.height) }];
    });
  });
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() =>
  chromium.launch({ channel: 'msedge' }),
);
const context = await browser.newContext({ ...devices['iPhone 14'] });
const page = await context.newPage();

for (const path of ['/', '/listings', '/sign-in', '/help']) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  console.log(JSON.stringify({ path, overflow, chrome: await chromeTargets(page) }));
}

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.getByRole('button', { name: /search listings/i }).click();
await page.waitForTimeout(300);
const searchField = await page.getByRole('combobox', { name: /search listings/i }).boundingBox();
const close = await page.getByRole('button', { name: /^close$/i }).boundingBox();
console.log(JSON.stringify({
  searchSheet: {
    field: searchField && { w: Math.round(searchField.width), h: Math.round(searchField.height) },
    close: close && { w: Math.round(close.width), h: Math.round(close.height) },
  },
}));

await browser.close();
