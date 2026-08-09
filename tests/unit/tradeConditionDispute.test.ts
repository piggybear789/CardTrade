// tests/unit/tradeConditionDispute.test.ts
//
// The Condition_Dispute path on a 2-way Trade (Req 7.1, 7.2, 7.3, 7.5, 7.6).
//
// WHY THIS FILE EXISTS. This path had NO unit coverage at all. `cashSaleDispute.test.ts`
// covers the Cash_Sale dispute, which is a different flow, and
// `tradeFraudAuthorization.test.ts` covers Objective_Fraud. So the $20 Friction_Tax
// capture, its $10/$10 allocation, and the release of both traders' collateral — every
// money movement a condition dispute makes — were unexercised.
//
// Two defects had already shipped through that gap, and both are pinned below:
//
//   * The $10 return-shipping share was ALLOCATED and never PAID. It was written to
//     `friction_tax_return_cents` and read back only by display code, so the platform
//     captured $20 and kept all of it while the trader who has to post the item back was
//     underpaid by $10 on every dispute.
//
//   * `voidHold`'s returned status was DISCARDED when releasing collateral, and the row
//     was marked VOIDED regardless. A trader's card could stay encumbered while the
//     system recorded the hold as released — and because the expiry reconciler only
//     sweeps holds still marked ACTIVE, nothing could find it afterwards.
//
// The direction of money is asserted throughout: `payoutToMerchant` pays OUT of the
// platform balance, `requestTransfer` COLLECTS from a card. Confusing the two is how the
// fraud path came to charge its own victim, so these tests assert that nothing is
// collected on this path at all.

import { describe, expect, it, vi } from 'vitest';

import {
  FRICTION_TAX_CENTS,
  FRICTION_TAX_PLATFORM_FEE_CENTS,
  FRICTION_TAX_RETURN_SHIPPING_CENTS,
  raiseConditionDispute,
  resolveConditionDispute,
  type DisputeResolutionDeps,
  type DisputeResolutionRepository,
} from '@/domain/orchestrator/disputeResolution';
import type { PaymentService } from '@/domain/services/types';

const RAISER = 'trader-raiser';
const ACCUSED = 'trader-accused';
const OUTSIDER = 'not-a-party';

/** A trade already carrying the dispute participants, as the repository records them. */
const TRADE = {
  id: 'trade-1',
  initiator_id: RAISER,
  counterpart_id: ACCUSED,
  state: 'DISPUTED',
  dispute_raised_by: RAISER,
  disputed_against: ACCUSED,
};

/** Equal-value collateral, as an equal-FMV swap produces. */
const HOLDS = [
  { holdRef: 'hold_raiser', traderId: RAISER, amountCents: 80_000, capturedCents: 0, status: 'ACTIVE' },
  { holdRef: 'hold_accused', traderId: ACCUSED, amountCents: 80_000, capturedCents: 0, status: 'ACTIVE' },
];

function payee(traderId: string, payable = true) {
  return {
    profileId: traderId,
    merchantRef: payable ? `acct_${traderId}` : null,
    merchantStatus: payable ? ('APPROVED' as const) : ('NONE' as const),
    liveEnabled: payable,
    transactionsEnabled: payable,
    settlementsEnabled: payable,
  };
}

function makeDeps(
  options: {
    captureSettles?: boolean;
    raiserPayable?: boolean;
    payoutSettles?: boolean;
    voidSucceeds?: boolean;
  } = {},
) {
  const captureSettles = options.captureSettles ?? true;
  const raiserPayable = options.raiserPayable ?? true;
  const payoutSettles = options.payoutSettles ?? true;
  const voidSucceeds = options.voidSucceeds ?? true;

  const recorded = {
    participants: [] as { raisedBy: string; disputedAgainst: string }[],
    captures: [] as { holdRef: string; capturedCents: number; allocation: unknown }[],
    captureFailures: [] as string[],
    returnResults: [] as { nonce: string; paid: boolean }[],
    /** Money paid OUT to a connected account — the correct direction. */
    payouts: [] as { merchantRef: string; amount: number; nonce: string }[],
    /** Money COLLECTED from a card. Must stay empty on this path. */
    collections: [] as { payerId: string; amount: number }[],
    voidedInProvider: [] as string[],
    markedVoided: [] as string[],
    manualReconciliations: 0,
  };

  const repository = {
    getHolds: vi.fn(async () => HOLDS),
    getTraderPayee: vi.fn(async (traderId: string) =>
      payee(traderId, traderId === RAISER ? raiserPayable : true),
    ),
    recordDisputeParticipants: vi.fn(
      async (p: { raisedBy: string; disputedAgainst: string }) => {
        recorded.participants.push({ raisedBy: p.raisedBy, disputedAgainst: p.disputedAgainst });
      },
    ),
    recordFrictionTaxCapture: vi.fn(
      async (p: { holdRef: string; capturedCents: number; allocation: unknown }) => {
        recorded.captures.push(p);
      },
    ),
    recordPartialCaptureFailure: vi.fn(async (p: { tradeId: string }) => {
      recorded.captureFailures.push(p.tradeId);
    }),
    recordFrictionTaxReturnResult: vi.fn(async (p: { nonce: string; paid: boolean }) => {
      recorded.returnResults.push({ nonce: p.nonce, paid: p.paid });
    }),
    markHoldVoided: vi.fn(async (ref: string) => {
      recorded.markedVoided.push(ref);
    }),
    flagManualReconciliation: vi.fn(async () => {
      recorded.manualReconciliations += 1;
    }),
    recordReturnOverdue: vi.fn(async () => {}),
    recordFraudParticipants: vi.fn(async () => {}),
    recordFullCapture: vi.fn(async () => {}),
  } as unknown as DisputeResolutionRepository;

  const payments = {
    partialCapture: vi.fn(async (p: { holdId: string; amount: number }) => ({
      captureId: 'cap_1',
      holdId: p.holdId,
      amount: p.amount,
      status: captureSettles ? ('SETTLED' as const) : ('FAILED' as const),
    })),
    voidHold: vi.fn(async (holdId: string) => {
      if (voidSucceeds) recorded.voidedInProvider.push(holdId);
      return {
        holdId,
        payerId: 'payer',
        amount: 0,
        status: voidSucceeds ? ('VOIDED' as const) : ('FAILED' as const),
      };
    }),
    payoutToMerchant: vi.fn(
      async (p: { merchantRef: string; amount: number; nonce: string }) => {
        recorded.payouts.push({ merchantRef: p.merchantRef, amount: p.amount, nonce: p.nonce });
        return {
          transferId: 'tr_1',
          amount: p.amount,
          status: payoutSettles ? ('SETTLED' as const) : ('FAILED' as const),
        };
      },
    ),
    // Present so a regression can be caught rather than throwing. Collecting on this
    // path would mean charging a trader money the platform already holds.
    requestTransfer: vi.fn(async (p: { payerId: string; amount: number }) => {
      recorded.collections.push({ payerId: p.payerId, amount: p.amount });
      return { transferId: 'tr_collect', amount: p.amount, status: 'SETTLED' as const };
    }),
  } as unknown as PaymentService;

  const orchestrator = {
    applyEvent: vi.fn(async () => ({ ok: true as const, trade: TRADE })),
  } as unknown as DisputeResolutionDeps['orchestrator'];

  const deps: DisputeResolutionDeps = { orchestrator, repository, payments };
  return { deps, recorded, repository, payments, orchestrator };
}

describe('raiseConditionDispute — the Friction_Tax', () => {
  it('captures $20 from the accused trader and pays the $10 return share to the raiser', async () => {
    const { deps, recorded, payments } = makeDeps();

    const result = await raiseConditionDispute(deps, {
      tradeId: TRADE.id,
      actorId: RAISER,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The accused trader is the raiser's counterpart, and it is THEIR hold that is hit.
    expect(result.disputedAgainst).toBe(ACCUSED);
    expect(recorded.participants).toEqual([
      { raisedBy: RAISER, disputedAgainst: ACCUSED },
    ]);
    expect(payments.partialCapture).toHaveBeenCalledWith({
      holdId: 'hold_accused',
      amount: FRICTION_TAX_CENTS,
    });

    // The split is recorded against the trade.
    expect(result.frictionTaxSettled).toBe(true);
    expect(result.allocation).toEqual({
      returnShippingCents: FRICTION_TAX_RETURN_SHIPPING_CENTS,
      platformFeeCents: FRICTION_TAX_PLATFORM_FEE_CENTS,
    });
    expect(recorded.captures).toHaveLength(1);
    expect(recorded.captures[0]?.holdRef).toBe('hold_accused');

    // AND THE $10 ACTUALLY MOVES, to the RAISER's connected account. This is the
    // assertion that fails against the version that only recorded the allocation.
    expect(result.returnShippingPaid).toBe(true);
    expect(recorded.payouts).toEqual([
      {
        merchantRef: `acct_${RAISER}`,
        amount: FRICTION_TAX_RETURN_SHIPPING_CENTS,
        nonce: `friction-return:${TRADE.id}`,
      },
    ]);
    expect(recorded.returnResults).toEqual([
      { nonce: `friction-return:${TRADE.id}`, paid: true },
    ]);

    // Nothing was collected from anybody: the $10 was already in the platform balance.
    expect(recorded.collections).toEqual([]);

    // The two halves must sum to what was captured, or the platform is keeping a
    // remainder nobody accounted for.
    expect(
      FRICTION_TAX_RETURN_SHIPPING_CENTS + FRICTION_TAX_PLATFORM_FEE_CENTS,
    ).toBe(FRICTION_TAX_CENTS);
  });

  it('records a failure and moves no money when the capture does not settle', async () => {
    const { deps, recorded } = makeDeps({ captureSettles: false });

    const result = await raiseConditionDispute(deps, {
      tradeId: TRADE.id,
      actorId: RAISER,
    });

    // Still ok: a failed capture does not roll the dispute back (Req 7.6).
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.frictionTaxSettled).toBe(false);
    expect(result.allocation).toBeUndefined();
    expect(recorded.captureFailures).toEqual([TRADE.id]);

    // Nothing captured means nothing to pay out. Paying the $10 here would spend the
    // platform's own money on a dispute that collected nothing.
    expect(recorded.captures).toEqual([]);
    expect(recorded.payouts).toEqual([]);
    expect(recorded.collections).toEqual([]);
  });

  it('keeps the $10 owed and visible when the raiser has no payout account', async () => {
    const { deps, recorded } = makeDeps({ raiserPayable: false });

    const result = await raiseConditionDispute(deps, {
      tradeId: TRADE.id,
      actorId: RAISER,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The capture stands — the accused trader owes it either way.
    expect(result.frictionTaxSettled).toBe(true);
    // But the share cannot land, so it stays in the platform balance, is recorded as
    // unpaid, and is flagged for an operator rather than quietly dropped.
    expect(result.returnShippingPaid).toBe(false);
    expect(recorded.payouts).toEqual([]);
    expect(recorded.returnResults).toEqual([
      { nonce: `friction-return:${TRADE.id}`, paid: false },
    ]);
    expect(recorded.manualReconciliations).toBe(1);

    // And no fallback charge. A trader with no payout account must never be DEBITED
    // instead — that inversion is exactly what the fraud path shipped.
    expect(recorded.collections).toEqual([]);
  });

  it('flags the case when the provider refuses the return payout', async () => {
    const { deps, recorded } = makeDeps({ payoutSettles: false });

    const result = await raiseConditionDispute(deps, {
      tradeId: TRADE.id,
      actorId: RAISER,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.returnShippingPaid).toBe(false);
    // Attempted, refused, recorded as unpaid — not recorded as paid because a call
    // was made. Payouts report failure by status rather than by throwing.
    expect(recorded.payouts).toHaveLength(1);
    expect(recorded.returnResults).toEqual([
      { nonce: `friction-return:${TRADE.id}`, paid: false },
    ]);
    expect(recorded.manualReconciliations).toBe(1);
  });

  it('refuses a raiser who is not a party to the trade', async () => {
    const { deps, recorded } = makeDeps();

    const result = await raiseConditionDispute(deps, {
      tradeId: TRADE.id,
      actorId: OUTSIDER,
    });

    expect(result).toMatchObject({ ok: false, error: 'NOT_PARTICIPANT' });
    expect(recorded.participants).toEqual([]);
    expect(recorded.captures).toEqual([]);
    expect(recorded.payouts).toEqual([]);
  });
});

describe('resolveConditionDispute — releasing the collateral', () => {
  it('releases both traders holds and reports what it released', async () => {
    const { deps, recorded } = makeDeps();

    const result = await resolveConditionDispute(deps, {
      tradeId: TRADE.id,
      actorId: RAISER,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both sides: the accused trader's remaining collateral AND the raiser's, which was
    // never captured from at all (Req 7.5).
    expect(recorded.voidedInProvider.sort()).toEqual(['hold_accused', 'hold_raiser']);
    expect(recorded.markedVoided.sort()).toEqual(['hold_accused', 'hold_raiser']);
    expect(result.voidedHoldRefs.sort()).toEqual(['hold_accused', 'hold_raiser']);
    expect(recorded.manualReconciliations).toBe(0);
  });

  it('does NOT record a release the provider refused', async () => {
    // THE REGRESSION THIS PINS. The returned status used to be discarded and the row
    // marked VOIDED regardless, so a trader's card stayed encumbered while the system
    // said it was released — and the expiry reconciler only sweeps holds still marked
    // ACTIVE, so nothing could ever find it again.
    const { deps, recorded } = makeDeps({ voidSucceeds: false });

    const result = await resolveConditionDispute(deps, {
      tradeId: TRADE.id,
      actorId: RAISER,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The row is left alone, so the expiry reconciler still owns it.
    expect(recorded.markedVoided).toEqual([]);
    // And the caller is not told it was released.
    expect(result.voidedHoldRefs).toEqual([]);
    // One flag per hold that could not be released.
    expect(recorded.manualReconciliations).toBe(2);
  });
});
