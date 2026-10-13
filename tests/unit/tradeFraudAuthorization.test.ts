// tests/unit/tradeFraudAuthorization.test.ts
//
// Who may determine Objective_Fraud, and who benefits from it (Req 8.1, revised;
// ESC-01, ESC-23).
//
// THE BUGS THIS PINS SHUT.
//
// 1. The victim used to be derived from the CALLER, and the caller was any participant:
//    either trader could name themselves the victim and take the other's collateral.
//    The victim is now an explicit staff argument, validated against the trade.
//
// 2. The payout DIRECTION. The old code paid the victim with `requestTransfer`, a
//    COLLECTION primitive, so a fraud finding captured the offender AND debited the
//    victim. `requestTransfer` must never be called on this path.
//
// 3. ESC-23: FRAUD_RESOLVED was committed BEFORE the victim was checked, so a refused
//    finding still closed the trade. The order is now validate -> holds -> money ->
//    commit, and a refused finding touches nothing.
//
// 4. ESC-01: the captured collateral is no longer paid inline. It is QUEUED for the
//    victim in `collateral_disbursements` and released after the 7-day safety hold, so
//    a "victim" who is the fraudster's second account cannot cash out immediately.

import { describe, expect, it } from 'vitest';

import { raiseFraudClaim, resolveTradeDispute } from '@/domain/orchestrator/disputeResolution';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { COUNTERPART, INITIATOR, createDisputeWorld, holdOf, payable } from './fakes/disputeWorld';

const OPERATOR = 'admin-1';

describe('resolveTradeDispute(FRAUD) — who benefits', () => {
  it('captures from the counterpart of the NAMED victim, not of the caller', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const result = await resolveTradeDispute(deps, {
      tradeId: world.trade.id, actorId: OPERATOR, outcome: { kind: 'FRAUD', victimId: INITIATOR },
    });
    expect(result.ok && result.resolution.offendingTraderId).toBe(COUNTERPART);
    expect(payments.captures).toEqual([expect.objectContaining({ holdId: holdOf(world, COUNTERPART).holdRef })]);
    expect(world.disbursements).toEqual([expect.objectContaining({ kind: 'PAYOUT', payeeId: INITIATOR })]);
  });

  it('reverses who pays when the operator names the other trader', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    await resolveTradeDispute(deps, { tradeId: world.trade.id, actorId: OPERATOR, outcome: { kind: 'FRAUD', victimId: COUNTERPART } });
    expect(payments.captures).toEqual([expect.objectContaining({ holdId: holdOf(world, INITIATOR).holdRef })]);
    expect(world.disbursements).toEqual([expect.objectContaining({ payeeId: COUNTERPART })]);
  });

  it('refuses a victim who is not party to the trade, before committing anything (ESC-23)', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const result = await resolveTradeDispute(deps, {
      tradeId: world.trade.id, actorId: OPERATOR, outcome: { kind: 'FRAUD', victimId: 'someone-else' },
    });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
    expect(world.trade.state).toBe('DISPUTED');
    expect(payments.captures).toHaveLength(0);
    expect(world.disbursements).toHaveLength(0);
  });

  it('does not treat the operator as the victim even though they are the actor', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, inspected: true });
    const result = await resolveTradeDispute(deps, {
      tradeId: world.trade.id, actorId: OPERATOR, outcome: { kind: 'FRAUD', victimId: OPERATOR },
    });
    expect(result).toMatchObject({ ok: false, error: 'INVALID_OUTCOME' });
  });

  it('never collects from anyone and pays nobody inline; the victim is paid by the drain', async () => {
    const payments = new InMemoryService();
    const made = await createDisputeWorld({ payments, inspected: true });
    await resolveTradeDispute(made.deps, {
      tradeId: made.world.trade.id, actorId: OPERATOR, outcome: { kind: 'FRAUD', victimId: INITIATOR },
    });
    expect(payments.transfers).toHaveLength(0);
    expect(payments.payouts).toHaveLength(0);

    await made.drain({ [INITIATOR]: payable(INITIATOR) });
    expect(payments.transfers).toHaveLength(0);
    expect(payments.payouts).toEqual([
      expect.objectContaining({ merchantRef: `acct_${INITIATOR}`, amount: 50_000, status: 'SETTLED' }),
    ]);
  });
});

describe('raiseFraudClaim — a member claim captures nothing', () => {
  it('moves COLLATERAL_LOCKED to DISPUTED with FRAUD_CLAIMED and records the claim', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, state: 'COLLATERAL_LOCKED' });
    const result = await raiseFraudClaim(deps, { tradeId: world.trade.id, actorId: INITIATOR, reason: 'Handed me a fake.' });
    expect(result).toMatchObject({ ok: true, accusedId: COUNTERPART, transitioned: true });
    expect(world.trade.state).toBe('DISPUTED');
    expect(world.transitions.at(-1)).toMatchObject({ event: 'FRAUD_CLAIMED', from: 'COLLATERAL_LOCKED', to: 'DISPUTED' });
    expect(world.fraudClaims).toEqual([{ claimantId: INITIATOR, reason: 'Handed me a fake.' }]);
    expect(payments.captures).toHaveLength(0);
  });

  it('records a counter-claim on an already-DISPUTED trade with no transition', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments });
    const result = await raiseFraudClaim(deps, { tradeId: world.trade.id, actorId: COUNTERPART, reason: 'No, they did.' });
    expect(result).toMatchObject({ ok: true, transitioned: false });
    expect(world.transitions).toHaveLength(0);
    expect(world.fraudClaims).toHaveLength(1);
  });

  it('refuses a claimant who is not a party', async () => {
    const payments = new InMemoryService();
    const { world, deps } = await createDisputeWorld({ payments, state: 'INSPECTION', inspected: true });
    expect(await raiseFraudClaim(deps, { tradeId: world.trade.id, actorId: 'x', reason: 'y' })).toMatchObject({
      ok: false, error: 'NOT_PARTICIPANT',
    });
  });
});
