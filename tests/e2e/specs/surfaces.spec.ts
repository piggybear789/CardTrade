// tests/e2e/specs/surfaces.spec.ts
//
// READ-ONLY SURFACE AUDIT ACROSS PUBLIC & MEMBER ROUTES (Task 15.5, Req 29.1, 29.4, 30.1–30.6).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { ALICE } from '../support/users';

pathway(
  {
    id: 'surfaces.public-and-member-routes-ux',
    title: 'Core public and member surfaces pass CLS, overflow, skeleton, motion, axe, and copy checks',
    area: 'surfaces',
    kind: 'happy',
    provider: 'stripe',
    members: { member: ALICE },
    viewports: 'both',
    timeout: 180_000,
  },
  async (ctx) => {
    for (const route of ['/', '/profile', '/listings/mine', '/trades', '/sales', '/messages', '/notifications', '/deals']) {
      await ctx.step(`Audit surface ${route}`, 'member', async (page) => {
        await page.goto(route);
        await expect(page.getByRole('main').first()).toBeVisible({ timeout: 20_000 });
        await page
          .waitForFunction(
            () => document.querySelector('[aria-label*="account menu"]') !== null,
            null,
            { timeout: 10_000 },
          )
          .catch(() => {});
      });
    }
  },
);

pathway(
  {
    id: 'surfaces.guest-restricted-surface-redirects',
    title: 'Restricted surface /listings/mine redirects guest cleanly without layout shift or errors',
    area: 'surfaces',
    kind: 'refusal',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Guest visiting /listings/mine is redirected to /sign-in',
      'visitor',
      async (page) => {
        await page.goto('/listings/mine');
        await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 });
        return { code: 'UNAUTHENTICATED' };
      },
      { code: 'UNAUTHENTICATED' },
    );
  },
);
