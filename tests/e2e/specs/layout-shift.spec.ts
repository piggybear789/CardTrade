// tests/e2e/specs/layout-shift.spec.ts
//
// A LAYOUT-SHIFT PROBE. Visits every major surface and measures Cumulative Layout Shift
// with the browser's own `layout-shift` entries, for two kinds of arrival:
//
//   * HARD LOAD — a fresh document. Dynamic routes stream their `loading.tsx` first and
//     swap the page in when it resolves, so this measures skeleton -> content fidelity
//     as well as image, font and hydration shifts.
//   * SOFT NAVIGATION — `router.push` from an already-loaded page, which is the path a
//     member actually takes most of the time and the one where a mismatched loading
//     boundary is most visible.
//
// READ-ONLY. It signs in as seeded members and navigates; it creates no rows. That is
// deliberate: the visual sweep in `screenshots.spec.ts` provisions contracts through the
// real UI and costs minutes per project, and a shift probe should be cheap enough to run
// after every polish pass.
//
// THE BUDGET is 0.1, Google's "good" CLS threshold, asserted SOFTLY so one bad surface
// does not hide the rest. Every measurement is appended to
// `ux-review/layout-shift.<project>.jsonl` with the score and the elements that moved,
// which is what turns a number into a fix. Delete the file to start a fresh report.
//
//   npx playwright test tests/e2e/specs/layout-shift.spec.ts --project=desktop --workers=1
//
// Shifts within 500ms of input (`hadRecentInput`) are excluded, as CLS itself excludes
// them: a panel that grows because the member clicked it is a response, not a shift.

import { test, expect } from '../support/fixtures';
import type { Page, TestInfo } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { ALICE, FRANK_ADMIN, GRACE_SUPPORT, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { COLD_ROUTE } from '../support/waiting';

const CLS_BUDGET = 0.1;
const OUTPUT_DIR = path.resolve(__dirname, '..', '..', '..', 'ux-review');

interface ShiftSource {
  node: string;
  from: string;
  to: string;
}

interface ShiftRecord {
  value: number;
  time: number;
  sources: ShiftSource[];
}

interface Measurement {
  surface: string;
  kind: 'hard' | 'soft';
  url: string;
  cls: number;
  shifts: ShiftRecord[];
}

/**
 * One JSON line per measurement, APPENDED. An in-memory array written from `afterAll`
 * lost every result before a failure, because Playwright replaces the worker after a
 * failing test and the new worker starts with an empty module.
 */
function resultsFile(projectName: string): string {
  return path.join(OUTPUT_DIR, `layout-shift.${projectName}.jsonl`);
}

/** First link on the page whose path matches `pattern` (e.g. a listing id, not `/listings/new`). */
async function firstHref(page: Page, pattern: RegExp): Promise<string | null> {
  await page.waitForLoadState('load');
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href') ?? ''));
  return hrefs.find((href) => pattern.test(href)) ?? null;
}

const LISTING_HREF = /^\/listings\/[0-9a-f-]{36}$/;

/**
 * Installed before any page script runs, so the observer exists from the first frame.
 * Entries go to `window.__shifts`, which a soft navigation resets.
 */
const OBSERVER_SCRIPT = `
  (() => {
    window.__shifts = [];
    const describe = (node) => {
      if (!node || !(node instanceof Element)) return '(text)';
      const id = node.id ? '#' + node.id : '';
      const cls = typeof node.className === 'string'
        ? '.' + node.className.trim().split(/\\s+/).slice(0, 4).join('.')
        : '';
      const text = (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
      return node.tagName.toLowerCase() + id + cls + (text ? ' "' + text + '"' : '');
    };
    const rect = (r) => r ? Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) : '';
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.hadRecentInput) continue;
          window.__shifts.push({
            value: entry.value,
            time: Math.round(entry.startTime),
            sources: (entry.sources || []).slice(0, 4).map((s) => ({
              node: describe(s.node),
              from: rect(s.previousRect),
              to: rect(s.currentRect),
            })),
          });
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) { /* layout-shift unsupported (WebKit): the probe reports 0 */ }
  })();
`;

/** CLS as the session-window maximum: 1s gap, 5s cap — the metric's definition. */
function sessionWindowCls(shifts: ShiftRecord[]): number {
  let best = 0;
  let current = 0;
  let windowStart = -Infinity;
  let last = -Infinity;
  for (const shift of shifts) {
    if (shift.time - last > 1000 || shift.time - windowStart > 5000) {
      current = 0;
      windowStart = shift.time;
    }
    current += shift.value;
    last = shift.time;
    best = Math.max(best, current);
  }
  return Number(best.toFixed(4));
}

/** Network quiet (best effort — Realtime sockets never go idle) plus a settle beat. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(1_500);
}

async function readShifts(page: Page): Promise<ShiftRecord[]> {
  return page.evaluate(
    () => (window as unknown as { __shifts?: ShiftRecord[] }).__shifts ?? [],
  );
}

function record(testInfo: TestInfo, measurement: Measurement): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  appendFileSync(resultsFile(testInfo.project.name), `${JSON.stringify(measurement)}\n`, 'utf8');
  const top = measurement.shifts
    .flatMap((shift) => shift.sources.map((source) => `${shift.value.toFixed(3)} ${source.node} ${source.from} -> ${source.to}`))
    .slice(0, 6);
  console.log(
    `[CLS ${measurement.kind}] ${measurement.surface}: ${measurement.cls}` +
      (top.length ? `\n    ${top.join('\n    ')}` : ''),
  );
  void testInfo.attach(`${measurement.surface}-${measurement.kind}.json`, {
    body: JSON.stringify(measurement, null, 2),
    contentType: 'application/json',
  });
  expect
    .soft(measurement.cls, `${measurement.kind} CLS on ${measurement.surface}`)
    .toBeLessThanOrEqual(CLS_BUDGET);
}

/** Fresh document. Visited once first so a `next dev` compile is not what we measure. */
async function measureHardLoad(
  page: Page,
  testInfo: TestInfo,
  surface: string,
  route: string,
): Promise<void> {
  await page.goto(route, { timeout: COLD_ROUTE });
  await settle(page);
  await page.goto(route, { timeout: COLD_ROUTE });
  await settle(page);
  const shifts = await readShifts(page);
  record(testInfo, {
    surface,
    kind: 'hard',
    url: page.url(),
    cls: sessionWindowCls(shifts),
    shifts,
  });
}

/**
 * Client-side navigation from `from` to `to` through the App Router, which is what a
 * `<Link>` click does. Warmed first for the same reason as the hard load.
 */
async function measureSoftNav(
  page: Page,
  testInfo: TestInfo,
  surface: string,
  from: string,
  to: string,
): Promise<void> {
  // Warm both routes' compiled chunks and payloads.
  await page.goto(to, { timeout: COLD_ROUTE });
  await settle(page);
  await page.goto(from, { timeout: COLD_ROUTE });
  await settle(page);

  await page.evaluate(() => {
    (window as unknown as { __shifts: ShiftRecord[] }).__shifts = [];
  });
  const target = new URL(to, page.url());
  await page.evaluate((href) => {
    const next = (window as unknown as { next?: { router?: { push(href: string): void } } })
      .next;
    if (!next?.router) throw new Error('App Router instance not exposed on window.next');
    next.router.push(href);
  }, `${target.pathname}${target.search}`);
  await page.waitForURL((url) => url.pathname === target.pathname && url.search === target.search, {
    timeout: COLD_ROUTE,
  });
  await settle(page);
  const shifts = await readShifts(page);
  record(testInfo, {
    surface,
    kind: 'soft',
    url: page.url(),
    cls: sessionWindowCls(shifts),
    shifts,
  });
}

// NOT serial: a serial group skips everything after its first failure, and a probe's
// whole value is reporting every surface. Run it with `--workers=1` so one dev server
// is not measured under parallel load.

test.beforeEach(async ({ context }) => {
  await context.addInitScript(OBSERVER_SCRIPT);
});

// ═══ Guests ═══════════════════════════════════════════════════════════════════════

test.describe('guest', () => {
  const ROUTES: ReadonlyArray<readonly [string, string]> = [
    ['catalog', '/'],
    ['sign-in', '/sign-in'],
    ['sign-up', '/sign-up'],
    ['forgot-password', '/forgot-password'],
    ['help', '/help'],
    ['safety', '/safety'],
    ['terms', '/terms'],
    ['privacy', '/privacy'],
    ['account-suspended', '/account-suspended'],
    ['seller-profile', `/sellers/${ALICE.id}`],
  ];

  for (const [surface, route] of ROUTES) {
    test(`hard ${surface}`, async ({ page }, testInfo) => {
      await measureHardLoad(page, testInfo, `guest-${surface}`, route);
    });
  }

  test('hard listing-detail', async ({ page }, testInfo) => {
    await page.goto('/', { timeout: COLD_ROUTE });
    const href = await firstHref(page, LISTING_HREF);
    test.skip(!href, 'No listing in the catalog to measure');
    await measureHardLoad(page, testInfo, 'guest-listing-detail', href!);
  });

  test('soft catalog -> listing-detail', async ({ page }, testInfo) => {
    await page.goto('/', { timeout: COLD_ROUTE });
    const href = await firstHref(page, LISTING_HREF);
    test.skip(!href, 'No listing in the catalog to measure');
    await measureSoftNav(page, testInfo, 'guest-catalog-to-listing', '/', href!);
  });

  test('soft help -> terms', async ({ page }, testInfo) => {
    await measureSoftNav(page, testInfo, 'guest-help-to-terms', '/help', '/terms');
  });
});

// ═══ Member (Alice) ═══════════════════════════════════════════════════════════════

test.describe('member', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(ALICE) });
  });

  const ROUTES: ReadonlyArray<readonly [string, string]> = [
    ['catalog', '/'],
    ['profile', '/profile'],
    ['profile-verification', '/profile?tab=verification'],
    ['profile-payouts', '/profile?tab=payouts'],
    ['listing-new', '/listings/new'],
    ['listings-mine', '/listings/mine'],
    ['sales', '/sales'],
    ['purchases', '/purchases'],
    ['trades', '/trades'],
    ['offers', '/offers'],
    ['saved', '/saved'],
    ['messages', '/messages'],
    ['notifications', '/notifications'],
  ];

  for (const [surface, route] of ROUTES) {
    test(`hard ${surface}`, async ({ page }, testInfo) => {
      await measureHardLoad(page, testInfo, `member-${surface}`, route);
    });
  }

  const SOFT: ReadonlyArray<readonly [string, string, string]> = [
    ['catalog-to-sales', '/', '/sales'],
    ['sales-to-trades', '/sales', '/trades'],
    ['trades-to-purchases', '/trades', '/purchases'],
    ['purchases-to-offers', '/purchases', '/offers'],
    ['offers-to-saved', '/offers', '/saved'],
    ['saved-to-messages', '/saved', '/messages'],
    ['messages-to-notifications', '/messages', '/notifications'],
    ['notifications-to-profile', '/notifications', '/profile'],
    ['profile-to-payouts-tab', '/profile', '/profile?tab=payouts'],
    ['profile-to-verification-tab', '/profile', '/profile?tab=verification'],
    ['profile-to-listings-mine', '/profile', '/listings/mine'],
    ['listings-mine-to-new', '/listings/mine', '/listings/new'],
    ['sales-to-past', '/sales', '/sales?show=past'],
  ];

  for (const [surface, from, to] of SOFT) {
    test(`soft ${surface}`, async ({ page }, testInfo) => {
      await measureSoftNav(page, testInfo, `member-${surface}`, from, to);
    });
  }

  test('soft messages -> first thread', async ({ page }, testInfo) => {
    await page.goto('/messages', { timeout: COLD_ROUTE });
    const href = await firstHref(page, /^\/messages\/[0-9a-f-]{36}$/);
    test.skip(!href, 'Alice has no conversation to open');
    await measureSoftNav(page, testInfo, 'member-messages-to-thread', '/messages', href!);
  });

  test('hard first contract room', async ({ page }, testInfo) => {
    await page.goto('/sales', { timeout: COLD_ROUTE });
    const href = await firstHref(page, /^\/sales\/[0-9a-f-]{36}$/);
    test.skip(!href, 'Alice has no cash sale to open');
    await measureHardLoad(page, testInfo, 'member-cash-sale-room', href!);
  });
});

// ═══ Staff ═══════════════════════════════════════════════════════════════════════

test.describe('admin', () => {
  test.use({ storageState: storageStatePath(FRANK_ADMIN) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [FRANK_ADMIN]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(FRANK_ADMIN) });
  });

  for (const tab of ['payouts', 'reports', 'feedback', 'errors', 'reconciliation']) {
    test(`hard admin ${tab}`, async ({ page }, testInfo) => {
      await measureHardLoad(page, testInfo, `admin-${tab}`, `/admin?tab=${tab}`);
    });
  }

  test('soft admin payouts -> reports', async ({ page }, testInfo) => {
    await measureSoftNav(page, testInfo, 'admin-payouts-to-reports', '/admin', '/admin?tab=reports');
  });
});

test.describe('arbitration', () => {
  test.use({ storageState: storageStatePath(GRACE_SUPPORT) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [GRACE_SUPPORT]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(GRACE_SUPPORT) });
  });

  test('hard arbitration queue', async ({ page }, testInfo) => {
    await measureHardLoad(page, testInfo, 'arbitration-queue', '/admin/arbitration');
  });
});
