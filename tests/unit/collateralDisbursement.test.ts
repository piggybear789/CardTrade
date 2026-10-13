// tests/unit/collateralDisbursement.test.ts
//
// The drain for money leaving captured trade collateral (design §1.4), over the
// bounded InMemoryService so a refund or payout beyond what was captured fails the
// way the provider would.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  processDueCollateralDisbursements,
  type CollateralDisbursementRepository,
  type CollateralDisbursementRow,
  type DisbursementNotifier,
} from '@/domain/orchestrator/collateralDisbursement';
import { CAPTURED_COLLATERAL_HOLDBACK_HOURS, type ReleaseFacts } from '@/domain/payouts/releasePolicy';
import type { MerchantRecord } from '@/domain/orchestrator/merchantOnboarding';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';

const HOUR = 3_600_000;
const T0 = new Date('2026-06-01T00:00:00.000Z');

class FakeRepo implements CollateralDisbursementRepository {
  rows = new Map<string, CollateralDisbursementRow>();
  payees = new Map<string, MerchantRecord>();
  capturedAt = new Map<string, string>();

  async listDue({ now, currency }: { now: Date; currency: string }) {
    return [...this.rows.values()]
      .filter(
        (r) =>
          (r.status === 'PENDING' || r.status === 'FAILED') &&
          r.currency === currency &&
          r.holdReason === null &&
          r.attempts < 5 &&
          (r.releaseAt === null || Date.parse(r.releaseAt) <= now.getTime()),
      )
      .map((r) => ({ ...r }));
  }
  async loadReleaseFacts(row: CollateralDisbursementRow): Promise<ReleaseFacts> {
    return {
      source: 'CAPTURED_COLLATERAL',
      currency: row.currency,
      qualifyingCompletedSales: 0,
      paymentSettledAt: null,
      capturedAt: this.capturedAt.get(row.holdRef) ?? row.createdAt,
      openChargeDispute: false,
      openFraudWarning: row.holdReason === 'FRAUD_WARNING',
      staffHold: row.holdReason === 'STAFF',
    };
  }
  async getPayee(payeeId: string) {
    return this.payees.get(payeeId) ?? null;
  }
  async markSettled({ id }: { id: string }) {
    const r = this.rows.get(id)!;
    this.rows.set(id, { ...r, status: 'SETTLED', lastError: null });
  }
  async markFailed({ id, error, countAttempt }: { id: string; error: string; countAttempt: boolean }) {
    const r = this.rows.get(id)!;
    this.rows.set(id, { ...r, status: 'FAILED', lastError: error, attempts: r.attempts + (countAttempt ? 1 : 0) });
  }
  async recordDeferral({ id, releaseAt, holdReason }: { id: string; releaseAt: string | null; holdReason: string | null }) {
    const r = this.rows.get(id)!;
    this.rows.set(id, { ...r, releaseAt, holdReason });
  }
  async markFailureNotified({ id, at }: { id: string; at: Date }) {
    const r = this.rows.get(id)!;
    this.rows.set(id, { ...r, failureNotifiedAt: at.toISOString() });
  }
}

function payable(profileId: string): MerchantRecord {
  return {
    profileId,
    merchantRef: `acct_${profileId}`,
    merchantStatus: 'APPROVED',
    liveEnabled: true,
    transactionsEnabled: true,
    settlementsEnabled: true,
    fraudBannedAt: null,
  };
}

function row(over: Partial<CollateralDisbursementRow>): CollateralDisbursementRow {
  return {
    id: 'd1',
    tradeId: 't1',
    holdRef: 'hold_x',
    kind: 'REFUND',
    payeeId: 'alice',
    amountMinor: 1_000,
    currency: 'aud',
    nonce: 'collateral:d1',
    status: 'PENDING',
    releaseAt: null,
    holdReason: null,
    attempts: 0,
    lastError: null,
    failureNotifiedAt: null,
    createdAt: T0.toISOString(),
    ...over,
  };
}

describe('processDueCollateralDisbursements', () => {
  let repo: FakeRepo;
  let payments: InMemoryService;
  let notified: Array<Parameters<DisbursementNotifier['payoutFailed']>[0]>;
  const notifier: DisbursementNotifier = {
    async payoutFailed(p) {
      notified.push(p);
    },
  };

  async function capturedHold(amount: number): Promise<string> {
    const hold = await payments.placeHold({ payerId: 'bob', amount, ref: `hold:t1:bob:${amount}` });
    await payments.fullCapture(hold.holdId);
    return hold.holdId;
  }

  const run = (now: Date) =>
    processDueCollateralDisbursements({ repository: repo, payments, currency: 'aud', notifier, now: () => now });

  beforeEach(() => {
    repo = new FakeRepo();
    payments = new InMemoryService();
    notified = [];
  });

  it('refunds within what was captured, and refuses beyond it', async () => {
    const holdRef = await capturedHold(5_000);
    repo.rows.set('d1', row({ id: 'd1', holdRef, amountMinor: 4_000, nonce: 'n1' }));
    repo.rows.set('d2', row({ id: 'd2', holdRef, amountMinor: 1_001, nonce: 'n2' }));

    const result = await run(T0);
    expect(result.settled).toBe(1);
    expect(result.failed).toBe(1);
    expect(repo.rows.get('d1')!.status).toBe('SETTLED');
    expect(repo.rows.get('d2')!).toMatchObject({ status: 'FAILED', lastError: 'REFUND_FAILED', attempts: 1 });
    expect(payments.remainingOn(holdRef)).toBe(1_000);
  });

  it('defers a payout for the 7-day captured-collateral holdback, then releases it', async () => {
    const holdRef = await capturedHold(8_000);
    repo.payees.set('alice', payable('alice'));
    repo.capturedAt.set(holdRef, T0.toISOString());
    repo.rows.set('d1', row({ kind: 'PAYOUT', holdRef, amountMinor: 8_000 }));

    const first = await run(new Date(T0.getTime() + HOUR));
    expect(first.deferred).toBe(1);
    expect(repo.rows.get('d1')!).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      releaseAt: new Date(T0.getTime() + CAPTURED_COLLATERAL_HOLDBACK_HOURS * HOUR).toISOString(),
    });
    expect(payments.payouts).toHaveLength(0);

    // Still inside the holdback: not even listed.
    expect((await run(new Date(T0.getTime() + 100 * HOUR))).considered).toBe(0);

    const released = await run(new Date(T0.getTime() + CAPTURED_COLLATERAL_HOLDBACK_HOURS * HOUR));
    expect(released.settled).toBe(1);
    expect(payments.payouts).toHaveLength(1);
    expect(payments.payouts[0]).toMatchObject({ merchantRef: 'acct_alice', amount: 8_000, status: 'SETTLED' });
  });

  it('marks an unpayable payee FAILED / SELLER_NOT_PAYABLE and notifies once', async () => {
    const holdRef = await capturedHold(3_000);
    repo.capturedAt.set(holdRef, new Date(T0.getTime() - 200 * HOUR).toISOString());
    repo.rows.set('d1', row({ kind: 'PAYOUT', holdRef, amountMinor: 3_000 }));

    await run(T0);
    await run(new Date(T0.getTime() + HOUR));
    await run(new Date(T0.getTime() + 2 * HOUR));

    expect(repo.rows.get('d1')!).toMatchObject({ status: 'FAILED', lastError: 'SELLER_NOT_PAYABLE', attempts: 0 });
    expect(notified).toEqual([{ payeeId: 'alice', tradeId: 't1', cause: 'NOT_PAYABLE' }]);
    expect(payments.payouts).toHaveLength(0);

    // Finishing payout setup releases it on a later pass.
    repo.payees.set('alice', payable('alice'));
    expect((await run(new Date(T0.getTime() + 3 * HOUR))).settled).toBe(1);
  });

  it('reuses the persisted nonce on retry, so a retried payout cannot pay twice', async () => {
    const holdRef = await capturedHold(3_000);
    repo.payees.set('alice', payable('alice'));
    repo.capturedAt.set(holdRef, new Date(T0.getTime() - 200 * HOUR).toISOString());
    const failing = new InMemoryService({ outcomes: { 'collateral-payout:d1': 'FAILURE' } });
    repo.rows.set('d1', row({ kind: 'PAYOUT', holdRef, amountMinor: 3_000, nonce: 'collateral:d1' }));

    // First pass against a provider that refuses: an attempt is counted.
    await processDueCollateralDisbursements({
      repository: repo, payments: failing, currency: 'aud', notifier, now: () => T0,
    });
    expect(repo.rows.get('d1')!).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'PAYOUT_FAILED' });

    // Retry against the real double twice with the same row: one payout, same nonce.
    await run(new Date(T0.getTime() + HOUR));
    repo.rows.set('d1', { ...repo.rows.get('d1')!, status: 'PENDING' });
    await run(new Date(T0.getTime() + 2 * HOUR));
    const settledPayouts = payments.payouts.filter((p) => p.status === 'SETTLED');
    expect(settledPayouts).toHaveLength(1);
    expect(payments.remainingOn(holdRef)).toBe(0);
  });

  it('settles a platform-retained share with no provider call', async () => {
    repo.rows.set('d1', row({ kind: 'PLATFORM_RETAINED', payeeId: null, amountMinor: 1_000 }));
    const result = await run(T0);
    expect(result.settled).toBe(1);
    expect(payments.refunds).toHaveLength(0);
    expect(payments.payouts).toHaveLength(0);
  });

  it('keeps a staff-held placeholder out of the drain', async () => {
    repo.rows.set('d1', row({ kind: 'PAYOUT', amountMinor: 0, holdReason: 'STAFF' }));
    expect((await run(T0)).considered).toBe(0);
    expect(repo.rows.get('d1')!.status).toBe('PENDING');
  });
});
