// tests/unit/collateralReconcile.test.ts
//
// ESC-08: the one lock rule. A trade locks only when EVERY trader's current hold is
// ACTIVE; a provider event for a superseded attempt is ignored; and the "collateral
// locked" notification goes out exactly once, from whichever path actually moved the
// trade.

import { describe, expect, it, vi } from 'vitest';

import {
  confirmCollateralIfComplete,
  reconcileHoldStatus,
} from '@/domain/orchestrator/collateralReconcile';

import { A, B, hold, world } from './fakes/collateralWorld';

describe('reconcileHoldStatus', () => {
  it('does not lock when only one of two holds is active', async () => {
    // B has no hold row yet: the old "every existing row is ACTIVE" check passed here.
    const w = world({ holds: [hold(A, 'pi_a', 'ACTIVE', '2026-10-01')] });
    const result = await reconcileHoldStatus(w.deps, { tradeId: 't1', holdId: 'pi_a', status: 'ACTIVE', actorId: A });
    expect(result).toMatchObject({ kind: 'RECORDED', confirm: { kind: 'INCOMPLETE', reason: 'HOLDS' } });
    expect(w.trade.state).toBe('COLLATERAL_PENDING');
    expect(w.notified).toEqual([]);
  });

  it('locks once the second trader\'s hold clears, and notifies once', async () => {
    const w = world({
      holds: [
        hold(A, 'pi_a', 'ACTIVE', '2026-10-01'),
        hold(B, 'pi_b', 'FAILED', '2026-10-01'),
        hold(B, 'pi_b2', 'FAILED', '2026-10-02'),
      ],
    });
    // B retried after a decline; the retry's provider event arrives.
    const result = await reconcileHoldStatus(w.deps, { tradeId: 't1', holdId: 'pi_b2', status: 'ACTIVE', actorId: A });
    expect(result).toMatchObject({ kind: 'RECORDED', confirm: { kind: 'LOCKED' } });
    expect(w.trade.state).toBe('COLLATERAL_LOCKED');
    expect(w.notified).toEqual(['t1']);
  });

  it('ignores a provider event for a superseded attempt (stale id → no lock, no write)', async () => {
    const w = world({
      holds: [
        hold(A, 'pi_a', 'ACTIVE', '2026-10-01'),
        hold(B, 'pi_b_old', 'FAILED', '2026-10-01'),
        hold(B, 'pi_b_new', 'FAILED', '2026-10-02'),
      ],
    });
    const result = await reconcileHoldStatus(w.deps, { tradeId: 't1', holdId: 'pi_b_old', status: 'ACTIVE', actorId: A });
    expect(result).toEqual({ kind: 'NO_OP', reason: 'STALE_HOLD' });
    expect(w.holds.find((h) => h.holdRef === 'pi_b_old')?.status).toBe('FAILED');
    expect(w.trade.state).toBe('COLLATERAL_PENDING');
  });

  it('ignores an unknown hold id', async () => {
    const w = world({ holds: [hold(A, 'pi_a', 'ACTIVE', '2026-10-01')] });
    expect(await reconcileHoldStatus(w.deps, { tradeId: 't1', holdId: 'pi_x', status: 'ACTIVE', actorId: A })).toEqual({
      kind: 'NO_OP',
      reason: 'UNKNOWN_HOLD',
    });
  });

  it('an active event after HOLDS_FAILED still needs both current holds active', async () => {
    const w = world({ holds: [hold(A, 'pi_a', 'FAILED', '2026-10-01'), hold(B, 'pi_b', 'FAILED', '2026-10-01')] });
    await reconcileHoldStatus(w.deps, { tradeId: 't1', holdId: 'pi_a', status: 'FAILED', actorId: A });
    expect(w.events).toContain('HOLDS_FAILED');
    const late = await reconcileHoldStatus(w.deps, { tradeId: 't1', holdId: 'pi_b', status: 'ACTIVE', actorId: A });
    expect(late).toMatchObject({ confirm: { kind: 'INCOMPLETE', reason: 'HOLDS' } });
    expect(w.trade.state).toBe('COLLATERAL_PENDING');
  });
});

describe('confirmCollateralIfComplete preconditions', () => {
  const both = () => [hold(A, 'pi_a', 'ACTIVE', '2026-10-01'), hold(B, 'pi_b', 'ACTIVE', '2026-10-01')];

  it('waits on the cash leg and the fees when their predicates say no', async () => {
    const w = world({ holds: both() });
    expect(
      await confirmCollateralIfComplete({ ...w.deps, isCashLegCollected: async () => false }, { tradeId: 't1', actorId: A }),
    ).toEqual({ kind: 'INCOMPLETE', reason: 'CASH' });
    expect(
      await confirmCollateralIfComplete({ ...w.deps, areFeesSettled: async () => false }, { tradeId: 't1', actorId: A }),
    ).toEqual({ kind: 'INCOMPLETE', reason: 'FEES' });
    expect(w.trade.state).toBe('COLLATERAL_PENDING');
  });

  it('locks with no holds only when explicitly told no bond is required', async () => {
    const w = world();
    expect(await confirmCollateralIfComplete(w.deps, { tradeId: 't1', actorId: A })).toEqual({
      kind: 'INCOMPLETE',
      reason: 'HOLDS',
    });
    expect(await confirmCollateralIfComplete(w.deps, { tradeId: 't1', actorId: A, noBondsRequired: true })).toEqual({
      kind: 'LOCKED',
    });
  });

  it('reports a concurrent lock as ALREADY_LOCKED without notifying', async () => {
    const w = world({ holds: both() });
    const raced = vi.fn(async () => {
      w.trade.state = 'COLLATERAL_LOCKED';
      return { ok: false as const, error: 'CONCURRENT_MODIFICATION' as const };
    });
    expect(await confirmCollateralIfComplete({ ...w.deps, applyEvent: raced }, { tradeId: 't1', actorId: A })).toEqual({
      kind: 'ALREADY_LOCKED',
    });
    expect(w.notified).toEqual([]);
  });
});
