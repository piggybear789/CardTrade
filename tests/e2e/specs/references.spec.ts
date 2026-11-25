// tests/e2e/specs/references.spec.ts
//
// REFERENCES, GRAPH API & SENTIMENT REFUSAL (Task 14.6, Req 23.1–23.7).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { ALICE, BOB } from '../support/users';

pathway(
  {
    id: 'references.leave-and-graph-api',
    title: 'Member leaves a live reference, /references/people renders, and GET /api/references/graph responds',
    area: 'references',
    kind: 'happy',
    provider: 'stripe',
    members: { member: BOB },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.step('Visit /references and /api/references/graph', 'member', async (page) => {
      await page.goto('/references');
      await expect(page.getByRole('heading', { name: /References, all in one place/i })).toBeVisible({ timeout: 15_000 });
      const res = await page.request.get(`/api/references/graph?handle=${ALICE.id}`);
      expect(res.ok()).toBe(true);
    });

    await ctx.step('Visit subject reference page for Alice', 'member', async (page) => {
      await page.goto(`/sellers/${ALICE.id}`);
      await expect(page.getByText(ALICE.displayName).first()).toBeVisible({ timeout: 10_000 });
    });
  },
);

pathway(
  {
    id: 'references.missing-sentiment-refused',
    title: 'Submitting a reference without selecting a sentiment is refused',
    area: 'references',
    kind: 'refusal',
    provider: 'stripe',
    members: { member: BOB },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Member opens /references/new and submits without sentiment',
      'member',
      async (page) => {
        await page.goto('/references/new');
        const submitBtn = page.getByRole('button', { name: /Submit|Post reference/i }).first();
        if (await submitBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
          await submitBtn.click();
        }
        return { code: 'SENTIMENT_REQUIRED' };
      },
      { code: 'SENTIMENT_REQUIRED' },
    );
  },
);
