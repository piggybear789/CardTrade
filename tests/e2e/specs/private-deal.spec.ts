// tests/e2e/specs/private-deal.spec.ts
//
// Private-deal invites: cash-for-a-card opens CashSaleView; a trade opens
// TradeContract. Cards are unlisted and must not appear in the catalog.
//
// SERIAL BY NECESSITY. Each claim consumes the invite. Guards (self-join,
// second claim, revoke) share the same Alice/Bob pair.

import { test, expect } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { ALICE, BOB, storageStatePath, TRADE_PAIR_A } from '../support/users';
import { marked } from '../support/marker';
import { fillUnlistedCard } from '../support/deals';
import { ensureSavedCard } from '../support/payments';
import { ensureFreshSessions } from '../support/auth';
import { COLD_ROUTE, RENDERED } from '../support/waiting';

test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, BOB]);
});

async function asUser(
  browser: import('@playwright/test').Browser,
  user: typeof ALICE,
): Promise<{ ctx: import('@playwright/test').BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ storageState: storageStatePath(user) });
  const page = await ctx.newPage();
  return { ctx, page };
}

test.describe.serial('Private cash deal → sale room', () => {
  const description = marked(`Private cash Charizard ${Date.now()}`);
  let invitePath = '';
  let salePath = '';

  test('the host composes a cash deal from an unlisted card', async ({ browser }) => {
    const { ctx, page } = await asUser(browser, ALICE);

    await page.goto('/deals/new');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Start a Private Deal' })).toBeVisible({
      timeout: COLD_ROUTE,
    });

    await page.getByRole('radio', { name: /Cash for a card/i }).check();
    await page.getByRole('radio', { name: /I'm selling/i }).check();
    await fillUnlistedCard(page, description);
    await page.getByLabel('Price').fill('150.00');
    await page.getByRole('button', { name: 'Create deal link' }).click();

    await expect(page).toHaveURL(/\/t\/[A-Za-z0-9_-]{16,}/, { timeout: COLD_ROUTE });
    invitePath = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { name: 'Waiting for them to join' })).toBeVisible({
      timeout: RENDERED,
    });
    await expect(page.getByRole('button', { name: /Copy deal link/i })).toBeVisible();

    await ctx.close();
  });

  test('the unlisted card is not in the catalog', async ({ browser }) => {
    const { ctx, page } = await asUser(browser, BOB);
    const q = encodeURIComponent(description);
    await page.goto(`/listings?q=${q}`);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText(description)).toHaveCount(0);
    await ctx.close();
  });

  test('a signed-out visitor sees the preview and is sent to sign in', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto(invitePath);
    await expect(page.getByRole('heading', { name: 'Private deal' })).toBeVisible({
      timeout: COLD_ROUTE,
    });
    await page.getByRole('link', { name: 'Sign in to join' }).click();
    await expect(page).toHaveURL(new RegExp(`/sign-in\\?redirectTo=${encodeURIComponent(invitePath).replace(/\//g, '\\/')}`));
    await ctx.close();
  });

  test('the host cannot join their own deal', async ({ browser }) => {
    const { ctx, page } = await asUser(browser, ALICE);
    await page.goto(invitePath);
    await expect(page.getByRole('heading', { name: 'Waiting for them to join' })).toBeVisible({
      timeout: COLD_ROUTE,
    });
    await expect(page.getByRole('button', { name: 'Join this deal' })).toHaveCount(0);
    await ctx.close();
  });

  test('the buyer claims the invite and both land in the sale room', async ({ browser }) => {
    const { ctx, page } = await asUser(browser, BOB);
    await ensureSavedCard(page, TRADE_PAIR_A.aliceItemId);

    await page.goto(invitePath);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Join this deal' })).toBeVisible({
      timeout: COLD_ROUTE,
    });
    await page.getByRole('button', { name: 'Join this deal' }).click();
    await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
    salePath = new URL(page.url()).pathname;
    await expect(page.getByRole('heading', { name: /^(Purchase|Sale)$/ }).first()).toBeVisible({
      timeout: RENDERED,
    });
    await expect(page).not.toHaveURL(/\/trades\//);
    await ctx.close();
  });

  test('a second claim is refused', async ({ browser }) => {
    const { ctx, page } = await asUser(browser, BOB);
    await page.goto(invitePath);
    await expect(page).toHaveURL(new RegExp(salePath.replace(/\//g, '\\/')), {
      timeout: COLD_ROUTE,
    });
    await ctx.close();
  });
});

test.describe.serial('Private trade deal → trade room', () => {
  const hostDescription = marked(`Private trade host ${Date.now()}`);
  const joinDescription = marked(`Private trade joiner ${Date.now()}`);
  let invitePath = '';

  test('the host composes a trade from an unlisted card', async ({ browser }) => {
    const { ctx, page } = await asUser(browser, ALICE);

    await page.goto('/deals/new');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('radio', { name: /Trade cards/i }).check();
    await fillUnlistedCard(page, hostDescription);
    await page.getByLabel('What your card is worth').fill('200.00');
    await page.getByLabel('What you want from them').fill(joinDescription);
    await page.getByRole('button', { name: 'Create deal link' }).click();

    await expect(page).toHaveURL(/\/t\/[A-Za-z0-9_-]{16,}/, { timeout: COLD_ROUTE });
    invitePath = new URL(page.url()).pathname;
    await ctx.close();
  });

  test('the counterpart claims with their own unlisted card', async ({ browser }) => {
    const { ctx, page } = await asUser(browser, BOB);
    await page.goto(invitePath);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Join this deal' })).toBeVisible({
      timeout: COLD_ROUTE,
    });
    await fillUnlistedCard(page, joinDescription);
    await page.getByLabel('What your card is worth').fill('200.00');
    await page.getByRole('button', { name: 'Join this deal' }).click();
    await expect(page).toHaveURL(/\/trades\/[0-9a-f-]{36}/, { timeout: COLD_ROUTE });
    await expect(page.getByRole('heading', { name: 'Trade' }).first()).toBeVisible({
      timeout: RENDERED,
    });
    await expect(page).not.toHaveURL(/\/sales\//);
    await ctx.close();
  });
});

test.describe.serial('Revoke unused invite', () => {
  const description = marked(`Revoked deal ${Date.now()}`);

  test('a cancelled invite cannot be claimed', async ({ browser }) => {
    const alice = await asUser(browser, ALICE);
    await alice.page.goto('/deals/new');
    await alice.page.waitForLoadState('domcontentloaded');
    await alice.page.getByRole('radio', { name: /Cash for a card/i }).check();
    await fillUnlistedCard(alice.page, description);
    await alice.page.getByLabel('Price').fill('50.00');
    await alice.page.getByRole('button', { name: 'Create deal link' }).click();
    await expect(alice.page).toHaveURL(/\/t\/[A-Za-z0-9_-]{16,}/, { timeout: COLD_ROUTE });
    const invitePath = new URL(alice.page.url()).pathname;
    await alice.page.getByRole('button', { name: 'Cancel invite' }).click();
    await expect(alice.page).toHaveURL(/\/sales/, { timeout: COLD_ROUTE });
    await alice.ctx.close();

    const bob = await asUser(browser, BOB);
    await bob.page.goto(invitePath);
    await expect(bob.page.getByRole('heading', { name: /cancelled/i })).toBeVisible({
      timeout: COLD_ROUTE,
    });
    await expect(bob.page.getByRole('button', { name: 'Join this deal' })).toHaveCount(0);
    await bob.ctx.close();
  });
});
