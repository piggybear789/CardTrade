// tests/unit/tradeConditionDispute.test.ts
//
// The Condition_Dispute path on a 2-way Trade (Req 7.1, ESC-01, ESC-07).
//
// WHAT CHANGED, AND WHY THIS FILE WAS REWRITTEN. Raising a condition dispute used to
// partially capture a $20 Friction_Tax from the accused on the spot and pay $10 of it
// out to the raiser. A PaymentIntent can be captured only ONCE: Stripe released the
// rest of the accused's collateral with that first capture, so a later fraud finding
// on the same trade had nothing left to take. The raise destroyed the remedy it was
// meant to protect (ESC-01).
//
// Raising now captures NOTHING and pays NOTHING; it freezes the trade and records who
// said what. Money moves only at a staff decision (`resolveTradeDispute`, covered in
// disputeOutcomes.test.ts) or when the custody backstop takes a lapsing hold.
//
// Two older defects stay pinned, on the release side:
//   * `voidHold`'s returned status must decide whether a hold is recorded VOIDED.
//   * A non-participant cannot raise a dispute.

import { describe, expect, it } from 'vitest';

import { raiseConditionDispute, resolveTradeDispute } from '@/domain/orchestrator/disputeResolution';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { COUNTERPART, INITIATOR, createDisputeWorld, holdOf } from './fakes/disputeWorld';

describe('raiseConditionDispute — no money moves', () => {
  it('freezes the trade and records the participants without calling partialCapture', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, state: 'INSPECTION', inspected: true });

    const result = await raiseConditionDispute(deps, {
      tradeId: world.trade.id,
      actorId: INITIATOR,
      reason: 'The card has a crease that was not in the photos.',
    });

    expect(result).toMatchObject({ ok: true, disputedAgainst: COUNTERPART });
    expect(world.trade.state).toBe('DISPUTED');
    expect(world.trade.dispute_raised_by).toBe(INITIATOR);
    expect(payments.captures).toHaveLength(0);
    expect(payments.payouts).toHaveLength(0);
    expect(payments.transfers).toHaveLength(0);
    expect(world.holds.every((h) => h.status === 'ACTIVE')).toBe(true);
    expect(world.disbursements).toHaveLength(0);
  });

  it('refuses a raiser who is not a party to the trade, before any transition', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, state: 'INSPECTION', inspected: true });
    const result = await raiseConditionDispute(deps, { tradeId: world.trade.id, actorId: 'not-a-party', reason: 'x' });
    expect(result).toMatchObject({ ok: false, error: 'NOT_PARTICIPANT' });
    expect(world.trade.state).toBe('INSPECTION');
  });

  it('is refused outside INSPECTION by the state machine', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, state: 'COLLATERAL_LOCKED' });
    const result = await raiseConditionDispute(deps, { tradeId: world.trade.id, actorId: INITIATOR, reason: 'x' });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_TRANSITION' });
    expect(payments.captures).toHaveLength(0);
  });
});

describe('releasing collateral on resolution', () => {
  it('releases both traders holds on UNFOUNDED and reports what it released', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: 'staff', outcome: { kind: 'UNFOUNDED' } });
    expect(result.ok && result.resolution.voidedHoldRefs.sort()).toEqual(
      [holdOf(world, INITIATOR).holdRef, holdOf(world, COUNTERPART).holdRef].sort(),
    );
  });

  it('does NOT record a release the provider refused, and leaves the trade DISPUTED', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    // A void the provider refuses: the hold was already captured provider-side.
    await payments.fullCapture(holdOf(world, COUNTERPART).holdRef);
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: 'staff', outcome: { kind: 'UNFOUNDED' } });
    expect(result).toMatchObject({ ok: false, error: 'HOLD_RELEASE_FAILED' });
    expect(holdOf(world, COUNTERPART).status).toBe('ACTIVE');
    expect(world.trade.state).toBe('DISPUTED');
    expect(world.manualReconciliation).toBe(true);
  });
});
