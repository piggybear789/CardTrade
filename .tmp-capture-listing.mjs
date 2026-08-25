import { chromium, devices } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.MOBILE_PASS_BASE ?? 'http://localhost:3001';
const EMAIL = process.env.NODITTO_TEST_EMAIL;
const PASSWORD = process.env.NODITTO_TEST_PASSWORD;
const OUT = join(process.cwd(), 'ux-review', 'captures', 'signed-in-mobile');
const OWNER = 'd0928837-da37-4907-9ecc-a84e62445119';
const ITEM_ID = 'e2e00000-0000-4000-8000-00000000c001';

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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function credentials() {
  const env = { ...readEnvFile(), ...process.env };
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, ''),
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function rest(method, pathAndQuery, body) {
  const { url, serviceKey } = credentials();
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

const existing = await rest('GET', `items?id=eq.${ITEM_ID}&select=id`);
if (!existing?.length) {
  const inserted = await rest('POST', 'items', {
    id: ITEM_ID,
    owner_id: OWNER,
    title: 'Screenshot fixture — 1999 Base Set Charizard',
    description:
      'Screenshot fixture — 1999 Base Set Charizard\nTemporary listing used to capture signed-in mobile screens. Safe to delete.',
    category: 'Trading Cards',
    condition: 'Near Mint',
    fmv_cents: 12500,
    status: 'AVAILABLE',
    listing_kind: 'SINGLE',
    image_paths: [],
    hidden: false,
    location_label: 'Melbourne VIC',
    location_country_code: 'AU',
    location_precision: 'suburb',
  });
  console.log('seeded item', inserted?.[0]?.id);
} else {
  console.log('item already present');
}

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

const shots = [];
async function visit(path, name) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
  shots.push({ name, url: page.url() });
  console.log('shot', name, page.url());
}

await visit('/listings', 'listings');
await visit('/listings?region=all', 'listings-all-regions');
await visit('/listings/mine', 'listings-mine');
await visit(`/listings/${ITEM_ID}`, 'detail-listing');
await visit(`/sellers/${OWNER}`, 'detail-seller');

await browser.close();
writeFileSync(join(OUT, 'listing-followup.json'), JSON.stringify({ itemId: ITEM_ID, shots }, null, 2));
