// tests/e2e/debug/inbox-pane-seam.spec.ts
//
// The two panes of `/messages/[id]` each carry a top bar, and their bottom borders are
// supposed to form one line across the seam. Reported as an offset. `InboxTwoPane`
// derives its 56px from "the thread's 36px avatar plus py-2.5", so this measures what
// the thread's bar ACTUALLY is — its content is a two-line text block, not the avatar.

import { devices } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { createListing, itemIdFromUrl } from '../support/listings';
import { marked } from '../support/marker';
import { messageSellerFromListing } from '../support/messageSeller';

test('inbox pane seam probe', async ({ browser }) => {
  test.setTimeout(9 * 60_000);
  await ensureFreshSessions(browser, [ALICE, BOB]);

  const aliceContext = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const alicePage = await aliceContext.newPage();
  const itemId = itemIdFromUrl(
    await createListing(alicePage, { title: marked(`seam probe ${Date.now()}`) }),
  );
  await aliceContext.close();

  const wide = await browser.newContext({
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    storageState: storageStatePath(BOB),
  });
  const page = await wide.newPage();
  const threadPath = await messageSellerFromListing(
    page,
    itemId,
    marked(`seam probe body ${Date.now()}`),
  );
  await page.goto(threadPath);
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible({
    timeout: 30_000,
  });

  const measured = await page.evaluate(() => {
    const listBar = document
      .querySelector('aside[aria-label="Conversations"]')
      ?.firstElementChild as HTMLElement | null;
    const threadBar = document.querySelector(
      'section[aria-label="Conversation"] > header',
    ) as HTMLElement | null;
    const box = (element: HTMLElement | null) =>
      element
        ? {
            height: Math.round(element.getBoundingClientRect().height * 100) / 100,
            top: Math.round(element.getBoundingClientRect().top * 100) / 100,
            bottom: Math.round(element.getBoundingClientRect().bottom * 100) / 100,
            padding: getComputedStyle(element).paddingTop,
            minHeight: getComputedStyle(element).minHeight,
          }
        : null;
    const inner = threadBar
      ? Array.from(threadBar.children).map((child) => ({
          tag: child.tagName.toLowerCase(),
          height: Math.round(child.getBoundingClientRect().height * 100) / 100,
          text: (child.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        }))
      : [];
    return { listBar: box(listBar), threadBar: box(threadBar), inner };
  });
  console.log('PROBE seam', JSON.stringify(measured, null, 2));

  await wide.close();
});
