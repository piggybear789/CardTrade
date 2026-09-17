// tests/e2e/debug/watchlist-save.spec.ts
//
// The journey found that saving a listing flips the heart and does not persist: the
// row is absent from `/saved`, and a reload of the listing shows it unsaved again.
// Grants and RLS on `cardtrade.watchlist` check out (column INSERT on
// `(user_id, item_id)` for `authenticated`, `watchlist_owner_all` with a matching
// `with check`), so this watches the actual attempt: the toast the component shows
// on failure, the request, and the state after a reload.

import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { createListing, itemIdFromUrl } from '../support/listings';
import { marked } from '../support/marker';

test('watchlist save probe', async ({ browser }) => {
  test.setTimeout(8 * 60_000);
  await ensureFreshSessions(browser, [ALICE, BOB]);

  const aliceContext = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const alicePage = await aliceContext.newPage();
  const itemId = itemIdFromUrl(
    await createListing(alicePage, { title: marked(`watch probe ${Date.now()}`) }),
  );
  await aliceContext.close();

  const bobContext = await browser.newContext({ storageState: storageStatePath(BOB) });
  const page = await bobContext.newPage();

  const notes: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      notes.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => notes.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) =>
    notes.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText}`),
  );
  page.on('response', async (response) => {
    if (response.request().method() === 'POST' && response.status() >= 400) {
      notes.push(`POST ${response.status()} ${response.url()}`);
    }
  });

  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');

  const save = page
    .getByRole('button', { name: /^Save item$/ })
    .filter({ visible: true })
    .first();
  await expect(save).toBeVisible({ timeout: 30_000 });
  await save.click();

  // Whatever the component decided to tell the member.
  const toast = page.locator('[data-sonner-toast]');
  const toastText = await toast
    .first()
    .textContent({ timeout: 8_000 })
    .catch(() => '(no toast)');
  console.log('PROBE toast', JSON.stringify(toastText));

  await page.waitForTimeout(3_000);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  const stillSaved = await page
    .getByRole('button', { name: /^Remove from saved items$/ })
    .filter({ visible: true })
    .count();
  console.log('PROBE saved after reload =', stillSaved > 0);
  console.log('PROBE notes', JSON.stringify(notes, null, 2));

  await bobContext.close();
});
