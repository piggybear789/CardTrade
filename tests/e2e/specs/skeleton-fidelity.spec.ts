// tests/e2e/specs/skeleton-fidelity.spec.ts
//
// SKELETON FIDELITY: what a member sees WHILE a route loads, next to what it becomes.
//
// WHY THIS IS NOT THE CLS PROBE. `layout-shift.spec.ts` measures the browser's
// `layout-shift` entries, and those only score elements that exist in BOTH frames and
// moved. A `loading.tsx` swap REPLACES its subtree, so a skeleton the wrong shape
// scores zero unless something persistent sits below it — which in a full-height
// workspace column is usually nothing. The probe can pass while every placeholder in
// the app is wrong. This spec looks instead.
//
// HOW. Each case loads the origin page, throttles the network through CDP, and pushes
// the destination through the App Router. Throttled, the RSC stream delivers its
// loading-boundary chunk well before the page's, so the skeleton holds on screen long
// enough to photograph. The throttle is lifted, the page settles, and both frames are
// written as one side-by-side PNG under `ux-review/skeleton-fidelity/` — skeleton left,
// page right — along with the y-positions of the main column's major boxes in each, so
// a mismatch is a number as well as a picture.
//
// Chromium only (CDP). Read-only, like the CLS probe.
//
//   npx playwright test tests/e2e/specs/skeleton-fidelity.spec.ts --project=desktop --workers=1
//   (prefix `SKELETON_PHONE=1` for the phone viewport)

import { test, expect } from '../support/fixtures';
import type { CDPSession, Page, TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { ALICE, FRANK_ADMIN, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { COLD_ROUTE } from '../support/waiting';

const OUTPUT_DIR = path.resolve(__dirname, '..', '..', '..', 'ux-review', 'skeleton-fidelity');

/**
 * `SKELETON_PHONE=1` runs the same cases at a 390x844 phone viewport (Chromium, so a
 * layout check rather than a WebKit one). Desktop otherwise.
 */
const PHONE = process.env.SKELETON_PHONE === '1';
const VIEWPORT = PHONE ? { width: 390, height: 844 } : { width: 1280, height: 800 };

/** Throttled enough that a typical RSC payload takes a few seconds to arrive. */
const SLOW = { offline: false, latency: 300, downloadThroughput: 48 * 1024, uploadThroughput: 64 * 1024 };
const FAST = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

interface Box {
  y: number;
  h: number;
  tag: string;
}

/**
 * The main column's major blocks, top-down: every visible element inside `main` at
 * least 24px tall and wider than half the column, de-duplicated by its top edge. Coarse
 * on purpose — the question is "does the header end, and the list begin, at the same y".
 */
async function majorBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const root =
      document.querySelector('main [data-workspace-content]') ??
      document.querySelector('main') ??
      document.body;
    const rootRect = root.getBoundingClientRect();
    const seen = new Set<number>();
    const boxes: { y: number; h: number; tag: string }[] = [];
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const rect = element.getBoundingClientRect();
      if (rect.height < 24 || rect.width < rootRect.width / 2) continue;
      if (rect.top > window.innerHeight || rect.bottom < 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'contents') continue;
      const y = Math.round(rect.top);
      if (seen.has(y)) continue;
      seen.add(y);
      boxes.push({ y, h: Math.round(rect.height), tag: element.tagName.toLowerCase() });
    }
    return boxes.sort((a, b) => a.y - b.y).slice(0, 14);
  });
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(800);
}

async function composite(skeleton: Buffer, final: Buffer, file: string): Promise<void> {
  const left = sharp(skeleton);
  const { width = 1280, height = 800 } = await left.metadata();
  const gap = 16;
  // Two pipelines: sharp applies `resize` BEFORE `composite` within one, which shrinks
  // the canvas under full-size inputs.
  const joined = await sharp({
    create: { width: width * 2 + gap, height, channels: 3, background: '#ff00ff' },
  })
    .composite([
      { input: skeleton, left: 0, top: 0 },
      { input: final, left: width + gap, top: 0 },
    ])
    .png()
    .toBuffer();
  await sharp(joined).resize({ width: 1600 }).png().toFile(file);
}

async function probe(
  page: Page,
  testInfo: TestInfo,
  surface: string,
  from: string,
  to: string,
): Promise<void> {
  // Warm both routes so the throttle, not a `next dev` compile, is what holds the frame.
  await page.goto(to, { timeout: COLD_ROUTE });
  await settle(page);
  await page.goto(from, { timeout: COLD_ROUTE });
  await settle(page);

  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW);

  const target = new URL(to, page.url());
  const href = `${target.pathname}${target.search}`;
  await page.evaluate((destination) => {
    const next = (window as unknown as { next?: { router?: { push(h: string): void } } }).next;
    if (!next?.router) throw new Error('App Router instance not exposed on window.next');
    next.router.push(destination);
  }, href);

  // The loading boundary is up when a route-level placeholder is drawn in the main
  // column. Under `next dev` there is no prefetch, so the router holds the origin page
  // until the RSC tree's head arrives — which under the throttle can take a while.
  // A `role=status` loader is what every route `loading.tsx` renders, and the origin
  // page, settled, has none.
  let skeletonShown = true;
  try {
    await page
      .locator('main .animate-skeleton, [role="status"][aria-busy="true"] .animate-skeleton')
      .first()
      .waitFor({ state: 'visible', timeout: 25_000 });
    // One frame so the whole boundary has painted, not just its first bar.
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
  } catch {
    skeletonShown = false;
  }
  const skeletonBoxes = skeletonShown ? await majorBoxes(page) : [];
  const skeletonShot = await page.screenshot({ animations: 'disabled', caret: 'initial' });

  await cdp.send('Network.emulateNetworkConditions', FAST);
  await page.waitForURL((url) => url.pathname === target.pathname, { timeout: COLD_ROUTE });
  await settle(page);
  // A page can legitimately hold an inner Suspense skeleton (a Stripe frame); wait a
  // little for the route's own placeholders to clear, but do not insist.
  await page
    .waitForFunction(() => document.querySelectorAll('main .animate-skeleton').length === 0, null, {
      timeout: 6_000,
    })
    .catch(() => undefined);
  const finalBoxes = await majorBoxes(page);
  const finalShot = await page.screenshot({ animations: 'disabled', caret: 'initial' });
  await cdp.detach();

  mkdirSync(OUTPUT_DIR, { recursive: true });
  const stem = `${surface}.${testInfo.project.name}${PHONE ? '-phone' : ''}`;
  await composite(skeletonShot, finalShot, path.join(OUTPUT_DIR, `${stem}.png`));
  writeFileSync(
    path.join(OUTPUT_DIR, `${stem}.json`),
    `${JSON.stringify({ surface, from, to, skeletonShown, skeletonBoxes, finalBoxes }, null, 2)}\n`,
    'utf8',
  );
  console.log(
    `[skeleton] ${surface}: ${skeletonShown ? 'captured' : 'NO SKELETON SEEN'}\n` +
      `    skeleton y: ${skeletonBoxes.map((b) => b.y).join(' ')}\n` +
      `    final    y: ${finalBoxes.map((b) => b.y).join(' ')}`,
  );
  // Not a failure: a payload small enough to beat the throttle simply never shows its
  // boundary, which is the best outcome there is. Recorded so the report says so.
  if (!skeletonShown) {
    testInfo.annotations.push({ type: 'no-skeleton', description: `${surface} resolved before its loader painted` });
  }
  expect(finalBoxes.length, `${surface}: the page rendered`).toBeGreaterThan(0);
}

test.describe('member', () => {
  test.use({ storageState: storageStatePath(ALICE), viewport: VIEWPORT });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(ALICE) });
  });

  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['catalog', '/saved', '/'],
    ['sales', '/', '/sales'],
    ['purchases', '/', '/purchases'],
    ['trades', '/', '/trades'],
    ['offers', '/', '/offers'],
    ['saved', '/', '/saved'],
    ['messages', '/', '/messages'],
    ['notifications', '/', '/notifications'],
    ['profile', '/', '/profile'],
    ['profile-verification', '/', '/profile?tab=verification'],
    ['profile-payouts', '/', '/profile?tab=payouts'],
    ['listings-mine', '/', '/listings/mine'],
    ['listings-new', '/', '/listings/new'],
    ['seller', '/', `/sellers/${ALICE.id}`],
    ['trades-new', '/', '/trades/new'],
  ];

  for (const [surface, from, to] of CASES) {
    test(`skeleton ${surface}`, async ({ page }, testInfo) => {
      await probe(page, testInfo, `member-${surface}`, from, to);
    });
  }

  test('skeleton listing-detail', async ({ page }, testInfo) => {
    await page.goto('/', { timeout: COLD_ROUTE });
    await page.waitForLoadState('load');
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''));
    const href = hrefs.find((h) => /^\/listings\/[0-9a-f-]{36}$/.test(h));
    test.skip(!href, 'No listing in the catalog');
    await probe(page, testInfo, 'member-listing-detail', '/', href!);
  });
});

test.describe('admin', () => {
  test.use({ storageState: storageStatePath(FRANK_ADMIN), viewport: VIEWPORT });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [FRANK_ADMIN]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(FRANK_ADMIN) });
  });

  for (const tab of ['payouts', 'reports', 'errors']) {
    test(`skeleton admin ${tab}`, async ({ page }, testInfo) => {
      await probe(page, testInfo, `admin-${tab}`, '/', `/admin?tab=${tab}`);
    });
  }

  test('skeleton arbitration', async ({ page }, testInfo) => {
    await probe(page, testInfo, 'admin-arbitration', '/', '/admin/arbitration');
  });
});
