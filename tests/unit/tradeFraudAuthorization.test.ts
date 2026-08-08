// tests/unit/tradeFraudAuthorization.test.ts
//
// Who may determine Objective_Fraud, and who benefits from it (Req 8.1, revised).
//
// THE BUG THIS PINS SHUT. `reportObjectiveFraud` used to derive the victim from its
// caller, and its only caller was a participant-gated Server Action. So either trader
// in a 2-way escrow could name themselves the victim, capture the counterparty's
// 100%-of-FMV collateral, have it paid to themselves, and have their own hold voided
// at zero cost — terminal, with no evidence, no review, and no chance for the accused
// to answer. Whoever clicked first took the other's money.
//
// The victim is now an explicit argument supplied by an operator, and it is validated
// against the trade's participants. These tests assert both halves: that the caller is
// no longer trusted as the beneficiary, and that an operator cannot direct a capture
// to someone who is not party to the trade.
//
// AND A SECOND BUG, IN THE SAME FIVE LINES: the payout DIRECTION.
//
// Having established the right victim, the code then paid them with
// `requestTransfer({ payerId: victimPayerId, ... })`. That is a COLLECTION primitive —
// it creates a PaymentIntent against the given customer's saved card and returns
// SETTLED once the charge succeeds. So a confirmed fraud finding captured the
// offender's collateral AND DEBITED THE VICTIM for the same amount, reported success,
// and left the platform holding both sides. Capturing from the right person and then
// charging them is worse than paying the wrong one.
//
// So these tests assert the destination is a connected ACCOUNT via `payoutToMerchant`,
// and that `requestTransfer` is never called on this path at all. The second assertion
// is the one that would have caught it: the old code called a function that existed,
// with plausible arguments, and returned a status that said it worked.

import { describe, expect, it, vi } from 'vitest';

import {
  reportObjectiveFraud,
  type DisputeResolutionDeps,
  type DisputeResolutionRepository,
} from '@/domain/orchestrator/disputeResolution';
import type { PaymentService } from '@/domain/services/types';

const INITIATOR = 'trader-initiator';
const COUNTERPART = 'trader-counterpart';
const OPERATOR = 'admin-1';
const STRANGER = 'someone-else';

const TRADE = {
  id: 'trade-1',
  initiator_id: INITIATOR,
  counterpart_id: COUNTERPART,
  state: 'FRAUD_RESOLVED',
};

/** Holds of equal value, as an equal-FMV trade produces. */
const HOLDS = [
  { holdRef: 'hold_initiator', traderId: INITIATOR, amountCents: 120_000, status: 'ACTIVE' },
  { holdRef: 'hold_counterpart', traderId: COUNTERPART, amountCents: 120_000, status: 'ACTIVE' },
];

function makePayee(traderId: string, payable = true) {
  return {
    profileId: traderId,
    merchantRef: payable ? `acct_${traderId}` : null,
    merchantStatus: payable ? ('APPROVED' as const) : ('NONE' as const),
    liveEnabled: payable,
    transactionsEnabled: payable,
    settlementsEnabled: payable,
  };
}

function makeDepsWith(options: { victimPayable?: boolean } = {}) {
  const victimPayable = options.victimPayable ?? true;
  const recorded = {
    participants: [] as { victimId: string; offendingId: string }[],
    captures: [] as { holdRef: string; capturedCents: number }[],
    voided: [] as string[],
    /** Money paid OUT to a connected account — the correct direction. */
    payouts: [] as { merchantRef: string; amount: number }[],
    /** Money COLLECTED from a card. Must stay empty on this path. */
    collections: [] as { payerId: string; amount: number }[],
  };

  // Payout destinations per trader, so the test can assert WHERE the captured money
  // went and not merely that something happened. Paying the wrong side — or paying
  // in the wrong direction — is the failure mode this whole file exists for.
  const payeeOf: Record<string, ReturnType<typeof makePayee>> = {
    [INITIATOR]: makePayee(INITIATOR, victimPayable),
    [COUNTERPART]: makePayee(COUNTERPART, victimPayable),
  };

  const repository = {
    getHolds: vi.fn(async () => HOLDS),
    getTraderPayee: vi.fn(async (traderId: string) => payeeOf[traderId] ?? null),
    recordFraudParticipants: vi.fn(async (p: { victimId: string; offendingId: string }) => {
      recorded.participants.push({ victimId: p.victimId, offendingId: p.offendingId });
    }),
    recordFullCapture: vi.fn(async (p: { holdRef: string; capturedCents: number }) => {
      recorded.captures.push(p);
    }),
    markHoldVoided: vi.fn(async (ref: string) => {
      recorded.voided.push(ref);
    }),
    flagManualReconciliation: vi.fn(async () => {}),
    recordDisputeRaised: vi.fn(async () => {}),
    recordFrictionTaxCapture: vi.fn(async () => {}),
    recordPartialCaptureFailure: vi.fn(async () => {}),
    recordReturnOverdue: vi.fn(async () => {}),
  } as unknown as DisputeResolutionRepository;

  const payments = {
    fullCapture: vi.fn(async (holdId: string) => ({
      captureId: 'cap_1',
      holdId,
      amount: 120_000,
      status: 'SETTLED' as const,
    })),
    voidHold: vi.fn(async (holdId: string) => ({
      holdId,
      payerId: 'payer',
      amount: 0,
      status: 'VOIDED' as const,
    })),
    payoutToMerchant: vi.fn(async (p: { amount: number; merchantRef: string }) => {
      recorded.payouts.push({ merchantRef: p.merchantRef, amount: p.amount });
      return { transferId: 'tr_1', amount: p.amount, status: 'SETTLED' as const };
    }),
    // Present so the test can prove it is NOT used. Leaving it off the fake would
    // make a regression throw, which reads as a broken test rather than as the
    // victim being charged.
    requestTransfer: vi.fn(async (p: { amount: number; payerId: string }) => {
      recorded.collections.push({ payerId: p.payerId, amount: p.amount });
      return { transferId: 'tr_collect', amount: p.amount, status: 'SETTLED' as const };
    }),
  } as unknown as PaymentService;

  const orchestrator = {
    applyEvent: vi.fn(async () => ({ ok: true as const, trade: TRADE })),
  } as unknown as DisputeResolutionDeps['orchestrator'];

  const deps: DisputeResolutionDeps = { orchestrator, repository, payments };
  return { deps, recorded, repository, payments };
}

function makeDeps() {
  return makeDepsWith();
}

describe('reportObjectiveFraud — who benefits', () => {
  it('captures from the counterpart of the NAMED victim, not of the caller', async () => {
    const { deps, recorded } = makeDeps();

    // The operator is the actor. If the victim were still inferred from `actorId`,
    // this could not resolve at all — the operator is not a party to the trade.
    const result = await reportObjectiveFraud(deps, {
      tradeId: TRADE.id,
      actorId: OPERATOR,
      victimId: COUNTERPART,
    });

    expect(result.ok).toBe(true);
    expect(recorded.participants).toEqual([
      { victimId: COUNTERPART, offendingId: INITIATOR },
    ]);
    // The offender's hold is captured; the victim's is released.
    expect(recorded.captures.map((c) => c.holdRef)).toEqual(['hold_initiator']);
    expect(recorded.voided).toContain('hold_counterpart');
    // And the captured collateral is paid OUT to the NAMED victim's connected
    // account. Capturing from the right person but paying the wrong one would be the
    // same bug with extra steps.
    expect(recorded.payouts).toEqual([
      { merchantRef: `acct_${COUNTERPART}`, amount: 120_000 },
    ]);
    // Nothing was COLLECTED. This is the assertion that fails against the old code.
    expect(recorded.collections).toEqual([]);
  });

  it('reverses who pays when the operator names the other trader', async () => {
    const { deps, recorded } = makeDeps();

    await reportObjectiveFraud(deps, {
      tradeId: TRADE.id,
      actorId: OPERATOR,
      victimId: INITIATOR,
    });

    expect(recorded.participants).toEqual([
      { victimId: INITIATOR, offendingId: COUNTERPART },
    ]);
    expect(recorded.captures.map((c) => c.holdRef)).toEqual(['hold_counterpart']);
    expect(recorded.voided).toContain('hold_initiator');
    expect(recorded.payouts).toEqual([{ merchantRef: `acct_${INITIATOR}`, amount: 120_000 }]);
    expect(recorded.collections).toEqual([]);
  });

  it('refuses to capture for a victim who is not party to the trade', async () => {
    const { deps, recorded } = makeDeps();

    const result = await reportObjectiveFraud(deps, {
      tradeId: TRADE.id,
      actorId: OPERATOR,
      victimId: STRANGER,
    });

    // An operator naming an unrelated account must not redirect a capture to them.
    expect(result).toMatchObject({ ok: false, error: 'NOT_PARTICIPANT' });
    expect(recorded.captures).toEqual([]);
    expect(recorded.payouts).toEqual([]);
    expect(recorded.collections).toEqual([]);
    expect(recorded.participants).toEqual([]);
  });

  it('does not treat the operator as the victim even though they are the actor', async () => {
    const { deps, recorded } = makeDeps();

    const result = await reportObjectiveFraud(deps, {
      tradeId: TRADE.id,
      actorId: OPERATOR,
      victimId: OPERATOR,
    });

    // The operator is not a trader here, so naming themselves is rejected the same
    // way naming any other outsider is. This is the specific shape of the old bug:
    // actor and beneficiary being the same person, unchecked.
    expect(result).toMatchObject({ ok: false, error: 'NOT_PARTICIPANT' });
    expect(recorded.captures).toEqual([]);
  });

  it('holds the captured funds when the victim has no payout account, and charges them nothing', async () => {
    const { deps, recorded } = makeDepsWith({ victimPayable: false });

    const result = await reportObjectiveFraud(deps, {
      tradeId: TRADE.id,
      actorId: OPERATOR,
      victimId: COUNTERPART,
    });

    // A verified member with no Connect account is a normal, valid state, so this is
    // recoverable rather than an error: the collateral is captured, stays in the
    // platform balance, and the case is flagged for an operator.
    expect(result).toMatchObject({ ok: true });
    expect(recorded.captures.map((c) => c.holdRef)).toEqual(['hold_initiator']);
    expect(recorded.payouts).toEqual([]);
    if (result.ok) {
      expect(result.outcome.indications).toContain('VICTIM_NOT_PAYABLE');
      expect(result.outcome.manualReconciliation).toBe(true);
      expect(result.outcome.transferSettled).toBe(false);
    }

    // AND THE POINT OF THE CASE: no fallback charge. The old code fell back to the
    // trader id when no payer was on file and pushed it through a collection call, so
    // the least-prepared victim was the one most likely to be debited.
    expect(recorded.collections).toEqual([]);
  });
});
