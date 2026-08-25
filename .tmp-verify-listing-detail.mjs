import { chromium, devices } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.MOBILE_PASS_BASE ?? 'http://localhost:3001';
const ITEM_ID = 'e2e00000-0000-4000-8000-00000000c001';
const OUT = join(process.cwd(), 'ux-review', 'captures', 'signed-in-mobile');
mkdirSync(OUT, { recursive: true });

function readEnvFile() {
  const out = {};
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const env = { ...readEnvFile(), ...process.env };
const EMAIL = env.NODITTO_TEST_EMAIL;
const PASSWORD = env.NODITTO_TEST_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error('Missing test credentials');

const browser = await chromium
  .launch({ channel: 'chrome', headless: true })
  .catch(() => chromium.launch({ channel: 'msedge', headless: true }));
const context = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-AU' });
const page = await context.newPage();

await page.goto(`${BASE}/sign-in`, { waitUntil: 'load', timeout: 45_000 });
await page.getByLabel('Email').fill(EMAIL);
await page.getByLabel('Password').fill(PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/(listings|onboarding|profile)/, { timeout: 30_000 });

async function shot(path, name) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  return page.url();
}

await shot(`/listings/${ITEM_ID}`, 'detail-listing');

const facts = await page.evaluate(() => {
  const price = [...document.querySelectorAll('p')].find((el) =>
    /\$/.test(el.textContent || '') && el.className.includes('text-gold'),
  );
  const back = [...document.querySelectorAll('a')].find(
    (el) => el.getClientRects().length > 0 && /Back to listings/.test(el.textContent || ''),
  );
  const hub = [...document.querySelectorAll('nav, a')].find(
    (el) => el.getClientRects().length > 0 && (el.textContent || '').trim() === 'Browse',
  );
  const barBuy = [...document.querySelectorAll('button')].find(
    (el) => el.getClientRects().length > 0 && /Buy Now/.test(el.textContent || ''),
  );
  const title = document.querySelector('h2');
  const seller = [...document.querySelectorAll('a')].find((el) =>
    (el.textContent || '').includes('You') || (el.textContent || '').includes('test'),
  );
  return {
    vw: window.innerWidth,
    goldPrice: price?.textContent?.trim() ?? null,
    pricePx: price ? Number.parseFloat(getComputedStyle(price).fontSize) : null,
    title: title?.textContent?.trim() ?? null,
    backVisible: Boolean(back),
    hubVisible: Boolean(hub),
    buyBarVisible: Boolean(barBuy),
    photoH: document.querySelector('img, [class*="350"]')?.getBoundingClientRect().height ?? null,
  };
});

await page.goto(`${BASE}/listings?region=all`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(800);
const otherHref = await page.evaluate((ownedId) => {
  const links = [...document.querySelectorAll('a[href^="/listings/"]')];
  const hit = links.find((a) => {
    const href = a.getAttribute('href') || '';
    return /^\/listings\/[0-9a-f-]{36}/i.test(href) && !href.includes(ownedId);
  });
  return hit?.getAttribute('href') ?? null;
}, ITEM_ID);

let otherFacts = null;
if (otherHref) {
  await shot(otherHref, 'detail-listing-other');
  otherFacts = await page.evaluate(() => {
    const buy = [...document.querySelectorAll('button')].filter(
      (el) => el.getClientRects().length > 0 && /Buy Now|Browse & Buy|Sign in/.test(el.textContent || ''),
    );
    const chat = [...document.querySelectorAll('button')].filter(
      (el) => el.getClientRects().length > 0 && (el.textContent || '').trim() === 'Chat',
    );
    const hub = [...document.querySelectorAll('a')].find(
      (el) => el.getClientRects().length > 0 && (el.textContent || '').trim() === 'Browse',
    );
    const gold = [...document.querySelectorAll('p')].find((el) => el.className.includes('text-gold'));
    return {
      buyLabels: buy.map((el) => el.textContent.trim()),
      chatCount: chat.length,
      hubVisible: Boolean(hub),
      goldPrice: gold?.textContent?.trim() ?? null,
    };
  });
}

console.log(JSON.stringify({ facts, otherHref, otherFacts }, null, 2));
await browser.close();
