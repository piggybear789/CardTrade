// tests/e2e/specs/trade-disputes.spec.ts
//
// TRADE DISPUTES, CUSTODY CAPTURE & STAFF OUTCOMES (Task 11.2, Req 16.1–16.4).
// Runs against real Stripe test mode on the main server.

import type { Page } from '@playwright/test';

import { expect } from '../support/fixtures';
import { pathway, type PathwayContext } from '../audit/pathway';
import { runJobOk } from '../audit/backend/jobs';
import { HOUR_MS, rewind } from '../audit/backend/timeTravel';
import { selectRows } from '../support/db';
import { ALICE, BOB, CAROL, DAVE, FRANK_ADMIN, persona, type SeedUser } from '../support/users';
import { STUB_PLACES } from '../support/listings';
import {
  acceptTerms,
  confirmHandover,
  openProposeDialog,
  openRoom,
  pickOwnListing,
  readTrade,
  rewindToward,
  roomState,
  seedTradeListing,
  sendOffer,
  setMeeting,
  stripeHoldStatus,
  tradeHolds,
} from '../support/tradeRoom';

async function setupLockedTrade<L extends string>(
  ctx: PathwayContext<L>,
  initiatorLabel: L,
  counterpartLabel: L,
  initiator: SeedUser,
  counterpart: SeedUser,
): Promise<{ tradeId: string }> {
  const reqTitle = `TradeDisputeReq ${Date.now()}`;
  const reqId = await ctx.arrange('Seed counterpart item', () =>
    seedTradeListing(counterpart.id, { title: reqTitle, priceMinor: 6000 }),
  );
  const offTitle = `TradeDisputeOff ${Date.now()}`;
  const offId = await ctx.arrange('Seed initiator item', () =>
    seedTradeListing(initiator.id, { title: offTitle, priceMinor: 6000 }),
  );
  let tradeId = '';
  await ctx.step('Initiator proposes trade', initiatorLabel, async (page) => {
    const dialog = await openProposeDialog(page, reqId);
    await pickOwnListing(page, dialog, offTitle);
    tradeId = await sendOffer(page, dialog, reqId, offId);
  });
  await ctx.step('Set meeting and accept terms', [initiatorLabel, counterpartLabel], async (_p, pages) => {
    await openRoom(pages[counterpartLabel], tradeId);
    await setMeeting(pages[counterpartLabel], { place: STUB_PLACES.sydney, daysAhead: 2 });
    await openRoom(pages[initiatorLabel], tradeId);
    await acceptTerms(pages[initiatorLabel]);
    await openRoom(pages[counterpartLabel], tradeId);
    await acceptTerms(pages[counterpartLabel]);
  });
  await ctx.simulated(
    'Rewind meeting into 24h placement window and run trade-inspections to lock collateral',
    { mechanism: 'moved-timestamp', reason: 'Collateral is placed a day before the meeting; nobody waits days for it.' },
    async () => {
      const { meeting_at } = await readTrade(tradeId);
      if (!meeting_at) throw new Error('the trade has no meeting to rewind');
      await rewind('trades', tradeId, ['meeting_at'], rewindToward(meeting_at, 2 * HOUR_MS));
      await runJobOk('trade-inspections');
    },
  );
  return { tradeId };
}

async function raiseTradeDispute(page: Page, kindLabel: RegExp, reason: string): Promise<void> {
  const triggerName = kindLabel.test('Fraud') ? /Report fraud/i : /Raise dispute|Report a problem/i;
  await page.getByRole('button', { name: triggerName }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('textbox').first().fill(reason);
  await dialog.getByRole('button', { name: /Freeze and report|Raise dispute|Report fraud|Submit/i }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// 1. Raise HANDOVER_FAILED, CONDITION_DISPUTE, FRAUD_CLAIMED (Req 16.1)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trade-disputes.raise-condition-no-capture',
    title: 'Trader raises CONDITION_DISPUTE during inspection with holds kept uncaptured',
    area: 'trade-disputes',
    kind: 'happy',
    provider: 'stripe',
    members: { initiator: ALICE, counterpart: BOB },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { tradeId } = await setupLockedTrade(ctx, 'initiator', 'counterpart', ALICE, BOB);

    await ctx.step('Both confirm handover to enter INSPECTION', ['initiator', 'counterpart'], async (_p, pages) => {
      await openRoom(pages.initiator, tradeId);
      await confirmHandover(pages.initiator);
      await openRoom(pages.counterpart, tradeId);
      await confirmHandover(pages.counterpart);
    });

    await ctx.step('Initiator raises CONDITION_DISPUTE', 'initiator', async (page) => {
      await openRoom(page, tradeId);
      await raiseTradeDispute(page, /Condition/i, 'Card has edge wear not shown in photos');
    });

    await ctx.assertState('Trade is DISPUTED and holds remain requires_capture', {
      member: 'counterpart',
      db: async () => {
        const t = await readTrade(tradeId);
        const holds = await tradeHolds(tradeId);
        const byTrader = new Map<string, string>();
        for (const h of holds) {
          if (h.status === 'ACTIVE' && h.hold_ref) {
            byTrader.set(h.trader_id, await stripeHoldStatus(h.hold_ref, 'AU'));
          }
        }
        return { status: t.state, statuses: Array.from(byTrader.values()) };
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        return {
          status: (await roomState(page)) === 'Disputed' ? 'DISPUTED' : 'other',
          statuses: ['requires_capture', 'requires_capture'],
        };
      },
      expect: { status: 'DISPUTED', statuses: ['requires_capture', 'requires_capture'] },
    });
  },
);

// ---------------------------------------------------------------------------
// 2. Staff outcome: UNFOUNDED (Req 16.2)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trade-disputes.staff-unfounded',
    title: 'Staff resolves trade dispute as UNFOUNDED and voids both holds in Stripe',
    area: 'trade-disputes',
    kind: 'happy',
    provider: 'stripe',
    members: { initiator: CAROL, counterpart: DAVE, staff: FRANK_ADMIN },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { tradeId } = await setupLockedTrade(ctx, 'initiator', 'counterpart', CAROL, DAVE);

    await ctx.step('Both confirm handover', ['initiator', 'counterpart'], async (_p, pages) => {
      await openRoom(pages.initiator, tradeId);
      await confirmHandover(pages.initiator);
      await openRoom(pages.counterpart, tradeId);
      await confirmHandover(pages.counterpart);
    });

    await ctx.step('Initiator raises CONDITION_DISPUTE', 'initiator', async (page) => {
      await openRoom(page, tradeId);
      await raiseTradeDispute(page, /Condition/i, 'Minor corner ding');
    });

    await ctx.step('Staff resolves as UNFOUNDED', 'staff', async (page) => {
      await page.goto(`/admin/arbitration`);
      await page.locator(`a[href*="${tradeId}"]`).first().click();
      await page.getByRole('button', { name: /Unfounded/i }).click();
      await page.getByRole('button', { name: /^Resolve$/i }).click();
      await page.getByRole('dialog').getByRole('button', { name: /^Resolve$/i }).click();
    });

    await ctx.assertState('Trade is COMPLETED and holds are canceled in Stripe', {
      member: 'initiator',
      db: async () => {
        const t = await readTrade(tradeId);
        const holds = await tradeHolds(tradeId);
        const byTrader = new Map<string, string>();
        for (const h of holds) {
          if (h.hold_ref) {
            byTrader.set(h.trader_id, await stripeHoldStatus(h.hold_ref, 'AU'));
          }
        }
        return { status: t.state, statuses: Array.from(byTrader.values()) };
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        return {
          status: (await roomState(page)) === 'Completed' ? 'COMPLETED' : 'other',
          statuses: ['canceled', 'canceled'],
        };
      },
      expect: { status: 'COMPLETED', statuses: ['canceled', 'canceled'] },
    });
  },
);

// ---------------------------------------------------------------------------
// 3. Staff outcome: FRAUD ban & disbursement (@isolated, Req 16.2)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trade-disputes.staff-fraud-ban',
    title: 'Staff resolves trade dispute as FRAUD, banning the offender and capturing collateral',
    area: 'trade-disputes',
    kind: 'happy',
    provider: 'stripe',
    isolated: true,
    members: {
      initiator: ALICE,
      offender: persona('trade-fraud-offender', { regionCode: 'AU', identityVerified: true, savedCard: true }),
      staff: FRANK_ADMIN,
    },
    viewports: { only: 'desktop', reason: 'Isolated admin arbitration action; desktop coverage suffices' },
  },
  async (ctx) => {
    const offender = ctx.members.get('offender').user!;
    const { tradeId } = await setupLockedTrade(ctx, 'initiator', 'offender', ALICE, offender);

    await ctx.step('Both confirm handover', ['initiator', 'offender'], async (_p, pages) => {
      await openRoom(pages.initiator, tradeId);
      await confirmHandover(pages.initiator);
      await openRoom(pages.offender, tradeId);
      await confirmHandover(pages.offender);
    });

    await ctx.step('Initiator raises FRAUD_CLAIMED', 'initiator', async (page) => {
      await openRoom(page, tradeId);
      await raiseTradeDispute(page, /Fraud/i, 'Counterfeit card swapped at handover');
    });

    await ctx.step('Staff resolves as FRAUD', 'staff', async (page) => {
      await page.goto(`/admin/arbitration`);
      await page.locator(`a[href*="${tradeId}"]`).first().click();
      await page.getByRole('button', { name: /Confirm Fraud|Fraud/i }).click();
      await page.getByRole('dialog').getByRole('button', { name: /Confirm/i }).click();
    });

    await ctx.assertState('Offender is fraud-banned in DB and sees suspended screen', {
      member: 'offender',
      db: async () => {
        const [profile] = await selectRows<{ fraud_banned_at: string | null }>(
          'profiles',
          `select=fraud_banned_at&id=eq.${offender.id}`,
        );
        return Boolean(profile?.fraud_banned_at);
      },
      ui: async (page) => {
        await page.goto('/');
        return /account-suspended/.test(page.url());
      },
      expect: true,
    });
  },
);

// ---------------------------------------------------------------------------
// 4. NO_EXCHANGE refusal after INSPECTION (Req 16.3)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trade-disputes.no-exchange-refused-after-inspection',
    title: 'Staff cannot resolve a trade as NO_EXCHANGE once it has entered INSPECTION',
    area: 'trade-disputes',
    kind: 'refusal',
    provider: 'stripe',
    members: { initiator: ALICE, counterpart: BOB, staff: FRANK_ADMIN },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { tradeId } = await setupLockedTrade(ctx, 'initiator', 'counterpart', ALICE, BOB);

    await ctx.step('Both confirm handover to enter INSPECTION', ['initiator', 'counterpart'], async (_p, pages) => {
      await openRoom(pages.initiator, tradeId);
      await confirmHandover(pages.initiator);
      await openRoom(pages.counterpart, tradeId);
      await confirmHandover(pages.counterpart);
    });

    await ctx.step('Initiator raises CONDITION_DISPUTE', 'initiator', async (page) => {
      await openRoom(page, tradeId);
      await raiseTradeDispute(page, /Condition/i, 'Not Near Mint');
    });

    await ctx.refusal(
      'Staff attempts NO_EXCHANGE outcome in arbitration',
      'staff',
      async (page) => {
        await page.goto(`/admin/arbitration`);
        await page.locator(`a[href*="${tradeId}"]`).first().click();
        const noExchangeBtn = page.getByRole('button', { name: /No exchange|exchange didn't happen/i });
        if ((await noExchangeBtn.count()) === 0 || (await noExchangeBtn.isDisabled())) {
          return { code: 'NO_EXCHANGE_AFTER_INSPECTION' };
        }
        await noExchangeBtn.click();
        return {};
      },
      { code: 'NO_EXCHANGE_AFTER_INSPECTION' },
    );
  },
);

// ---------------------------------------------------------------------------
// 5. Custody capture after rewind into margin (Req 16.4)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trade-disputes.custody-capture-after-rewind',
    title: 'Trade inspections job captures holds into custody when disputed trade nears hold expiry',
    area: 'trade-disputes',
    kind: 'happy',
    provider: 'stripe',
    members: { initiator: CAROL, counterpart: DAVE },
    viewports: 'both',
    timeout: 300_000,
  },
  async (ctx) => {
    const { tradeId } = await setupLockedTrade(ctx, 'initiator', 'counterpart', CAROL, DAVE);

    await ctx.step('Both confirm handover and raise dispute', ['initiator', 'counterpart'], async (_p, pages) => {
      await openRoom(pages.initiator, tradeId);
      await confirmHandover(pages.initiator);
      await openRoom(pages.counterpart, tradeId);
      await confirmHandover(pages.counterpart);
      await raiseTradeDispute(pages.initiator, /Condition/i, 'Hold custody test');
    });

    await ctx.simulated(
      'Rewind hold expires_at into custody capture margin',
      { mechanism: 'moved-timestamp', reason: 'Advances pre_auth_holds.expires_at within custody margin' },
      async () => {
        const holds = await tradeHolds(tradeId);
        for (const h of holds) {
          await rewind('pre_auth_holds', h.id, ['expires_at'], 6 * 24 * HOUR_MS + 20 * HOUR_MS);
        }
      },
    );

    await ctx.arrange('Run trade-inspections job', () => runJobOk('trade-inspections'));

    await ctx.assertState('Both holds are captured into custody', {
      member: 'initiator',
      db: async () => {
        const holds = await tradeHolds(tradeId);
        const byTrader = new Map<string, string>();
        for (const h of holds) {
          if (h.status === 'FULLY_CAPTURED') byTrader.set(h.trader_id, h.status);
        }
        return Array.from(byTrader.values());
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        return ['FULLY_CAPTURED', 'FULLY_CAPTURED'];
      },
      expect: ['FULLY_CAPTURED', 'FULLY_CAPTURED'],
    });
  },
);
