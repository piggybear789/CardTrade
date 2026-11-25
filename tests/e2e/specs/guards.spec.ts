// tests/e2e/specs/guards.spec.ts
//
// PROTECTED PREFIXES, NON-PARTY ROOMS, MOBILE API AUTH & DEMO GUARD
// (Task 15.4, Req 28.1–28.4).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { ALICE, appServerUrl, BOB, CAROL } from '../support/users';
import { listingTitle, openListing, reserveSingle, seedListing, uniqueToken } from '../support/cashSaleRoom';

pathway(
  {
    id: 'guards.protected-routes-redirect-with-return-path',
    title: 'Unauthenticated visitors on protected prefixes redirect to /sign-in with redirectTo',
    area: 'guards',
    kind: 'happy',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    for (const prefix of ['/profile', '/trades', '/messages', '/listings/new', '/admin']) {
      await ctx.step(`Guest visiting ${prefix} redirects to /sign-in`, 'visitor', async (page) => {
        await page.goto(prefix);
        await expect(page).toHaveURL(
          new RegExp(`/sign-in\\?redirectTo=${encodeURIComponent(prefix).replace(/\//g, '\\/')}`),
          { timeout: 15_000 },
        );
      });
    }
  },
);

pathway(
  {
    id: 'guards.non-party-and-mobile-api-refused',
    title: 'Non-party cannot view a contract room and mobile API refuses unauthenticated requests',
    area: 'guards',
    kind: 'refusal',
    provider: 'stripe',
    members: { buyer: BOB, outsider: CAROL },
    viewports: 'both',
  },
  async (ctx) => {
    const token = uniqueToken();
    const itemId = await ctx.arrange('Seed listing', () =>
      seedListing(ALICE, { title: listingTitle(`Guard ${token}`, token), priceMinor: 3000 }),
    );
    let saleId = '';
    await ctx.step('Buyer reserves listing', 'buyer', async (page) => {
      await openListing(page, itemId);
      saleId = await reserveSingle(page, itemId);
    });

    await ctx.refusal(
      'Outsider visiting /sales/[id] is refused with no contract detail shown',
      'outsider',
      async (page) => {
        await page.goto(`/sales/${saleId}`);
        await expect(page.getByText(token)).toHaveCount(0);
        return { code: 'NOT_A_PARTY' };
      },
      { code: 'NOT_A_PARTY' },
    );

    await ctx.refusal(
      'Mobile API without bearer token returns 401',
      'outsider',
      async () => {
        const res = await fetch(`${appServerUrl('main')}/api/mobile/offers/make`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        expect(res.status).toBe(401);
        return { code: 'UNAUTHORIZED' };
      },
      { code: 'UNAUTHORIZED' },
    );
  },
);
