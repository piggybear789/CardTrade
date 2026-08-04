import { describe, it, expect, beforeEach } from 'vitest';

import { MockService } from '@/domain/services/mock/MockService';
import type { TradeRecord } from '@/domain/orchestrator/tradeOrchestrator';
import {
  proposeTrade,
  createCollateralSideEffects,
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
    // Both unverified, so both must bond 100% of their own item's FMV.
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

    // One hold per trader, each sized at 100% of that trader's own item FMV (Req 5.4).
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

  it('bonds only the unverified trader when symmetry is disabled', async () => {
    seedTwoTraders(repo, 5000);
    repo.profiles.set('alice', { id: 'alice', verified: false, payerId: 'payer_alice' });
    const payments = makePayments();

    const result = await proposeTrade(
      { repository: repo, payments, symmetricBonds: false },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bondsRequired).toBe(1);
    const holds = await repo.getHolds(result.trade.id);
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({ traderId: 'alice', amountCents: 5000 });
  });

  it('places no bond at all when both traders are verified', async () => {
    seedTwoTraders(repo, 5000);
    const payments = makePayments();

    const result = await proposeTrade(
      { repository: repo, payments },
      { proposerId: 'alice', initiatorItemId: 'item_a', counterpartItemId: 'item_b' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Verified identity replaces the bond, so nothing is charged (revised Req 5.4).
    expect(result.bondsRequired).toBe(0);
    expect(await repo.getHolds(result.trade.id)).toHaveLength(0);
    // The trade still exists and both items are reserved.
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
});
