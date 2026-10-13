// tests/unit/disputeOutcomes.test.ts
//
// The staff decision on a disputed trade (design §1.2, ESC-01, ESC-10, ESC-23).
//
// Four outcomes, each over the three ways a hold can stand behind a dispute: still an
// open authorisation (ACTIVE), already captured into custody by the backstop, or a
// LEGACY partial capture the pre-fix code took at raise. Run over the bounded
// InMemoryService, so a capture or refund the provider would refuse fails here too.

import { beforeEach, describe, expect, it } from 'vitest';

import { resolveTradeDispute } from '@/domain/orchestrator/disputeResolution';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import {
  COUNTERPART,
  INITIATOR,
  createDisputeWorld,
  holdOf,
  type DisputeWorld,
} from './fakes/disputeWorld';

const STAFF = 'staff-1';
let payments: InMemoryService;

beforeEach(() => {
  payments = new InMemoryService();
});

/** Take a world's hold into custody the way the backstop does. */
async function custody(world: DisputeWorld, traderId: string) {
  const hold = holdOf(world, traderId);
  const captured = await payments.fullCapture(hold.holdRef);
  world.holds = world.holds.map((h) =>
    h.holdRef === hold.holdRef
      ? { ...h, status: 'FULLY_CAPTURED', capturedCents: captured.amount, custodyCapturedAt: '2026-06-30T00:00:00.000Z' }
      : h,
  );
}

/** Replace a trader's hold with a legacy partial capture (430000 / 2000, as in the report). */
function legacyPartial(world: DisputeWorld, traderId: string, opts: { returnPaid?: boolean } = {}) {
  const ref = `pi_legacy_${traderId}`;
  payments.seedHold(
    { holdId: ref, payerId: `payer_${traderId}`, amount: 430_000, status: 'PARTIALLY_CAPTURED' },
    { capturedCents: 2_000, spentCents: opts.returnPaid ? 1_000 : 0 },
  );
  world.holds = world.holds.filter((h) => h.traderId !== traderId);
  world.holds.push({
    traderId, holdRef: ref, amountCents: 430_000, capturedCents: 2_000, status: 'PARTIALLY_CAPTURED',
    createdAt: '2026-06-01T00:00:00.000Z', custodyCapturedAt: null,
  });
  world.trade = {
    ...world.trade,
    friction_tax_return_cents: 1_000,
    friction_tax_platform_cents: 1_000,
    friction_tax_return_paid_at: opts.returnPaid ? '2026-06-02T00:00:00.000Z' : null,
  };
  return ref;
}

const sum = (world: DisputeWorld, filter: (d: DisputeWorld['disbursements'][number]) => boolean) =>
  world.disbursements.filter(filter).reduce((s, d) => s + d.amountMinor, 0);

describe('UNFOUNDED', () => {
  it('voids both ACTIVE holds and completes the trade', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'UNFOUNDED' } });
    expect(result.ok).toBe(true);
    expect(world.trade.state).toBe('COMPLETED');
    expect(world.holds.every((h) => h.status === 'VOIDED')).toBe(true);
    expect(payments.captures).toHaveLength(0);
    expect(world.unfounded[INITIATOR]).toBe(1);
    expect(world.outcome).toEqual({ outcome: 'UNFOUNDED', attestedBy: null, cancelled: false });
  });

  it('refunds a custody-captured hold in full to its owner', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    await custody(world, COUNTERPART);
    await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'UNFOUNDED' } });
    expect(world.disbursements).toEqual([
      expect.objectContaining({ kind: 'REFUND', payeeId: COUNTERPART, amountMinor: 50_000 }),
    ]);
  });

  it('refunds a legacy partial capture including the platform share, with no capture call', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    legacyPartial(world, COUNTERPART, { returnPaid: true });
    await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'UNFOUNDED' } });
    expect(payments.captures).toHaveLength(0);
    // captured 2000 - return share paid 1000 = 1000 back to the accused.
    expect(world.disbursements).toEqual([expect.objectContaining({ kind: 'REFUND', payeeId: COUNTERPART, amountMinor: 1_000 })]);
  });
});

describe('CONDITION', () => {
  const condition = (X: number, goodsChangedHands?: boolean) => ({
    kind: 'CONDITION' as const, wrongedTraderId: INITIATOR, compensationMinor: X, goodsChangedHands,
  });

  it('captures X + platform share from the accused ACTIVE hold and voids the other', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(5_000) });
    expect(result.ok).toBe(true);
    expect(payments.captures).toEqual([expect.objectContaining({ kind: 'PARTIAL', amount: 6_000, status: 'SETTLED' })]);
    expect(holdOf(world, INITIATOR).status).toBe('VOIDED');
    expect(world.disbursements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'PAYOUT', payeeId: INITIATOR, amountMinor: 5_000 }),
        expect.objectContaining({ kind: 'PLATFORM_RETAINED', payeeId: null, amountMinor: 1_000 }),
      ]),
    );
    expect(world.trade.state).toBe('COMPLETED');
  });

  it('bounds X by the remaining collateral', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const over = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(50_001) });
    expect(over).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    expect(payments.captures).toHaveLength(0);
    expect(world.trade.state).toBe('DISPUTED');

    const all = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(50_000) });
    expect(all.ok).toBe(true);
    // The platform share is what is left after X, here nothing.
    expect(payments.captures[0]).toMatchObject({ amount: 50_000 });
  });

  it('rejects a negative or fractional amount', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    for (const X of [-1, 10.5]) {
      expect(await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(X) })).toMatchObject({
        ok: false, error: 'INVALID_OUTCOME',
      });
    }
  });

  it('voids instead of capturing when X + platform share is 0', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true, currency: 'gbp' });
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(0) });
    expect(result.ok).toBe(true);
    expect(payments.captures).toHaveLength(0);
    expect(world.holds.every((h) => h.status === 'VOIDED')).toBe(true);
  });

  it('splits a custody-captured accused hold: X out, platform share kept, the rest refunded', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    await custody(world, COUNTERPART);
    await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(7_000) });
    expect(world.disbursements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'PAYOUT', payeeId: INITIATOR, amountMinor: 7_000 }),
        expect.objectContaining({ kind: 'PLATFORM_RETAINED', amountMinor: 1_000 }),
        expect.objectContaining({ kind: 'REFUND', payeeId: COUNTERPART, amountMinor: 42_000 }),
      ]),
    );
    expect(sum(world, (d) => d.holdRef === holdOf(world, COUNTERPART).holdRef)).toBe(50_000);
  });

  it('pays from a legacy partial capture without any capture call, and the shares sum to remainingFor', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const ref = legacyPartial(world, COUNTERPART);
    // remaining = 2000 (return share never paid); platform share already captured = 1000.
    const over = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(1_001) });
    expect(over).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(600) });
    expect(payments.captures).toHaveLength(0);
    expect(world.disbursements.filter((d) => d.holdRef === ref)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'PAYOUT', payeeId: INITIATOR, amountMinor: 600 }),
        expect.objectContaining({ kind: 'REFUND', payeeId: COUNTERPART, amountMinor: 400 }),
      ]),
    );
    // 600 + 400 + the 1000 platform share the legacy code already took = 2000.
    expect(sum(world, (d) => d.holdRef === ref) + 1_000).toBe(2_000);
    // The void loop never touches the PARTIALLY_CAPTURED row.
    expect(holdOf(world, COUNTERPART).status).toBe('PARTIALLY_CAPTURED');
  });

  it('leaves the trade DISPUTED with a manual flag when the accused has no live hold', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true, holdAmounts: { counterpart: null } });
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(100) });
    expect(result).toMatchObject({ ok: false, error: 'HOLD_NOT_FOUND' });
    expect(world.trade.state).toBe('DISPUTED');
    expect(world.manualReconciliation).toBe(true);
  });

  it('leaves the trade DISPUTED when the capture fails', async () => {
    const failing = new InMemoryService();
    payments = failing;
    const { world, deps } = await createDisputeWorld({ payments: failing, inspected: true });
    // Kill the authorisation the way a lapse would.
    await failing.voidHold(holdOf(world, COUNTERPART).holdRef);
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: condition(100) });
    expect(result).toMatchObject({ ok: false, error: 'CAPTURE_FAILED' });
    expect(world.trade.state).toBe('DISPUTED');
    expect(world.manualReconciliation).toBe(true);
  });
});

describe('FRAUD', () => {
  it('captures the offender in full and queues it for the victim; voids the victim', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const result = await resolveTradeDispute(deps, {
      tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'FRAUD', victimId: INITIATOR },
    });
    expect(result.ok && result.resolution.offendingTraderId).toBe(COUNTERPART);
    expect(payments.captures).toEqual([expect.objectContaining({ kind: 'FULL', amount: 50_000 })]);
    expect(holdOf(world, INITIATOR).status).toBe('VOIDED');
    expect(world.disbursements).toEqual([expect.objectContaining({ kind: 'PAYOUT', payeeId: INITIATOR, amountMinor: 50_000 })]);
    expect(world.trade.state).toBe('FRAUD_RESOLVED');
    // Never paid inline.
    expect(payments.payouts).toHaveLength(0);
  });

  it('refuses a victim who is not on the trade with zero provider calls (ESC-23)', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const before = { captures: payments.captures.length, refunds: payments.refunds.length };
    const result = await resolveTradeDispute(deps, {
      tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'FRAUD', victimId: 'stranger' },
    });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    expect(payments.captures.length).toBe(before.captures);
    expect(world.trade.state).toBe('DISPUTED');
    expect(world.holds.every((h) => h.status === 'ACTIVE')).toBe(true);
  });

  it('pays a custody-captured offender hold to the victim and refunds the victim own custody hold', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    await custody(world, COUNTERPART);
    await custody(world, INITIATOR);
    await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'FRAUD', victimId: INITIATOR } });
    expect(world.disbursements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'PAYOUT', payeeId: INITIATOR, amountMinor: 50_000, holdRef: holdOf(world, COUNTERPART).holdRef }),
        expect.objectContaining({ kind: 'REFUND', payeeId: INITIATOR, amountMinor: 50_000, holdRef: holdOf(world, INITIATOR).holdRef }),
      ]),
    );
  });

  it('queues a legacy partial remainder to the victim with no capture call', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const ref = legacyPartial(world, COUNTERPART, { returnPaid: true });
    await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'FRAUD', victimId: INITIATOR } });
    expect(payments.captures).toHaveLength(0);
    expect(world.disbursements.filter((d) => d.holdRef === ref)).toEqual([
      expect.objectContaining({ kind: 'PAYOUT', payeeId: INITIATOR, amountMinor: 1_000 }),
    ]);
  });

  describe('acknowledgeNoCollateral', () => {
    it('is refused while the offender still has an ACTIVE or custody hold', async () => {
      const { world, deps } = await createDisputeWorld({ payments, inspected: true });
      const active = await resolveTradeDispute(deps, {
        tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'FRAUD', victimId: INITIATOR, acknowledgeNoCollateral: true },
      });
      expect(active).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
      await custody(world, COUNTERPART);
      const custodial = await resolveTradeDispute(deps, {
        tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'FRAUD', victimId: INITIATOR, acknowledgeNoCollateral: true },
      });
      expect(custodial).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    });

    it('is accepted over the seeded 430000 / 2000 legacy hold and queues captured minus paid share', async () => {
      const { world, deps } = await createDisputeWorld({ payments, inspected: true });
      const ref = legacyPartial(world, COUNTERPART, { returnPaid: true });
      const result = await resolveTradeDispute(deps, {
        tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'FRAUD', victimId: INITIATOR, acknowledgeNoCollateral: true },
      });
      expect(result.ok).toBe(true);
      expect(world.trade.state).toBe('FRAUD_RESOLVED');
      expect(world.fullCaptureFailed).toBe(true);
      expect(world.manualReconciliation).toBe(true);
      expect(world.disbursements).toEqual([
        expect.objectContaining({ kind: 'PAYOUT', payeeId: INITIATOR, amountMinor: 1_000, holdRef: ref }),
      ]);
    });

    it('writes a zero STAFF placeholder when nothing at all is left', async () => {
      const { world, deps } = await createDisputeWorld({ payments, inspected: true });
      world.holds = world.holds.map((h) => (h.traderId === COUNTERPART ? { ...h, status: 'EXPIRED' } : h));
      const result = await resolveTradeDispute(deps, {
        tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'FRAUD', victimId: INITIATOR, acknowledgeNoCollateral: true },
      });
      expect(result.ok).toBe(true);
      expect(world.disbursements).toEqual([
        expect.objectContaining({ kind: 'PAYOUT', payeeId: INITIATOR, amountMinor: 0, holdReason: 'STAFF' }),
      ]);
    });
  });
});

describe('NO_EXCHANGE', () => {
  const noExchange = { kind: 'NO_EXCHANGE' as const };

  async function neverInspected(setup: (world: DisputeWorld) => void = () => {}) {
    const made = await createDisputeWorld({
      payments,
      cashAmountCents: 10_000,
      items: [
        { id: 'own-reserved', ownerId: INITIATOR, status: 'RESERVED', listingKind: 'SINGLE' },
        { id: 'sold', ownerId: INITIATOR, status: 'SOLD', listingKind: 'SINGLE' },
        { id: 'held-by-sale', ownerId: COUNTERPART, status: 'RESERVED', listingKind: 'SINGLE', claimedElsewhere: true },
      ],
    });
    setup(made.world);
    return made;
  }

  it.each([
    ['HANDOVER_FAILED from LOCKED', 'COLLATERAL_LOCKED', 'HANDOVER_FAILED'],
    ['FRAUD_CLAIMED from LOCKED by the cash receiver', 'COLLATERAL_LOCKED', 'FRAUD_CLAIMED'],
    ['legacy HANDOVER_FAILED from IN_TRANSIT', 'IN_TRANSIT', 'HANDOVER_FAILED'],
  ] as const)('is accepted after %s', async (_label, from, event) => {
    const { world, deps } = await neverInspected((w) => {
      w.transitions.push({ from, to: 'DISPUTED', event, by: COUNTERPART });
      // Self-loop audit rows and a later counter-claim do not change the answer.
      w.transitions.push({ from: 'DISPUTED', to: 'DISPUTED', event: 'COLLATERAL_TAKEN_INTO_CUSTODY', by: null });
    });
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: noExchange });
    expect(result.ok).toBe(true);
    expect(world.trade.state).toBe('CANCELLED');
    expect(world.outcome).toMatchObject({ outcome: 'NO_EXCHANGE', cancelled: true });
  });

  it('voids ACTIVE holds and refunds a custody hold in full', async () => {
    const { world, deps } = await neverInspected();
    await custody(world, INITIATOR);
    await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: noExchange });
    expect(holdOf(world, COUNTERPART).status).toBe('VOIDED');
    expect(world.disbursements).toEqual([expect.objectContaining({ kind: 'REFUND', payeeId: INITIATOR, amountMinor: 50_000 })]);
  });

  it('restores only the unclaimed reservation, never un-sells, refunds fees and routes the cash leg as NO_EXCHANGE', async () => {
    const { world, deps } = await neverInspected();
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: noExchange });
    expect(result.ok && result.resolution.restoredItemIds).toEqual(['own-reserved']);
    expect(world.items.find((i) => i.id === 'sold')!.status).toBe('SOLD');
    expect(world.items.find((i) => i.id === 'held-by-sale')!.status).toBe('RESERVED');
    expect(world.calls.refundFees).toEqual([world.trade.id]);
    expect(world.calls.cashLeg).toEqual(['NO_EXCHANGE']);
    expect(world.calls.notifications).toEqual(
      expect.arrayContaining(['restored:own-reserved', `unwound:${INITIATOR},${COUNTERPART}`]),
    );
  });

  it.each([
    ['CONDITION_DISPUTE', 'INSPECTION', 'CONDITION_DISPUTE'],
    ['FRAUD_CLAIMED from INSPECTION', 'INSPECTION', 'FRAUD_CLAIMED'],
  ] as const)('is refused after any INSPECTION entry (%s), with zero provider calls', async (_l, from, event) => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    world.transitions.push({ from, to: 'DISPUTED', event, by: INITIATOR });
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: noExchange });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    expect(payments.captures).toHaveLength(0);
    expect(world.holds.every((h) => h.status === 'ACTIVE')).toBe(true);
    expect(world.calls.refundFees).toHaveLength(0);
  });

  it('[R4-M1] is refused when inspection_deadline_at is set even with no INSPECTION audit row', async () => {
    const { world, deps } = await createDisputeWorld({
      payments, extraTrade: { inspection_deadline_at: '2026-06-28T00:00:00.000Z' },
    });
    expect(world.transitions.some((t) => t.to === 'INSPECTION')).toBe(false);
    const refused = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: noExchange });
    expect(refused).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    // ...and UNFOUNDED is accepted without the attestation, because it was inspected.
    const unfounded = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'UNFOUNDED' } });
    expect(unfounded.ok).toBe(true);
    expect(world.outcome).toMatchObject({ attestedBy: null });
  });
});

describe('the never-inspected attestation', () => {
  it.each([
    ['UNFOUNDED', { kind: 'UNFOUNDED' as const }],
    ['CONDITION', { kind: 'CONDITION' as const, wrongedTraderId: INITIATOR, compensationMinor: 100 }],
  ])('%s is refused without goodsChangedHands, with zero provider calls and no cash-leg call', async (_l, outcome) => {
    const { world, deps } = await createDisputeWorld({ payments, cashAmountCents: 10_000 });
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    expect(payments.captures).toHaveLength(0);
    expect(world.calls.cashLeg).toHaveLength(0);
    expect(world.trade.state).toBe('DISPUTED');
  });

  it('commits with goodsChangedHands and writes the attestation', async () => {
    const { world, deps } = await createDisputeWorld({ payments, cashAmountCents: 10_000 });
    const result = await resolveTradeDispute(deps, {
      tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'UNFOUNDED', goodsChangedHands: true },
    });
    expect(result.ok).toBe(true);
    expect(world.outcome).toEqual({ outcome: 'UNFOUNDED', attestedBy: STAFF, cancelled: false });
    expect(world.calls.cashLeg).toEqual(['UNFOUNDED']);
  });

  it('is ignored on an inspected trade', async () => {
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    await resolveTradeDispute(deps, {
      tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'UNFOUNDED', goodsChangedHands: true },
    });
    expect(world.outcome).toMatchObject({ attestedBy: null });
  });
});

describe('history unavailable', () => {
  it('returns DISPUTE_HISTORY_UNAVAILABLE and touches nothing', async () => {
    const { world, deps } = await createDisputeWorld({ payments });
    world.historyFails = true;
    const result = await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: STAFF, outcome: { kind: 'NO_EXCHANGE' } });
    expect(result).toMatchObject({ ok: false, error: 'DISPUTE_HISTORY_UNAVAILABLE' });
    expect(world.holds.every((h) => h.status === 'ACTIVE')).toBe(true);
    expect(world.trade.state).toBe('DISPUTED');
  });
});
