// tests/e2e/support/waiting.ts
//
// One rule about waiting, written down because breaking it produced a failure that
// looked exactly like an application hang.
//
// NEVER `waitForLoadState('networkidle')` IN THIS SUITE.
//
// `networkidle` resolves after 500ms with no in-flight requests. Every
// authenticated page here holds a Supabase Realtime WebSocket — the notification
// bell subscribes on mount, and contract rooms subscribe as well — so on those
// pages there is no such quiet period and the wait can simply never resolve. It
// appeared to work for a while because the socket sometimes settled before the
// assertion that followed happened to pass anyway.
//
// The symptom when it did not: `page.waitForLoadState: Test ended`, ninety seconds
// into a test whose real work had finished in eight. That reads as the app hanging,
// which is the most expensive possible way for a test to be wrong — it accuses the
// code under test. Playwright's own guidance discourages `networkidle` for exactly
// this reason.
//
// WHAT TO DO INSTEAD, in order of preference:
//   1. Nothing. `expect(locator)` auto-waits and retries, which is almost always
//      the whole answer.
//   2. Assert on the thing you are about to interact with — a heading, or
//      `toBeEnabled()` on the control. That both waits AND documents the
//      precondition.
//   3. `waitForLoadState('domcontentloaded')` when a page needs to be parsed before
//      a locator can be resolved at all. It is bounded and does not care about
//      sockets.
//   4. `waitForURL(...)` for navigations, with a `COLD_ROUTE` budget — `next dev`
//      compiles a route on its first request, so a first visit is slow in a way
//      that says nothing about the app. See F5 in FINDINGS.md.
//
// Never `waitForTimeout` in a spec. It is fine in tests/e2e/debug (a human reads
// that output), and nowhere else: a fixed sleep is either too short and flaky or
// too long and slow, and it hides which condition was actually being waited for.

/**
 * Budget for a navigation to a route this run has not visited yet.
 *
 * Sized for `next dev` compiling a route on first request (15–25s observed for
 * `/messages/[id]` and `/sales/[id]`), which is why it is far larger than any
 * assertion timeout. Kept below the 90s per-test budget in playwright.config.ts so
 * a genuine hang still fails the test rather than the whole worker.
 */
export const COLD_ROUTE = 30_000;

/** Budget for content that is server-rendered on an already-compiled route. */
export const RENDERED = 15_000;

/**
 * Click something that navigates, and try once more if nothing moved.
 *
 * THIS EXISTS FOR A REAL DEFECT, not to paper over a flaky locator, and the retry
 * is deliberately visible rather than hidden inside a helper called `click`.
 *
 * `CatalogMosaic` renders TWO different trees — the phone mosaic on the server (it
 * has no viewport) and a flat grid after hydration — and swaps between them when
 * `useIsDesktop` resolves. The two lay out identically at `md` and up, so a desktop
 * visitor sees a finished page during the swap, and every tile's anchor is destroyed
 * and rebuilt underneath it. A click that lands in that window is dropped entirely:
 * probed in tests/e2e/debug/catalog-card-click.spec.ts, the event log reads
 * `pointerdown target=a connected=false`, then mousedown/mouseup on a `div`, and NO
 * `click` event at all.
 *
 * It self-heals after one page view because `ViewportHintWriter` records the tier in
 * the `nd_vw` cookie and the next server render starts in the right shape — so the
 * exposure is a first visit, which is also the visit a new member makes.
 *
 * Recorded in ux-audit-findings.md. Until it is fixed, a journey that asserts on the
 * PATHWAY should not fail on the race, and a journey that wants to assert on the race
 * should say so.
 */
export async function clickThrough(
  target: import('@playwright/test').Locator,
  expectUrl: RegExp,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const page = target.page();
  await target.click();
  try {
    await page.waitForURL(expectUrl, { timeout: 5_000 });
    return;
  } catch {
    // The hydration swap ate it. The element has been rebuilt by now, so the second
    // click is against a stable tree.
  }
  await target.click();
  await expect(page).toHaveURL(expectUrl, { timeout: COLD_ROUTE });
}

/**
 * Click something whose effect is a WRITE, and wait for the write's own response.
 *
 * TWO REAL BEHAVIOURS ARE BEING WORKED AROUND HERE, and both are recorded as F43.
 *
 *  1. An optimistic control reports success before the row exists. Asserting on the
 *     control and then navigating aborts the in-flight Server Action, and the next
 *     page correctly shows the unchanged state — which reads as a broken feature.
 *  2. A tap that lands before hydration does NOTHING AT ALL, silently: the button is
 *     painted, sized and enabled, but React has not attached its handler yet. Observed
 *     on mobile WebKit against the dev server, where the window is seconds long. The
 *     retry is what distinguishes "the click was too early" from "the write failed",
 *     because the first produces no request whatsoever.
 *
 * Server Actions POST to the URL of the page they were invoked from, which is why the
 * matcher is a URL fragment rather than an endpoint.
 */
export async function clickForWrite(
  target: import('@playwright/test').Locator,
  urlContains: string,
  attempts = 3,
): Promise<void> {
  const page = target.page();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const settled = page
      .waitForResponse(
        (response) =>
          response.request().method() === 'POST' && response.url().includes(urlContains),
        { timeout: attempt === attempts ? RENDERED : 6_000 },
      )
      .then(() => true)
      .catch(() => false);
    await target.click();
    if (await settled) return;
  }
  throw new Error(
    `No write request to a URL containing "${urlContains}" after ${attempts} clicks. ` +
      'No request at all means the handler was never attached (see F43); a failed ' +
      'request would have resolved this wait and failed later.',
  );
}
