// Temporary capture harness for the settings redesign.
// Signs in as a seed user and shoots the three Settings tabs at phone width.
import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SHOT_BASE ?? 'http://localhost:3001';
const EMAIL = process.env.SHOT_EMAIL ?? 'alice@example.com';
const PASSWORD = process.env.SHOT_PASSWORD ?? 'password123';
const OUT = process.env.SHOT_OUT ?? 'ux-review/captures/settings-redesign';

mkdirSync(OUT, { recursive: true });

const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch({ channel: 'msedge' }))
  .catch(() => chromium.launch());

const context = await browser.newContext({ ...devices['iPhone 14'] });
const page = await context.newPage();

await page.goto(`${BASE}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.getByLabel(/email/i).first().fill(EMAIL);
await page.getByLabel(/password/i).first().fill(PASSWORD);
// The credentials submit specifically — `Continue with Google` also matches /continue/.
await page.locator('form button[type="submit"]').first().click();
await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2000);

console.log('after sign-in:', page.url());
const authError = await page
  .locator('[role="alert"]')
  .first()
  .textContent()
  .catch(() => null);
if (authError) console.log('auth message:', authError.trim());

for (const [name, path] of [
  ['profile', '/profile'],
  ['verification', '/profile?tab=verification'],
  ['payouts', '/profile?tab=payouts'],
]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`shot ${name} -> ${OUT}/${name}.png (scrollHeight ${h}, at ${page.url()})`);
}

await browser.close();
