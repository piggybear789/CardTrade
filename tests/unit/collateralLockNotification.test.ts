// tests/unit/collateralLockNotification.test.ts
//
// ESC-08: exactly one "collateral locked" notification per lock, whichever path gets
// there first — the webhook, the synchronous sync after placement, or the
// process-died path — and none when the trade is already locked.

import { describe, expect, it } from 'vitest';

import { confirmCollateralIfComplete, reconcileHoldStatus } from '@/domain/orchestrator/collateralReconcile';
import { A, B, hold, world } from './fakes/collateralWorld';

const both = () => [hold(A, 'pi_a', 'ACTIVE', '2026-10-01'), hold(B, 'pi_b', 'ACTIVE', '2026-10-01')];

describe('collateral locked notification', () => {
  it('webhook then sync then process-died: one notification', async () => {
    const w = world({ holds: both() });
    await reconcileHoldStatus(w.deps, { tradeId: 't1', holdId: 'pi_b', status: 'ACTIVE', actorId: A });
    await confirmCollateralIfComplete(w.deps, { tradeId: 't1', actorId: A }); // sync
    await confirmCollateralIfComplete(w.deps, { tradeId: 't1', actorId: A }); // process-died retry
    expect(w.notified).toEqual(['t1']);
  });

  it('sync first, then the late webhook: still one', async () => {
    const w = world({ holds: both() });
    expect(await confirmCollateralIfComplete(w.deps, { tradeId: 't1', actorId: A })).toEqual({ kind: 'LOCKED' });
    const late = await reconcileHoldStatus(w.deps, { tradeId: 't1', holdId: 'pi_a', status: 'ACTIVE', actorId: A });
    expect(late).toMatchObject({ confirm: { kind: 'ALREADY_LOCKED' } });
    expect(w.notified).toEqual(['t1']);
  });

  it('none when the trade was already locked', async () => {
    const w = world({ state: 'COLLATERAL_LOCKED', holds: both() });
    expect(await confirmCollateralIfComplete(w.deps, { tradeId: 't1', actorId: A })).toEqual({ kind: 'ALREADY_LOCKED' });
    expect(w.notified).toEqual([]);
  });
});
