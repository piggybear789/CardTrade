import { chromium, devices } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.MOBILE_PASS_BASE ?? 'http://localhost:3001';
const OWNED = 'e2e00000-0000-4000-8000-00000000c001';
const OTHER_ITEM = 'e2e00000-0000-4000-8000-00000000c00b';
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

async function rest(method, pathAndQuery, body) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation,resolution=merge-duplicates',
  };
  if (method === 'GET') headers['Accept-Profile'] = 'cardtrade';
  else headers['Content-Profile'] = 'cardtrade';
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PostgREST ${method} ${pathAndQuery} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const owned = await rest('GET', `items?id=eq.${OWNED}&select=owner_id`);
const ownerId = owned?.[0]?.owner_id;
const profiles =
  (await rest('GET', `profiles?id=neq.${ownerId}&select=id,display_name&limit=1`)) ?? [];
if (!profiles?.length) throw new Error('No other profile to own a listing');
const otherOwner = profiles[0].id;
console.log('other owner', otherOwner, profiles[0].display_name);

await rest('POST', 'items', {
  id: OTHER_ITEM,
  owner_id: otherOwner,
  title: 'Buyer-bar fixture — Blastoise',
  description:
    'A long enough description to trip the Read more control on the Flutter-style listing page. Extra sentences keep the clamp honest so we can see the gold toggle.',
  category: 'Pokémon',
  condition: 'Near Mint',
  fmv_cents: 8800,
  status: 'AVAILABLE',
  listing_kind: 'SINGLE',
  image_paths: [],
  hidden: false,
  location_label: 'Sydney NSW',
  location_country_code: 'AU',
  location_precision: 'suburb',
});

const browser = await chromium
  .launch({ channel: 'chrome', headless: true })
  .catch(() => chromium.launch({ channel: 'msedge', headless: true }));
const context = await browser.newContext({ ...devices['iPhone 14'], locale: 'en-AU' });
const page = await context.newPage();

await page.goto(`${BASE}/sign-in`, { waitUntil: 'load', timeout: 45_000 });
await page.getByLabel('Email').fill(env.NODITTO_TEST_EMAIL);
await page.getByLabel('Password').fill(env.NODITTO_TEST_PASSWORD);
await page.getByRole('button', { name: 'Sign in' }).click();
await page.waitForURL(/\/(listings|onboarding|profile)/, { timeout: 30_000 });

await page.goto(`${BASE}/listings/${OTHER_ITEM}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, 'detail-listing-buyer.png'), fullPage: false });

const facts = await page.evaluate(() => {
  const visible = (el) => el && el.getClientRects().length > 0;
  const buttons = [...document.querySelectorAll('button, a')].filter(visible);
  return {
    labels: buttons.map((el) => (el.getAttribute('aria-label') || el.textContent || '').trim()).filter(Boolean),
    gold: [...document.querySelectorAll('p')].find((el) => el.className.includes('text-gold'))?.textContent?.trim() ?? null,
    hub: buttons.some((el) => (el.textContent || '').trim() === 'Browse'),
    buy: buttons.some((el) => /Buy Now/.test(el.textContent || '')),
    chat: buttons.some((el) => (el.textContent || '').trim() === 'Chat'),
    offer: buttons.some((el) => (el.textContent || '').trim() === 'Offer'),
    trade: buttons.some((el) => (el.textContent || '').trim() === 'Trade'),
    photoH: Math.max(
      ...[...document.querySelectorAll('div')].map((el) => el.getBoundingClientRect().height),
    ),
  };
});

await rest('DELETE', `items?id=eq.${OTHER_ITEM}`);
console.log(JSON.stringify(facts, null, 2));
await browser.close();
