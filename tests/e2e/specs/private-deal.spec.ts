// tests/e2e/specs/private-deal.spec.ts
//
// PRIVATE DEAL INVITES, CLAIM, EXPIRY & REFUSALS (Task 13.5, Req 17.1–17.8).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { DAY_MS, rewind } from '../audit/backend/timeTravel';
import { selectRows } from '../support/db';
import { ALICE, BOB, persona } from '../support/users';
import { TEST_IMAGE } from '../support/listings';

async function createPrivateDealInvite(page: import('@playwright/test').Page, title: string, price: string): Promise<string> {
  await page.goto('/deals');
  await page.locator('input[type="file"]').first().setInputFiles(TEST_IMAGE);
  await page.getByRole('textbox', { name: /Title|Card/i }).first().fill(title);
  await page.getByRole('textbox', { name: /What are you selling/i }).fill(`Private deal ${title}`);
  await page.getByRole('combobox', { name: 'Category' }).click();
  await page.getByRole('option', { name: 'Pokémon' }).click();
  await page.getByRole('combobox', { name: 'Condition' }).click();
  await page.getByRole('option', { name: 'Near Mint' }).click();
  await page.getByRole('button', { name: /^Next$/i }).click();
  await page.getByRole('spinbutton', { name: /Price/i }).fill(price);
  await page.getByRole('button', { name: /Get link/i }).click();
  await expect(page).toHaveURL(/\/deals\?link=/, { timeout: 25_000 });
  return new URL(page.url()).searchParams.get('link') ?? '';
}

pathway(
  {
    id: 'private-deals.create-and-claim-cash-sale',
    title: 'Host creates a CASH_SALE private deal invite and joiner claims it into a Cash_Sale room',
    area: 'private-deals',
    kind: 'happy',
    provider: 'stripe',
    members: {
      host: ALICE,
      joiner: persona('deal-joiner', { regionCode: 'AU', identityVerified: true, savedCard: true }),
    },
    viewports: 'both',
  },
  async (ctx) => {
    let token = '';

    await ctx.step('Host creates CASH_SALE seller invite on /deals', 'host', async (page) => {
      token = await createPrivateDealInvite(page, 'Private Deal Charizard', '80');
    });

    await ctx.step('Joiner opens /t/[token] and claims deal', 'joiner', async (page) => {
      await page.goto(`/t/${token}`);
      await page.getByRole('button', { name: /Claim|Buy|Join( this)? deal/i }).click();
      await expect(page).toHaveURL(/\/sales\/[0-9a-f-]+/, { timeout: 25_000 });
    });

    await ctx.assertState('Invite marked claimed in DB and room is open', {
      member: 'joiner',
      db: async () => {
        const [row] = await selectRows<{ claimed_at: string | null }>(
          'deal_invites',
          `select=claimed_at&token=eq.${token}`,
        );
        return row?.claimed_at ? 'CLAIMED' : 'OPEN';
      },
      ui: async (page) => (/\/sales\//.test(page.url()) ? 'CLAIMED' : 'OPEN'),
      expect: 'CLAIMED',
    });
  },
);

pathway(
  {
    id: 'private-deals.self-join-and-expired-refused',
    title: 'Host cannot join own invite and expired invites are refused',
    area: 'private-deals',
    kind: 'refusal',
    provider: 'stripe',
    members: { host: ALICE, joiner: BOB },
    viewports: 'both',
  },
  async (ctx) => {
    let token = '';

    await ctx.step('Host creates invite on /deals', 'host', async (page) => {
      token = await createPrivateDealInvite(page, 'Expired Deal Card', '40');
    });

    await ctx.refusal(
      'Host opening /t/[token] redirects to host editor rather than allowing self-join',
      'host',
      async (page) => {
        await page.goto(`/t/${token}`);
        await expect(page).toHaveURL(new RegExp(`/deals\\?link=${token}`), { timeout: 15_000 });
        return { code: 'SELF_JOIN_REFUSED' };
      },
      { code: 'SELF_JOIN_REFUSED' },
    );

    await ctx.simulated(
      'Rewind invite expires_at past 14-day TTL',
      { mechanism: 'moved-timestamp', reason: 'Advances deal_invites.expires_at past TTL' },
      async () => {
        const [row] = await selectRows<{ id: string }>('deal_invites', `select=id&token=eq.${token}`);
        await rewind('deal_invites', row.id, ['expires_at'], 15 * DAY_MS);
      },
    );

    await ctx.refusal(
      'Joiner opening expired invite sees expired refusal',
      'joiner',
      async (page) => {
        await page.goto(`/t/${token}`);
        await expect(page.getByText(/expired/i).first()).toBeVisible({ timeout: 15_000 });
        return { code: 'INVITE_EXPIRED' };
      },
      { code: 'INVITE_EXPIRED' },
    );
  },
);
