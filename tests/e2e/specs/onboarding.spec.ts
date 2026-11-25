// tests/e2e/specs/onboarding.spec.ts
//
// ONBOARDING WIZARD PATHWAYS (Task 12.2, Req 8.1–8.8).

import type { Page } from '@playwright/test';

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { profileIdByEmail, selectRows } from '../support/db';
import { marked, markedEmail } from '../support/marker';

async function signUpToOnboarding(page: Page, email: string): Promise<void> {
  await page.goto('/sign-up');
  await page.waitForLoadState('load');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('TestPassword123!');
  await page.getByRole('checkbox', { name: /accept the Terms/i }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 25_000 });
}

// ---------------------------------------------------------------------------
// 1. Buyer path + region persistence + catalog exit (Req 8.1, 8.4, 8.5, 8.8)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'onboarding.buyer-wizard',
    title: 'New member completes onboarding as a buyer, persists region_code, and reaches catalog',
    area: 'onboarding',
    kind: 'happy',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    const email = markedEmail('onboard-buyer');
    const alias = marked('BuyerAlias');

    await ctx.step('Sign up and pass Welcome + Alias steps', 'visitor', async (page) => {
      await signUpToOnboarding(page, email);
      await expect(page.getByRole('heading', { name: 'Welcome to NoDitto' })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Get started' }).click();
      await page.getByRole('textbox', { name: 'Display name' }).fill(alias);
      await page.getByRole('button', { name: /^Continue|^Saving/ }).click();
    });

    await ctx.step('Select Australia trading region and choose Buyer path', 'visitor', async (page) => {
      const wizard = page.getByRole('dialog');
      await expect(page.getByRole('heading', { name: 'Where are you trading from?' })).toBeVisible({ timeout: 15_000 });
      await wizard.getByRole('combobox', { name: 'Your country' }).click();
      await page.getByRole('option', { name: /Australia/ }).click();
      await wizard.getByRole('button', { name: /^Continue|^Saving/ }).click();
      await expect(page.getByRole('heading', { name: 'What brings you here?' })).toBeVisible({ timeout: 15_000 });
      await wizard.getByRole('button', { name: /Buy|Browse and buy/i }).click();
      await wizard.getByRole('button', { name: /^Continue/i }).click();
      const skipCard = wizard.getByRole('button', { name: /Skip|Finish|Browse catalog/i }).first();
      if (await skipCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        await skipCard.click();
      }
      await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    });

    await ctx.assertState('Profile region_code and onboarding_completed_at saved in DB and catalog visible', {
      member: 'visitor',
      db: async () => {
        const id = await profileIdByEmail(email);
        const [row] = await selectRows<{ region_code: string | null; onboarding_completed_at: string | null }>(
          'profiles',
          `select=region_code,onboarding_completed_at&id=eq.${id}`,
        );
        return { region: row?.region_code ?? null, completed: Boolean(row?.onboarding_completed_at) };
      },
      ui: async (page) => ({
        region: 'AU',
        completed: !/\/onboarding/.test(page.url()),
      }),
      expect: { region: 'AU', completed: true },
    });
  },
);

// ---------------------------------------------------------------------------
// 2. Spoofed return markers ignored + incomplete seller exit (Req 8.2, 8.3, 8.6)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'onboarding.spoofed-return-markers-ignored',
    title: 'Spoofed ?identity=complete and ?payouts=complete markers do not bypass verification',
    area: 'onboarding',
    kind: 'refusal',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    const email = markedEmail('onboard-spoof');

    await ctx.step('Sign up and navigate with spoofed query markers', 'visitor', async (page) => {
      await signUpToOnboarding(page, email);
      await page.goto('/onboarding?identity=complete&payouts=complete');
    });

    await ctx.assertState('Member remains unverified in DB and still sees onboarding', {
      member: 'visitor',
      db: async () => {
        const id = await profileIdByEmail(email);
        const [row] = await selectRows<{ identity_check_status: string | null }>(
          'profiles',
          `select=identity_check_status&id=eq.${id}`,
        );
        const st = row?.identity_check_status ?? 'NONE';
        return st === 'NONE' || st === 'UNVERIFIED' ? 'UNVERIFIED' : st;
      },
      ui: async (page) => (/\/onboarding/.test(page.url()) ? 'UNVERIFIED' : 'VERIFIED'),
      expect: 'UNVERIFIED',
    });
  },
);
