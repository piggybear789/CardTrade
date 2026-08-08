// tests/e2e/support/fixtures.ts
//
// The `test` every spec should import, instead of `@playwright/test` directly.
//
// It does one thing: guarantees the Google Places stub is installed on every context
// a spec uses. That has to be automatic, because a MISSED intercept does not fail
// loudly — the request goes to the real Google, is rejected for the fake key, the
// field yields no suggestions, and the test dies later on an unrelated assertion
// about a button being disabled. Opt-in setup that is silently wrong when forgotten
// is worse than no setup.
//
// Two entry points are covered, because specs use both:
//
//   * the built-in `page` / `context` fixtures, driven by `test.use({ storageState })`
//   * `browser.newContext(...)` inside a test, which multi-party flows need in order
//     to act as two members at once
//
// The second is the reason `browser` is overridden rather than only `context`. A
// wrapper around `newContext` is the only way to catch contexts a spec creates for
// itself, and every multi-party spec here creates several.

import { test as base, type Browser, type BrowserContext } from '@playwright/test';
import { stubGooglePlaces } from './places';

export const test = base.extend<{
  /** Unused directly; forces the stub onto the built-in context. */
  stubbedContext: void;
}>({
  // The fixture callback is named `runTest`, not `use`.
  //
  // Playwright's own examples call it `use`, and `react-hooks/rules-of-hooks` then
  // reports it as React's `use` hook being called outside a component — a hard lint
  // ERROR in a file that has nothing to do with React. Renaming is the honest fix:
  // the parameter is ours to name, and "runTest" says what it does.
  stubbedContext: [
    async ({ context }, runTest) => {
      await stubGooglePlaces(context);
      await runTest();
    },
    // `auto` so a spec gets this without asking. Asking is the thing that gets
    // forgotten.
    { auto: true },
  ],

  browser: async ({ browser }, runTest) => {
    const original = browser.newContext.bind(browser);

    // Patched rather than wrapped in a helper the specs must remember to call, for
    // the same reason `stubbedContext` is `auto`.
    const patched = async (
      ...args: Parameters<Browser['newContext']>
    ): Promise<BrowserContext> => {
      const context = await original(...args);
      await stubGooglePlaces(context);
      return context;
    };

    (browser as Browser & { newContext: typeof patched }).newContext = patched;
    await runTest(browser);
    (browser as Browser & { newContext: typeof original }).newContext = original;
  },
});

export { expect } from '@playwright/test';
