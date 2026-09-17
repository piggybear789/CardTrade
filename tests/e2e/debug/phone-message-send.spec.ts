// tests/e2e/debug/phone-message-send.spec.ts
//
// The phone journey sent a first message from a listing, saw it in the thread, and
// then found the INBOX row for that same conversation reading "No messages yet".
// Either the send never persisted (and the bubble was the optimistic one), or the
// inbox preview cannot see a message that exists.
//
// This separates the two: send, then RELOAD the thread — an optimistic bubble does
// not survive a reload — and only then look at the inbox.

import { devices } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import { createListing, itemIdFromUrl } from '../support/listings';
import { marked } from '../support/marker';

test('phone first-message persistence probe', async ({ browser }) => {
  test.setTimeout(9 * 60_000);
  await ensureFreshSessions(browser, [ALICE, BOB]);

  const aliceContext = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const alicePage = await aliceContext.newPage();
  const itemId = itemIdFromUrl(
    await createListing(alicePage, { title: marked(`phone msg probe ${Date.now()}`) }),
  );
  await aliceContext.close();

  const phone = await browser.newContext({
    ...devices['iPhone 14'],
    storageState: storageStatePath(BOB),
  });
  const page = await phone.newPage();
  const notes: string[] = [];
  page.on('pageerror', (error) => notes.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') notes.push(`console: ${message.text()}`);
  });

  const body = marked(`phone probe body ${Date.now()}`);
  await page.goto(`/listings/${itemId}`);
  await page.waitForLoadState('domcontentloaded');

  const open = page.getByRole('button', { name: 'Message seller' }).first();
  await expect(open).toBeEnabled({ timeout: 30_000 });
  await open.click();
  await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}/, { timeout: 40_000 });
  const threadPath = new URL(page.url()).pathname;

  const composer = page.getByPlaceholder(/Write a message/i);
  await expect(composer).toBeEnabled({ timeout: 20_000 });
  await composer.fill(body);
  await page.getByRole('button', { name: /^Send message$/ }).click();

  const bubble = page.getByLabel(/^Conversation with/).getByText(body);
  const appeared = await bubble
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  console.log('PROBE bubble after send =', appeared);

  const toast = await page
    .locator('[data-sonner-toast]')
    .first()
    .textContent({ timeout: 4_000 })
    .catch(() => '(no toast)');
  console.log('PROBE toast', JSON.stringify(toast));

  await page.waitForTimeout(3_000);
  await page.goto(threadPath);
  await page.waitForLoadState('domcontentloaded');
  const survived = await page
    .getByLabel(/^Conversation with/)
    .getByText(body)
    .count();
  console.log('PROBE bubble after reload =', survived > 0);

  await page.goto('/messages');
  await page.waitForLoadState('domcontentloaded');
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href^="/messages/"]')).map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    ),
  );
  console.log('PROBE inbox rows', JSON.stringify(rows, null, 2));
  console.log('PROBE notes', JSON.stringify(notes, null, 2));

  await phone.close();
});
