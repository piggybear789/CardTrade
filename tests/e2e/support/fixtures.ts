// tests/e2e/support/fixtures.ts
//
// The `test` every spec should import, instead of `@playwright/test` directly.
//
// It guarantees that every context a spec uses is INSTRUMENTED: the Google Places
// stub, the audit's Masker (emails, client secrets, invite tokens and legal names
// covered on screen and in video), the UX collectors, and the runtime collector that
// keeps the Storage upload ledger cleanup deletes from. That has to be automatic,
// because a MISSED intercept does not fail loudly — the request goes to the real
// Google, is rejected for the fake key, the field yields no suggestions, and the test
// dies later on an unrelated assertion about a button being disabled. A missed Masker
// is quieter still: an unmasked video. Opt-in setup that is silently wrong when
// forgotten is worse than no setup.
//
// Two entry points are covered, because specs use both:
//
//   * the built-in `page` / `context` fixtures, driven by `test.use({ storageState })`
//     (video comes from `use.video` in playwright.config.ts)
//   * `browser.newContext(...)` inside a test, which multi-party flows need in order
//     to act as two members at once. Those contexts do NOT inherit `use.video`, so the
//     patch adds `recordVideo` into the test's output directory at the context's
//     viewport, unless the caller asked for its own
//
// The second is the reason `browser` is overridden rather than only `context`. A
// wrapper around `newContext` is the only way to catch contexts a spec creates for
// itself, and every multi-party spec here creates several.
//
// Migrated Pathways use the `members` fixture instead (audit/members.ts): one labelled,
// recorded context per declared member, closed and saved at teardown whether the test
// passed or failed. Those contexts bypass the patch, because they are instrumented with
// their own label, video path and ledger.
//
// Requirements: 6.6, 29.2, 29.3, 29.4 (with audit/members.ts)

import path from 'node:path';

import { test as base, type Browser, type BrowserContext, type TestInfo } from '@playwright/test';

import {
  ORIGINAL_NEW_CONTEXT,
  instrumentContext,
  openMembers,
  videoSize,
  type MemberDeclarations,
  type MemberSet,
  type OpenMembersOptions,
} from '../audit/members';
import { isMemberLabel } from '../audit/core/artifactPaths';
import { runId } from './marker';
import { appServerUrl } from './users';

/** Opens a Pathway's member contexts; closed (and their videos saved) at teardown. */
export interface MemberRoster {
  open(declared: MemberDeclarations, options: Omit<OpenMembersOptions, 'testInfo'>): Promise<MemberSet>;
}

/** The member label for an unmigrated context: its jar's file name, else `member`. */
function legacyMemberLabel(storageState: unknown): string {
  if (typeof storageState === 'string') {
    const name = path.basename(storageState).replace(/\.json$/i, '').toLowerCase();
    if (isMemberLabel(name)) return name;
  }
  return 'member';
}

/** The ledger an unmigrated spec's uploads go into: the run's, under the spec's file name. */
function legacyLedger(testInfo: TestInfo): { runId: string; pathwayId: string } {
  const spec = path.basename(testInfo.file).replace(/\.[^.]+$/, '');
  return { runId: runId(), pathwayId: `unmigrated:${spec}` };
}

/** The test currently running, or null outside a test or hook (worker setup). */
function currentTestInfo(): TestInfo | null {
  try {
    return base.info();
  } catch {
    return null;
  }
}

export const test = base.extend<{
  /** Unused directly; forces instrumentation onto the built-in context. */
  stubbedContext: void;
  /** Member contexts for migrated Pathways (audit/members.ts). */
  members: MemberRoster;
}>({
  // The fixture callback is named `runTest`, not `use`.
  //
  // Playwright's own examples call it `use`, and `react-hooks/rules-of-hooks` then
  // reports it as React's `use` hook being called outside a component — a hard lint
  // ERROR in a file that has nothing to do with React. Renaming is the honest fix:
  // the parameter is ours to name, and "runTest" says what it does.
  stubbedContext: [
    async ({ context, storageState, baseURL }, runTest, testInfo) => {
      // Before the built-in `page` exists (auto fixtures are set up first), so the
      // first document already carries the Masker and the collectors.
      await instrumentContext(context, {
        member: legacyMemberLabel(storageState),
        appOrigin: baseURL ?? appServerUrl('main'),
        ledger: legacyLedger(testInfo),
      });
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
      const options = args[0] ?? {};
      const testInfo = currentTestInfo();
      const member = legacyMemberLabel(options.storageState);
      const viewport = options.viewport === undefined ? testInfo?.project.use.viewport : options.viewport;
      const context = await original({
        ...options,
        ...(options.recordVideo || !testInfo
          ? {}
          : {
              recordVideo: {
                dir: testInfo.outputPath('videos', member),
                size: videoSize(viewport ?? null),
              },
            }),
      });
      await instrumentContext(context, {
        member,
        appOrigin: options.baseURL ?? testInfo?.project.use.baseURL ?? appServerUrl('main'),
        ...(testInfo ? { ledger: legacyLedger(testInfo) } : {}),
      });
      return context;
    };

    type Patchable = Browser & { [ORIGINAL_NEW_CONTEXT]?: Browser['newContext'] };
    (browser as Patchable)[ORIGINAL_NEW_CONTEXT] = original;
    (browser as Browser & { newContext: typeof patched }).newContext = patched;
    await runTest(browser);
    (browser as Browser & { newContext: typeof original }).newContext = original;
    delete (browser as Patchable)[ORIGINAL_NEW_CONTEXT];
  },

  members: async ({ browser }, runTest, testInfo) => {
    const opened: MemberSet[] = [];
    await runTest({
      async open(declared, options) {
        const set = await openMembers(browser, declared, { ...options, testInfo });
        opened.push(set);
        return set;
      },
    });
    // Whether the test passed or failed (Req 29.2). `close()` is idempotent, so a
    // Pathway that closed its members itself to attach the videos is unaffected.
    for (const set of opened) await set.close();
  },
});

export { expect } from '@playwright/test';
