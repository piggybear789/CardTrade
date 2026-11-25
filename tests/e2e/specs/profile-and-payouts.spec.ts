// tests/e2e/specs/profile-and-payouts.spec.ts
//
// PROFILE, VERIFICATION & PAYOUTS PATHWAYS (Task 12.3, Req 24.1–24.4).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { selectRows } from '../support/db';
import { ALICE, DAVE, persona } from '../support/users';

// ---------------------------------------------------------------------------
// 1. Profile tabs & live edits (Req 24.1)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'profile-payouts.tabs-and-live-edit',
    title: 'Profile shows all three tabs and persists live display name edits',
    area: 'profile-payouts',
    kind: 'happy',
    provider: 'stripe',
    members: { member: DAVE },
    viewports: 'both',
  },
  async (ctx) => {
    const originalName = DAVE.displayName;
    const tempName = `${originalName} Edited`;

    try {
      await ctx.step('Open Profile tab and verify tabs', 'member', async (page) => {
        await page.goto('/profile');
        const tabs = page.getByRole('navigation', { name: 'Account sections' });
        for (const label of ['Profile', 'Verification', 'Payouts']) {
          await expect(tabs.getByRole('link', { name: label })).toBeVisible({ timeout: 10_000 });
        }
      });

      await ctx.step('Edit display name and save', 'member', async (page) => {
        await page.getByRole('button', { name: /Name and email/i }).click();
        const input = page.getByLabel(/Display name/i);
        await input.fill(tempName);
        await page.getByRole('button', { name: /Save/i }).click();
      });

      await ctx.assertState('Updated display name appears in DB and UI', {
        member: 'member',
        db: async () => {
          const [row] = await selectRows<{ display_name: string }>(
            'profiles',
            `select=display_name&id=eq.${DAVE.id}`,
          );
          return row.display_name;
        },
        ui: async (page) => {
          await page.reload();
          return (await page.getByRole('heading', { name: tempName }).first().textContent())?.trim() ?? '';
        },
        expect: tempName,
      });
    } finally {
      await ctx.arrange('Restore Dave display name', async () => {
        const page = await ctx.page('member');
        await page.goto('/profile');
        await page.getByRole('button', { name: /Name and email/i }).click();
        await page.getByLabel(/Display name/i).fill(originalName);
        await page.getByRole('button', { name: /Save/i }).click();
      });
    }
  },
);

// ---------------------------------------------------------------------------
// 2. Verification & Payouts tabs + redirect (Req 24.3, 24.4)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'profile-payouts.payouts-dashboard-and-redirect',
    title: '/profile/payouts redirects to ?tab=payouts and shows payout summary',
    area: 'profile-payouts',
    kind: 'happy',
    provider: 'stripe',
    members: { seller: ALICE },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.step('Visit /profile/payouts and verify redirect', 'seller', async (page) => {
      await page.goto('/profile/payouts');
      await expect(page).toHaveURL(/\/profile\?tab=payouts/, { timeout: 15_000 });
      await expect(page.getByRole('heading', { name: 'Where your money goes' })).toBeVisible({ timeout: 10_000 });
    });

    await ctx.step('Visit Verification tab', 'seller', async (page) => {
      await page.goto('/profile?tab=verification');
      await expect(page.getByText(/You're set up|Identity/i).first()).toBeVisible({ timeout: 10_000 });
    });
  },
);

// ---------------------------------------------------------------------------
// 3. Verified but not yet payable (Req 24.4)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'profile-payouts.verified-not-payable-refusal',
    title: 'Verified member without payout account sees payout setup prompt rather than active payouts',
    area: 'profile-payouts',
    kind: 'refusal',
    provider: 'stripe',
    members: {
      seller: persona('verified-no-payout', { regionCode: 'AU', identityVerified: true }),
    },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Verified member without Connect account checks Verification tab',
      'seller',
      async (page) => {
        await page.goto('/profile?tab=verification');
        const setupPrompt = page.getByText(/Add payout details|Continue with Stripe/i).first();
        await expect(setupPrompt).toBeVisible({ timeout: 10_000 });
        return { code: 'SELLER_NOT_PAYABLE' };
      },
      { code: 'SELLER_NOT_PAYABLE' },
    );
  },
);
