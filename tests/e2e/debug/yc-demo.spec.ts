// tests/e2e/debug/yc-demo.spec.ts
//
// One continuous desktop walkthrough for UI review. Not part of the suite.
//
//   npx playwright test --config=playwright.debug.config.ts tests/e2e/debug/yc-demo.spec.ts
//
// It signs in through the real form, opens menus and dialogs, and leaves them
// up long enough to read. Nothing destructive is confirmed. Action and
// navigation timeouts are short on purpose: a missing control is skipped,
// and the recording continues.

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

import { test } from '../support/fixtures';
import { markedEmail } from '../support/marker';
import {
  ALICE,
  BOB,
  FRANK_ADMIN,
  GRACE_SUPPORT,
  type SeedUser,
} from '../support/users';

const OUT_DIR = path.resolve(__dirname, '..', '..', '..', 'ux-review', 'captures');
const VIDEO_PATH = path.join(OUT_DIR, 'yc-product-walkthrough.webm');
const LOG_PATH = path.join(OUT_DIR, 'yc-product-walkthrough.jsonl');

const ALICE_LISTING = '/listings/aaaaaaa1-0000-0000-0000-000000000001';
const BOB_LISTING = '/listings/aaaaaaa2-0000-0000-0000-000000000002';
const INVITE = '/t/bg9bkC63w25ISJjF1Vhw145A';

const VIEW = { width: 1440, height: 900 };
const HOLD_PAGE = 1_600;
const HOLD_ACTION = 2_000;

test.use({
  viewport: VIEW,
  colorScheme: 'light',
  video: { mode: 'on', size: VIEW },
  navigationTimeout: 25_000,
  actionTimeout: 8_000,
});

test.describe.configure({ mode: 'serial', timeout: 25 * 60_000 });

const beats: Array<{ atMs: number; label: string }> = [];
let startedAt = 0;

test('full product walkthrough', async ({ page }, testInfo) => {
  mkdirSync(OUT_DIR, { recursive: true });
  startedAt = Date.now();
  await installChrome(page);
  const video = page.video();

  try {
    await guest(page);
    await signIn(page, ALICE, 'Alice signs in');
    await alice(page);
    await signOut(page);
    await signIn(page, BOB, 'Bob signs in');
    await bob(page);
    await signOut(page);
    await signIn(page, FRANK_ADMIN, 'Frank signs in');
    await frank(page);
    await signOut(page);
    await signIn(page, GRACE_SUPPORT, 'Grace signs in');
    await grace(page);
    await signOut(page);
    await onboard(page);
    await caption(page, 'End of walkthrough');
    await hold(1_000);
  } finally {
    // saveAs waits until the page closes. Closing first is what lets it return.
    await page.close().catch(() => undefined);
    await video?.saveAs(VIDEO_PATH).catch(() => undefined);
    await testInfo.attach('walkthrough', { path: VIDEO_PATH, contentType: 'video/webm' }).catch(() => undefined);
  }
});

async function guest(page: Page): Promise<void> {
  await visit(page, '/', 'Marketplace, signed out');
  await reveal(page, page.getByRole('button', { name: 'Help' }), 'Help menu');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: /More categories|All categories/ }), 'Categories');
  await dismiss(page);
  await reveal(page, page.getByLabel('Sort listings'), 'Sort');
  await hold(HOLD_ACTION);
  await page.keyboard.press('Escape').catch(() => undefined);
  await search(page, 'Charizard', 'Search');
  await openFirstListing(page, 'Open a listing from the grid');

  await visit(page, BOB_LISTING, 'Listing, signed out');
  await gallery(page);
  await reveal(page, page.getByRole('button', { name: /Buy|Sign in to buy/ }), 'Buy, signed out');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: 'Make an offer' }), 'Make an offer, signed out');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: /Propose (a )?trade/i }), 'Propose a trade, signed out');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: 'Message seller' }).or(page.getByRole('link', { name: 'Message seller' })), 'Message seller, signed out');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: 'Report listing' }), 'Report listing, signed out');
  await dismiss(page);

  await visit(page, `/sellers/${ALICE.id}`, 'Seller profile');
  await visit(page, `/sellers/${ALICE.id}?tab=sold`, 'Seller, sold');
  await visit(page, `/sellers/${ALICE.id}?tab=reviews`, 'Seller, reviews');
  await reveal(page, page.getByRole('button', { name: /More actions|Report/ }), 'Seller actions');
  await dismiss(page);

  await visit(page, '/sign-in', 'Sign in');
  await visit(page, '/sign-up', 'Create account');
  await visit(page, '/forgot-password', 'Forgot password');
  await visit(page, '/auth/update-password', 'Update password, no session');
  await visit(page, '/auth/callback?error=access_denied&error_description=The%20request%20was%20cancelled', 'OAuth cancelled');
  await visit(page, '/auth/confirm', 'Invalid confirm link');
  await visit(page, '/help', 'Help centre');
  await visit(page, '/safety', 'Staying safe');
  await visit(page, '/terms', 'Terms');
  await visit(page, '/privacy', 'Privacy');
  await visit(page, '/trusted-sellers', 'Trusted Sellers');
  await visit(page, '/trusted-sellers/apply', 'Apply as a Trusted Seller');
  await visit(page, '/report-scam', 'Report a scam');
  await visit(page, '/account-suspended', 'Account suspended');
  await visit(page, '/this-route-does-not-exist', 'Page not found');
  await visit(page, INVITE, 'Private invite, signed out');
}

async function alice(page: Page): Promise<void> {
  await visit(page, '/', 'Marketplace, Alice');
  await reveal(page, page.getByRole('button', { name: /Notifications/ }), 'Notifications');
  await hold(HOLD_ACTION);
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: /account menu/i }), 'Account menu');
  await hold(HOLD_ACTION);
  const feedback = page.getByRole('button', { name: 'Send feedback' });
  if (await feedback.isVisible().catch(() => false)) {
    await feedback.click();
    await caption(page, 'Send feedback');
    await hold(HOLD_ACTION);
    await dismiss(page);
  } else {
    await dismiss(page);
  }
  await reveal(page, page.getByRole('button', { name: 'Private Deal' }), 'Private deal');
  await hold(HOLD_ACTION);

  await visit(page, '/profile', 'Account');
  await reveal(page, page.getByRole('button', { name: 'Edit', exact: true }), 'Edit profile');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: /Picture options|Add a picture/ }), 'Profile photo');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: 'Add an address' }), 'Add an address');
  await cancelDialog(page);
  await visit(page, '/profile?tab=verification', 'Verification');
  await visit(page, '/profile?tab=payouts', 'Payouts in account');
  await visit(page, '/profile/payouts', 'Payouts');

  await listingForm(page);
  await visit(page, '/listings/mine', 'My listings');
  await visit(page, ALICE_LISTING, 'Own listing');
  await reveal(page, page.getByRole('link', { name: /Edit listing|^Edit$/ }), 'Edit listing');
  await hold(HOLD_PAGE);
  await visit(page, `${ALICE_LISTING}/edit`, 'Edit listing form');
  await visit(page, ALICE_LISTING, 'Own listing again');
  await reveal(page, page.getByRole('button', { name: 'Delete listing' }), 'Delete listing');
  await cancelDialog(page);
  await reveal(page, page.getByRole('button', { name: 'Share listing' }), 'Share listing');
  await dismiss(page);

  await visit(page, BOB_LISTING, 'Someone else’s listing');
  await reveal(page, page.getByRole('button', { name: /Save item|Remove from saved/ }), 'Save item');
  await reveal(page, page.getByRole('button', { name: 'Make an offer' }), 'Make an offer');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: /Propose (a )?trade/i }), 'Propose a trade');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: /^Buy/ }), 'Buy');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: 'Report listing' }), 'Report listing');
  await dismiss(page);
  await reveal(page, page.getByRole('button', { name: 'Message seller' }).or(page.getByRole('link', { name: 'Message seller' })), 'Message seller');
  await hold(HOLD_ACTION);

  await visit(page, `/trades/new?counterpartItemId=aaaaaaa2-0000-0000-0000-000000000002`, 'Start a trade');
  await visit(page, '/deals', 'Start a deal');
  await visit(page, INVITE, 'Private invite, signed in');

  for (const [route, label] of [
    ['/saved', 'Saved'],
    ['/offers', 'Offers'],
    ['/offers?show=past', 'Offers, past'],
    ['/sales', 'Sales'],
    ['/sales?show=past', 'Sales, past'],
    ['/purchases', 'Purchases'],
    ['/purchases?show=past', 'Purchases, past'],
    ['/trades', 'Trades'],
    ['/trades?show=past', 'Trades, past'],
    ['/messages', 'Messages'],
    ['/notifications', 'Notifications page'],
  ] as const) {
    await visit(page, route, label);
    await openFirstDetail(page, label);
  }
}

async function bob(page: Page): Promise<void> {
  await visit(page, '/purchases', 'Bob, purchases');
  await openFirstDetail(page, 'Bob, a purchase');
  await visit(page, '/trades', 'Bob, trades');
  await openFirstDetail(page, 'Bob, a trade');
  await visit(page, '/messages', 'Bob, messages');
  await openFirstDetail(page, 'Bob, a thread');
  await reveal(page, page.getByLabel(/Attach a photo|Attach a file/), 'Attach a file');
  await dismiss(page);
  await visit(page, '/offers', 'Bob, offers');
  await visit(page, ALICE_LISTING, 'Bob on Alice’s listing');
  await reveal(page, page.getByRole('button', { name: /^Buy/ }), 'Bob, buy');
  await dismiss(page);
}

async function frank(page: Page): Promise<void> {
  await reveal(page, page.getByRole('button', { name: /account menu/i }), 'Frank, account menu');
  await hold(HOLD_ACTION);
  await dismiss(page);
  await visit(page, '/admin', 'Admin');
  await visit(page, '/admin?tab=reports', 'Admin, reports');
  await visit(page, '/admin?tab=reconciliation', 'Admin, reconciliation');
}

async function grace(page: Page): Promise<void> {
  await visit(page, '/admin/arbitration', 'Arbitration');
  await visit(page, '/admin/arbitration?queue=mine', 'Arbitration, mine');
  await visit(page, '/admin/arbitration?queue=unassigned', 'Arbitration, unassigned');
  await visit(page, '/admin/arbitration/CASH_SALE/00000000-0000-0000-0000-000000000000', 'Arbitration, missing case');
}

async function listingForm(page: Page): Promise<void> {
  await visit(page, '/listings/new', 'New listing');
  const file = page.locator('input[type="file"]').first();
  if (await file.count()) {
    await file.setInputFiles(path.resolve(__dirname, '..', 'fixtures', 'test-image.png')).catch(() => undefined);
    await caption(page, 'New listing, photo added');
    await hold(HOLD_ACTION);
  }
  await reveal(page, page.getByRole('button', { name: 'Next', exact: true }), 'New listing, next step');
  await hold(HOLD_ACTION);
}

async function installChrome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const paint = () => {
      if (!document.getElementById('yc-cursor')) {
        const cursor = document.createElement('div');
        cursor.id = 'yc-cursor';
        cursor.style.cssText = 'position:fixed;z-index:2147483646;width:16px;height:16px;margin:-8px 0 0 -8px;border:2px solid #14120b;border-radius:999px;background:rgba(255,255,255,.92);pointer-events:none;left:72px;top:72px';
        document.documentElement.appendChild(cursor);
        document.addEventListener('mousemove', (event) => {
          cursor.style.left = `${event.clientX}px`;
          cursor.style.top = `${event.clientY}px`;
        }, true);
      }
      if (!document.getElementById('yc-caption')) {
        const caption = document.createElement('div');
        caption.id = 'yc-caption';
        caption.textContent = 'NoDitto';
        caption.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:18px;transform:translateX(-50%);max-width:min(760px,calc(100vw - 32px));padding:8px 14px;border-radius:999px;background:#14120b;color:#f6f1e7;font:600 13px/1.3 ui-sans-serif,system-ui,sans-serif;text-align:center;pointer-events:none';
        document.documentElement.appendChild(caption);
      }
    };
    paint();
    document.addEventListener('DOMContentLoaded', paint);
  });
}

async function caption(page: Page, label: string): Promise<void> {
  const atMs = Date.now() - startedAt;
  beats.push({ atMs, label });
  appendFileSync(LOG_PATH, `${JSON.stringify({ atMs, label })}\n`);
  console.log(`BEAT ${label}`);
  await page.evaluate((text) => {
    const node = document.getElementById('yc-caption');
    if (node) node.textContent = text;
  }, label).catch(() => undefined);
}

function hold(ms = HOLD_PAGE): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function glide(page: Page): Promise<void> {
  const distance = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight).catch(() => 0);
  const steps = Math.min(3, Math.max(0, Math.ceil(distance / 800)));
  for (let step = 0; step < steps; step += 1) {
    await page.mouse.wheel(0, 700);
    await hold(380);
  }
  if (steps > 0) {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    await hold(280);
  }
}

async function visit(page: Page, route: string, label: string): Promise<void> {
  try {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.locator('h1, h2, h3').filter({ visible: true }).first().waitFor({ timeout: 8_000 }).catch(() => undefined);
    await caption(page, label);
    await hold();
    await glide(page);
  } catch (error) {
    console.log(`SKIP ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function point(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 16 });
  await hold(220);
}

async function reveal(page: Page, locator: Locator, label: string): Promise<void> {
  try {
    const target = locator.first();
    if (!(await target.isVisible().catch(() => false))) {
      console.log(`SKIP ${label}: not visible`);
      return;
    }
    await caption(page, label);
    await point(page, target);
    await target.click();
    await hold(HOLD_ACTION);
  } catch (error) {
    console.log(`SKIP ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function dismiss(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await hold(280);
}

async function cancelDialog(page: Page): Promise<void> {
  const cancel = page.getByRole('button', { name: /^Cancel$/ }).last();
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click().catch(() => undefined);
    await hold(300);
    return;
  }
  await dismiss(page);
}

async function search(page: Page, query: string, label: string): Promise<void> {
  try {
    const field = page.getByLabel('Search listings').first();
    if (!(await field.isVisible().catch(() => false))) return;
    await caption(page, label);
    await point(page, field);
    await field.click();
    await field.fill(query);
    await hold(HOLD_ACTION);
    await page.keyboard.press('Escape').catch(() => undefined);
  } catch (error) {
    console.log(`SKIP ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function gallery(page: Page): Promise<void> {
  await reveal(page, page.getByRole('button', { name: /Next image|Show photo 2/ }), 'Next photo');
  await reveal(page, page.getByRole('button', { name: /Enlarge photo/ }), 'Photo enlarged');
  await dismiss(page);
}

async function openFirstListing(page: Page, label: string): Promise<void> {
  try {
    const card = page.locator('a[href^="/listings/"]').first();
    if (!(await card.isVisible().catch(() => false))) return;
    await caption(page, label);
    await point(page, card);
    await card.click();
    await hold(HOLD_ACTION);
  } catch (error) {
    console.log(`SKIP ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function openFirstDetail(page: Page, label: string): Promise<void> {
  try {
    const link = page.locator('a[href*="/sales/"], a[href*="/trades/"], a[href*="/messages/"], a[href*="/purchases/"]').first();
    if (!(await link.isVisible().catch(() => false))) return;
    await caption(page, label);
    await point(page, link);
    await link.click();
    await hold(HOLD_ACTION);
    await glide(page);
    await reveal(page, page.getByRole('button', { name: /Dispute|Accept|Ship|Record shipment|Set delivery|Edit terms|Release|Confirm/ }).first(), `${label}, primary action`);
    await dismiss(page);
  } catch (error) {
    console.log(`SKIP ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function signIn(page: Page, user: SeedUser, label: string): Promise<void> {
  await visit(page, '/sign-in', label);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await caption(page, label);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 20_000 });
  await hold(900);
}

async function signOut(page: Page): Promise<void> {
  await reveal(page, page.getByRole('button', { name: /account menu/i }), 'Sign out');
  const button = page.getByRole('button', { name: 'Sign out' });
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    await hold(1_200);
  }
}

async function onboard(page: Page): Promise<void> {
  try {
    await visit(page, '/sign-up', 'New member, create account');
    await page.getByLabel('Email').fill(markedEmail('yc-demo'));
    await page.getByLabel('Password', { exact: true }).fill('TestPassword123!');
    await page.getByRole('checkbox', { name: /accept the Terms/i }).check();
    await caption(page, 'New member, submit');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
    await caption(page, 'Welcome');
    await hold(HOLD_ACTION);
    const start = page.getByRole('button', { name: 'Get started' });
    if (await start.isVisible().catch(() => false)) {
      await start.click();
      await caption(page, 'Choose a username');
      await hold(HOLD_ACTION);
    }
  } catch (error) {
    console.log(`SKIP onboarding: ${error instanceof Error ? error.message : String(error)}`);
  }
}
