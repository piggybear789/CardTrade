// tests/e2e/specs/marketing-errors.spec.ts
//
// MARKETING/POLICY PAGES, NOT-FOUND & ERROR REPORTING (Task 15.3, Req 27.1–27.4).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';

pathway(
  {
    id: 'marketing-errors.public-pages-and-not-found',
    title: 'Help, terms, privacy, and safety pages render with headings and not-found handles unknown routes',
    area: 'marketing-errors',
    kind: 'happy',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    for (const route of ['/help', '/terms', '/privacy', '/safety']) {
      await ctx.step(`Visit ${route}`, 'visitor', async (page) => {
        await page.goto(route);
        await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15_000 });
      });
    }

    await ctx.step('Visit non-existent route for not-found page', 'visitor', async (page) => {
      await page.goto('/this-route-does-not-exist-e2e');
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 10_000 });
    });
  },
);

pathway(
  {
    id: 'marketing-errors.api-errors-anonymous-no-origin-refused',
    title: 'POST /api/errors from an anonymous caller without Origin is refused',
    area: 'marketing-errors',
    kind: 'refusal',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: { only: 'desktop', reason: 'API route origin check is viewport-independent' },
  },
  async (ctx) => {
    await ctx.refusal(
      'Anonymous POST /api/errors without Origin returns 403',
      'visitor',
      async (page) => {
        const res = await page.request.post('/api/errors', {
          data: { message: 'probe error' },
        });
        expect(res.status()).toBe(403);
        return { code: 'ORIGIN_REQUIRED' };
      },
      { code: 'ORIGIN_REQUIRED' },
    );
  },
);
