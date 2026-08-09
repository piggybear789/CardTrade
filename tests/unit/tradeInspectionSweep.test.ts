// tests/unit/tradeInspectionSweep.test.ts
//
// The trade inspection timeout (Req 6.x): the only code that releases both traders'
// collateral and settles a cash leg with nobody watching.
//
// WHY THIS IS WORTH TESTING EVEN THOUGH IT IS AWKWARD TO. It had three defects at once,
// and all three are the kind that only show up under load, at which point they cost the
// thing the timeout exists to protect:
//
//   1. The due query was UNBOUNDED. Each trade makes several provider calls and the route
//      has a wall-clock limit, so a backlog was cut off mid-batch — and the trades after
//      the cut sat past their deadline while their collateral burned down toward the
//      ~7-day authorisation limit.
//   2. NOTHING in the loop was guarded, so one bad row threw out to the route as a 500 and
//      cost every remaining trade in the batch its release.
//   3. `finalizeCompletedTrade` returned `void` and the result was discarded, so the sweep
//      counted a trade "completed" and told BOTH traders in writing that "both collateral
//      holds were released" whether or not any had been.
//
// The provider seam and the state machine are mocked; what is under test is the sweep's
// own control flow, which is where all three defects lived.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeAdmin, type FakeAdmin } from './fakes/supabaseChain';

/** Swapped per test before importing the sweep. */
let admin: FakeAdmin;
let applyEvent: ReturnType<typeof vi.fn>;
let finalize: ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin.client,
}));

vi.mock('@/domain/orchestrator/supabaseTradeRepository', () => ({
  createDefaultTradeOrchestrator: () => ({ applyEvent }),
}));

vi.mock('@/lib/trades/completion', () => ({
  finalizeCompletedTrade: (...args: unknown[]) => finalize(...args),
}));

vi.mock('@/domain/services', () => ({
  getPaymentService: () => ({}),
}));

vi.mock('@/lib/regionBinding', () => ({
  regionForCurrency: () => 'AU',
  regionForTrade: async () => 'AU',
}));

const { sweepTradeInspections } = await import('@/lib/trades/inspectionSweep');

/** A due trade row, with only the columns the sweep reads. */
function dueTrade(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `trade-${index}`,
    initiator_id: `initiator-${index}`,
    counterpart_id: `counterpart-${index}`,
    currency: 'aud',
    cash_amount_cents: 0,
    inspection_deadline_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Everything released cleanly: two holds voided, no cash leg. */
const CLEAN_FINALIZE = { holdsReleased: 2, holdsFailed: 0, cashSettled: null };

beforeEach(() => {
  applyEvent = vi.fn(async () => ({ ok: true as const, trade: {} }));
  finalize = vi.fn(async () => CLEAN_FINALIZE);
});

describe('sweepTradeInspections — bounding the batch', () => {
  it('completes a due trade and reports it', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: [dueTrade(1)] }, { data: [] }] },
    });

    const result = await sweepTradeInspections();

    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.needsReconciliation).toBe(0);
    expect(result.moreDue).toBe(false);
    expect(finalize).toHaveBeenCalledTimes(1);

    // Both traders are told, and the trade is stamped auto-completed.
    expect(admin.writes.filter((w) => w.table === 'notifications')).toHaveLength(1);
    expect(
      admin.writes.some(
        (w) =>
          w.table === 'trades' &&
          typeof w.payload === 'object' &&
          (w.payload as { auto_completed?: boolean }).auto_completed === true,
      ),
    ).toBe(true);
  });

  it('processes at most one bounded batch and flags that more are due', async () => {
    // 30 due trades: the query asks for limit+1 to detect a backlog, so the sweep sees 26
    // and must handle 25. Before the bound, a batch this size was cut off by the function
    // timeout instead, leaving the remainder past deadline with no record of why.
    const due = Array.from({ length: 26 }, (_, i) => dueTrade(i));
    admin = createFakeAdmin({ selects: { trades: [{ data: due }, { data: [] }] } });

    const result = await sweepTradeInspections();

    expect(result.completed).toBe(25);
    expect(result.moreDue).toBe(true);
    expect(finalize).toHaveBeenCalledTimes(25);
  });
});

describe('sweepTradeInspections — one bad row must not cost the queue', () => {
  it('keeps going when a trade throws, and counts it as failed', async () => {
    const due = [dueTrade(1), dueTrade(2), dueTrade(3)];
    admin = createFakeAdmin({ selects: { trades: [{ data: due }, { data: [] }] } });

    // The middle trade's finalize blows up, as a provider outage on one region would.
    finalize = vi.fn(async (trade: { id: string }) => {
      if (trade.id === 'trade-2') throw new Error('provider exploded');
      return CLEAN_FINALIZE;
    });

    const result = await sweepTradeInspections();

    // The other two still completed. Before the per-row guard this threw out to the route
    // and trades 3..n never ran at all.
    expect(result.completed).toBe(2);
    expect(result.failed).toBe(1);
    expect(finalize).toHaveBeenCalledTimes(3);
  });

  it('counts a rejected transition as failed without treating it as an error', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: [dueTrade(1)] }, { data: [] }] },
    });
    // A lost optimistic-lock race, or a state that moved on — the next pass picks it up.
    applyEvent = vi.fn(async () => ({ ok: false as const, error: 'CONCURRENT_MODIFICATION' }));

    const result = await sweepTradeInspections();

    expect(result.completed).toBe(0);
    expect(result.failed).toBe(1);
    // Nothing was finalised and nobody was told a trade completed.
    expect(finalize).not.toHaveBeenCalled();
    expect(admin.writes.filter((w) => w.table === 'notifications')).toHaveLength(0);
  });

  it('survives a notification insert that fails', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: [dueTrade(1)] }, { data: [] }] },
      throwOnWrite: (write) => write.table === 'notifications',
    });

    const result = await sweepTradeInspections();

    // The money side already happened, so the trade is not re-run; it is counted failed
    // and the next pass will not find it because the state has moved on. What matters is
    // that the sweep returned at all rather than 500ing the whole batch.
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(1);
  });
});

describe('sweepTradeInspections — telling traders the truth', () => {
  it('does not claim the collateral was released when a void failed', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: [dueTrade(1)] }, { data: [] }] },
    });
    finalize = vi.fn(async () => ({ holdsReleased: 1, holdsFailed: 1, cashSettled: null }));

    const result = await sweepTradeInspections();

    expect(result.completed).toBe(1);
    // Surfaced separately, because "completed" alone reads as nothing to look at.
    expect(result.needsReconciliation).toBe(1);

    const notification = admin.writes.find((w) => w.table === 'notifications');
    const bodies = (notification?.payload as { body: string }[]).map((row) => row.body);
    // THE REGRESSION THIS PINS. The old message asserted both holds were released
    // unconditionally, because the finalize result was thrown away.
    for (const body of bodies) {
      expect(body).not.toContain('both collateral holds were released');
      expect(body).toContain('still being finalised');
    }
  });

  it('flags a cash leg that did not settle', async () => {
    admin = createFakeAdmin({
      selects: {
        trades: [{ data: [dueTrade(1, { cash_amount_cents: 5_000 })] }, { data: [] }],
      },
    });
    finalize = vi.fn(async () => ({ holdsReleased: 2, holdsFailed: 0, cashSettled: false }));

    const result = await sweepTradeInspections();

    expect(result.completed).toBe(1);
    expect(result.needsReconciliation).toBe(1);
  });

  it('says holds were released when they actually were', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: [dueTrade(1)] }, { data: [] }] },
    });

    await sweepTradeInspections();

    const notification = admin.writes.find((w) => w.table === 'notifications');
    const bodies = (notification?.payload as { body: string }[]).map((row) => row.body);
    for (const body of bodies) {
      expect(body).toContain('both collateral holds were released');
    }
  });
});

describe('sweepTradeInspections — the closing-window warning', () => {
  it('warns traders whose window is about to close and stamps them once', async () => {
    admin = createFakeAdmin({
      selects: {
        trades: [
          { data: [] }, // nothing due yet
          { data: [{ id: 'trade-9', initiator_id: 'a', counterpart_id: 'b' }] },
        ],
      },
    });

    const result = await sweepTradeInspections();

    expect(result.warned).toBe(1);
    expect(
      admin.writes.some(
        (w) =>
          w.table === 'trades' &&
          typeof w.payload === 'object' &&
          'inspection_warned_at' in (w.payload as Record<string, unknown>),
      ),
    ).toBe(true);
  });
});
