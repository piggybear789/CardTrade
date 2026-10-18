// tests/e2e/debug/canvas-screenshots.spec.ts
//
// Captures a 1440x900 screenshot of all 36 pages, flows, and modals for the
// Page Facelift Audit Canvas, encodes each as a compact WebP data URI via sharp,
// and writes `ux-review/captures/canvas-thumbs.json`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import type { BrowserContext, Page } from '@playwright/test';

import { test } from '../support/fixtures';
import { ensureFreshSessions } from '../support/auth';
import { marked, markedEmail } from '../support/marker';
import {
  ALICE,
  BOB,
  FRANK_ADMIN,
  GRACE_SUPPORT,
  storageStatePath,
} from '../support/users';

const OUT_DIR = path.resolve(__dirname, '..', '..', '..', 'ux-review', 'captures', 'canvas-audit');
const THUMBS_JSON = path.join(OUT_DIR, 'canvas-thumbs.json');
const VIEW = { width: 1440, height: 900 };

function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, '..', '..', '..', '.env.local');
  const raw = readFileSync(envPath, 'utf8');
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    out[key] = val;
  }
  return out;
}

const ENV = loadEnvLocal();
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? ENV.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ENV.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function restInsert<T = Record<string, unknown>>(table: string, body: unknown): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Accept-Profile': 'cardtrade',
      'Content-Profile': 'cardtrade',
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${table} failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as T[];
}

interface SeededIds {
  aliceItemId: string;
  aliceSaleItemId: string;
  bobItemId: string;
  cashSaleId: string;
  tradeId: string;
  conversationId: string;
  inviteToken: string;
}

async function seedAuditRows(): Promise<SeededIds> {
  const imgA = '216cdd7d-ef4a-466d-bffe-6a55f64d4dc1/2011fde7-6a03-4ba5-bd2a-56ee19458598/0.jpg';
  const imgB = '27cf7959-22ec-438d-9521-0cc8dc53c706/884b7935-d87c-43dd-a473-10618e8bf399/0.webp';

  const [aliceItem] = await restInsert<{ id: string }>('items', {
    owner_id: ALICE.id,
    title: marked('1999 Base Set Charizard #4 PSA 8'),
    description: 'Clean holo surface, sharp corners, stored in a graded sleeve.',
    category: 'Pokémon',
    condition: 'Near Mint',
    fmv_cents: 45000,
    status: 'AVAILABLE',
    listing_kind: 'SINGLE',
    hidden: false,
    location_label: 'Sydney NSW, Australia',
    location_country_code: 'AU',
    image_paths: [imgA, imgB],
  });

  const [aliceSaleItem] = await restInsert<{ id: string }>('items', {
    owner_id: ALICE.id,
    title: marked('Umbreon Neo Discovery 1st Ed PSA 9'),
    description: 'First edition holo with swirl, graded PSA 9 Mint.',
    category: 'Pokémon',
    condition: 'Near Mint',
    fmv_cents: 68000,
    status: 'RESERVED',
    listing_kind: 'SINGLE',
    hidden: false,
    location_label: 'Sydney NSW, Australia',
    location_country_code: 'AU',
    image_paths: [imgB],
  });

  const [bobItem] = await restInsert<{ id: string }>('items', {
    owner_id: BOB.id,
    title: marked('1986 Fleer Michael Jordan #57 BGS 8'),
    description: 'Centering 65/35, strong corners and deep gloss.',
    category: 'Sports Cards',
    condition: 'Near Mint',
    fmv_cents: 52000,
    status: 'AVAILABLE',
    listing_kind: 'SINGLE',
    hidden: false,
    location_label: 'Melbourne VIC, Australia',
    location_country_code: 'AU',
    image_paths: [imgA],
  });

  const [conv] = await restInsert<{ id: string }>('conversations', {
    item_id: aliceItem.id,
    participant_a: ALICE.id,
    participant_b: BOB.id,
  });

  await restInsert('messages', [
    {
      conversation_id: conv.id,
      sender_id: BOB.id,
      kind: 'USER',
      body: marked('Hey Alice — is the holo surface clean under angled light?'),
    },
    {
      conversation_id: conv.id,
      sender_id: ALICE.id,
      kind: 'USER',
      body: marked('Yes, happy to send close-ups or agree tracked express post today.'),
    },
  ]);

  await restInsert('offers', {
    item_id: aliceItem.id,
    seller_id: ALICE.id,
    buyer_id: BOB.id,
    offered_by: BOB.id,
    amount_cents: 41000,
    status: 'PENDING',
    message: marked('Can do $410 with tracked express shipping today.'),
  });

  const [saleConv] = await restInsert<{ id: string }>('conversations', {
    item_id: aliceSaleItem.id,
    participant_a: ALICE.id,
    participant_b: BOB.id,
  });

  const [sale] = await restInsert<{ id: string }>('cash_sales', {
    item_id: aliceSaleItem.id,
    seller_id: ALICE.id,
    buyer_id: BOB.id,
    amount_cents: 69500,
    agreed_price_cents: 68000,
    platform_fee_cents: 0,
    status: 'AGREEMENT',
    item_title: marked('Umbreon Neo Discovery 1st Ed PSA 9'),
    item_description: 'First edition holo with swirl, graded PSA 9 Mint.',
    item_condition: 'Near Mint',
    item_image_paths: [imgB],
    fulfillment_method: 'DELIVERY',
    shipping_cost_cents: 1500,
    conversation_id: saleConv.id,
  });

  const [tradeConv] = await restInsert<{ id: string }>('conversations', {
    participant_a: ALICE.id,
    participant_b: BOB.id,
  });

  const [trade] = await restInsert<{ id: string }>('trades', {
    initiator_id: ALICE.id,
    counterpart_id: BOB.id,
    initiator_item_id: aliceItem.id,
    counterpart_item_id: bobItem.id,
    state: 'NEGOTIATING',
    cash_amount_cents: 5000,
    cash_direction: 'PROPOSER_PAYS',
    handover_method: 'DELIVERY',
    delivery_cost_cents: 1500,
    offer_message: marked('Happy to add $50 cash boot with tracked post both ways.'),
    conversation_id: tradeConv.id,
  });

  await restInsert('trade_items', [
    { trade_id: trade.id, trader_id: ALICE.id, item_id: aliceItem.id },
    { trade_id: trade.id, trader_id: BOB.id, item_id: bobItem.id },
  ]);

  return {
    aliceItemId: aliceItem.id,
    aliceSaleItemId: aliceSaleItem.id,
    bobItemId: bobItem.id,
    cashSaleId: sale.id,
    tradeId: trade.id,
    conversationId: conv.id,
    inviteToken: 'bg9bkC63w25ISJjF1Vhw145A',
  };
}

test.use({
  viewport: VIEW,
  colorScheme: 'light',
  navigationTimeout: 30_000,
  actionTimeout: 8_000,
});

test.describe.configure({ mode: 'serial', timeout: 15 * 60_000 });

const thumbs: Record<string, string> = {};

async function snap(page: Page, id: string): Promise<void> {
  await page.waitForTimeout(350);
  const pngPath = path.join(OUT_DIR, `${id}.png`);
  const buf = await page.screenshot({
    path: pngPath,
    fullPage: false,
    animations: 'disabled',
    caret: 'initial',
  });
  const webpBuf = await sharp(buf)
    .resize({ width: 720, withoutEnlargement: true })
    .webp({ quality: 62 })
    .toBuffer();
  thumbs[id] = `data:image/webp;base64,${webpBuf.toString('base64')}`;
  writeFileSync(THUMBS_JSON, JSON.stringify(thumbs, null, 2));
  console.log(`SNAP ${id} (${Math.round(webpBuf.length / 1024)}KB)`);
}

async function visitAndSnap(page: Page, route: string, id: string): Promise<void> {
  try {
    await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.locator('h1, h2, h3').filter({ visible: true }).first().waitFor({ timeout: 8_000 }).catch(() => undefined);
    await snap(page, id);
  } catch (err) {
    console.log(`ERR ${id}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

test('capture all 36 surfaces for canvas', async ({ browser }) => {
  mkdirSync(OUT_DIR, { recursive: true });

  execFileSync(
    'npx',
    ['tsx', '--env-file=.env.local', 'scripts/e2e/cleanup-test-data.ts'],
    { stdio: 'inherit', shell: true },
  );

  await ensureFreshSessions(browser, [ALICE, BOB, FRANK_ADMIN, GRACE_SUPPORT]);
  const ids = await seedAuditRows();

  let guestCtx: BrowserContext | null = null;
  let aliceCtx: BrowserContext | null = null;
  let bobCtx: BrowserContext | null = null;
  let frankCtx: BrowserContext | null = null;
  let graceCtx: BrowserContext | null = null;

  try {
    // ─── 1. GUEST SURFACES ──────────────────────────────────────────────────
    guestCtx = await browser.newContext({ viewport: VIEW });
    const guestPage = await guestCtx.newPage();

    await visitAndSnap(guestPage, '/', 'home-catalog');

    // Open HelpMenu for site-header-menus screenshot
    const helpBtn = guestPage.getByRole('button', { name: 'Help' }).first();
    if (await helpBtn.isVisible().catch(() => false)) {
      await helpBtn.click();
    }
    await snap(guestPage, 'site-header-menus');
    await guestPage.keyboard.press('Escape').catch(() => undefined);

    await visitAndSnap(guestPage, `/sellers/${ALICE.id}`, 'seller-profile');
    await visitAndSnap(guestPage, '/sign-in', 'auth-core');
    await visitAndSnap(guestPage, '/auth/update-password', 'auth-dead-states');
    await visitAndSnap(guestPage, '/account-suspended', 'account-suspended');
    await visitAndSnap(guestPage, '/this-route-does-not-exist', 'not-found');
    await visitAndSnap(guestPage, '/help', 'help-safety');
    await visitAndSnap(guestPage, '/terms', 'legal-pages');
    await visitAndSnap(guestPage, '/trusted-sellers', 'trusted-sellers');
    await visitAndSnap(guestPage, '/report-scam', 'report-scam');
    await visitAndSnap(guestPage, `/t/${ids.inviteToken}`, 'deal-invite');

    // ─── 2. ALICE SURFACES ──────────────────────────────────────────────────
    aliceCtx = await browser.newContext({
      viewport: VIEW,
      storageState: storageStatePath(ALICE),
    });
    const alicePage = await aliceCtx.newPage();

    await visitAndSnap(alicePage, `/listings/${ids.aliceItemId}`, 'listing-detail-owner');

    // Delete listing modal on Alice's own listing
    const delBtn = alicePage.getByRole('button', { name: 'Delete listing' }).first();
    if (await delBtn.isVisible().catch(() => false)) {
      await delBtn.click();
      await snap(alicePage, 'delete-close-dialogs');
      await alicePage.keyboard.press('Escape').catch(() => undefined);
    }

    await visitAndSnap(alicePage, '/listings/new', 'listings-new');
    await visitAndSnap(alicePage, '/listings/mine', 'listings-mine');
    await visitAndSnap(alicePage, '/deals', 'deals-compose');
    await visitAndSnap(alicePage, '/saved', 'saved-watchlist');
    await visitAndSnap(alicePage, '/offers', 'offers-list');
    await visitAndSnap(alicePage, '/sales', 'sales-purchases-lists');
    await visitAndSnap(alicePage, `/sales/${ids.cashSaleId}`, 'cash-sale-room');
    await visitAndSnap(alicePage, '/trades', 'trades-list');
    await visitAndSnap(alicePage, `/trades/${ids.tradeId}`, 'trade-room');
    await visitAndSnap(alicePage, `/messages/${ids.conversationId}`, 'messages-inbox');
    await visitAndSnap(alicePage, '/notifications', 'notifications-surface');
    await visitAndSnap(alicePage, '/profile', 'profile-hub');
    await visitAndSnap(alicePage, '/profile?tab=verification', 'profile-verification');
    await visitAndSnap(alicePage, '/profile?tab=payouts', 'profile-payouts');

    // ─── 3. BOB SURFACES (Buyer & Modals on Alice's listing) ────────────────
    bobCtx = await browser.newContext({
      viewport: VIEW,
      storageState: storageStatePath(BOB),
    });
    const bobPage = await bobCtx.newPage();

    await visitAndSnap(bobPage, `/listings/${ids.aliceItemId}`, 'listing-detail');

    // Buy now modal
    const buyBtn = bobPage.getByRole('button', { name: /^Buy( now)?$/i }).first();
    if (await buyBtn.isVisible().catch(() => false)) {
      await buyBtn.click();
      await bobPage.getByRole('dialog').first().waitFor({ timeout: 8_000 }).catch(() => undefined);
      await bobPage.waitForTimeout(600);
      await snap(bobPage, 'buy-now-dialog');
      await bobPage.keyboard.press('Escape').catch(() => undefined);
      await bobPage.waitForTimeout(250);
    }

    // Make an offer modal
    const offerBtn = bobPage.getByRole('button', { name: /Make an offer/i }).first();
    if (await offerBtn.isVisible().catch(() => false)) {
      await offerBtn.click();
      await bobPage.getByRole('dialog').first().waitFor({ timeout: 8_000 }).catch(() => undefined);
      await snap(bobPage, 'make-offer-dialog');
      await bobPage.keyboard.press('Escape').catch(() => undefined);
      await bobPage.waitForTimeout(250);
    }

    // Propose a trade modal
    const tradeBtn = bobPage.getByRole('button', { name: /Propose (a )?trade/i }).first();
    if (await tradeBtn.isVisible().catch(() => false)) {
      await tradeBtn.click();
      await bobPage.getByRole('dialog').first().waitFor({ timeout: 8_000 }).catch(() => undefined);
      await snap(bobPage, 'propose-trade-dialog');
      await bobPage.keyboard.press('Escape').catch(() => undefined);
      await bobPage.waitForTimeout(250);
    }

    // Report listing modal
    const reportBtn = bobPage.getByRole('button', { name: 'Report listing' }).first();
    if (await reportBtn.isVisible().catch(() => false)) {
      await reportBtn.click();
      await bobPage.getByRole('dialog').first().waitFor({ timeout: 8_000 }).catch(() => undefined);
      await snap(bobPage, 'report-feedback-dialogs');
      await bobPage.keyboard.press('Escape').catch(() => undefined);
    }

    // ─── 4. STAFF SURFACES (Frank & Grace) ──────────────────────────────────
    frankCtx = await browser.newContext({
      viewport: VIEW,
      storageState: storageStatePath(FRANK_ADMIN),
    });
    const frankPage = await frankCtx.newPage();
    await visitAndSnap(frankPage, '/admin', 'admin-console');

    graceCtx = await browser.newContext({
      viewport: VIEW,
      storageState: storageStatePath(GRACE_SUPPORT),
    });
    const gracePage = await graceCtx.newPage();
    await visitAndSnap(gracePage, '/admin/arbitration', 'arbitration-workspace');

    // ─── 5. ONBOARDING WIZARD (new member) ──────────────────────────────────
    const onboardPage = await guestCtx.newPage();
    await onboardPage.goto('/sign-up', { waitUntil: 'domcontentloaded' });
    await onboardPage.getByLabel('Email').fill(markedEmail('canvas-snap'));
    await onboardPage.getByLabel('Password', { exact: true }).fill('TestPassword123!');
    await onboardPage.getByRole('checkbox', { name: /accept the Terms/i }).check();
    await onboardPage.getByRole('button', { name: 'Create account' }).click();
    await onboardPage.waitForURL(/\/onboarding/, { timeout: 25_000 });
    await snap(onboardPage, 'onboarding-wizard');
  } finally {
    await guestCtx?.close().catch(() => undefined);
    await aliceCtx?.close().catch(() => undefined);
    await bobCtx?.close().catch(() => undefined);
    await frankCtx?.close().catch(() => undefined);
    await graceCtx?.close().catch(() => undefined);

    execFileSync(
      'npx',
      ['tsx', '--env-file=.env.local', 'scripts/e2e/cleanup-test-data.ts'],
      { stdio: 'inherit', shell: true },
    );
  }
});
