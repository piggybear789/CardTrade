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
