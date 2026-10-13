// tests/unit/tradeCashCollection.test.ts
//
// ESC-05 / ESC-06: a trade's cash leg is collected BUYER-PRESENT by the payer before
// any collateral hold, held by the platform, and released or refunded by the outcome.
// Every case from design §1.5, including the round-3 review #6 `pay_by` cases and
// R4-N3 (a passed deadline is refused with zero provider calls).

import { describe, expect, it } from 'vitest';

import {
  collectionNonce,
  computePayBy,
  confirmTradeCashPayment,
  drainTradeCash,
  payTradeCash,
  queueTradeCashRefund,
  queueTradeCashRelease,
  resolveCashAtPayBy,
  settleCashBeforeAbandon,
  type TradeCashSettlementDeps,
  type TradeCashSettlementRecord,
  type TradeCashSettlementRepository,
  type TradeCashStatus,
} from '@/domain/orchestrator/tradeCashSettlement';
import { createSettlementTableTradeCashLeg, createLegacyTradeCashLeg } from '@/domain/orchestrator/tradeCashLeg';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { currencyConversionFeeFor } from '@/domain/fees/fxFee';

const T0 = Date.parse('2026-10-13T00:00:00.000Z');
const HOUR = 3_600_000;
const TRADE = 'trade-1';
const PAYER = 'payer-1';
const RECEIVER = 'receiver-1';

function harness(overrides: {
  state?: string;
  meetingAt?: string | null;
  payBy?: string;
  status?: TradeCashStatus;
  payerRef?: string | null;
  currency?: string;
} = {}) {
  let now = T0;
  const trade = {
    id: TRADE,
    state: overrides.state ?? 'COLLATERAL_PENDING',
    meetingAt: overrides.meetingAt === undefined ? new Date(T0 + 72 * HOUR).toISOString() : overrides.meetingAt,
  };
  let row: TradeCashSettlementRecord = {
    tradeId: TRADE,
    payerId: PAYER,
    receiverId: RECEIVER,
    amountMinor: 5_000,
    fxFeeMinor: 0,
    currency: overrides.currency ?? 'aud',
    status: overrides.status ?? 'NOT_COLLECTED',
    collectionAttempt: 0,
    collectionRef: null,
    collectionRequestedAt: null,
    collectedAt: null,
    payBy: overrides.payBy ?? new Date(T0 + 48 * HOUR).toISOString(),
    releaseNonce: null,
    refundNonce: null,
    holdReason: null,
    cancelFailures: 0,
    attempts: 0,
  };
  const terminal = new Set(['CANCELLED', 'COMPLETED', 'FRAUD_RESOLVED']);
  const apply = (patch: Record<string, unknown>) => {
    const next = { ...row } as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined && key in next) next[key] = value;
    }
    return next as unknown as TradeCashSettlementRecord;
  };
  const repository: TradeCashSettlementRepository = {
    load: async () => ({ ...row }),
    loadTrade: async () => ({ ...trade }),
    async transition(_id, from, to, patch = {}) {
      if (!from.includes(row.status)) return null;
      let next = { ...apply(patch), status: to };
      // The 0139 trigger: a collection landing on an ended trade is refunded.
      if ((row.status === 'NOT_COLLECTED' || row.status === 'COLLECTING') && to === 'COLLECTED' && terminal.has(trade.state)) {
        next = { ...next, status: 'REFUND_PENDING', refundNonce: next.refundNonce ?? `trade-cash:refund:${TRADE}` };
      }
      row = next;
      return { ...row };
    },
    async patch(_id, status, patch) {
      if (row.status !== status) return null;
      row = apply(patch);
      return { ...row };
    },
    loadPayerRef: async () => (overrides.payerRef === undefined ? 'payer_ref' : overrides.payerRef),
    loadReceiverPayout: async () => ({ merchantRef: 'acct_receiver', payable: true }),
    listByStatus: async (status) => (row.status === status ? [{ ...row }] : []),
    listCollectingBefore: async (before) =>
      row.status === 'COLLECTING' && row.collectionRequestedAt && row.collectionRequestedAt < before ? [{ ...row }] : [],
  };
  const payments = new InMemoryService();
  const deps: TradeCashSettlementDeps = { repository, payments, now: () => new Date(now) };
  return {
    deps,
    payments,
    trade,
    get row() {
      return row;
    },
    advance(hours: number) {
      now += hours * HOUR;
    },
  };
}

describe('computePayBy', () => {
  it('is the placement lead before the meeting when there is time', () => {
    const meetingAt = new Date(T0 + 72 * HOUR).toISOString();
    expect(computePayBy({ meetingAt, agreedAt: new Date(T0) }).getTime()).toBe(T0 + 48 * HOUR);
  });
  it('agreed late: the earlier of two hours from now and an hour before the meeting', () => {
    const meetingAt = new Date(T0 + 10 * HOUR).toISOString();
    expect(computePayBy({ meetingAt, agreedAt: new Date(T0) }).getTime()).toBe(T0 + 2 * HOUR);
    const soon = new Date(T0 + 2 * HOUR).toISOString();
    expect(computePayBy({ meetingAt: soon, agreedAt: new Date(T0) }).getTime()).toBe(T0 + HOUR);
  });
});

describe('payTradeCash (ESC-05)', () => {
  it('collects buyer-present into the platform, with no merchantRef', async () => {
    const h = harness();
    const result = await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    expect(result.ok).toBe(true);
    expect(h.row.status).toBe('COLLECTED');
    expect(h.payments.transfers).toHaveLength(1);
    expect(h.payments.payouts).toHaveLength(0);
  });

  it('charges the payer the Currency_Conversion fee on a converted leg, and records it', async () => {
    const h = harness({ currency: 'eur' });
    const result = await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    expect(result.ok).toBe(true);
    const fee = currencyConversionFeeFor(5_000, 'eur');
    expect(fee).toBeGreaterThan(0);
    expect(h.payments.transfers[0].amount).toBe(5_000 + fee);
    expect(h.row.fxFeeMinor).toBe(fee);
  });

  it('charges no conversion fee on a leg in the platform currency', async () => {
    const h = harness({ currency: 'aud' });
    await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    expect(h.payments.transfers[0].amount).toBe(5_000);
    expect(h.row.fxFeeMinor).toBe(0);
  });

  it('only the payer may pay', async () => {
    const h = harness();
    expect(await payTradeCash(h.deps, { actorId: RECEIVER, tradeId: TRADE })).toMatchObject({ ok: false, error: 'NOT_PAYER' });
  });

  it('[R4-N3] refuses once pay_by has passed, with zero provider calls', async () => {
    const h = harness();
    h.advance(49);
    expect(await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE })).toMatchObject({
      ok: false,
      error: 'TRADE_CASH_PAY_BY_PASSED',
    });
    expect(h.payments.transfers).toHaveLength(0);
  });

  it('a decline returns the row to NOT_COLLECTED and the retry uses the next attempt key', async () => {
    const h = harness();
    // Decline every transfer for this trade.
    (h.payments as unknown as { opts: { outcomes: Record<string, string> } }).opts.outcomes = {
      [`trade-cash:${TRADE}`]: 'FAILURE',
    };
    const first = await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    expect(first).toMatchObject({ ok: false, error: 'CASH_DECLINED' });
    expect(h.row.status).toBe('NOT_COLLECTED');
    expect(h.row.collectionAttempt).toBe(1);

    (h.payments as unknown as { opts: { outcomes: Record<string, string> } }).opts.outcomes = {};
    const second = await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    expect(second.ok).toBe(true);
    expect(h.row.collectionAttempt).toBe(2);
    expect(collectionNonce(TRADE, 2)).toBe(`trade-cash:collect:${TRADE}:2`);
  });

  it('REQUIRES_ACTION keeps the row COLLECTING with a client secret; the read-back collects it', async () => {
    const h = harness();
    h.payments.forceRequiresAction = true;
    const result = await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    expect(result.ok && result.nextAction?.clientSecret).toBeTruthy();
    expect(h.row.status).toBe('COLLECTING');
    h.payments.completeChallenge(h.row.collectionRef!, 'SETTLED');
    await confirmTradeCashPayment(h.deps, { actorId: PAYER, tradeId: TRADE });
    expect(h.row.status).toBe('COLLECTED');
  });

  it('a collection confirmed after the trade was cancelled ends REFUND_PENDING', async () => {
    const h = harness();
    h.payments.forceRequiresAction = true;
    await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    h.trade.state = 'CANCELLED';
    h.payments.completeChallenge(h.row.collectionRef!, 'SETTLED');
    await confirmTradeCashPayment(h.deps, { actorId: PAYER, tradeId: TRADE });
    expect(h.row.status).toBe('REFUND_PENDING');
    expect(h.row.refundNonce).toBe(`trade-cash:refund:${TRADE}`);
    const drained = await drainTradeCash(h.deps);
    expect(drained.refunded).toBe(1);
    expect(h.row.status).toBe('REFUNDED');
  });
});

describe('resolveCashAtPayBy (round-3 review #6)', () => {
  it('NOT_COLLECTED at pay_by abandons with no provider call', async () => {
    const h = harness();
    h.advance(49);
    expect(await resolveCashAtPayBy(h.deps, { tradeId: TRADE })).toEqual({ kind: 'ABANDON' });
    expect(h.payments.transfers).toHaveLength(0);
  });

  it('before pay_by an unpaid leg waits', async () => {
    const h = harness();
    expect(await resolveCashAtPayBy(h.deps, { tradeId: TRADE })).toEqual({ kind: 'WAIT', flagged: false });
  });

  it('COLLECTING at pay_by with the cancel succeeding abandons, nothing charged', async () => {
    const h = harness();
    h.payments.forceRequiresAction = true;
    await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    h.advance(49);
    expect(await resolveCashAtPayBy(h.deps, { tradeId: TRADE })).toEqual({ kind: 'ABANDON' });
    expect(h.row.status).toBe('NOT_COLLECTED');
    expect(h.payments.refunds).toHaveLength(0);
  });

  it('COLLECTING at pay_by whose challenge finished first places when there is still time', async () => {
    const h = harness();
    h.payments.forceRequiresAction = true;
    await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    h.payments.completeChallenge(h.row.collectionRef!, 'SETTLED');
    h.advance(49);
    expect(await resolveCashAtPayBy(h.deps, { tradeId: TRADE })).toEqual({ kind: 'PLACE' });
    expect(h.row.status).toBe('COLLECTED');
  });

  it('…and abandons (to refund) when the meeting is under an hour away', async () => {
    const h = harness();
    h.payments.forceRequiresAction = true;
    await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    h.payments.completeChallenge(h.row.collectionRef!, 'SETTLED');
    h.advance(71.5);
    expect(await resolveCashAtPayBy(h.deps, { tradeId: TRADE })).toEqual({ kind: 'ABANDON' });
    expect(await queueTradeCashRefund(h.deps, { tradeId: TRADE })).toBe(true);
    expect(h.row.status).toBe('REFUND_PENDING');
  });

  it('a failed cancel is never abandoned this run, and flags after three', async () => {
    const h = harness();
    h.payments.forceRequiresAction = true;
    await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    h.payments.cancelCollection = async () => ({ status: 'FAILED' });
    h.advance(49);
    expect(await resolveCashAtPayBy(h.deps, { tradeId: TRADE })).toEqual({ kind: 'WAIT', flagged: false });
    expect(await resolveCashAtPayBy(h.deps, { tradeId: TRADE })).toEqual({ kind: 'WAIT', flagged: false });
    expect(await resolveCashAtPayBy(h.deps, { tradeId: TRADE })).toEqual({ kind: 'WAIT', flagged: true });
    expect(await settleCashBeforeAbandon(h.deps, { tradeId: TRADE })).toBe('STOP');
  });
});

describe('release and routing (ESC-06)', () => {
  async function collected() {
    const h = harness();
    await payTradeCash(h.deps, { actorId: PAYER, tradeId: TRADE });
    return h;
  }

  it('completion queues the release; RELEASED only after the transfer settles', async () => {
    const h = await collected();
    expect(await queueTradeCashRelease(h.deps, { tradeId: TRADE })).toBe(true);
    expect(h.row.status).toBe('RELEASE_PENDING');
    const drained = await drainTradeCash(h.deps);
    expect(drained.released).toBe(1);
    expect(h.row.status).toBe('RELEASED');
    expect(h.payments.payouts).toHaveLength(1);
    expect(h.payments.payouts[0]!.merchantRef).toBe('acct_receiver');
  });

  it('a failed release stays RELEASE_PENDING', async () => {
    const h = await collected();
    await queueTradeCashRelease(h.deps, { tradeId: TRADE });
    (h.payments as unknown as { opts: { outcomes: Record<string, string> } }).opts.outcomes = {
      [`trade-cash:${TRADE}`]: 'FAILURE',
    };
    const drained = await drainTradeCash(h.deps);
    expect(drained.failed).toBe(1);
    expect(h.row.status).toBe('RELEASE_PENDING');
  });

  it('never releases a leg that was never collected', async () => {
    const h = harness({ status: 'RELEASE_PENDING' });
    const failures: string[] = [];
    await drainTradeCash(h.deps, { onFailure: ({ error }) => failures.push(error) });
    expect(failures).toEqual(['TRADE_CASH_NOT_COLLECTED']);
    expect(h.payments.payouts).toHaveLength(0);
  });

  it('a trade can never lock-and-complete with the leg uncollected: release refuses', async () => {
    const h = harness();
    expect(await queueTradeCashRelease(h.deps, { tradeId: TRADE })).toBe(false);
  });

  it('routes FRAUD by who was wronged, and NO_EXCHANGE refunds or closes', async () => {
    const legFor = (h: ReturnType<typeof harness>) =>
      createSettlementTableTradeCashLeg({
        loadSettlement: async () => ({ payerId: h.row.payerId, receiverId: h.row.receiverId, status: h.row.status }),
        queueRelease: (id) => queueTradeCashRelease(h.deps, { tradeId: id }),
        queueRefund: (id) => queueTradeCashRefund(h.deps, { tradeId: id }),
        closeUncollected: async () => true,
        legacy: createLegacyTradeCashLeg({ settleTradeCash: async () => undefined }),
      });

    const payerWronged = await collected();
    await legFor(payerWronged).settleForOutcome(TRADE, 'FRAUD', { victimId: PAYER });
    expect(payerWronged.row.status).toBe('REFUND_PENDING');

    const receiverWronged = await collected();
    await legFor(receiverWronged).settleForOutcome(TRADE, 'FRAUD', { victimId: RECEIVER });
    expect(receiverWronged.row.status).toBe('RELEASE_PENDING');

    const unwound = await collected();
    await legFor(unwound).settleForOutcome(TRADE, 'NO_EXCHANGE');
    expect(unwound.row.status).toBe('REFUND_PENDING');

    const neverPaid = harness();
    const closed = await legFor(neverPaid).settleForOutcome(TRADE, 'NO_EXCHANGE');
    expect(closed.manualReconciliation).toBe(false);
  });

  it('a pre-switch trade with no row uses the legacy leg', async () => {
    let legacyCalled = false;
    const leg = createSettlementTableTradeCashLeg({
      loadSettlement: async () => null,
      queueRelease: async () => true,
      queueRefund: async () => true,
      closeUncollected: async () => true,
      legacy: createLegacyTradeCashLeg({
        settleTradeCash: async () => {
          legacyCalled = true;
        },
      }),
    });
    await leg.settleForOutcome(TRADE, 'CONDITION');
    expect(legacyCalled).toBe(true);
  });
});
