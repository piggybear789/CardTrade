// tests/e2e/specs/messages.spec.ts
//
// Buyer-to-seller messaging: the composer on a listing, the inbox, and the thread.
//
// TIMING, NOT BEHAVIOUR — the correction worth recording. An earlier version of
// this file asserted that sending from a listing does NOT navigate, because a
// 4-second probe found the page still on the listing with the composer disabled.
// Both observations were real and the conclusion was wrong: `MessageSellerButton`
// awaits `getOrCreateConversation` then `sendMessage` then pushes to
// `/messages/<id>`, and `disabled={isPending}` is the PENDING state, not a
// success confirmation. What actually happened is that this suite runs `next dev`,
// which compiles `/messages/[id]` on its first request — the push was queued
// behind a cold route compile that takes longer than four seconds.
//
// Hence the generous timeouts on first-visit navigations here. They are not
// flakiness insurance; they are the cost of a dev server. Trimming them to
// "reasonable" numbers reintroduces exactly the false conclusion above.
//
// EVERY MESSAGE BODY IS MARKED. Both participants are seeded members, so nothing
// these tests create matches the marked-profile or marked-item walk in
// scripts/e2e/cleanup-test-data.ts. The marker on the body is the only thing that
// makes the rows findable; without it each run leaves a conversation and a
// notification on Alice's account permanently.

import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { ensureFreshSessions } from '../support/auth';
import { messageSellerComposer } from '../support/messageSeller';

// Repair any stored cookie jar this file relies on before its first test.
// Refresh-token rotation retires the token a jar holds as soon as another context
// uses it, so a shared snapshot goes stale on its own during a long run. See
// tests/e2e/support/auth.ts for the full reasoning.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, BOB]);
});

/** Alice's AVAILABLE Charizard. Bob is not the owner, so he is offered the composer. */
const ALICE_LISTING = 'aaaaaaa1-0000-0000-0000-000000000001';

/** Cold-compile budget for a route this run has not visited yet. */
const COLD_ROUTE = 30_000;

/**
 * Send a marked message to the seller from a listing page, and land in the thread.
 *
 * Returns the conversation URL so a caller can come back to it.
 */
async function sendFromListing(
  page: import('@playwright/test').Page,
  itemId: string,
  body: string,
): Promise<string> {
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');

  const { input: composer, send } = messageSellerComposer(page);
  await expect(composer).toBeEnabled({ timeout: 15_000 });

  // Send is gated on content: an empty message is not sendable.
  await expect(send).toBeDisabled();
  await composer.click();
  await composer.fill(body);
  await expect(send).toBeEnabled({ timeout: 5_000 });

  await send.click();

  await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  return page.url();
}

test.describe('Inbox', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('loads for an authenticated member', async ({ page }) => {
    await page.goto('/messages');
    await page.waitForLoadState('domcontentloaded');

    // h1 from the shell, h2 from SectionHeader. Unusually for this app the two
    // differ, so neither needs .first().
    await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  });
});

test.describe('Composer on a listing', () => {
  test.use({ storageState: storageStatePath(BOB) });

  test('sends and opens the conversation', async ({ page }) => {
    const body = marked(`composer ${Date.now()}`);
    await sendFromListing(page, ALICE_LISTING, body);

    // The message is the first thing in the thread it just opened.
    await expect(page.getByText(body)).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Thread', () => {
  test('the seller receives the message and can reply', async ({ browser }) => { const body = marked(`thread ${Date.now()}`);
  const reply = marked(`reply ${Date.now()}`);
  
  // Bob sends.
  const bobContext = await browser.newContext({ storageState: storageStatePath(BOB) });
  const bobPage = await bobContext.newPage();
  await sendFromListing(bobPage, ALICE_LISTING, body);
  await bobContext.close();
  
  // Alice finds it in her inbox.
  const aliceContext = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const alicePage = await aliceContext.newPage();
  await alicePage.goto('/messages');
  await alicePage.waitForLoadState('domcontentloaded');
  
  // A conversation row is a LINK whose accessible name runs the counterparty,
  // relative time, item title and preview together, so match on substring.
  const row = alicePage.getByRole('link').filter({ hasText: BOB.displayName }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  
  await expect(alicePage).toHaveURL(/\/messages\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
  await expect(alicePage.getByText(body)).toBeVisible({ timeout: 15_000 });
  
  // Alice replies. The thread composer is a distinct control from the listing
  // one and is not single-use.
  const threadComposer = alicePage.getByPlaceholder(/write a message/i);
  await expect(threadComposer).toBeEnabled({ timeout: 15_000 });
  await threadComposer.fill(reply);
  await alicePage.getByRole('button', { name: /^Send/ }).click();
  
  await expect(alicePage.getByText(reply)).toBeVisible({ timeout: 20_000 });
  await aliceContext.close(); });
});
