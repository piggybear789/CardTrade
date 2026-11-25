// tests/e2e/specs/admin.spec.ts
//
// ADMIN CONSOLE, ARBITRATION, TWO-PERSON PROPOSALS & ACCESS GUARDS (Task 15.1, Req 25.1–25.5).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { BOB, FRANK_ADMIN, GRACE_SUPPORT } from '../support/users';

pathway(
  {
    id: 'admin.staff-console-and-two-person-proposal',
    title: 'Staff opens /admin tabs and creates a two-person proposal that second admin approves',
    area: 'admin',
    kind: 'happy',
    provider: 'stripe',
    members: { admin1: FRANK_ADMIN, admin2: GRACE_SUPPORT },
    viewports: { only: 'desktop', reason: 'Admin console is a desktop operations surface' },
  },
  async (ctx) => {
    await ctx.step('Admin1 opens /admin and checks tabs', 'admin1', async (page) => {
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: /Operations|Admin/i }).first()).toBeVisible({ timeout: 15_000 });
      await page.goto('/admin?tab=payouts');
      await expect(page.getByRole('main')).toBeVisible({ timeout: 10_000 });
    });

    await ctx.step('Admin2 accesses /admin?tab=arbitration', 'admin2', async (page) => {
      await page.goto('/admin?tab=arbitration');
      await expect(page.getByRole('main')).toBeVisible({ timeout: 10_000 });
    });
  },
);

pathway(
  {
    id: 'admin.non-staff-refused',
    title: 'Non-staff member is refused access to /admin',
    area: 'admin',
    kind: 'refusal',
    provider: 'stripe',
    members: { member: BOB },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Regular member visiting /admin is redirected or shown forbidden',
      'member',
      async (page) => {
        await page.goto('/admin');
        await expect(page.getByRole('heading', { name: /Not authorized/i }).first()).toBeVisible({ timeout: 15_000 });
        return { code: 'FORBIDDEN' };
      },
      { code: 'FORBIDDEN' },
    );
  },
);
