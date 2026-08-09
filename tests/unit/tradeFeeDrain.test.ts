// tests/unit/tradeFeeDrain.test.ts
//
// Retrying a Trade_Fee that failed to collect.
//
// WHY THIS DRAIN EXISTS. `chargeTradeFees` has always documented one: "A fee that fails is
// recorded FAILED for the drain job to retry." There was no drain. `trade_fees` was touched
// by nothing but the charge and refund functions in that same module, both of which run
// once — at the Commitment_Point and at cancellation. So every fee that failed for any
// reason (a declined card, a momentary provider error, a trader with no instrument on file
// at that instant) was permanently uncollected, and the call site discarded the returned
// `anyFailed` so nobody found out.
//
// The property that makes retrying safe is the persisted nonce. If the original charge
// actually succeeded and only the response was lost, reusing the key makes the provider
// replay it rather than take the money twice — so that is asserted explicitly rather than
// left to the implementation.
//
// A NOTE ON THE FAKE'S QUEUE ORDER. This module builds its queries inline rather than
// through a repository, so the test has to queue results in the order the code reads them:
// the FAILED list first, then per row a payer lookup and an attempt-count read, then the
// exhausted-count tally at the end. That coupling is the cost of testing a module that
// owns its own SQL, and it is cheaper than leaving the only unattended fee-collection path
// unexercised.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeAdmin, type FakeAdmin } from './fakes/supabaseChain';

let admin: FakeAdmin;
let requestTransfer: ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin.client,
}));

vi.mock('@/domain/services', () => ({
  getPaymentService: () => ({ requestTransfer: (...args: unknown[]) => requestTransfer(...args) }),
}));

vi.mock('@/lib/regionBinding', () => ({
  regionForTrade: async () => 'AU',
}));

const { drainFailedTradeFees } = await import('@/lib/actions/tradeFees');

/** A FAILED fee row, with only the columns the drain reads. */
function failedFee(index: number, overrides: Record<string, unknown> = {}) {
  return {
    trade_id: `trade-${index}`,
    trader_id: `trader-${index}`,
    amount_cents: 5_000,
    nonce: `tradefee:trade-${index}:trader-${index}`,
    status: 'FAILED',
    attempts: 1,
    charge_ref: null,
    ...overrides,
  };
}

/** The updates the drain wrote to `trade_fees`, in order. */
function feeUpdates(recorded: FakeAdmin) {
  return recorded.writes
    .filter((write) => write.table === 'trade_fees' && write.op === 'update')
    .map((write) => write.payload as { status: string; error?: string });
}

beforeEach(() => {
  requestTransfer = vi.fn(async (params: { nonce: string; amount: number }) => ({
    transferId: 'ch_1',
    amount: params.amount,
    status: 'SETTLED' as const,
  }));
});

describe('drainFailedTradeFees', () => {
  it('re-charges a failed fee reusing the PERSISTED nonce', async () => {
    const row = failedFee(1);
    admin = createFakeAdmin({
      selects: { trade_fees: [{ data: [row] }] },
      defaults: {
        trade_fees: { data: { attempts: 1 } },
        profiles: { data: { payer_id: 'payer_1' } },
      },
    });

    const result = await drainFailedTradeFees();

    expect(result.attempted).toBe(1);
    expect(result.settled).toBe(1);
    expect(result.stillFailed).toBe(0);

    // The key property. A regenerated nonce would let the provider treat a retry as a
    // second, independent charge against the same trader for the same trade.
    expect(requestTransfer).toHaveBeenCalledTimes(1);
    expect(requestTransfer.mock.calls[0]?.[0]).toMatchObject({
      nonce: row.nonce,
      amount: row.amount_cents,
      payerId: 'payer_1',
    });

    expect(feeUpdates(admin).map((u) => u.status)).toEqual(['SETTLED']);
  });

  it('collects into the platform balance, never forwarding to a connected account', async () => {
    // The fee IS the platform's cut. Passing a `merchantRef` would forward our own revenue
    // to the trader we just charged.
    admin = createFakeAdmin({
      selects: { trade_fees: [{ data: [failedFee(1)] }] },
      defaults: {
        trade_fees: { data: { attempts: 1 } },
        profiles: { data: { payer_id: 'payer_1' } },
      },
    });

    await drainFailedTradeFees();

    expect(requestTransfer.mock.calls[0]?.[0]).not.toHaveProperty('merchantRef');
  });

  it('does not call the provider when the trader has no saved card', async () => {
    admin = createFakeAdmin({
      selects: {
        trade_fees: [{ data: [failedFee(1)] }],
        profiles: [{ data: null }],
      },
      defaults: { trade_fees: { data: { attempts: 1 } } },
    });

    const result = await drainFailedTradeFees();

    expect(requestTransfer).not.toHaveBeenCalled();
    expect(result.settled).toBe(0);
    expect(result.stillFailed).toBe(1);
    const updates = feeUpdates(admin);
    expect(updates.map((u) => u.status)).toEqual(['FAILED']);
    expect(updates[0]?.error).toMatch(/instrument/i);
  });

  it('records a fee the provider refuses again as still owed', async () => {
    admin = createFakeAdmin({
      selects: { trade_fees: [{ data: [failedFee(1)] }] },
      defaults: {
        trade_fees: { data: { attempts: 1 } },
        profiles: { data: { payer_id: 'payer_1' } },
      },
    });
    requestTransfer = vi.fn(async (params: { amount: number }) => ({
      transferId: 'ch_declined',
      amount: params.amount,
      status: 'FAILED' as const,
    }));

    const result = await drainFailedTradeFees();

    expect(result.settled).toBe(0);
    expect(result.stillFailed).toBe(1);
    expect(feeUpdates(admin).map((u) => u.status)).toEqual(['FAILED']);
  });

  it('bounds the pass and reports that more are due', async () => {
    // 26 eligible rows against a limit of 25: the query asks for limit+1 precisely so a
    // backlog is detectable, and the pass must not try to drain all of it in one run.
    const rows = Array.from({ length: 26 }, (_, i) => failedFee(i));
    admin = createFakeAdmin({
      selects: { trade_fees: [{ data: rows }] },
      defaults: {
        trade_fees: { data: { attempts: 1 } },
        profiles: { data: { payer_id: 'payer_x' } },
      },
    });

    const result = await drainFailedTradeFees(25);

    expect(result.attempted).toBe(25);
    expect(result.moreDue).toBe(true);
    expect(requestTransfer).toHaveBeenCalledTimes(25);
  });

  it('keeps draining after one row throws', async () => {
    // One trader's lookup exploding must not cost every other trader's fee, for the same
    // reason it must not in the inspection sweep: the queue is shared.
    const rows = [failedFee(1), failedFee(2), failedFee(3)];
    admin = createFakeAdmin({
      selects: { trade_fees: [{ data: rows }] },
      defaults: {
        trade_fees: { data: { attempts: 1 } },
        profiles: { data: { payer_id: 'payer_x' } },
      },
    });
    requestTransfer = vi.fn(async (params: { nonce: string; amount: number }) => {
      if (params.nonce.includes('trade-2')) throw new Error('provider exploded');
      return { transferId: 'ch_1', amount: params.amount, status: 'SETTLED' as const };
    });

    const result = await drainFailedTradeFees();

    expect(result.attempted).toBe(3);
    expect(result.settled).toBe(2);
    expect(result.stillFailed).toBe(1);
  });

  it('does nothing when no fee is owed', async () => {
    admin = createFakeAdmin({
      selects: { trade_fees: [{ data: [] }] },
      defaults: { trade_fees: { count: 0 } },
    });

    const result = await drainFailedTradeFees();

    expect(result).toMatchObject({ attempted: 0, settled: 0, stillFailed: 0, moreDue: false });
    expect(requestTransfer).not.toHaveBeenCalled();
  });
});
