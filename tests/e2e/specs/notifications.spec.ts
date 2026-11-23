// tests/e2e/specs/notifications.spec.ts
//
// The notification centre: it loads, it reflects an event that just happened,
// and "Mark all read" clears the unread state.
//
// THREE THINGS THE INSPECTOR SETTLED:
//
//   1. `MarketplaceShell` renders its title as an <h1> TWICE — once `sr-only
//      lg:hidden` for the document outline below `lg`, once inside the desktop
//      rail. So even a page whose h1 and h2 differ (here "Notifications" and
//      "Activity") still needs `.first()` on the h1. Every page title in this app
//      is a duplicate; there is no exception to check for.
//   2. A notification is a <button>, not a list item, and its accessible name
//      concatenates type, relative time and body, so a specific one is found by
//      its body text.
//   3. THE BELL EXISTS TWICE: once in the desktop header and once in
//      MobileBottomNav. Below `lg` the header one hides and vice versa, but both
//      stay in the DOM, so `toHaveCount(0)` against an unread-bell pattern fails
//      on the hidden twin even when the visible bell is correct. Assert on the
//      VISIBLE bell, or on a control that only renders while something is unread.
//
// A MESSAGE RAISES NO NOTIFICATION (0176): the inbox counts it, and a bell row as
// well was the same message counted twice. The delivery test therefore arranges a
// SYSTEM row directly with the service role, marked so it can be found and
// removed, and a second test pins that a sent message leaves the bell alone. That
// message is MARKED so teardown can find it — both members are seeded, so the
// marked-profile walk never reaches these rows. See messages.spec.ts.

import { test, expect } from '../support/fixtures';
import { ALICE, BOB, storageStatePath } from '../support/users';
import { marked } from '../support/marker';
import { ensureFreshSessions } from '../support/auth';
import { messageSellerComposer } from '../support/messageSeller';
import { deleteRows, insertRow, selectRows } from '../support/db';

// Repair any stored cookie jar this file relies on before its first test.
// Refresh-token rotation retires the token a jar holds as soon as another context
// uses it, so a shared snapshot goes stale on its own during a long run. See
// tests/e2e/support/auth.ts for the full reasoning.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, BOB]);
});

const ALICE_LISTING = 'aaaaaaa1-0000-0000-0000-000000000001';

/** Cold-compile budget for a route this run has not visited yet (see F5). */
const COLD_ROUTE = 30_000;

test.describe('Notification centre', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test('loads', async ({ page }) => {
    await page.goto('/notifications');
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: 'Notifications' }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
  });
});

test.describe('Notification delivery', () => {
  test('a new notification shows, and marking read clears it', async ({ browser }) => {
    const body = marked(`notify ${Date.now()}`);
    const row = await insertRow<{ id: string }>('notifications', {
      user_id: ALICE.id,
      type: 'SYSTEM',
      title: 'E2E notice',
      body,
    });

    try {
      const aliceContext = await browser.newContext({
        storageState: storageStatePath(ALICE),
      });
      const alicePage = await aliceContext.newPage();
      await alicePage.goto('/notifications');
      await alicePage.waitForLoadState('domcontentloaded');

      await expect(
        alicePage.getByRole('button').filter({ hasText: body }).first(),
      ).toBeVisible({ timeout: 20_000 });

      // Something is unread, so the bulk action is live. `Mark all read` is always
      // RENDERED — it carries `disabled={isPending || unreadCount === 0}` — so its
      // enablement, not its presence, is the unread signal.
      const markAll = alicePage.getByRole('button', { name: 'Mark all read' });
      await expect(markAll).toBeEnabled({ timeout: 15_000 });

      // The visible bell announces the count in its accessible name — that is what
      // a screen-reader user gets, so it is the thing worth asserting on.
      await expect(
        alicePage.getByRole('button', { name: /Notifications, \d+ unread/ }).first(),
      ).toBeVisible();

      await markAll.click();

      // `markAllReadLocal()` drops the count optimistically before the server action
      // resolves, which takes `unreadCount` to 0 and disables the control. Asserting
      // DISABLED rather than HIDDEN: the button never unmounts.
      await expect(markAll).toBeDisabled({ timeout: 20_000 });
      await expect(
        alicePage.getByRole('button', { name: /Notifications, \d+ unread/ }),
      ).toHaveCount(0, { timeout: 20_000 });

      // And it stays cleared across a reload, so the optimistic update was backed by
      // a persisted write rather than being local-only.
      await alicePage.reload();
      await alicePage.waitForLoadState('domcontentloaded');
      await expect(
        alicePage.getByRole('button', { name: /Notifications, \d+ unread/ }),
      ).toHaveCount(0, { timeout: 20_000 });

      await aliceContext.close();
    } finally {
      await deleteRows('notifications', `id=eq.${row.id}`);
    }
  });

  test('a message is counted by the inbox, not the bell', async ({ browser }) => {
    const body = marked(`no-bell ${Date.now()}`);

    const bobContext = await browser.newContext({ storageState: storageStatePath(BOB) });
    const bobPage = await bobContext.newPage();
    await bobPage.goto(`/listings/${ALICE_LISTING}`);
    await bobPage.waitForLoadState('domcontentloaded');
    const { input: composer, send } = messageSellerComposer(bobPage);
    await expect(composer).toBeEnabled({ timeout: 15_000 });
    await composer.click();
    await composer.fill(body);
    await send.click();
    // Landing in the thread is what proves the message was written — see F5 for
    // why a shorter wait reads as a different bug entirely.
    await expect(bobPage).toHaveURL(/\/messages\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
    await bobContext.close();

    // Notifications are inserted after the response (`after()`), so give a stray
    // insert time to land before asserting there is none.
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const rows = await selectRows<{ id: string }>(
      'notifications',
      `select=id&user_id=eq.${ALICE.id}&type=eq.MESSAGE&created_at=gte.${encodeURIComponent(
        new Date(Date.now() - 60_000).toISOString(),
      )}`,
    );
    expect(rows).toHaveLength(0);
  });
});
