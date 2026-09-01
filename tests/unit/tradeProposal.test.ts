import { describe, it, expect, beforeEach } from 'vitest';

import { MockService } from '@/domain/services/mock/MockService';
import type { TradeRecord } from '@/domain/orchestrator/tradeOrchestrator';
import {
  proposeTrade,
  createCollateralSideEffects,
  placeBondsForAgreedTrade,
  currentHoldsAreActive,
  type CreateTradeParams,
  type HoldRecordInput,
  type ItemRecord,
  type ProfileRecord,
  type RecordedHold,
  type TradeProposalRepository,
} from '@/domain/orchestrator/tradeProposal';
import type { PreAuthHold } from '@/domain/services/types';

// ---------------------------------------------------------------------------
// In-memory fake repository (stands in for the Supabase-backed binding). It
// records mutations so tests can assert reservation / hold effects without a DB.
// ---------------------------------------------------------------------------

class FakeTradeProposalRepository implements TradeProposalRepository {
  profiles = new Map<string, ProfileRecord>();
  items = new Map<string, ItemRecord>();
  trades = new Map<string, TradeRecord>();
  holds: RecordedHold[] = [];
  /** Extra bundled item ids per trade, on top of the two primary columns. */
  bundleIds = new Map<string, string[]>();
  private seq = 0;

  async getProfile(profileId: string): Promise<ProfileRecord | null> {
    return this.profiles.get(profileId) ?? null;
  }

  async getItem(itemId: string): Promise<ItemRecord | null> {
    const item = this.items.get(itemId);
    return item ? { ...item } : null;
  }

  async createTrade(params: CreateTradeParams): Promise<TradeRecord> {
    const id = `trade_${++this.seq}`;
    const trade: TradeRecord = {
      id,
      state: 'COLLATERAL_PENDING',
      version: 0,
      initiator_id: params.initiatorId,
      counterpart_id: params.counterpartId,
      initiator_item_id: params.initiatorItemId,
      counterpart_item_id: params.counterpartItemId,
    };
    this.trades.set(id, trade);
    return { ...trade };
  }

  async reserveItems(itemIds: string[]): Promise<void> {
    for (const id of itemIds) {
      const item = this.items.get(id);
      if (item) item.status = 'RESERVED';
    }
  }

  async restoreItems(itemIds: string[]): Promise<void> {
    for (const id of itemIds) {
      const item = this.items.get(id);
      if (item) item.status = 'AVAILABLE';
    }
  }

  async recordHold(hold: HoldRecordInput): Promise<void> {
    this.holds.push({ ...hold });
  }

  async getHolds(tradeId: string): Promise<RecordedHold[]> {
    return this.holds.filter((h) => h.tradeId === tradeId).map((h) => ({ ...h }));
  }

  async listTradeItemIds(tradeId: string): Promise<string[]> {
    const trade = this.trades.get(tradeId);
    if (!trade) return [];
    const extras = this.bundleIds.get(tradeId) ?? [];
    return [
      trade.initiator_item_id as string,
      trade.counterpart_item_id as string,
      ...extras,
    ].filter((id) => typeof id === 'string' && id.length > 0);
  }

  async markHoldStatus(holdRef: string, status: PreAuthHold['status']): Promise<void> {
    for (const hold of this.holds) {
      if (hold.holdRef === holdRef) hold.status = status;
    }
  }
}

/** A MockService with a no-op webhook transport (holds/voids never hit HTTP). */
function makePayments(scenario?: ConstructorParameters<typeof MockService>[0]['scenario']) {
  return new MockService({
    webhookUrl: 'http://localhost/api/webhooks/stripe',
    secret: 'test-secret',
    scenario,
    fetchFn: async () => ({}),
  });
}

function seedTwoTraders(repo: FakeTradeProposalRepository, fmv = 5000) {
  repo.profiles.set('alice', { id: 'alice', verified: true, payerId: 'payer_alice' });
  repo.profiles.set('bob', { id: 'bob', verified: true, payerId: 'payer_bob' });
  repo.items.set('item_a', { id: 'item_a', ownerId: 'alice', fmvCents: fmv, status: 'AVAILABLE' });
  repo.items.set('item_b', { id: 'item_b', ownerId: 'bob', fmvCents: fmv, status: 'AVAILABLE' });
}

describe('proposeTrade (Req 2.4, 5.1, 5.3, 5.4)', () => {
  let repo: FakeTradeProposalRepository;

  beforeEach(() => {
    repo = new FakeTradeProposalRepository();
  });

  it('creates a COLLATERAL_PENDING trade, reserves both items, and bonds both unverified traders', async () => {
    seedTwoTraders(repo, 5000);
    // Verification is irrelevant to a trade bond — both sides post one regardless.
    repo.profiles.set('alice', { id: 'alice', verified: false, payerId: 'payer_alice' });
    repo.profiles.set('bob', { id: 'bob', verified: false, payerId: 'payer_bob' });
    const payments = makePayments();

    const result = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.trade.state).toBe('COLLATERAL_PENDING');
    expect(result.trade.counterpart_id).toBe('bob');

    // Both items reserved (Req 5.1).
    expect(repo.items.get('item_a')?.status).toBe('RESERVED');
    expect(repo.items.get('item_b')?.status).toBe('RESERVED');

    // One hold per trader, each sized at 100% of what that trader RECEIVES (Req 5.4).
    // Both items are seeded at 5000, so the two readings agree here by construction —
    // `bondPolicy.test.ts` is where the crossing itself is pinned.
    const holds = await repo.getHolds(result.trade.id);
    expect(holds).toHaveLength(2);
    for (const hold of holds) {
      expect(hold.amountCents).toBe(5000);
      expect(hold.status).toBe('ACTIVE');
    }
    expect(holds.map((h) => h.traderId).sort()).toEqual(['alice', 'bob']);
  });

  it('bonds BOTH traders when either is unverified (symmetric bonds)', async () => {
    seedTwoTraders(repo, 5000);
    repo.profiles.set('alice', { id: 'alice', verified: false, payerId: 'payer_alice' });
    const payments = makePayments();

    const result = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Verified Bob still bonds: otherwise unverified Alice would be the only
    // party with money at risk, and Bob could defect for free.
    expect(result.bondsRequired).toBe(2);

    const holds = await repo.getHolds(result.trade.id);
    expect(holds.map((h) => h.traderId).sort()).toEqual(['alice', 'bob']);
    expect(holds.every((h) => h.amountCents === 5000)).toBe(true);
  });

  it('bonds BOTH traders even when both are verified', async () => {
    seedTwoTraders(repo, 5000);
    const payments = makePayments();

    const result = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The verified exemption is gone for trades. It made every legal trade post zero
    // collateral — both parties must satisfy the Identity_Gate to enter escrow, and
    // that Gate IS "verified" — so the Friction_Tax (Req 7.3) had nothing to capture
    // and an Objective_Fraud finding (Req 8.3) had nothing to pay the victim.
    expect(result.bondsRequired).toBe(2);
    const holds = await repo.getHolds(result.trade.id);
    expect(holds.map((h) => h.traderId).sort()).toEqual(['alice', 'bob']);
    expect(holds.every((h) => h.amountCents === 5000)).toBe(true);
    expect(repo.items.get('item_a')?.status).toBe('RESERVED');
    expect(repo.items.get('item_b')?.status).toBe('RESERVED');
  });

  it('rejects an unverified trader with no payment instrument to bond against', async () => {
    seedTwoTraders(repo, 5000);
    repo.profiles.set('alice', { id: 'alice', verified: false, payerId: null });
    const payments = makePayments();

    const result = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );

    // Neither identity nor money stands behind the trade.
    expect(result).toEqual({ ok: false, error: 'payer-not-found' });
    expect(repo.items.get('item_a')?.status).toBe('AVAILABLE');
    expect(repo.trades.size).toBe(0);
    expect(repo.holds).toHaveLength(0);
  });

  it('allows unequal-value pairings — acceptance, not appraisal, agrees the exchange (Req 5.2, revised)', async () => {
    seedTwoTraders(repo, 5000);
    repo.items.set('item_b', { id: 'item_b', ownerId: 'bob', fmvCents: 9999, status: 'AVAILABLE' });
    const payments = makePayments();

    const result = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both items reserved even though their FMVs differ — the bundle/declared
    // value model replaced strict equal-value pairing.
    expect(repo.items.get('item_a')?.status).toBe('RESERVED');
    expect(repo.items.get('item_b')?.status).toBe('RESERVED');
  });

  it('rejects when a paired item is not AVAILABLE and leaves both items unchanged (Req 5.3)', async () => {
    seedTwoTraders(repo, 5000);
    repo.items.set('item_b', { id: 'item_b', ownerId: 'bob', fmvCents: 5000, status: 'RESERVED' });
    const payments = makePayments();

    const result = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );

    expect(result).toEqual({ ok: false, error: 'item-unavailable' });
    expect(repo.items.get('item_a')?.status).toBe('AVAILABLE');
    expect(repo.items.get('item_b')?.status).toBe('RESERVED');
    expect(repo.trades.size).toBe(0);
  });

  it('rejects when the proposer does not own the offered item', async () => {
    seedTwoTraders(repo, 5000);
    const payments = makePayments();

    // Alice tries to offer Bob's item as her own.
    const result = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_b', counterpartItemId: 'item_a' },
    );

    expect(result).toEqual({ ok: false, error: 'not-owner' });
    expect(repo.trades.size).toBe(0);
  });
});

/**
 * THE CROSSING, PINNED.
 *
 * Each Trader bonds the value of what they RECEIVE, so `resolveTradeBonds` is called
 * with the two sides swapped. Every other bond assertion in this file seeds both
 * sides at the SAME value, which makes the swap invisible: uncross the arguments and
 * they all still pass. `bondPolicy.test.ts` cannot catch it either, because at that
 * level `fmvCents` is just whatever the caller chose to bond against.
 *
 * That gap was live while several comments in `tradeProposal.ts` and `bondPolicy.ts`
 * asserted the opposite rule — that a Trader bonds their own goods. Anyone who
 * "fixed" the code to match those comments would have halved the collateral on every
 * asymmetric trade and seen a green suite. These are the tests that would have failed.
 */
describe('trade bonds are sized on what each Trader receives', () => {
  let repo: FakeTradeProposalRepository;

  beforeEach(() => {
    repo = new FakeTradeProposalRepository();
  });

  /** Alice gives $300 of goods; Bob gives $700. Deliberately unequal. */
  function seedLopsidedTraders() {
    repo.profiles.set('alice', { id: 'alice', verified: true, payerId: 'payer_alice' });
    repo.profiles.set('bob', { id: 'bob', verified: true, payerId: 'payer_bob' });
    repo.items.set('item_a', {
      id: 'item_a',
      ownerId: 'alice',
      fmvCents: 30_000,
      status: 'AVAILABLE',
    });
    repo.items.set('item_b', {
      id: 'item_b',
      ownerId: 'bob',
      fmvCents: 70_000,
      status: 'AVAILABLE',
    });
  }

  it('crosses the sides on the proposal path', async () => {
    seedLopsidedTraders();

    const result = await proposeTrade(
      { repository: repo, payments: makePayments() },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byTrader = new Map(
      (await repo.getHolds(result.trade.id)).map((h) => [h.traderId, h.amountCents]),
    );
    // Alice receives Bob's $700, so Alice's card carries $700 — NOT the $300 she gives.
    expect(byTrader.get('alice')).toBe(70_000);
    expect(byTrader.get('bob')).toBe(30_000);
  });

  it('crosses the sides on the negotiated path', async () => {
    // The path the contract room's Accept actually takes, and the one whose figures
    // the accept dialog now quotes back to the trader before charging them.
    seedLopsidedTraders();
    const trade = await repo.createTrade({
      initiatorId: 'alice',
      counterpartId: 'bob',
      initiatorItemId: 'item_a',
      counterpartItemId: 'item_b',
    });

    const result = await placeBondsForAgreedTrade(
      { repository: repo, payments: makePayments() },
      {
        tradeId: trade.id,
        initiatorId: 'alice',
        counterpartId: 'bob',
        initiatorItemIds: ['item_a'],
        counterpartItemIds: ['item_b'],
      },
    );

    expect(result.ok).toBe(true);

    const byTrader = new Map(
      (await repo.getHolds(trade.id)).map((h) => [h.traderId, h.amountCents]),
    );
    expect(byTrader.get('alice')).toBe(70_000);
    expect(byTrader.get('bob')).toBe(30_000);
  });
});

describe('createCollateralSideEffects — HOLDS_FAILED cancellation (Req 5.6)', () => {
  let repo: FakeTradeProposalRepository;

  beforeEach(() => {
    repo = new FakeTradeProposalRepository();
  });

  it('voids active holds and restores both items to AVAILABLE on HOLDS_FAILED', async () => {
    seedTwoTraders(repo, 5000);
    // Unverified traders so bonds exist to be voided.
    repo.profiles.set('alice', { id: 'alice', verified: false, payerId: 'payer_alice' });
    repo.profiles.set('bob', { id: 'bob', verified: false, payerId: 'payer_bob' });
    const payments = makePayments();

    const proposal = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const trade = proposal.trade;

    const hook = createCollateralSideEffects(repo);
    const outcome = await hook({
      trade,
      event: 'HOLDS_FAILED',
      nextState: 'COLLATERAL_PENDING',
      actorId: 'system',
      payments,
    });

    expect(outcome.ok).toBe(true);
    // Items restored (Req 5.6).
    expect(repo.items.get('item_a')?.status).toBe('AVAILABLE');
    expect(repo.items.get('item_b')?.status).toBe('AVAILABLE');
    // All previously-active holds are now VOIDED (Req 5.6).
    const holds = await repo.getHolds(trade.id);
    expect(holds.every((h) => h.status === 'VOIDED')).toBe(true);
  });

  it('is a no-op for non-HOLDS_FAILED events (e.g. HOLDS_CONFIRMED)', async () => {
    seedTwoTraders(repo, 5000);
    repo.profiles.set('alice', { id: 'alice', verified: false, payerId: 'payer_alice' });
    repo.profiles.set('bob', { id: 'bob', verified: false, payerId: 'payer_bob' });
    const payments = makePayments();

    const proposal = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );
    if (!proposal.ok) return;

    const hook = createCollateralSideEffects(repo);
    const outcome = await hook({
      trade: proposal.trade,
      event: 'HOLDS_CONFIRMED',
      nextState: 'COLLATERAL_LOCKED',
      actorId: 'system',
      payments,
    });

    expect(outcome.ok).toBe(true);
    // Items remain reserved; holds remain active.
    expect(repo.items.get('item_a')?.status).toBe('RESERVED');
    const holds = await repo.getHolds(proposal.trade.id);
    expect(holds.every((h) => h.status === 'ACTIVE')).toBe(true);
  });

  it('restores extra bundled items as well as the two primary ids', async () => {
    seedTwoTraders(repo, 5000);
    repo.profiles.set('alice', { id: 'alice', verified: false, payerId: 'payer_alice' });
    repo.profiles.set('bob', { id: 'bob', verified: false, payerId: 'payer_bob' });
    repo.items.set('item_c', {
      id: 'item_c',
      ownerId: 'alice',
      fmvCents: 1000,
      status: 'RESERVED',
    });
    const payments = makePayments();

    const proposal = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    repo.bundleIds.set(proposal.trade.id, ['item_c']);

    const hook = createCollateralSideEffects(repo);
    await hook({
      trade: proposal.trade,
      event: 'HOLDS_FAILED',
      nextState: 'COLLATERAL_PENDING',
      actorId: 'system',
      payments,
    });

    expect(repo.items.get('item_c')?.status).toBe('AVAILABLE');
  });
});

describe('collateral retry uses a new authorisation key', () => {
  let repo: FakeTradeProposalRepository;

  beforeEach(() => {
    repo = new FakeTradeProposalRepository();
  });

  it('places a second hold under a new ref after the first declined', async () => {
    seedTwoTraders(repo, 5000);
    repo.profiles.set('alice', { id: 'alice', verified: false, payerId: 'payer_alice' });
    repo.profiles.set('bob', { id: 'bob', verified: false, payerId: 'payer_bob' });
    // First placement keys `hold:<trade>:<trader>`. Force those to fail; the
    // retry key (`:2`) is not listed, so it succeeds.
    const payments = makePayments({
      forceFailure: {
        'hold:trade_1:alice': true,
        'hold:trade_1:bob': true,
      },
    });

    const proposal = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;

    const first = await repo.getHolds(proposal.trade.id);
    expect(first.every((h) => h.status === 'FAILED')).toBe(true);
    expect(currentHoldsAreActive(first)).toBe(false);

    const retry = await placeBondsForAgreedTrade(
      { repository: repo, payments },
      {
        tradeId: proposal.trade.id,
        initiatorId: 'alice',
        counterpartId: 'bob',
        initiatorItemIds: ['item_a'],
        counterpartItemIds: ['item_b'],
      },
    );
    expect(retry.ok).toBe(true);

    const all = await repo.getHolds(proposal.trade.id);
    expect(all).toHaveLength(4);
    expect(currentHoldsAreActive(all)).toBe(true);
    const firstRefs = new Set(first.map((h) => h.holdRef));
    const latest = all.filter((h) => h.status === 'ACTIVE');
    expect(latest).toHaveLength(2);
    expect(latest.every((h) => !firstRefs.has(h.holdRef))).toBe(true);
  });
});
