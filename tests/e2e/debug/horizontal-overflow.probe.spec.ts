// tests/e2e/debug/horizontal-overflow.probe.spec.ts
//
// DIAGNOSTIC, not a spec. Finds what makes a page scroll sideways on a phone.
//
// Reports, per page and per width:
//   * whether the VIEWPORT scrolls horizontally at all
//   * every element whose box crosses the right edge, with the nearest ancestor
//     that could have clipped it and did not
//
// Run:
//   npx playwright test --config=playwright.debug.config.ts --grep "overflow"
import { test, expect } from '@playwright/test';

// Signs in inline rather than reusing a storageState file: the demo seed users are
// not in this database, so the `setup` project cannot write one.
const PROBE_EMAIL = 'ux-probe@example.com';
const PROBE_PASSWORD = 'password123';

// CHROMIUM WITH A PHONE VIEWPORT, not `devices['iPhone 14']`.
//
// The device descriptor forces WebKit, which is the right engine for a Safari-specific
// finding — but it crashed the page on every navigation on this machine once the dev
// server had recompiled a few times ("Page crashed" from `page.goto`). What this probe
// measures is containing-block resolution and utility source order, which is not
// engine-specific, so Chromium answers the same question and actually completes.
// Swap `...devices['iPhone 14']` back in when checking something Safari-only.
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await page.goto('/sign-in');
  await page.waitForLoadState('load');
  await page.getByLabel('Email').fill(PROBE_EMAIL);
  await page.getByLabel('Password').fill(PROBE_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 });
});

/** Narrowest width worth supporting, plus the reported device. */
const WIDTHS = [320, 390];

const LIVE_ITEM = '328fae4d-8bcf-4677-be40-69c23276706b';

const PAGES = [
  ['SELL (create listing)', '/listings/new'],
  ['listing detail (fixed bars)', `/listings/${LIVE_ITEM}`],
  ['my listings', '/listings/mine'],
  ['profile', '/profile'],
];

interface Offender {
  selector: string;
  right: number;
  width: number;
  position: string;
  whiteSpace: string;
  clippedBy: string | null;
}

/**
 * Walks the tree for boxes crossing the viewport's right edge.
 *
 * An element inside an `overflow-x: hidden|clip|auto|scroll` ancestor is NOT a
 * finding: that ancestor absorbs it. Only unclipped overflow reaches the viewport
 * and produces a sideways scroll, so the report names the first ancestor that
 * could have absorbed it, or null when nothing did.
 */
const COLLECT = (viewportWidth: number) => {
  const describe = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 6).join('.')}`
        : '';
    return `${tag}${id}${cls}`;
  };

  const results: Offender[] = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right <= viewportWidth + 1) continue;

    let clippedBy: string | null = null;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      const overflowX = getComputedStyle(parent).overflowX;
      if (overflowX !== 'visible') {
        clippedBy = `${describe(parent)} [overflow-x:${overflowX}]`;
        break;
      }
    }

    const style = getComputedStyle(el);
    results.push({
      selector: describe(el),
      right: Math.round(rect.right),
      width: Math.round(rect.width),
      position: style.position,
      whiteSpace: style.whiteSpace,
      clippedBy,
    });
  }
  return results.sort((a, b) => b.right - a.right).slice(0, 25);
};

for (const width of WIDTHS) {
  // The context is CREATED at this size rather than resized mid-test.
  // `setViewportSize` after the sign-in navigation crashed the WebKit page
  // ("Target page, context or browser has been closed") often enough to be
  // useless as a measurement tool.
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    for (const [label, path] of PAGES) {
      test(`overflow probe: ${label} at ${width}px`, async ({ page }) => {
        await page.goto(path, { waitUntil: 'networkidle', timeout: 60_000 });

      const metrics = await page.evaluate(() => ({
        url: location.pathname,
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        htmlOverflowX: getComputedStyle(document.documentElement).overflowX,
        bodyOverflowX: getComputedStyle(document.body).overflowX,
      }));

      // Can a user actually drag the page sideways?
      const scrollable = await page.evaluate(async () => {
        const before = window.scrollX;
        window.scrollTo(9999, 0);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const after = window.scrollX;
        window.scrollTo(before, 0);
        return after;
      });

      const offenders = (await page.evaluate(COLLECT, width)) as Offender[];

      console.log(`\n===== ${label} (${metrics.url}) @ ${width}px =====`);
      console.log(
        `doc ${metrics.docScrollWidth}/${metrics.docClientWidth}  body ${metrics.bodyScrollWidth}/${metrics.bodyClientWidth}  ` +
          `html overflow-x:${metrics.htmlOverflowX}  body overflow-x:${metrics.bodyOverflowX}`,
      );
      console.log(`scrollX after scrollTo(9999): ${scrollable}  <-- >0 means it really scrolls`);
      if (offenders.length === 0) {
        console.log('no boxes cross the right edge');
      } else {
        for (const o of offenders) {
          console.log(
            `  right=${o.right} w=${o.width} pos=${o.position} ws=${o.whiteSpace}\n` +
              `    ${o.selector}\n` +
              `    clipped by: ${o.clippedBy ?? 'NOTHING — this reaches the viewport'}`,
          );
        }
      }

        expect(
          scrollable,
          `${label} pans sideways by ${scrollable}px at ${width}px`,
        ).toBe(0);
      });
    }
  });
}
