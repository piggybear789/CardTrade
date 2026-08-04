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

function makeDeps() {
  const recorded = {
    participants: [] as { victimId: string; offendingId: string }[],
    captures: [] as { holdRef: string; capturedCents: number }[],
    voided: [] as string[],
    transfers: [] as { payerId: string; amount: number }[],
  };

  // Payer refs per trader, so the test can assert WHERE the captured money went and
  // not merely that a transfer happened. Paying the wrong side is the failure mode
  // this whole file exists for.
  const payerOf: Record<string, string> = {
    [INITIATOR]: 'payer_initiator',
    [COUNTERPART]: 'payer_counterpart',
  };

  const repository = {
    getHolds: vi.fn(async () => HOLDS),
    getTraderPayerId: vi.fn(async (traderId: string) => payerOf[traderId] ?? null),
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
    requestTransfer: vi.fn(async (p: { amount: number; payerId: string }) => {
      recorded.transfers.push({ payerId: p.payerId, amount: p.amount });
      return { transferId: 'tr_1', amount: p.amount, status: 'SETTLED' as const };
    }),
  } as unknown as PaymentService;

  const orchestrator = {
    applyEvent: vi.fn(async () => ({ ok: true as const, trade: TRADE })),
  } as unknown as DisputeResolutionDeps['orchestrator'];

  const deps: DisputeResolutionDeps = { orchestrator, repository, payments };
  return { deps, recorded, repository, payments };
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
    // And the captured collateral is paid to the NAMED victim. Capturing from the
    // right person but paying the wrong one would be the same bug with extra steps.
    expect(recorded.transfers).toEqual([{ payerId: 'payer_counterpart', amount: 120_000 }]);
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
    expect(recorded.transfers).toEqual([{ payerId: 'payer_initiator', amount: 120_000 }]);
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
    expect(recorded.transfers).toEqual([]);
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
});
