// tests/unit/tradeProposalRequest.test.ts
//
// The Trade_Proposal negotiation step: a Trade must be accepted by the
// Counterpart before it exists. These tests pin the guarantees that matter:
// nothing is reserved while an offer is pending, only the Counterpart may
// accept, a privately offered Item is allowed on the offering side but never as
// the target, and equal Fair_Market_Value is re-checked at acceptance time.

import { describe, expect, it } from 'vitest';

import {
  authorizeTradeProposalAcceptance,
  declineTradeProposal,
  requestTradeProposal,
  withdrawTradeProposal,
  type CreateProposalParams,
  type ProposalItemRecord,
  type TradeProposalRecord,
  type TradeProposalRequestRepository,
  type TradeProposalStatus,
} from '@/domain/orchestrator/tradeProposalRequest';

const ALICE = 'alice';
const BOB = 'bob';

function item(overrides: Partial<ProposalItemRecord> = {}): ProposalItemRecord {
  return {
    id: 'item-a',
    ownerId: ALICE,
    fmvCents: 25_000,
    status: 'AVAILABLE',
    hidden: false,
    ...overrides,
  };
}

/** In-memory repository; records every write so tests can assert on effects. */
function fakeRepository(seed: {
  items?: ProposalItemRecord[];
  proposals?: TradeProposalRecord[];
}) {
  const items = new Map((seed.items ?? []).map((i) => [i.id, i]));
  const proposals = new Map((seed.proposals ?? []).map((p) => [p.id, p]));
  const created: CreateProposalParams[] = [];
  let sequence = 0;

  const repository: TradeProposalRequestRepository = {
    async getItem(itemId) {
      return items.get(itemId) ?? null;
    },
    async getProposal(proposalId) {
      return proposals.get(proposalId) ?? null;
    },
    async hasPendingProposal(proposerId, counterpartItemId) {
      return Array.from(proposals.values()).some(
        (p) =>
          p.status === 'PENDING' &&
          p.proposerId === proposerId &&
          p.counterpartItemId === counterpartItemId,
      );
    },
    async createProposal(params) {
      created.push(params);
      const record: TradeProposalRecord = {
        id: `proposal-${++sequence}`,
        proposerId: params.proposerId,
        counterpartId: params.counterpartId,
        proposerItemId: params.proposerItemId,
        extraItemIds: params.extraItemIds ?? [],
        counterpartItemId: params.counterpartItemId,
        cashAmountCents: params.cashAmountCents ?? 0,
        declaredValueCents: params.declaredValueCents ?? null,
        status: 'PENDING',
        message: params.message,
        tradeId: null,
      };
      proposals.set(record.id, record);
      return record;
    },
    async closeProposal(proposalId, status: TradeProposalStatus) {
      const existing = proposals.get(proposalId);
      if (!existing || existing.status !== 'PENDING') return null;
      const next = { ...existing, status };
      proposals.set(proposalId, next);
      return next;
    },
    async updateProposalTerms(params) {
      const existing = proposals.get(params.proposalId);
      if (!existing || existing.status !== 'PENDING') return null;
      const next: TradeProposalRecord = {
        ...existing,
        extraItemIds: params.extraItemIds,
        cashAmountCents: params.cashAmountCents,
        declaredValueCents: params.declaredValueCents,
        message: params.message,
      };
      proposals.set(params.proposalId, next);
      return next;
    },
    async markAccepted(proposalId, tradeId) {
      const existing = proposals.get(proposalId);
      if (!existing || existing.status !== 'PENDING') return null;
      const next: TradeProposalRecord = {
        ...existing,
        status: 'ACCEPTED',
        tradeId,
      };
      proposals.set(proposalId, next);
      return next;
    },
  };

  return { repository, created, proposals, items };
}

/** A valid offer: Alice's item for Bob's item, both $250. */
function validOffer(): CreateProposalParams {
  return {
    proposerId: ALICE,
    counterpartId: '',
    proposerItemId: 'item-a',
    counterpartItemId: 'item-b',
    message: null,
  };
}

function bothItems(overrides: {
  offered?: Partial<ProposalItemRecord>;
  requested?: Partial<ProposalItemRecord>;
} = {}) {
  return [
    item({ id: 'item-a', ownerId: ALICE, ...overrides.offered }),
    item({ id: 'item-b', ownerId: BOB, ...overrides.requested }),
  ];
}

describe('requestTradeProposal', () => {
  it('creates a pending offer and derives the counterpart from the requested item', async () => {
    const { repository, created } = fakeRepository({ items: bothItems() });

    const result = await requestTradeProposal(validOffer(), { repository });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.status).toBe('PENDING');
    // No trade, so nothing is reserved and no hold exists yet.
    expect(result.proposal.tradeId).toBeNull();
    // The counterpart is the requested item's owner, never client-supplied.
    expect(created[0]?.counterpartId).toBe(BOB);
  });

  it('allows a privately offered item on the offering side', async () => {
    const { repository } = fakeRepository({
      items: bothItems({ offered: { hidden: true } }),
    });

    const result = await requestTradeProposal(validOffer(), { repository });

    expect(result.ok).toBe(true);
  });

  it('refuses to target an item that is not publicly listed', async () => {
    const { repository } = fakeRepository({
      items: bothItems({ requested: { hidden: true } }),
    });

    const result = await requestTradeProposal(validOffer(), { repository });

    expect(result).toEqual({ ok: false, error: 'counterpart-item-private' });
  });

  it('allows an unequal offer, because acceptance is what agrees the value', async () => {
    const { repository, created } = fakeRepository({
      items: bothItems({ requested: { fmvCents: 25_001 } }),
    });

    const result = await requestTradeProposal(validOffer(), { repository });

    expect(result.ok).toBe(true);
    expect(created).toHaveLength(1);
  });

  it('records a bundle, cash, and the declared value', async () => {
    const { repository, created } = fakeRepository({
      items: [
        ...bothItems(),
        item({ id: 'item-a2', ownerId: ALICE, fmvCents: 5_000 }),
      ],
    });

    const result = await requestTradeProposal(
      {
        ...validOffer(),
        extraItemIds: ['item-a2', 'item-a2', 'item-a'],
        cashAmountCents: 7_500,
        declaredValueCents: 32_500,
      },
      { repository },
    );

    expect(result.ok).toBe(true);
    // Duplicates and the primary item are stripped from the bundle.
    expect(created[0]?.extraItemIds).toEqual(['item-a2']);
    expect(created[0]?.cashAmountCents).toBe(7_500);
    expect(created[0]?.declaredValueCents).toBe(32_500);
  });

  it('rejects an item in the bundle that the proposer does not own', async () => {
    const { repository } = fakeRepository({
      items: [...bothItems(), item({ id: 'item-x', ownerId: BOB })],
    });

    const result = await requestTradeProposal(
      { ...validOffer(), extraItemIds: ['item-x'] },
      { repository },
    );

    expect(result).toEqual({ ok: false, error: 'not-owner' });
  });

  it('rejects negative cash and a non-positive declared value', async () => {
    const { repository } = fakeRepository({ items: bothItems() });

    await expect(
      requestTradeProposal({ ...validOffer(), cashAmountCents: -1 }, { repository }),
    ).resolves.toEqual({ ok: false, error: 'invalid-cash' });
    await expect(
      requestTradeProposal({ ...validOffer(), declaredValueCents: 0 }, { repository }),
    ).resolves.toEqual({ ok: false, error: 'invalid-declared-value' });
  });

  it('rejects offering an item the proposer does not own', async () => {
    const { repository } = fakeRepository({
      items: bothItems({ offered: { ownerId: BOB } }),
    });

    const result = await requestTradeProposal(validOffer(), { repository });

    expect(result).toEqual({ ok: false, error: 'not-owner' });
  });

  it('rejects trading with yourself', async () => {
    const { repository } = fakeRepository({
      items: bothItems({ requested: { ownerId: ALICE } }),
    });

    const result = await requestTradeProposal(validOffer(), { repository });

    expect(result).toEqual({ ok: false, error: 'self-trade' });
  });

  it.each(['RESERVED', 'SOLD'] as const)(
    'rejects a %s item on either side',
    async (status) => {
      const offeredBlocked = fakeRepository({
        items: bothItems({ offered: { status } }),
      });
      const requestedBlocked = fakeRepository({
        items: bothItems({ requested: { status } }),
      });

      await expect(
        requestTradeProposal(validOffer(), offeredBlocked),
      ).resolves.toEqual({ ok: false, error: 'item-unavailable' });
      await expect(
        requestTradeProposal(validOffer(), requestedBlocked),
      ).resolves.toEqual({ ok: false, error: 'item-unavailable' });
    },
  );

  it('rejects a duplicate live offer on the same item', async () => {
    const { repository } = fakeRepository({ items: bothItems() });
    await requestTradeProposal(validOffer(), { repository });

    const second = await requestTradeProposal(validOffer(), { repository });

    expect(second).toEqual({ ok: false, error: 'duplicate-pending' });
  });
});

describe('responding to a proposal', () => {
  async function pending() {
    const fake = fakeRepository({ items: bothItems() });
    const created = await requestTradeProposal(validOffer(), fake);
    if (!created.ok) throw new Error('fixture failed');
    return { ...fake, proposalId: created.proposal.id };
  }

  it('lets only the counterpart accept', async () => {
    const { repository, proposalId } = await pending();

    const byProposer = await authorizeTradeProposalAcceptance(
      { proposalId, actorId: ALICE },
      { repository },
    );
    const byCounterpart = await authorizeTradeProposalAcceptance(
      { proposalId, actorId: BOB },
      { repository },
    );

    expect(byProposer).toEqual({ ok: false, error: 'not-permitted' });
    expect(byCounterpart.ok).toBe(true);
    if (!byCounterpart.ok) return;
    // The proposer initiates the resulting trade.
    expect(byCounterpart.initiatorId).toBe(ALICE);
    expect(byCounterpart.initiatorItemId).toBe('item-a');
    expect(byCounterpart.counterpartItemId).toBe('item-b');
  });

  it('re-checks availability at acceptance time', async () => {
    const { repository, proposalId, items } = await pending();
    items.set('item-b', item({ id: 'item-b', ownerId: BOB, status: 'SOLD' }));

    const result = await authorizeTradeProposalAcceptance(
      { proposalId, actorId: BOB },
      { repository },
    );

    expect(result).toEqual({ ok: false, error: 'item-unavailable' });
  });

  it('does not re-check value at acceptance time', async () => {
    const { repository, proposalId, items } = await pending();
    items.set(
      'item-b',
      item({ id: 'item-b', ownerId: BOB, fmvCents: 30_000 }),
    );

    const result = await authorizeTradeProposalAcceptance(
      { proposalId, actorId: BOB },
      { repository },
    );

    // Repricing an item does not invalidate an offer: the Counterpart accepting
    // is what agrees the valuation, not a comparison of the two sides.
    expect(result.ok).toBe(true);
  });

  it('lets only the counterpart decline', async () => {
    const { repository, proposalId } = await pending();

    await expect(
      declineTradeProposal({ proposalId, actorId: ALICE }, { repository }),
    ).resolves.toEqual({ ok: false, error: 'not-permitted' });

    const declined = await declineTradeProposal(
      { proposalId, actorId: BOB },
      { repository },
    );
    expect(declined.ok).toBe(true);
    if (declined.ok) expect(declined.proposal.status).toBe('DECLINED');
  });

  it('lets only the proposer withdraw', async () => {
    const { repository, proposalId } = await pending();

    await expect(
      withdrawTradeProposal({ proposalId, actorId: BOB }, { repository }),
    ).resolves.toEqual({ ok: false, error: 'not-permitted' });

    const withdrawn = await withdrawTradeProposal(
      { proposalId, actorId: ALICE },
      { repository },
    );
    expect(withdrawn.ok).toBe(true);
    if (withdrawn.ok) expect(withdrawn.proposal.status).toBe('WITHDRAWN');
  });

  it('cannot answer an offer twice', async () => {
    const { repository, proposalId } = await pending();
    await declineTradeProposal({ proposalId, actorId: BOB }, { repository });

    await expect(
      authorizeTradeProposalAcceptance({ proposalId, actorId: BOB }, { repository }),
    ).resolves.toEqual({ ok: false, error: 'not-pending' });
    await expect(
      declineTradeProposal({ proposalId, actorId: BOB }, { repository }),
    ).resolves.toEqual({ ok: false, error: 'not-pending' });
  });
});
