// tests/unit/custodyCaptureHold.test.ts
//
// The one custody-capture operation (design §1.2), shared by the expiry backstop
// sweep and a pending fraud finding. It takes a live hold INTO THE PLATFORM BALANCE
// before the authorisation lapses, so a slow staff decision cannot destroy the remedy.

import { beforeEach, describe, expect, it } from 'vitest';

import { custodyCaptureHold } from '@/domain/orchestrator/disputeResolution';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { COUNTERPART, INITIATOR, createDisputeWorld, holdOf } from './fakes/disputeWorld';

let payments: InMemoryService;
beforeEach(() => {
  payments = new InMemoryService();
});

describe('custodyCaptureHold', () => {
  it('refuses a trade that is not DISPUTED', async () => {
    const { world, deps } = await createDisputeWorld({ payments, state: 'INSPECTION' });
    const result = await custodyCaptureHold(deps, {
      tradeId: world.trade.id, holdRef: holdOf(world, COUNTERPART).holdRef, reason: 'EXPIRY_BACKSTOP',
    });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    expect(payments.captures).toHaveLength(0);
  });

  it('refuses a hold that is not a trader’s current live hold', async () => {
    const { world, deps } = await createDisputeWorld({ payments });
    // An older FAILED attempt for the same trader.
    world.holds.unshift({
      traderId: COUNTERPART, holdRef: 'pi_old_failed', amountCents: 50_000, capturedCents: 0, status: 'FAILED',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const result = await custodyCaptureHold(deps, { tradeId: world.trade.id, holdRef: 'pi_old_failed', reason: 'EXPIRY_BACKSTOP' });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    expect(payments.captures).toHaveLength(0);
  });

  it('captures in full, stamps custody, writes the neutral audit code and notifies', async () => {
    const { world, deps } = await createDisputeWorld({ payments });
    const ref = holdOf(world, COUNTERPART).holdRef;
    const result = await custodyCaptureHold(deps, { tradeId: world.trade.id, holdRef: ref, reason: 'FRAUD_PROPOSAL' });
    expect(result).toEqual({ ok: true, alreadyCaptured: false, capturedCents: 50_000 });
    expect(holdOf(world, COUNTERPART)).toMatchObject({ status: 'FULLY_CAPTURED', capturedCents: 50_000 });
    expect(holdOf(world, COUNTERPART).custodyCapturedAt).toBeTruthy();
    const audit = world.transitions.filter((t) => t.event === 'COLLATERAL_TAKEN_INTO_CUSTODY');
    expect(audit).toEqual([{ from: 'DISPUTED', to: 'DISPUTED', event: 'COLLATERAL_TAKEN_INTO_CUSTODY', by: null }]);
    // The reason never appears in a member-visible code.
    expect(world.transitions.some((t) => t.event.includes('FRAUD'))).toBe(false);
    expect(world.calls.notifications).toEqual([`custody:${COUNTERPART}`]);
    expect(world.trade.state).toBe('DISPUTED');
  });

  it('is idempotent on an already custody-captured hold', async () => {
    const { world, deps } = await createDisputeWorld({ payments });
    const ref = holdOf(world, COUNTERPART).holdRef;
    await custodyCaptureHold(deps, { tradeId: world.trade.id, holdRef: ref, reason: 'EXPIRY_BACKSTOP' });
    const again = await custodyCaptureHold(deps, { tradeId: world.trade.id, holdRef: ref, reason: 'FRAUD_PROPOSAL' });
    expect(again).toEqual({ ok: true, alreadyCaptured: true, capturedCents: 50_000 });
    expect(payments.captures).toHaveLength(1);
    expect(world.transitions.filter((t) => t.event === 'COLLATERAL_TAKEN_INTO_CUSTODY')).toHaveLength(1);
  });

  it('a FRAUD proposal captures the offender only and leaves the victim ACTIVE', async () => {
    const { world, deps } = await createDisputeWorld({ payments });
    await custodyCaptureHold(deps, {
      tradeId: world.trade.id, holdRef: holdOf(world, COUNTERPART).holdRef, reason: 'FRAUD_PROPOSAL',
    });
    expect(holdOf(world, INITIATOR).status).toBe('ACTIVE');
    expect(payments.holds.get(holdOf(world, INITIATOR).holdRef)?.status).toBe('ACTIVE');
  });

  it('reports CUSTODY_CAPTURE_FAILED and flags the trade when the authorisation is dead', async () => {
    const { world, deps } = await createDisputeWorld({ payments });
    const ref = holdOf(world, COUNTERPART).holdRef;
    await payments.voidHold(ref);
    const result = await custodyCaptureHold(deps, { tradeId: world.trade.id, holdRef: ref, reason: 'EXPIRY_BACKSTOP' });
    expect(result).toMatchObject({ ok: false, error: 'CUSTODY_CAPTURE_FAILED' });
    expect(world.manualReconciliation).toBe(true);
    expect(holdOf(world, COUNTERPART).status).toBe('ACTIVE');
  });
});
