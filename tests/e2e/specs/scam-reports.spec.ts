// tests/e2e/specs/scam-reports.spec.ts
//
// OFF-PLATFORM SCAM REPORTS & CORROBORATION (Task 14.4, Req 21.1–21.5).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { selectRows } from '../support/db';
import { ALICE, FRANK_ADMIN, persona } from '../support/users';
import { TEST_IMAGE } from '../support/listings';

pathway(
  {
    id: 'scam-reports.submit-and-staff-cluster',
    title: 'Verified member submits off-platform scam report and staff views cluster',
    area: 'scam-reports',
    kind: 'happy',
    provider: 'stripe',
    members: {
      reporter: persona('scam-reporter', { regionCode: 'AU', identityVerified: true }),
      staff: FRANK_ADMIN,
    },
    viewports: 'both',
  },
  async (ctx) => {
    const handle = `scammer_${Date.now()}`;
    const startedAt = new Date().toISOString();

    await ctx.step('Verified member submits /report-scam', 'reporter', async (page) => {
      await page.goto('/report-scam');
      await page.waitForLoadState('domcontentloaded');
      const story = `Off-platform PayID scam by ${handle} who took payment and blocked me after promising express post.`;
      const storyBox = page.getByRole('textbox', { name: /Story|What happened/i }).first();
      await expect(async () => {
        await storyBox.fill('');
        await storyBox.fill(story);
        await expect(page.getByText(`${story.length} / 4,000`)).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      await page.getByLabel(/Roughly when/i).fill('2026-10');
      await page.getByText('PayID', { exact: true }).click();
      await page.getByRole('textbox', { name: 'Detail 1' }).fill(`${handle}@example.com`);
      await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE);
      await expect(page.getByRole('button', { name: 'Remove screenshot 1' })).toBeVisible({ timeout: 20_000 });
      await page.getByRole('checkbox').first().check();
      const sendBtn = page.getByRole('button', { name: 'Send report' });
      await expect(sendBtn).toBeEnabled({ timeout: 20_000 });
      await sendBtn.click();
      await expect(page.getByText('Report sent.').first()).toBeVisible({ timeout: 20_000 });
    });

    await ctx.assertState('Report stored with hashed fingerprint and visible on /admin?tab=scams', {
      member: 'staff',
      db: async () => {
        const rows = await selectRows<{ id: string }>('scam_reports', `select=id&created_at=gte.${encodeURIComponent(startedAt)}&order=created_at.desc&limit=1`);
        return rows.length > 0;
      },
      ui: async (page) => {
        await page.goto('/admin?tab=scams');
        return /tab=scams/.test(page.url());
      },
      expect: true,
    });
  },
);

pathway(
  {
    id: 'scam-reports.unverified-member-refused',
    title: 'Unverified member cannot submit an off-platform scam report',
    area: 'scam-reports',
    kind: 'refusal',
    provider: 'stripe',
    members: {
      unverified: persona('scam-unverified', { regionCode: 'AU', identityVerified: false }),
    },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Unverified member opening /report-scam is blocked by Identity_Gate',
      'unverified',
      async (page) => {
        await page.goto('/report-scam');
        await expect(page.getByText(/Verify your (ID|identity)/i).first()).toBeVisible({ timeout: 15_000 });
        return { code: 'IDENTITY_REQUIRED' };
      },
      { code: 'IDENTITY_REQUIRED' },
    );
  },
);
