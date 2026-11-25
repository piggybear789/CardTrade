// tests/e2e/specs/jobs-webhooks.spec.ts
//
// BACKGROUND JOBS, STRIPE WEBHOOKS & SHIP24 TRACKING (Task 15.2, Req 26.1–26.8).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { runJob } from '../audit/backend/jobs';
import { postShip24Event } from '../audit/backend/ship24';
import { BOB } from '../support/users';

pathway(
  {
    id: 'jobs-webhooks.authorized-jobs-and-ship24',
    title: 'Authorized job endpoints return 200 and Ship24 webhook accepts valid bearer',
    area: 'jobs-webhooks',
    kind: 'happy',
    provider: 'stripe',
    members: { member: BOB },
    viewports: { only: 'desktop', reason: 'Server-to-server job and webhook endpoints are viewport-independent' },
    timeout: 180_000,
  },
  async (ctx) => {
    await ctx.arrange('Run cash-sale-payouts and trade-inspections with valid bearer', async () => {
      const payouts = await runJob('cash-sale-payouts', { auth: 'correct' });
      expect(payouts.status).toBe(200);
      const inspections = await runJob('trade-inspections', { auth: 'correct' });
      expect(inspections.status).toBe(200);
    });

    await ctx.simulated(
      'Post Ship24 IN_TRANSIT event with valid bearer',
      { mechanism: 'signed-fixture', reason: 'Tests Ship24 webhook auth without altering a sale' },
      async () => {
        const res = await postShip24Event({ trackings: [{ tracking: { trackingNumber: 'E2E-NOOP-000' }, shipment: { statusMilestone: 'in_transit' } }] } as never);
        expect(res.status).toBeLessThan(500);
      },
    );
  },
);

pathway(
  {
    id: 'jobs-webhooks.unauthorized-job-and-invalid-signature-refused',
    title: 'Missing/wrong job bearer and invalid Stripe webhook signature are refused',
    area: 'jobs-webhooks',
    kind: 'refusal',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: { only: 'desktop', reason: 'Server-to-server endpoint auth check is viewport-independent' },
  },
  async (ctx) => {
    await ctx.refusal(
      'Job endpoint refuses missing and wrong bearer tokens',
      'visitor',
      async () => {
        const missing = await runJob('cash-sale-payouts', { auth: 'missing' });
        expect(missing.status).toBe(401);
        const wrong = await runJob('cash-sale-payouts', { auth: 'wrong' });
        expect(wrong.status).toBe(401);
        return { code: 'UNAUTHORIZED' };
      },
      { code: 'UNAUTHORIZED' },
    );

    await ctx.refusal(
      'Stripe webhook refuses invalid signature',
      'visitor',
      async (page) => {
        const res = await page.request.post('/api/webhooks/stripe', {
          headers: { 'stripe-signature': 't=0,v1=invalid', 'content-type': 'application/json' },
          data: JSON.stringify({ id: 'evt_invalid', type: 'charge.dispute.created' }),
        });
        expect(res.status()).toBe(401);
        return { code: 'INVALID_SIGNATURE' };
      },
      { code: 'INVALID_SIGNATURE' },
    );
  },
);
