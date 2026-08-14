// tests/unit/staleCollateralTrades.test.ts
//
// Noticing a trade stuck in COLLATERAL_PENDING within hours instead of a week.
//
// WHY THIS MATTERS. COLLATERAL_PENDING is a MOMENT, not a phase: bonds are authorised and
// `syncHolds` reads the results back and dispatches HOLDS_CONFIRMED or HOLDS_FAILED inside
// the same request. A trade should pass through in seconds.
//
// If it does not — the process died between placing the holds and syncing them — the state
// machine has no other exit, because HOLDS_FAILED loops back to COLLATERAL_PENDING rather
// than terminating. The trade then sits with two live authorisations against two members'
// cards and nothing advancing it, and the only thing that noticed was `expire_lapsed_holds`
// about SEVEN DAYS later when the authorisations lapsed by themselves.
//
// NOTHING IS MOVED OR REVERSED HERE, and that is deliberate. Money on hold is not money
// lost, and guessing which way a half-finished authorisation should resolve is exactly the
// decision that needs a human. This only makes the case visible.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeAdmin, type FakeAdmin } from './fakes/supabaseChain';

/** Swapped per test before the module under test reads it. */
let admin: FakeAdmin;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => admin.client,
}));

const { flagStaleCollateralTrades } = await import('@/lib/trades/inspectionSweep');

beforeEach(() => {
  admin = createFakeAdmin({ selects: { trades: [{ data: [] }] } });
});

/** Trade writes only, so an unrelated table cannot satisfy an assertion. */
const tradeWrites = () => admin.writes.filter((write) => write.table === 'trades');

describe('flagStaleCollateralTrades', () => {
  it('flags a stuck trade so it reaches the admin console', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: [{ id: 'trade-stuck' }] }] },
    });

    const result = await flagStaleCollateralTrades();

    expect(result.flagged).toBe(1);
    // `manual_reconciliation` is the existing "a human must look" channel, and the admin
    // dashboard already counts and lists it — so flagging is what makes this visible
    // rather than merely logged.
    expect(tradeWrites()).toHaveLength(1);
    expect(tradeWrites()[0].op).toBe('update');
    expect(tradeWrites()[0].payload).toMatchObject({ manual_reconciliation: true });
  });

  it('does nothing when no trade is stuck', async () => {
    const result = await flagStaleCollateralTrades();

    expect(result.flagged).toBe(0);
    // No write at all, so an empty pass cannot churn `updated_at` on live rows.
    expect(tradeWrites()).toHaveLength(0);
  });

  it('MOVES NO MONEY — it only flags', async () => {
    admin = createFakeAdmin({
      selects: { trades: [{ data: [{ id: 'trade-stuck' }] }] },
    });

    await flagStaleCollateralTrades();

    // The whole safety argument for running this unattended is that it cannot resolve a
    // half-finished authorisation either way. Nothing touches holds, and the only write
    // sets the review flag.
    expect(admin.writes.some((write) => write.table === 'pre_auth_holds')).toBe(false);
    expect(tradeWrites()).toHaveLength(1);
    expect(tradeWrites()[0].payload).toEqual({ manual_reconciliation: true });
  });

  it('keeps going when one write fails, and counts only what it flagged', async () => {
    let attempts = 0;
    admin = createFakeAdmin({
      selects: { trades: [{ data: [{ id: 'trade-1' }, { id: 'trade-2' }] }] },
      throwOnWrite: () => {
        attempts += 1;
        // Fail the FIRST write only.
        return attempts === 1;
      },
    });

    const result = await flagStaleCollateralTrades();

    // One bad row must not cost the rest of the pass — the same property the inspection
    // sweep holds, and for the same reason: this runs unattended on a schedule.
    //
    // `flagged === 1` is the whole proof: the FIRST write threw, so the only way the
    // count reaches one is the loop continuing to the second row. Asserting a write
    // count instead would depend on whether the fake records a throwing write, which is
    // its implementation detail rather than a property of this function.
    expect(result.flagged).toBe(1);
  });
});
