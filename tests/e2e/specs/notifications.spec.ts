// tests/e2e/specs/notifications.spec.ts
//
// IN-APP NOTIFICATIONS, LIVE BELL COUNT & MARK ALL READ (Task 14.2, Req 19.1–19.2).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { insertRow, selectRows } from '../support/db';
import { BOB } from '../support/users';

pathway(
  {
    id: 'notifications.bell-and-mark-all-read',
    title: 'Bell count reflects unread notifications and Mark all read persists across reload',
    area: 'notifications',
    kind: 'happy',
    provider: 'stripe',
    members: { member: BOB },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.arrange('Seed unread notification for Bob', () =>
      insertRow('notifications', {
        user_id: BOB.id,
        type: 'SYSTEM',
        title: '[E2E] Audit notification',
        body: 'Unread check',
        read_at: null,
      }),
    );

    await ctx.step('Open /notifications and mark all read', 'member', async (page) => {
      await page.goto('/notifications');
      await expect(page.getByText('[E2E] Audit notification').first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: /Mark all read/i }).click();
    });

    await ctx.assertState('Unread notification count is 0 in DB and after reload', {
      member: 'member',
      db: async () => {
        const unread = await selectRows<{ id: string }>(
          'notifications',
          `select=id&user_id=eq.${BOB.id}&read_at=is.null`,
        );
        return unread.length;
      },
      ui: async (page) => {
        await page.reload();
        const btn = page.getByRole('button', { name: /Mark all read/i });
        return (await btn.isDisabled().catch(() => true)) ? 0 : 1;
      },
      expect: 0,
    });
  },
);

pathway(
  {
    id: 'notifications.guest-redirected',
    title: 'Guest navigating to /notifications is refused and redirected to sign-in',
    area: 'notifications',
    kind: 'refusal',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Guest visits /notifications',
      'visitor',
      async (page) => {
        await page.goto('/notifications');
        await expect(page).toHaveURL(/\/sign-in\?redirectTo=%2Fnotifications/, { timeout: 15_000 });
        return { code: 'UNAUTHENTICATED' };
      },
      { code: 'UNAUTHENTICATED' },
    );
  },
);
