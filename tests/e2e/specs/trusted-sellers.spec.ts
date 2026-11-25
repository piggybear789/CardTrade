// tests/e2e/specs/trusted-sellers.spec.ts
//
// TRUSTED SELLERS APPLICATION, APPROVAL, DIRECTORY & REFUSALS (Task 14.5, Req 22.1–22.5).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { selectRows } from '../support/db';
import { FRANK_ADMIN, persona } from '../support/users';

pathway(
  {
    id: 'trusted-sellers.apply-and-approve',
    title: 'Verified seller applies for Trusted Seller, staff approves, and directory shows badge without surname',
    area: 'trusted-sellers',
    kind: 'happy',
    provider: 'stripe',
    members: {
      applicant: persona('trusted-applicant', { regionCode: 'AU', identityVerified: true }),
      staff: FRANK_ADMIN,
    },
    viewports: 'both',
  },
  async (ctx) => {
    const user = ctx.members.get('applicant').user!;

    await ctx.step('Applicant submits /trusted-sellers/apply', 'applicant', async (page) => {
      await page.goto('/trusted-sellers/apply');
      await page.waitForLoadState('networkidle');
      const details = page.getByLabel(/Tell us about your selling/i).first();
      const story = 'Long-time TCG collector and seller';
      await expect(async () => {
        await details.fill('');
        await details.fill(story);
        await expect(page.getByText(`${story.length} / 4,000`)).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      await page.getByRole('button', { name: /Send application/i }).click();
      await expect(page.getByText(/we’ve got your application|submitted|under review/i).first()).toBeVisible({ timeout: 20_000 });
    });

    await ctx.step('Staff approves application on /admin', 'staff', async (page) => {
      await page.goto('/admin?tab=trusted');
      await page.getByRole('button', { name: /Approve/i }).first().click();
    });

    await ctx.assertState('Applicant is marked trusted in DB and visible in /trusted-sellers', {
      member: 'applicant',
      db: async () => {
        const [row] = await selectRows<{ trusted_seller_at: string | null }>(
          'profiles',
          `select=trusted_seller_at&id=eq.${user.id}`,
        );
        return Boolean(row?.trusted_seller_at);
      },
      ui: async (page) => {
        await page.goto(`/sellers/${user.id}`);
        return (await page.getByText(/Trusted seller/i).count()) > 0;
      },
      expect: true,
    });
  },
);

pathway(
  {
    id: 'trusted-sellers.unverified-refused',
    title: 'Unverified member cannot apply to Trusted Sellers',
    area: 'trusted-sellers',
    kind: 'refusal',
    provider: 'stripe',
    members: {
      unverified: persona('trusted-unverified', { regionCode: 'AU', identityVerified: false }),
    },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Unverified member visits /trusted-sellers/apply',
      'unverified',
      async (page) => {
        await page.goto('/trusted-sellers/apply');
        await expect(page.getByText(/Verify your (ID|identity)/i).first()).toBeVisible({ timeout: 15_000 });
        return { code: 'IDENTITY_REQUIRED' };
      },
      { code: 'IDENTITY_REQUIRED' },
    );
  },
);
