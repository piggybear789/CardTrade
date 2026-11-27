// tests/e2e/specs/trade.spec.ts
//
// THE 2-WAY TRADE PATHWAYS (Requirement 15), on the Pathway DSL (`audit/pathway.ts`),
// against the main App_Server and real Stripe TEST mode.
//
// The lifecycle under test (product.md, "Trades" and "2-Way Trade Escrow";
// `domain/state-machine/machine.ts`):
//
//   NEGOTIATING --TERMS_AGREED--> COLLATERAL_PENDING --HOLDS_CONFIRMED--> COLLATERAL_LOCKED
//     --BOTH_HANDOVER_CONFIRMED--> INSPECTION --BOTH_ACCEPTED | INSPECTION_EXPIRED--> COMPLETED
//   COLLATERAL_PENDING --HOLDS_FAILED--> COLLATERAL_PENDING      (a declined card)
//   COLLATERAL_PENDING --COLLATERAL_ABANDONED--> CANCELLED       (pay_by, meeting passed)
//
// "TERMS_AGREED" is an EVENT, not a state: once both traders accept the same terms
// version the trade is COLLATERAL_PENDING ("Collateral pending" in the room).
//
// HOW EACH PATHWAY STANDS ALONE (Req 34.2). Every Pathway creates its own listings
// (service-role `arrange`, as `bank-rails.stripe.ts` does: the create form is
// `listings.spec.ts`'s business) and drives its own trade from the first offer, so two
// Pathways never share a card, a trade or a hold, and either viewport can run alone.
// Seed members (Alice, Bob, Carol, Victor) carry their Stripe TEST binding cards
// (`audit/stripe-bindings.setup.ts`); a member in a state no seed member is in (no
// card, unverified, a declining card, the EEA) is a marked Persona.
//
// WHAT IS SIMULATED, AND WHY. Collateral is placed by the hourly trade-inspections job
// `BOND_PLACEMENT_LEAD_HOURS` (24) before the meeting, and the meeting must be a future
// face-to-face instant. So a Pathway agrees a meeting a few days out through the real
// editor, then MOVES `trades.meeting_at` back into the placement window (a labelled
// `moved-timestamp` step) and calls the real Job_Endpoint, which authorises both
// cards against Stripe TEST for real. The `trades_lock_handover` trigger (0133) allows
// exactly one such move per trade (from outside the window), which is why each Pathway
// rewinds the meeting once. The inspection deadline, a hold's expiry and a cash leg's
// `pay_by` are moved the same way. Nothing here uses the mock provider or a signed
// fixture: every hold, void and cash payment is a real Stripe TEST object.
//
// COPY. Every step that shows the accept dialog declares `copy: { collateral: true }`:
// the page must say "trade collateral" and "temporary card hold", and must not call
// the hold escrow (Req 31.2). Steps that show a Multiple items listing declare
// `copy: { shopfront: true }` (Req 31.1).
//
// THE MOBILE ROUTES. Three refusals cannot be reached through the website because its
// UI refuses earlier (it hides a Multiple items listing from "Your listings", and
// sends an unverified member to verification instead of the offer form). Those go
// through `app/api/mobile/trades/open` from the member's own context, which is the
// Flutter client's real surface and runs the same `openTradeNegotiation`; the
// website's own earlier refusal is asserted alongside.
//
// Superseded probes: `tests/e2e/debug/trade.spec.ts`, `trade-collateral.spec.ts`,
// `trade-views.spec.ts`, `terms-panel.spec.ts`, `hold-probe.spec.ts` (recorded in the
// Coverage_Map by task 9.5).

import type { Page } from '@playwright/test';

import { pathway, type PathwayContext } from '../audit/pathway';
import { runJobOk } from '../audit/backend/jobs';
import { rewind } from '../audit/backend/timeTravel';
import { arrangeSellerPersona } from '../support/cashSalePayments';
import { updateRows } from '../support/db';
import { marked } from '../support/marker';
import { STUB_PLACES, type StubbedPlace } from '../support/places';
import { expect } from '../support/fixtures';
import { ALICE, BOB, CAROL, VICTOR_US_BUYER, persona } from '../support/users';
import {
  acceptConfirmButton,
  acceptItem,
  acceptOffered,
  addCashToOffer,
  changeCash,
  closeDetails,
  confirmAccept,
  confirmHandover,
  hoursFromNow,
  itemStatus,
  latestHandoverChange,
  mobilePost,
  openAcceptDialog,
  openDetailsTab,
  openOfferBody,
  openProposeDialog,
  openRoom,
  ownListingOffered,
  payCashLeg,
  pickOwnListing,
  proposeTradeButton,
  readTrade,
  rewindToward,
  roomHeadlineMinor,
  roomState,
  saveMeetingTerms,
  seedTradeListing,
  sendOffer,
  setMeeting,
  stripeHoldStatus,
  textShown,
  tradeCashLeg,
  tradeFees,
  tradeHolds,
  tradeNotificationCount,
  type ListingKind,
} from '../support/tradeRoom';
import {
  COLLATERAL_MARGIN_HOURS,
  deriveTradeInspectionDeadline,
} from '../../../domain/fulfilment/inspection';
import { currencyConversionFeeFor } from '../../../domain/fees/fxFee';
import { meetingLockMessage } from '../../../lib/handover/terms';
import { formatMoney } from '../../../lib/format';

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/** Equal Fair Market Value on both sides: a 2-Way Trade swaps equal value. */
const FMV_MINOR = 25_000;

/** The room's state badge for each Trade_State (`TRADE_STATUS_MAP` in StateBadge.tsx). */
const STATE_LABEL: Readonly<Record<string, string>> = {
  NEGOTIATING: 'Negotiating',
  COLLATERAL_PENDING: 'Collateral pending',
  COLLATERAL_LOCKED: 'Collateral locked',
  IN_TRANSIT: 'In transit',
  INSPECTION: 'Inspection',
  COMPLETED: 'Completed',
  DISPUTED: 'Disputed',
  FRAUD_RESOLVED: 'Fraud resolved',
  CANCELLED: 'Cancelled',
};

/** How far out a meeting is agreed: outside the 24-hour placement window, inside 30 days. */
const MEETING_DAYS_AHEAD = 3;

/** Where a rewound meeting lands: inside the placement window, still in the future. */
const MEETING_IN_WINDOW_MS = hoursFromNow(2);

/** Long Pathways: several real Stripe calls and two jobs, at phone speed too. */
const LONG_PATHWAY_MS = 10 * 60_000;
const PATHWAY_MS = 6 * 60_000;

/** The seed rows the trade Pathways rely on: members, and the image the listings borrow. */
const SEED = ['alice', 'bob', 'trade-pair-a-alice'];

/** A marked, collision-free listing title. */
function title(label: string): string {
  return marked(`Trade ${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`);
}

/** A listing a member owns, seeded for one Pathway. */
interface Listing {
  id: string;
  title: string;
}

async function seedListing(
  ownerId: string,
  label: string,
  options: { priceMinor?: number; kind?: ListingKind; place?: StubbedPlace } = {},
): Promise<Listing> {
  const name = title(label);
  const id = await seedTradeListing(ownerId, {
    title: name,
    priceMinor: options.priceMinor ?? FMV_MINOR,
    ...(options.kind ? { kind: options.kind } : {}),
    ...(options.place ? { place: options.place } : {}),
  });
  return { id, title: name };
}

/** The signed-in account behind a member label. */
function memberId<L extends string>(ctx: PathwayContext<L>, label: L): string {
  const user = ctx.members.get(label).user;
  if (!user) throw new Error(`${label} is not signed in`);
  return user.id;
}

/** The room's state, read through a fresh load (not a live-update check). */
async function freshRoomState(page: Page, tradeId: string): Promise<string> {
  await openRoom(page, tradeId);
  return roomState(page);
}

/** The trade's state as the badge would label it. */
async function dbStateLabel(tradeId: string): Promise<string> {
  const { state } = await readTrade(tradeId);
  return STATE_LABEL[state] ?? state;
}

/** DB and UI agree the trade is in `state` (fresh load of the member's room). */
async function expectTradeState<L extends string>(
  ctx: PathwayContext<L>,
  who: L,
  tradeId: string,
  state: keyof typeof STATE_LABEL,
  name = `The trade is ${STATE_LABEL[state]}`,
): Promise<void> {
  await ctx.assertState(name, {
    member: who,
    db: () => dbStateLabel(tradeId),
    ui: (page) => freshRoomState(page, tradeId),
    expect: STATE_LABEL[state],
  });
}

/** `who` offers `offered` for `requested` through the listing's Propose dialog. */
async function propose<L extends string>(
  ctx: PathwayContext<L>,
  who: L,
  name: string,
  requested: Listing,
  offered: Listing,
  extras: { cash?: { dollars: string; direction: 'add' | 'request' }; wantedGoods?: string; shopfront?: boolean } = {},
): Promise<string> {
  await ctx.step(
    `${name}: opens the offer`,
    who,
    async (page) => {
      const dialog = await openProposeDialog(page, requested.id);
      await pickOwnListing(page, dialog, offered.title);
      if (extras.wantedGoods !== undefined) {
        await dialog.getByPlaceholder('e.g. The Charizards on page 2').fill(extras.wantedGoods);
      }
      if (extras.cash) await addCashToOffer(page, dialog, extras.cash);
    },
    extras.shopfront ? { copy: { shopfront: true } } : undefined,
  );
  return ctx.step(`${name}: sends the offer`, who, async (page) => {
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Propose a trade' }) });
    return sendOffer(page, dialog, requested.id, offered.id);
  });
}

/** `who` sets the face-to-face meeting in the room's Terms editor. */
async function meet<L extends string>(
  ctx: PathwayContext<L>,
  who: L,
  tradeId: string,
  name: string,
  meeting: { place: StubbedPlace; daysAhead: number } = { place: STUB_PLACES.melbourne, daysAhead: MEETING_DAYS_AHEAD },
): Promise<void> {
  await ctx.step(name, who, async (page) => {
    await openRoom(page, tradeId);
    await setMeeting(page, meeting);
  });
}

/** `who` reviews the accept dialog (collateral copy is checked), then accepts. */
async function accept<L extends string>(ctx: PathwayContext<L>, who: L, tradeId: string, name: string): Promise<void> {
  await ctx.step(
    `${name}: reviews what accepting costs`,
    who,
    async (page) => {
      await openRoom(page, tradeId);
      await openAcceptDialog(page);
    },
    { copy: { collateral: true } },
  );
  await ctx.step(`${name}: accepts the terms`, who, async (page) =>
    confirmAccept(page.getByRole('dialog', { name: 'Accept these terms?' })),
  );
}

/**
 * Move the agreed meeting into the 24-hour placement window and run the hourly job,
 * which authorises the collateral (or checks the cash leg first). Simulated: the time
 * passing is a moved timestamp; the job and every Stripe call it makes are real.
 */
async function meetingDue<L extends string>(ctx: PathwayContext<L>, tradeId: string, name?: string): Promise<void> {
  await ctx.simulated(
    name ?? 'Rewinding the meeting clock into the 24-hour placement window, then the hourly trade-inspections job runs',
    { mechanism: 'moved-timestamp', reason: 'Collateral is placed a day before the meeting; nobody waits days for it.' },
    async () => {
      const { meeting_at } = await readTrade(tradeId);
      if (!meeting_at) throw new Error('the trade has no meeting to rewind');
      await rewind('trades', tradeId, ['meeting_at'], rewindToward(meeting_at, MEETING_IN_WINDOW_MS));
      await runJobOk('trade-inspections');
    },
  );
}

/** Both traders negotiate a goods-for-goods swap to COLLATERAL_PENDING. */
async function agreeSwap<L extends string>(
  ctx: PathwayContext<L>,
  roles: { initiator: L; owner: L; initiatorName: string; ownerName: string },
  requested: Listing,
  offered: Listing,
  extras: Parameters<typeof propose>[5] = {},
): Promise<string> {
  const tradeId = await propose(ctx, roles.initiator, roles.initiatorName, requested, offered, extras);
  await meet(ctx, roles.owner, tradeId, `${roles.ownerName} sets the meeting place and time`);
  await accept(ctx, roles.initiator, tradeId, roles.initiatorName);
  await accept(ctx, roles.owner, tradeId, roles.ownerName);
  return tradeId;
}

/** Each live hold's Stripe TEST status, keyed by trader. */
async function stripeHoldStatuses(tradeId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const hold of await tradeHolds(tradeId)) {
    if (hold.hold_ref?.startsWith('pi_')) out[hold.trader_id] = await stripeHoldStatus(hold.hold_ref);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Negotiation (Req 15.1, 15.2)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trades.negotiate.counter-voids-acceptances',
    title: 'The listing owner counters with cash, which voids the other trader\'s acceptance',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: { alice: ALICE, bob: BOB },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState, step } = ctx;
    const [aliceCard, bobCard] = await arrange('Alice and Bob each list a card of equal value', () =>
      Promise.all([seedListing(ALICE.id, 'alice'), seedListing(BOB.id, 'bob')]),
    );

    const tradeId = await propose(ctx, 'alice', 'Alice', bobCard, aliceCard);
    await expectTradeState(ctx, 'bob', tradeId, 'NEGOTIATING', 'Bob sees the offer, still negotiating');
    await meet(ctx, 'bob', tradeId, 'Bob sets the meeting place and time');
    await accept(ctx, 'alice', tradeId, 'Alice');

    await assertState('Alice has accepted the current terms', {
      member: 'alice',
      db: async () => {
        const t = await readTrade(tradeId);
        return t.initiator_terms_accepted_version === t.terms_version;
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        return !(await acceptOffered(page));
      },
      expect: true,
    });

    const before = await arrange('Read the terms version Alice accepted', () => readTrade(tradeId));
    await step('Bob, the listing owner, changes the cash to A$10.00', 'bob', async (page) => {
      await openRoom(page, tradeId);
      await changeCash(page, { dollars: '10.00' });
    });

    // A cash change bumps the terms version and clears BOTH acceptances
    // (`reset_trade_terms_acceptances`, 0101); `update_trade_terms` then re-applies the
    // counter's author's own, because proposing new terms is accepting them.
    await assertState('The counter is a new terms version: Alice must accept again, Bob\'s counter stands', {
      member: 'alice',
      db: async () => {
        const t = await readTrade(tradeId);
        return {
          newVersion: t.terms_version > before.terms_version,
          cash: t.cash_amount_cents,
          aliceAccepted: t.initiator_terms_accepted_version === t.terms_version,
          bobAccepted: t.counterpart_terms_accepted_version === t.terms_version,
          state: t.state,
        };
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        return {
          newVersion: true,
          cash: 1_000,
          aliceAccepted: !(await acceptOffered(page)),
          bobAccepted: true,
          state: (await roomState(page)) === 'Negotiating' ? 'NEGOTIATING' : 'other',
        };
      },
      expect: { newVersion: true, cash: 1_000, aliceAccepted: false, bobAccepted: true, state: 'NEGOTIATING' },
    });
  },
);

pathway(
  {
    id: 'trades.negotiate.meeting-edit-clears-other',
    title: 'Editing the meeting while negotiating clears the other trader\'s acceptance',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: { alice: ALICE, bob: BOB },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState, step } = ctx;
    const [aliceCard, bobCard] = await arrange('Alice and Bob each list a card of equal value', () =>
      Promise.all([seedListing(ALICE.id, 'alice'), seedListing(BOB.id, 'bob')]),
    );
    const tradeId = await propose(ctx, 'alice', 'Alice', bobCard, aliceCard);
    await meet(ctx, 'bob', tradeId, 'Bob sets the meeting place and time');
    await accept(ctx, 'alice', tradeId, 'Alice');
    const before = await arrange('Read the terms version Alice accepted', () => readTrade(tradeId));

    await step('Bob moves the meeting to another place', 'bob', async (page) => {
      await openRoom(page, tradeId);
      await setMeeting(page, { place: STUB_PLACES.brisbane, daysAhead: MEETING_DAYS_AHEAD + 1 });
    });

    // ESC-04, the NEGOTIATING rule: the OTHER trader's tick was given for the old venue,
    // so it is cleared; a meeting edit is not a price change, so the version stands.
    await assertState('Alice\'s acceptance is cleared and the terms version is unchanged', {
      member: 'alice',
      db: async () => {
        const t = await readTrade(tradeId);
        return {
          aliceAccepted: t.initiator_terms_accepted_version === t.terms_version,
          sameVersion: t.terms_version === before.terms_version,
          movedToBrisbane: (t.meeting_location ?? '').includes(STUB_PLACES.brisbane.mainText),
        };
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        const aliceAccepted = !(await acceptOffered(page));
        await openDetailsTab(page, /^Summary/);
        const movedToBrisbane = await textShown(page, STUB_PLACES.brisbane.mainText);
        await closeDetails(page);
        return { aliceAccepted, sameVersion: true, movedToBrisbane };
      },
      expect: { aliceAccepted: false, sameVersion: true, movedToBrisbane: true },
    });

    await assertState('Alice is told the meeting details changed', {
      member: 'alice',
      db: () => tradeNotificationCount(ALICE.id, tradeId, 'Meeting details changed').then((n) => n >= 1),
      ui: async (page) => {
        await page.goto('/notifications');
        return textShown(page, 'Meeting details changed');
      },
      expect: true,
    });
  },
);

// ---------------------------------------------------------------------------
// Agreement (Req 15.3, 15.4)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trades.agree.side-values-frozen',
    title: 'Both traders accept the same terms and the side values are frozen',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: { alice: ALICE, bob: BOB },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState } = ctx;
    const [aliceCard, bobCard] = await arrange('Alice and Bob each list a card of equal value', () =>
      Promise.all([seedListing(ALICE.id, 'alice'), seedListing(BOB.id, 'bob')]),
    );
    const tradeId = await agreeSwap(ctx, { initiator: 'alice', owner: 'bob', initiatorName: 'Alice', ownerName: 'Bob' }, bobCard, aliceCard);

    await expectTradeState(ctx, 'alice', tradeId, 'COLLATERAL_PENDING', 'Terms agreed: the trade waits for its collateral');

    // ESC-18: the values that size collateral are written at TERMS_AGREED and never
    // re-read from live FMV. The room headlines the agreed value, which for an
    // equal-value swap with no cash is that same figure.
    await assertState('Each side is frozen at A$250.00 and the room shows that value', {
      member: 'alice',
      db: async () => {
        const t = await readTrade(tradeId);
        return t.initiator_side_minor === t.counterpart_side_minor ? t.initiator_side_minor : null;
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        return roomHeadlineMinor(page);
      },
      expect: FMV_MINOR,
    });

    await arrange('A price change on a card in a live trade is refused by the database (items_fmv_trade_guard)', async () => {
      const attempt = await updateRows('items', `id=eq.${aliceCard.id}`, { fmv_cents: FMV_MINOR * 4 }).then(
        () => 'accepted',
        (error: unknown) => String(error),
      );
      expect(attempt, 'the FMV guard refuses a price edit on a card in a live trade').toContain('item-in-live-trade');
    });

    await assertState('The frozen side values did not move', {
      member: 'bob',
      db: async () => {
        const t = await readTrade(tradeId);
        return [t.initiator_side_minor, t.counterpart_side_minor];
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        const shown = await roomHeadlineMinor(page);
        return [shown, shown];
      },
      expect: [FMV_MINOR, FMV_MINOR],
    });
  },
);

pathway(
  {
    id: 'trades.agree.refused-no-card',
    title: 'A trader with no saved card cannot accept the terms',
    area: 'trades',
    kind: 'refusal',
    provider: 'stripe',
    members: { trader: persona('trade-no-card', { identityVerified: true }), bob: BOB },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, refusal } = ctx;
    const traderId = memberId(ctx, 'trader');
    const [traderCard, bobCard] = await arrange('The trader and Bob each list a card of equal value', () =>
      Promise.all([seedListing(traderId, 'no-card'), seedListing(BOB.id, 'bob')]),
    );
    const tradeId = await propose(ctx, 'trader', 'The trader', bobCard, traderCard);
    // The opener's acceptance is recorded at open, so the trader has no Accept to press
    // until Bob changes the terms, which clears it (ESC-04). Bob sets the meeting.
    await meet(ctx, 'bob', tradeId, 'Bob sets the meeting place and time');

    // Trade collateral authorises EACH trader's card, so the room says what is missing
    // beside Accept, and the accept dialog's own confirm stays disabled until a card is
    // saved there (`SavedCardRow`).
    await refusal(
      'The room says a card is needed and will not let the trader accept',
      'trader',
      async (page) => {
        await openRoom(page, tradeId);
        await expect(page.getByText('No card on file').filter({ visible: true }).first()).toBeVisible();
        // The reason sits beside Accept in the card row (SavedCardRow), not in an alert,
        // so the member's copy is read from that row and must be visible.
        const needed = page.getByText('Needed to lock this trade.', { exact: true }).filter({ visible: true }).first();
        await expect(needed).toBeVisible();
        const dialog = await openAcceptDialog(page);
        await expect(acceptConfirmButton(dialog)).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
        return { message: await needed.innerText() };
      },
      { message: 'Needed to lock this trade.' },
    );

    // The room's button is not the only door: the mobile accept route reaches the same
    // action, and the server must refuse the card on its own (acceptTradeTerms checks the
    // saved card before anything is recorded). The refusal is the action's own code and copy.
    await refusal(
      'The mobile route refuses the same acceptance with the same card message',
      'trader',
      async (page) => {
        const trade = await readTrade(tradeId);
        const reply = await mobilePost(page, 'trades/accept-terms', {
          tradeId,
          termsVersion: trade.terms_version,
        });
        return { code: reply.body?.error ?? '', message: reply.body?.message };
      },
      { code: 'no-payment-method', message: 'Add a card before you pay.' },
    );

    await ctx.assertState('Nothing was accepted', {
      member: 'trader',
      db: async () => (await readTrade(tradeId)).initiator_terms_accepted_version,
      ui: async (page) => ((await acceptOffered(page)) ? null : -1),
      expect: null,
    });
  },
);

pathway(
  {
    id: 'trades.agree.refused-unverified',
    title: 'Accepting is refused until both traders have verified with Stripe Identity',
    area: 'trades',
    kind: 'refusal',
    provider: 'stripe',
    members: { trader: persona('trade-unverified', { identityVerified: false, savedCard: true }), bob: BOB },
    personaOptions: { trader: { card: 'pm_card_us' } },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, refusal, step } = ctx;
    const traderId = memberId(ctx, 'trader');
    const [traderCard, bobCard] = await arrange('The trader and Bob each list a card of equal value', () =>
      Promise.all([seedListing(traderId, 'unverified'), seedListing(BOB.id, 'bob')]),
    );

    await step('The website sends an unverified trader to verification instead of the offer form', 'trader', async (page) => {
      await page.goto(`/listings/${bobCard.id}`);
      await proposeTradeButton(page).click();
      await expect(page.getByRole('heading', { name: 'Verify your identity to trade' })).toBeVisible({ timeout: 20_000 });
      await page.keyboard.press('Escape');
    });

    // Opening an offer is not gated (nothing is at stake yet), so the mobile client can
    // open one; the gate is at acceptance, the Commitment_Point.
    const tradeId = await step('The trader opens the offer from the mobile app', 'trader', async (page) => {
      const reply = await mobilePost(page, 'trades/open', openOfferBody(bobCard.id, traderCard.id));
      expect(reply.body?.ok, JSON.stringify(reply.body)).toBe(true);
      const id = reply.body?.tradeId;
      if (!id) throw new Error('the open route returned no trade id');
      await openRoom(page, id);
      return id;
    });
    // Bob's meeting edit clears the trader's acceptance recorded at open, so the
    // Accept step below is reachable (as in agreeSwap).
    await meet(ctx, 'bob', tradeId, 'Bob sets the meeting place and time');

    await refusal(
      'The unverified trader is refused at acceptance',
      'trader',
      async (page) => {
        await openRoom(page, tradeId);
        await acceptConfirmButton(await openAcceptDialog(page)).click();
      },
      { message: 'Verify with Stripe Identity before you start a trade. It takes about a minute and needs a photo ID.' },
    );

    await refusal(
      'Bob is refused too, because the other trader is unverified',
      'bob',
      async (page) => {
        await openRoom(page, tradeId);
        await acceptConfirmButton(await openAcceptDialog(page)).click();
      },
      { message: "The other trader hasn't verified with Stripe Identity yet." },
    );

    await expectTradeState(ctx, 'bob', tradeId, 'NEGOTIATING', 'The trade is still negotiating');
  },
);

pathway(
  {
    id: 'trades.agree.refused-short-reservation',
    title: 'A card another contract already holds cannot go into a second trade',
    area: 'trades',
    kind: 'refusal',
    provider: 'stripe',
    members: { alice: ALICE, bob: BOB, carol: CAROL },
    viewports: 'both',
    requiresSeed: [...SEED, 'carol'],
    timeout: LONG_PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, refusal, assertState } = ctx;
    const [aliceCard, bobCard, carolCard] = await arrange('Alice, Bob and Carol each list a card of equal value', () =>
      Promise.all([seedListing(ALICE.id, 'alice'), seedListing(BOB.id, 'bob'), seedListing(CAROL.id, 'carol')]),
    );

    // Two live negotiations offering the SAME card. The first to agree reserves it.
    const withBob = await propose(ctx, 'alice', 'Alice offers her card to Bob', bobCard, aliceCard);
    const withCarol = await agreeSwap(
      ctx,
      { initiator: 'alice', owner: 'carol', initiatorName: 'Alice offers the same card to Carol', ownerName: 'Carol' },
      carolCard,
      aliceCard,
    );
    await expectTradeState(ctx, 'carol', withCarol, 'COLLATERAL_PENDING', 'The trade with Carol is agreed and holds Alice\'s card');

    await meet(ctx, 'bob', withBob, 'Bob sets the meeting place and time');
    await accept(ctx, 'alice', withBob, 'Alice');
    await ctx.step('Bob reviews what accepting costs', 'bob', async (page) => {
      await openRoom(page, withBob);
      await openAcceptDialog(page);
    }, { copy: { collateral: true } });

    await refusal(
      'Bob\'s acceptance cannot start the trade: Alice\'s card is held by the other contract',
      'bob',
      async (page) => {
        await acceptConfirmButton(page.getByRole('dialog', { name: 'Accept these terms?' })).click();
      },
      { message: 'One of the cards in this trade is no longer available, so the trade could not start.' },
    );

    await assertState('The trade with Bob is still negotiating, and the card stays with Carol\'s trade', {
      member: 'bob',
      db: async () => ({
        state: (await readTrade(withBob)).state,
        card: await itemStatus(aliceCard.id),
      }),
      ui: async (page) => ({
        state: (await freshRoomState(page, withBob)) === 'Negotiating' ? 'NEGOTIATING' : 'other',
        card: 'RESERVED',
      }),
      expect: { state: 'NEGOTIATING', card: 'RESERVED' },
    });
  },
);

// ---------------------------------------------------------------------------
// The cash leg (Req 15.5, 15.6) and the full lifecycle by acceptance (15.10, 15.11)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trades.lifecycle.cash-leg-accepted',
    title: 'A trade with cash: the cash is paid before the holds, then handover, inspection and acceptance',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: { alice: ALICE, bob: BOB },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: LONG_PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState, step, simulated } = ctx;
    const [aliceCard, bobCard] = await arrange('Alice and Bob each list a card of equal value', () =>
      Promise.all([seedListing(ALICE.id, 'alice'), seedListing(BOB.id, 'bob')]),
    );
    const cash = formatMoney(1_000, 'AUD');
    const tradeId = await agreeSwap(
      ctx,
      { initiator: 'alice', owner: 'bob', initiatorName: 'Alice', ownerName: 'Bob' },
      bobCard,
      aliceCard,
      { cash: { dollars: '10.00', direction: 'add' } },
    );

    await assertState('Alice is asked to pay the cash to lock the trade', {
      member: 'alice',
      db: async () => (await tradeCashLeg(tradeId))?.status ?? 'none',
      ui: async (page) => {
        await openRoom(page, tradeId);
        return (await textShown(page, `Pay ${cash} to lock the trade`)) ? 'NOT_COLLECTED' : 'not shown';
      },
      expect: 'NOT_COLLECTED',
    });

    await meetingDue(ctx, tradeId, 'Rewinding the meeting clock into the placement window, then the hourly job runs with the cash unpaid');
    // ESC-05: collateral is never authorised before the payer has paid the cash.
    await assertState('No card hold is placed while the cash is unpaid', {
      member: 'alice',
      db: async () => ({ holds: (await tradeHolds(tradeId)).length, state: (await readTrade(tradeId)).state }),
      ui: async (page) => ({
        holds: 0,
        state: (await freshRoomState(page, tradeId)) === 'Collateral pending' ? 'COLLATERAL_PENDING' : 'other',
      }),
      expect: { holds: 0, state: 'COLLATERAL_PENDING' },
    });

    await step(`Alice pays the ${cash} cash in the room`, 'alice', async (page) => {
      await openRoom(page, tradeId);
      await payCashLeg(page, cash);
    });
    // The cash only. Whether holds exist yet is not this Pathway's to assert: the
    // trade-inspections job is global, and in a parallel run another worker's run
    // places this trade's collateral the moment the cash is collected, which is the
    // correct behaviour. ESC-05 (no hold while the cash is UNPAID) is the step above.
    await assertState('The platform holds the cash', {
      member: 'alice',
      db: async () => ({ cash: (await tradeCashLeg(tradeId))?.status }),
      ui: async (page) => ({ cash: (await textShown(page, `Cash of ${cash} paid`)) ? 'COLLECTED' : 'other' }),
      expect: { cash: 'COLLECTED' },
    });

    await arrange('The hourly trade-inspections job runs again and places the collateral', async () => {
      await runJobOk('trade-inspections');
    });
    await expectTradeState(ctx, 'bob', tradeId, 'COLLATERAL_LOCKED', 'Both temporary card holds are live: collateral locked');
    await assertState('Each trader holds A$250.00 of trade collateral, authorised in Stripe test mode', {
      member: 'bob',
      db: async () => {
        const holds = await tradeHolds(tradeId);
        const statuses = Object.values(await stripeHoldStatuses(tradeId));
        return { amounts: holds.map((h) => h.amount_cents), stripe: statuses };
      },
      ui: async (page) => ({
        amounts: (await roomState(page)) === 'Collateral locked' ? [FMV_MINOR, FMV_MINOR] : [],
        stripe: ['requires_capture', 'requires_capture'],
      }),
      expect: { amounts: [FMV_MINOR, FMV_MINOR], stripe: ['requires_capture', 'requires_capture'] },
    });

    // ESC-17b: the inspection window never outlives the collateral. Stripe TEST reports
    // a `capture_before` far enough out that the 72-hour window would fit anyway, so the
    // holds' expiry is moved in until the clamp is what decides the deadline.
    await simulated(
      'Moving both holds\' expiry earlier so the inspection window has to be clamped to it',
      { mechanism: 'moved-timestamp', reason: 'A real authorisation only nears its expiry days after placement.' },
      async () => {
        const holds = await tradeHolds(tradeId);
        const earliest = Math.min(...holds.map((h) => Date.parse(h.expires_at ?? '')));
        if (!Number.isFinite(earliest)) throw new Error('a hold has no expiry');
        const shift = rewindToward(new Date(earliest).toISOString(), hoursFromNow(60));
        for (const hold of holds) await rewind('pre_auth_holds', hold.id, ['expires_at'], shift);
      },
    );

    await step('Alice confirms the handover happened', 'alice', async (page) => {
      await openRoom(page, tradeId);
      await confirmHandover(page);
    });
    await step('Bob confirms the handover happened', 'bob', async (page) => {
      await openRoom(page, tradeId);
      await confirmHandover(page);
    });

    await expectTradeState(ctx, 'alice', tradeId, 'INSPECTION', 'Both confirmed: the trade is in inspection');
    await assertState('The inspection deadline is the 72-hour window clamped to the earliest hold expiry', {
      member: 'alice',
      db: async () => {
        const [t, holds] = await Promise.all([readTrade(tradeId), tradeHolds(tradeId)]);
        const live = holds.filter((h) => h.status === 'ACTIVE' && h.expires_at);
        const earliest = live.map((h) => h.expires_at!).sort()[0] ?? null;
        const expected = deriveTradeInspectionDeadline({ method: 'IN_PERSON', meetingAt: t.meeting_at }, new Date(), earliest);
        const actual = Date.parse(t.inspection_deadline_at ?? '');
        const clampHolds =
          earliest !== null && actual <= Date.parse(earliest) - COLLATERAL_MARGIN_HOURS * 3_600_000 + 1_000;
        return clampHolds && Math.abs(actual - Date.parse(expected)) < 5 * 60_000;
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        // Desktop: the inspection banner. Phone: the step card's clock (the banner
        // is hidden there, 2026-11-27).
        return (await textShown(page, /^Inspection window · /)) || textShown(page, /^Completes /);
      },
      expect: true,
    });

    await step('Alice accepts what she received', 'alice', async (page) => {
      await openRoom(page, tradeId);
      await acceptItem(page);
    });
    await step('Bob accepts what he received', 'bob', async (page) => {
      await openRoom(page, tradeId);
      await acceptItem(page);
    });

    await expectTradeState(ctx, 'bob', tradeId, 'COMPLETED', 'Both accepted: the trade is complete');
    await assertState('Both holds are voided in Stripe test mode', {
      member: 'bob',
      db: async () => ({
        rows: (await tradeHolds(tradeId)).map((h) => h.status),
        stripe: Object.values(await stripeHoldStatuses(tradeId)),
      }),
      ui: async (page) => ({
        rows: (await roomState(page)) === 'Completed' ? ['VOIDED', 'VOIDED'] : [],
        stripe: ['canceled', 'canceled'],
      }),
      expect: { rows: ['VOIDED', 'VOIDED'], stripe: ['canceled', 'canceled'] },
    });

    await arrange('The hourly payout job drains the queued cash release', async () => {
      await runJobOk('cash-sale-payouts');
    });
    // The release policy may hold a new receiver's money for its holdback window
    // (`decideRelease`); either way the cash is on its way to Bob and the room says so.
    await assertState('The cash leg is released to Bob, or scheduled for release', {
      member: 'bob',
      db: async () => {
        const leg = await tradeCashLeg(tradeId);
        return leg?.status === 'RELEASED' || leg?.status === 'RELEASE_PENDING';
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        return textShown(page, new RegExp(`^Cash of ${cash.replace(/[$.]/g, '\\$&')} (released|is being released)$`));
      },
      expect: true,
    });
  },
);

pathway(
  {
    id: 'trades.cash-leg.fx-disclosure',
    title: 'A cash leg in a converted currency discloses the conversion fee before Pay',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: {
      payer: persona('trade-eur-payer', { regionCode: 'DE', identityVerified: true, savedCard: true }),
      owner: persona('trade-eur-owner', { regionCode: 'DE', identityVerified: true, savedCard: true }),
    },
    personaOptions: { payer: { card: 'pm_card_fr' }, owner: { card: 'pm_card_de' } },
    viewports: 'both',
    requiresSeed: ['trade-pair-a-alice'],
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState } = ctx;
    const [payerCard, ownerCard] = await arrange('Two EEA traders each list a card of equal value', async () => {
      await arrangeSellerPersona(memberId(ctx, 'owner'));
      return Promise.all([
        seedListing(memberId(ctx, 'payer'), 'eur-payer', { place: STUB_PLACES.berlin }),
        seedListing(memberId(ctx, 'owner'), 'eur-owner', { place: STUB_PLACES.berlin }),
      ]);
    });
    const tradeId = await propose(ctx, 'payer', 'The payer', ownerCard, payerCard, { cash: { dollars: '10.00', direction: 'add' } });
    await meet(ctx, 'owner', tradeId, 'The owner sets the meeting place and time', {
      place: STUB_PLACES.berlin,
      daysAhead: MEETING_DAYS_AHEAD,
    });
    await accept(ctx, 'payer', tradeId, 'The payer');
    await accept(ctx, 'owner', tradeId, 'The owner');

    // A EUR leg on the US platform is converted, so the PAYER is charged the
    // Currency_Conversion fee (`currencyConversionFeeFor`, the same function the charge
    // uses) and the receiver gets exactly the agreed cash.
    const fee = currencyConversionFeeFor(1_000, 'eur');
    const feeText = formatMoney(fee, 'EUR');
    const total = formatMoney(1_000 + fee, 'EUR');
    await assertState('The payer is shown the conversion fee and the total before paying', {
      member: 'payer',
      db: async () => {
        const t = await readTrade(tradeId);
        return { currency: (t.currency ?? '').toUpperCase(), fee: currencyConversionFeeFor(t.cash_amount_cents, t.currency) };
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        const notice = page.getByRole('note', { name: 'Currency' }).filter({ visible: true }).first();
        const disclosed = await notice
          .innerText()
          .then((text) => text.includes(`Includes a ${feeText} currency conversion fee (2%)`))
          .catch(() => false);
        const payButton = await page.getByRole('button', { name: `Pay ${total}` }).filter({ visible: true }).count();
        return { currency: disclosed && payButton > 0 ? 'EUR' : 'not disclosed', fee: disclosed ? fee : 0 };
      },
      expect: { currency: 'EUR', fee },
    });
  },
);

pathway(
  {
    id: 'trades.cash-leg.unpaid-pay-by-abandons',
    title: 'Cash left unpaid at its deadline cancels the trade and releases the cards',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: { alice: ALICE, bob: BOB },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState, simulated } = ctx;
    const [aliceCard, bobCard] = await arrange('Alice and Bob each list a card of equal value', () =>
      Promise.all([seedListing(ALICE.id, 'alice'), seedListing(BOB.id, 'bob')]),
    );
    const tradeId = await agreeSwap(
      ctx,
      { initiator: 'alice', owner: 'bob', initiatorName: 'Alice', ownerName: 'Bob' },
      bobCard,
      aliceCard,
      { cash: { dollars: '10.00', direction: 'add' } },
    );
    await expectTradeState(ctx, 'alice', tradeId, 'COLLATERAL_PENDING', 'Both traders agree the terms');

    await simulated(
      'Rewinding the meeting into the placement window and the cash deadline (pay_by) into the past, then the hourly job runs',
      { mechanism: 'moved-timestamp', reason: 'pay_by is a day before the meeting; nobody waits for it.' },
      async () => {
        const { meeting_at } = await readTrade(tradeId);
        if (!meeting_at) throw new Error('the trade has no meeting');
        const shift = rewindToward(meeting_at, MEETING_IN_WINDOW_MS);
        await rewind('trades', tradeId, ['meeting_at'], shift);
        // `pay_by` sits BOND_PLACEMENT_LEAD_HOURS before the meeting, so the same move
        // puts it 22 hours in the past.
        await rewind('trade_cash_settlements', tradeId, ['pay_by'], shift, { key: 'trade_id' });
        await runJobOk('trade-inspections');
      },
    );

    await expectTradeState(ctx, 'alice', tradeId, 'CANCELLED', 'The unpaid trade is cancelled');
    await assertState('Nothing was held or charged and both cards are back on the market', {
      member: 'bob',
      db: async () => ({
        holds: (await tradeHolds(tradeId)).filter((h) => h.status === 'ACTIVE').length,
        unrefundedFees: (await tradeFees(tradeId)).filter((f) => f.status === 'SETTLED').length,
        cards: [await itemStatus(aliceCard.id), await itemStatus(bobCard.id)],
      }),
      ui: async (page) => {
        await page.goto(`/listings/${aliceCard.id}`);
        const available = await proposeTradeButton(page).isVisible({ timeout: 15_000 }).catch(() => false);
        return { holds: 0, unrefundedFees: 0, cards: available ? ['AVAILABLE', 'AVAILABLE'] : ['not available'] };
      },
      expect: { holds: 0, unrefundedFees: 0, cards: ['AVAILABLE', 'AVAILABLE'] },
    });
    await assertState('Both traders are told the trade was cancelled', {
      member: 'alice',
      db: async () =>
        (await tradeNotificationCount(ALICE.id, tradeId, 'Trade cancelled')) >= 1 &&
        (await tradeNotificationCount(BOB.id, tradeId, 'Trade cancelled')) >= 1,
      ui: async (page) => {
        await page.goto('/notifications');
        return textShown(page, 'Trade cancelled');
      },
      expect: true,
    });
  },
);

// ---------------------------------------------------------------------------
// Collateral (Req 15.7, 15.8) and completion by the job (15.10, 15.11)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trades.collateral.locks-live-and-job-completes',
    title: 'Collateral locks with one notice and a live room, and the job completes an untouched inspection',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    // Personas, so the notification centre holds this trade's notices and no other
    // Pathway's: "exactly one" is then checkable on screen as well as in the table.
    members: {
      initiator: persona('trade-lock-initiator', { identityVerified: true, savedCard: true }),
      owner: persona('trade-lock-owner', { identityVerified: true, savedCard: true }),
    },
    personaOptions: { initiator: { card: 'pm_card_us' }, owner: { card: 'pm_card_gb' } },
    viewports: 'both',
    requiresSeed: ['trade-pair-a-alice'],
    knownFindings: ['F21'],
    timeout: LONG_PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState, step, simulated } = ctx;
    const initiatorId = memberId(ctx, 'initiator');
    const ownerId = memberId(ctx, 'owner');
    const [initiatorCard, ownerCard] = await arrange('Both traders list a card of equal value', async () => {
      await arrangeSellerPersona(ownerId);
      return Promise.all([seedListing(initiatorId, 'lock-initiator'), seedListing(ownerId, 'lock-owner')]);
    });
    const tradeId = await agreeSwap(
      ctx,
      { initiator: 'initiator', owner: 'owner', initiatorName: 'The initiator', ownerName: 'The owner' },
      ownerCard,
      initiatorCard,
    );

    await step('Both traders keep the room open', ['initiator', 'owner'], async (_page, pages) => {
      await openRoom(pages.initiator, tradeId);
      await openRoom(pages.owner, tradeId);
    });
    await meetingDue(ctx, tradeId);

    // F21: the room must move on its own, with no reload, when the holds land.
    await assertState('The open room shows collateral locked without a reload', {
      member: 'initiator',
      db: () => dbStateLabel(tradeId),
      ui: (page) => roomState(page),
      expect: STATE_LABEL.COLLATERAL_LOCKED,
    });
    await assertState('Each trader gets exactly one "Trade collateral locked" notice', {
      member: 'owner',
      db: async () => [
        await tradeNotificationCount(initiatorId, tradeId, 'Trade collateral locked'),
        await tradeNotificationCount(ownerId, tradeId, 'Trade collateral locked'),
      ],
      ui: async (page) => {
        await page.goto('/notifications');
        const rows = await page.getByRole('button').filter({ hasText: 'Trade collateral locked' }).filter({ visible: true }).count();
        return [rows, rows];
      },
      expect: [1, 1],
    });

    await step('The initiator confirms the handover happened', 'initiator', async (page) => {
      await openRoom(page, tradeId);
      await confirmHandover(page);
    });
    await step('The owner confirms the handover happened', 'owner', async (page) => {
      await openRoom(page, tradeId);
      await confirmHandover(page);
    });
    await expectTradeState(ctx, 'initiator', tradeId, 'INSPECTION', 'Both confirmed: the trade is in inspection');

    await simulated(
      'Rewinding the inspection deadline into the past, then the hourly trade-inspections job runs',
      { mechanism: 'moved-timestamp', reason: 'The inspection window is 72 hours.' },
      async () => {
        const { inspection_deadline_at } = await readTrade(tradeId);
        if (!inspection_deadline_at) throw new Error('the trade has no inspection deadline');
        await rewind('trades', tradeId, ['inspection_deadline_at'], rewindToward(inspection_deadline_at, -60_000));
        await runJobOk('trade-inspections');
      },
    );

    await expectTradeState(ctx, 'owner', tradeId, 'COMPLETED', 'The untouched inspection completes on its own');
    await assertState('Both holds are voided in Stripe test mode', {
      member: 'owner',
      db: async () => ({
        rows: (await tradeHolds(tradeId)).map((h) => h.status),
        stripe: Object.values(await stripeHoldStatuses(tradeId)),
      }),
      ui: async (page) => ({
        rows: (await roomState(page)) === 'Completed' ? ['VOIDED', 'VOIDED'] : [],
        stripe: ['canceled', 'canceled'],
      }),
      expect: { rows: ['VOIDED', 'VOIDED'], stripe: ['canceled', 'canceled'] },
    });
  },
);

pathway(
  {
    id: 'trades.collateral.declined-hold-voids-other',
    title: 'A declined card voids the other trader\'s hold and charges nothing',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: { alice: ALICE, owner: persona('trade-declining-card', { identityVerified: true, savedCard: true }) },
    // Attaches to the Customer, then every charge or authorisation on it is declined.
    personaOptions: { owner: { card: 'pm_card_chargeCustomerFail' } },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState } = ctx;
    const ownerId = memberId(ctx, 'owner');
    const [aliceCard, ownerCard] = await arrange('Alice and the owner each list a card of equal value', async () => {
      await arrangeSellerPersona(ownerId);
      return Promise.all([seedListing(ALICE.id, 'alice'), seedListing(ownerId, 'declining')]);
    });
    const tradeId = await agreeSwap(
      ctx,
      { initiator: 'alice', owner: 'owner', initiatorName: 'Alice', ownerName: 'The owner' },
      ownerCard,
      aliceCard,
    );
    await meetingDue(ctx, tradeId);

    // HOLDS_FAILED loops back to COLLATERAL_PENDING so the card can be replaced, voids
    // the hold that did go through, and charges no Trade_Fee (holds come first).
    await expectTradeState(ctx, 'owner', tradeId, 'COLLATERAL_PENDING', 'The trade is paused waiting for collateral');
    await assertState('Alice\'s authorised hold is voided in Stripe, the declined one failed, and no fee was charged', {
      member: 'owner',
      db: async () => {
        const holds = await tradeHolds(tradeId);
        const stripe = await stripeHoldStatuses(tradeId);
        return {
          alice: [...new Set(holds.filter((h) => h.trader_id === ALICE.id).map((h) => `${h.status}:${stripe[ALICE.id] ?? 'none'}`))],
          owner: [...new Set(holds.filter((h) => h.trader_id === ownerId).map((h) => h.status))],
          chargedFees: (await tradeFees(tradeId)).filter((f) => f.status === 'SETTLED').length,
        };
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        const paused = await textShown(page, /A card declined the hold, so the trade is paused\. Nothing was\s+charged\./);
        return paused
          ? { alice: ['VOIDED:canceled'], owner: ['FAILED'], chargedFees: 0 }
          : { alice: [], owner: [], chargedFees: -1 };
      },
      expect: { alice: ['VOIDED:canceled'], owner: ['FAILED'], chargedFees: 0 },
    });
    await assertState('The room offers the trader a retry', {
      member: 'owner',
      db: async () => (await readTrade(tradeId)).state === 'COLLATERAL_PENDING',
      ui: async (page) => (await page.getByRole('button', { name: 'Retry hold' }).filter({ visible: true }).count()) > 0,
      expect: true,
    });
  },
);

// ---------------------------------------------------------------------------
// Meeting changes after agreement (Req 15.9)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trades.meeting.change-proposal-accepted',
    title: 'Before the placement cutoff a meeting change is a proposal the other trader accepts',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: { alice: ALICE, bob: BOB },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState, step } = ctx;
    const [aliceCard, bobCard] = await arrange('Alice and Bob each list a card of equal value', () =>
      Promise.all([seedListing(ALICE.id, 'alice'), seedListing(BOB.id, 'bob')]),
    );
    const tradeId = await agreeSwap(ctx, { initiator: 'alice', owner: 'bob', initiatorName: 'Alice', ownerName: 'Bob' }, bobCard, aliceCard);

    await step('Alice proposes a new meeting place and day', 'alice', async (page) => {
      await openRoom(page, tradeId);
      await setMeeting(page, { place: STUB_PLACES.brisbane, daysAhead: MEETING_DAYS_AHEAD + 2 });
    });
    // ESC-04: once agreed, nobody moves the meeting alone. Nothing changes yet.
    await assertState('The change waits for Bob, and the agreed meeting is unchanged', {
      member: 'bob',
      db: async () => {
        const [change, t] = await Promise.all([latestHandoverChange(tradeId), readTrade(tradeId)]);
        return {
          pending: change !== null && change.decision === null && change.proposed_by === ALICE.id,
          moved: (t.meeting_location ?? '').includes(STUB_PLACES.brisbane.mainText),
        };
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        return { pending: await textShown(page, /proposed new meeting details$/), moved: false };
      },
      expect: { pending: true, moved: false },
    });

    await step('Bob accepts the proposed meeting', 'bob', async (page) => {
      const banner = page.getByRole('region', { name: /proposed new meeting details$/ }).filter({ visible: true }).first();
      await banner.getByRole('button', { name: 'Accept', exact: true }).click();
      await expect(banner).toBeHidden({ timeout: 30_000 });
    });
    await assertState('The new meeting is now the agreed one', {
      member: 'alice',
      db: async () => {
        const [change, t] = await Promise.all([latestHandoverChange(tradeId), readTrade(tradeId)]);
        return { decision: change?.decision ?? null, moved: (t.meeting_location ?? '').includes(STUB_PLACES.brisbane.mainText) };
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        await openDetailsTab(page, /^Summary/);
        const moved = await textShown(page, STUB_PLACES.brisbane.mainText);
        await closeDetails(page);
        return { decision: 'ACCEPTED', moved };
      },
      expect: { decision: 'ACCEPTED', moved: true },
    });
  },
);

pathway(
  {
    id: 'trades.meeting.change-refused-after-cutoff',
    title: 'Inside the placement window the meeting can no longer change',
    area: 'trades',
    kind: 'refusal',
    provider: 'stripe',
    members: { alice: ALICE, bob: BOB },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, refusal, simulated, assertState } = ctx;
    const [aliceCard, bobCard] = await arrange('Alice and Bob each list a card of equal value', () =>
      Promise.all([seedListing(ALICE.id, 'alice'), seedListing(BOB.id, 'bob')]),
    );
    const tradeId = await agreeSwap(ctx, { initiator: 'alice', owner: 'bob', initiatorName: 'Alice', ownerName: 'Bob' }, bobCard, aliceCard);

    await simulated(
      'Rewinding the meeting clock to inside the 24-hour placement window',
      { mechanism: 'moved-timestamp', reason: 'The cutoff is a day before the meeting.' },
      async () => {
        const { meeting_at } = await readTrade(tradeId);
        if (!meeting_at) throw new Error('the trade has no meeting');
        await rewind('trades', tradeId, ['meeting_at'], rewindToward(meeting_at, MEETING_IN_WINDOW_MS));
      },
    );
    const locked = await arrange('Read the locked meeting', () => readTrade(tradeId));

    // `updateTradeHandoverTerms` refuses as `invalid-state` (ESC-04). The editor's copy
    // for that code is what the member reads.
    await refusal(
      'Alice tries to move the meeting and is refused',
      'alice',
      async (page) => {
        await openRoom(page, tradeId);
        await saveMeetingTerms(page, { place: STUB_PLACES.brisbane, daysAhead: MEETING_DAYS_AHEAD + 2 });
      },
      {
        // The lock names the placement cutoff of THIS meeting (ESC-04), not a generic
        // "shipped" line: the copy is derived from the stored meeting time.
        message: meetingLockMessage(locked.meeting_at),
        // The refusal is written inside the Meeting terms dialog the member saved from. The
        // dialog only exists once the step opens it, so it cannot be a precondition here.
        messageIn: (page) => page.getByRole('dialog', { name: 'Meeting terms' }),
      },
    );
    await assertState('The meeting did not move and no proposal was made', {
      member: 'alice',
      db: async () => {
        const [t, change] = await Promise.all([readTrade(tradeId), latestHandoverChange(tradeId)]);
        return { same: t.meeting_at === locked.meeting_at, proposal: change !== null };
      },
      ui: async (page) => ({
        same: true,
        proposal: await textShown(page, /Waiting for .+ to accept the new meeting details/),
      }),
      expect: { same: true, proposal: false },
    });
  },
);

// ---------------------------------------------------------------------------
// Multiple items (Req 15.12)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trades.shopfront.side-valued-at-offer',
    title: 'Trading for cards out of a Multiple items listing values that side at the offer',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: { alice: ALICE, bob: BOB },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState, step } = ctx;
    const [aliceCard, bobListing] = await arrange('Alice lists a card; Bob lists Multiple items with a A$500.00 "from" price', () =>
      Promise.all([
        seedListing(ALICE.id, 'alice'),
        seedListing(BOB.id, 'bob-multiple', { kind: 'SHOPFRONT', priceMinor: FMV_MINOR * 2 }),
      ]),
    );
    const tradeId = await propose(ctx, 'alice', 'Alice', bobListing, aliceCard, {
      wantedGoods: 'The two holo Charizards on page one',
      shopfront: true,
    });
    await meet(ctx, 'bob', tradeId, 'Bob sets the meeting place and time');
    await accept(ctx, 'alice', tradeId, 'Alice');

    // The goods coming out of the listing are part of the TERMS: revising them voids
    // Alice's acceptance, exactly as changing the cash does (0081).
    await step('Bob revises which cards come out of the listing', 'bob', async (page) => {
      await openRoom(page, tradeId);
      await changeCash(page, { dollars: '0.00', goods: 'One holo Charizard and one Blastoise from page one' });
    });
    await assertState('Alice must accept the revised cards again', {
      member: 'alice',
      db: async () => {
        const t = await readTrade(tradeId);
        return t.initiator_terms_accepted_version === t.terms_version;
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        return !(await acceptOffered(page));
      },
      expect: false,
    });
    await accept(ctx, 'alice', tradeId, 'Alice');
    await expectTradeState(ctx, 'bob', tradeId, 'COLLATERAL_PENDING', 'Terms agreed on the Multiple items trade');

    // `resolveTradeSideValues`: the binder side is worth what is offered against it,
    // never its own "from" price.
    await assertState('Bob\'s side is valued at Alice\'s A$250.00 card, not the A$500.00 "from" price', {
      member: 'bob',
      db: async () => {
        const t = await readTrade(tradeId);
        return { initiator: t.initiator_side_minor, counterpart: t.counterpart_side_minor };
      },
      ui: async (page) => {
        await openRoom(page, tradeId);
        const shown = await roomHeadlineMinor(page);
        return { initiator: shown, counterpart: shown };
      },
      expect: { initiator: FMV_MINOR, counterpart: FMV_MINOR },
    });
  },
);

pathway(
  {
    id: 'trades.shopfront.refused-as-offering-side',
    title: 'A Multiple items listing cannot be put up as the offering side',
    area: 'trades',
    kind: 'refusal',
    provider: 'stripe',
    members: { alice: ALICE },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, refusal, step } = ctx;
    const [aliceListing, bobCard] = await arrange('Alice lists Multiple items; Bob lists a card', () =>
      Promise.all([
        seedListing(ALICE.id, 'alice-multiple', { kind: 'SHOPFRONT', priceMinor: FMV_MINOR }),
        seedListing(BOB.id, 'bob'),
      ]),
    );

    await step('The offer form does not list Alice\'s Multiple items listing', 'alice', async (page) => {
      const dialog = await openProposeDialog(page, bobCard.id);
      expect(await ownListingOffered(page, dialog, aliceListing.title)).toBe(false);
      await page.keyboard.press('Escape');
    });

    await refusal(
      'Offering it from the mobile app is refused',
      'alice',
      async (page) => {
        const reply = await mobilePost(page, 'trades/open', openOfferBody(bobCard.id, aliceListing.id));
        return { code: reply.body?.error, message: reply.body?.message };
      },
      {
        code: 'invalid-terms',
        message: 'A listing with multiple items cannot be put up as your side of a trade. Offer the individual cards instead.',
      },
    );
  },
);

// ---------------------------------------------------------------------------
// Abandonment (Req 15.13)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trades.abandon.meeting-passed-unlocked',
    title: 'A meeting that passes without collateral locking cancels the trade and restores the cards',
    area: 'trades',
    kind: 'happy',
    provider: 'stripe',
    members: { alice: ALICE, owner: persona('trade-abandon-card', { identityVerified: true, savedCard: true }) },
    // A card that declines keeps the trade from ever locking.
    personaOptions: { owner: { card: 'pm_card_chargeCustomerFail' } },
    viewports: 'both',
    requiresSeed: SEED,
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, assertState, simulated } = ctx;
    const ownerId = memberId(ctx, 'owner');
    const [aliceCard, ownerCard] = await arrange('Alice and the owner each list a card of equal value', async () => {
      await arrangeSellerPersona(ownerId);
      return Promise.all([seedListing(ALICE.id, 'alice'), seedListing(ownerId, 'abandon')]);
    });
    const tradeId = await agreeSwap(
      ctx,
      { initiator: 'alice', owner: 'owner', initiatorName: 'Alice', ownerName: 'The owner' },
      ownerCard,
      aliceCard,
    );

    await simulated(
      'Rewinding the meeting clock to an hour ago, then the hourly trade-inspections job runs',
      { mechanism: 'moved-timestamp', reason: 'The meeting is days away; the abandon fires once it has passed.' },
      async () => {
        const { meeting_at } = await readTrade(tradeId);
        if (!meeting_at) throw new Error('the trade has no meeting');
        await rewind('trades', tradeId, ['meeting_at'], rewindToward(meeting_at, -hoursFromNow(1)));
        await runJobOk('trade-inspections');
      },
    );

    await expectTradeState(ctx, 'alice', tradeId, 'CANCELLED', 'The trade is cancelled');
    await assertState('No hold is left live in Stripe and both cards are back on the market', {
      member: 'alice',
      db: async () => ({
        live: Object.values(await stripeHoldStatuses(tradeId)).filter((s) => s === 'requires_capture').length,
        activeRows: (await tradeHolds(tradeId)).filter((h) => h.status === 'ACTIVE').length,
        cards: [await itemStatus(aliceCard.id), await itemStatus(ownerCard.id)],
      }),
      ui: async (page) => {
        await page.goto(`/listings/${ownerCard.id}`);
        const available = await proposeTradeButton(page).isVisible({ timeout: 15_000 }).catch(() => false);
        return { live: 0, activeRows: 0, cards: available ? ['AVAILABLE', 'AVAILABLE'] : ['not available'] };
      },
      expect: { live: 0, activeRows: 0, cards: ['AVAILABLE', 'AVAILABLE'] },
    });
  },
);

// ---------------------------------------------------------------------------
// Region (Req 15.14)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'trades.open.refused-region-mismatch',
    title: 'A trader cannot open a trade with a member on another platform',
    area: 'trades',
    kind: 'refusal',
    provider: 'stripe',
    members: { victor: VICTOR_US_BUYER },
    viewports: 'both',
    requiresSeed: [...SEED, 'victor'],
    timeout: PATHWAY_MS,
  },
  async (ctx) => {
    const { arrange, refusal } = ctx;
    const [aliceCard, victorCard] = await arrange('Alice (AU) and Victor (US) each list a card', () =>
      Promise.all([
        seedListing(ALICE.id, 'alice'),
        seedListing(VICTOR_US_BUYER.id, 'victor', { priceMinor: FMV_MINOR, place: STUB_PLACES.portland }),
      ]),
    );

    // `checkRegionCompatibility` is a contract guard: the listing only warns, the
    // offer is refused. The refusal message is the same text the listing warns with.
    await refusal(
      'Victor\'s offer on an Australian listing is refused, as the listing warned',
      'victor',
      async (page) => {
        await page.goto(`/listings/${aliceCard.id}`);
        await page.waitForLoadState('domcontentloaded');
        const reply = await mobilePost(page, 'trades/open', openOfferBody(aliceCard.id, victorCard.id));
        const message = reply.body?.message;
        if (message) await expect(page.getByText(message).filter({ visible: true }).first()).toBeVisible();
        return { code: reply.body?.error };
      },
      { code: 'region-mismatch' },
    );
  },
);
