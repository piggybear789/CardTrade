// tests/unit/staleCollateralTrades.test.ts
//
// What happens to a trade stuck in COLLATERAL_PENDING (ESC-04).
//
// TWO CASES, TREATED DIFFERENTLY.
//
//   * The meeting PASSED and the trade never locked. Nothing protects either trader,
//     the items are off the market and fees may already be charged. It is ENDED, by
//     the one abandon operation (`abandonCollateralPendingTrade`), which voids any live
//     hold first and stops (flagged) if it cannot.
//   * There is NO meeting on file (a pre-fix row: `acceptTradeTerms` now refuses that).
//     Collateral can never be placed. Flagged for a human rather than guessed at; this
//     path moves no money.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeAdmin, type FakeAdmin } from './fakes/supabaseChain';

/** Swapped per test before the module under test reads it. */
let admin: FakeAdmin;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin.client,
}));

const abandon = vi.fn(async (_tradeId: string, _reason: string) => ({
  ok: true as const,
  abandoned: true as const,
  restoredItemIds: [],
  feeRefundFailed: false,
}));
vi.mock('@/lib/trades/collateralPlacement', () => ({
  abandonCollateralPendingTrade: (tradeId: string, reason: string) => abandon(tradeId, reason),
}));
vi.mock('@/lib/errors/errorLog', () => ({ logBackgroundFailure: vi.fn(async () => undefined) }));

const { flagStaleCollateralTrades } = await import('@/lib/trades/inspectionSweep');

/** The two reads, in order: passed meetings, then rows with no meeting. */
function reads(passed: Array<{ id: string }>, noMeeting: Array<{ id: string }>) {
  return { trades: [{ data: passed }, { data: noMeeting }] };
}

beforeEach(() => {
  abandon.mockClear();
  admin = createFakeAdmin({ selects: reads([], []) });
});

/** Trade writes only, so an unrelated table cannot satisfy an assertion. */
const tradeWrites = () => admin.writes.filter((write) => write.table === 'trades');

describe('flagStaleCollateralTrades', () => {
  it('ends a trade whose meeting passed without locking, through the one abandon operation', async () => {
    admin = createFakeAdmin({ selects: reads([{ id: 'trade-passed' }], []) });
    const result = await flagStaleCollateralTrades();
    expect(abandon).toHaveBeenCalledWith('trade-passed', 'MEETING_PASSED_UNLOCKED');
    expect(result).toEqual({ flagged: 0, abandoned: 1 });
  });

  it('flags (and does not abandon) a trade with no meeting on file', async () => {
    admin = createFakeAdmin({ selects: reads([], [{ id: 'trade-no-meeting' }]) });
    const result = await flagStaleCollateralTrades();
    expect(abandon).not.toHaveBeenCalled();
    expect(result.flagged).toBe(1);
    expect(tradeWrites()).toHaveLength(1);
    expect(tradeWrites()[0].payload).toEqual({ manual_reconciliation: true });
    // The flag path moves no money.
    expect(admin.writes.some((write) => write.table === 'pre_auth_holds')).toBe(false);
  });

  it('does nothing when no trade is stuck', async () => {
    const result = await flagStaleCollateralTrades();
    expect(result).toEqual({ flagged: 0, abandoned: 0 });
    expect(tradeWrites()).toHaveLength(0);
  });

  it('does not count an abandon that stopped on a failed void', async () => {
    abandon.mockResolvedValueOnce({ ok: false, error: 'VOID_FAILED' } as never);
    admin = createFakeAdmin({ selects: reads([{ id: 'trade-1' }, { id: 'trade-2' }], []) });
    const result = await flagStaleCollateralTrades();
    expect(abandon).toHaveBeenCalledTimes(2);
    expect(result.abandoned).toBe(1);
  });

  it('keeps going when one flag write fails, and counts only what it flagged', async () => {
    let attempts = 0;
    admin = createFakeAdmin({
      selects: reads([], [{ id: 'trade-1' }, { id: 'trade-2' }]),
      throwOnWrite: () => {
        attempts += 1;
        return attempts === 1;
      },
    });
    const result = await flagStaleCollateralTrades();
    expect(result.flagged).toBe(1);
  });
});
