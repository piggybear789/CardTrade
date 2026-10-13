// tests/unit/inMemoryRefundBounds.test.ts
//
// BOUNDED REFUNDS in the test doubles (ESC-01, design review #11).
//
// `InMemoryService.refundPayment` used to accept any ref and any amount, so a
// property like "total disbursed never exceeds what was captured" passed vacuously:
// the double would happily refund money that never existed. Both doubles now track
// what each collection or captured hold actually took, and refuse anything beyond
// it. One shared table of cases runs against both, so they cannot drift apart.

import { describe, expect, it } from 'vitest';

import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { MockService } from '@/domain/services/mock/MockService';
import type { PaymentService } from '@/domain/services/types';

const doubles: Array<[string, () => PaymentService]> = [
  ['InMemoryService', () => new InMemoryService()],
  [
    'MockService',
    () =>
      new MockService({
        webhookUrl: 'http://localhost/none',
        secret: 'test-secret',
        isolatedLedger: true,
        fetchFn: async () => undefined,
      }),
  ],
];

/** A collection of `amount` the double knows about. */
async function collect(svc: PaymentService, amount: number, ref: string): Promise<string> {
  const t = await svc.requestTransfer({ payerId: 'buyer', amount, ref, nonce: `n:${ref}` });
  expect(t.status).toBe('SETTLED');
  return t.transferId;
}

interface RefundCase {
  name: string;
  run: (svc: PaymentService) => Promise<void>;
}

const cases: RefundCase[] = [
  {
    name: 'refuses a refund on a ref that never held money',
    run: async (svc) => {
      const r = await svc.refundPayment({ paymentRef: 'pi_unknown', amount: 100, nonce: 'r1' });
      expect(r.status).toBe('FAILED');
    },
  },
  {
    name: 'refuses an over-refund',
    run: async (svc) => {
      const ref = await collect(svc, 5_000, 'sale:1');
      expect((await svc.refundPayment({ paymentRef: ref, amount: 5_001, nonce: 'r2' })).status).toBe('FAILED');
      // Nothing was spent by the refusal.
      expect((await svc.refundPayment({ paymentRef: ref, amount: 5_000, nonce: 'r3' })).status).toBe('SETTLED');
    },
  },
  {
    name: 'refunds the remainder when the amount is omitted, then refuses a zero remainder',
    run: async (svc) => {
      const ref = await collect(svc, 5_000, 'sale:2');
      expect((await svc.refundPayment({ paymentRef: ref, amount: 1_500, nonce: 'r4' })).status).toBe('SETTLED');
      const rest = await svc.refundPayment({ paymentRef: ref, nonce: 'r5' });
      expect(rest).toMatchObject({ status: 'SETTLED', amount: 3_500 });
      expect((await svc.refundPayment({ paymentRef: ref, nonce: 'r6' })).status).toBe('FAILED');
    },
  },
  {
    name: 'bounds a refund after a partial capture by what was captured',
    run: async (svc) => {
      const hold = await svc.placeHold({ payerId: 'trader', amount: 10_000, ref: 'hold:t:a' });
      await svc.partialCapture({ holdId: hold.holdId, amount: 2_000 });
      expect((await svc.refundPayment({ paymentRef: hold.holdId, amount: 2_001, nonce: 'r7' })).status).toBe('FAILED');
      expect((await svc.refundPayment({ paymentRef: hold.holdId, amount: 2_000, nonce: 'r8' })).status).toBe('SETTLED');
    },
  },
  {
    name: 'returns the first result for a repeated refund nonce',
    run: async (svc) => {
      const ref = await collect(svc, 5_000, 'sale:3');
      const first = await svc.refundPayment({ paymentRef: ref, amount: 1_000, nonce: 'r9' });
      const again = await svc.refundPayment({ paymentRef: ref, amount: 1_000, nonce: 'r9' });
      expect(again).toEqual(first);
      // Only one refund was spent: 4,000 is still refundable, 4,001 is not.
      expect((await svc.refundPayment({ paymentRef: ref, amount: 4_001, nonce: 'r10' })).status).toBe('FAILED');
    },
  },
  {
    name: 'bounds a sourced payout against the same charge',
    run: async (svc) => {
      const hold = await svc.placeHold({ payerId: 'offender', amount: 8_000, ref: 'hold:t:b' });
      await svc.fullCapture(hold.holdId);
      const over = await svc.payoutToMerchant({
        merchantRef: 'acct_victim', amount: 8_001, ref: 'p1', nonce: 'p1', sourcePaymentRef: hold.holdId,
      });
      expect(over.status).toBe('FAILED');
      const paid = await svc.payoutToMerchant({
        merchantRef: 'acct_victim', amount: 6_000, ref: 'p2', nonce: 'p2', sourcePaymentRef: hold.holdId,
      });
      expect(paid.status).toBe('SETTLED');
      // The payout and the refund share one budget.
      expect((await svc.refundPayment({ paymentRef: hold.holdId, amount: 2_001, nonce: 'r11' })).status).toBe('FAILED');
      expect((await svc.refundPayment({ paymentRef: hold.holdId, nonce: 'r12' })).amount).toBe(2_000);
    },
  },
  {
    name: 'refuses a sourced payout from a ref that never held money',
    run: async (svc) => {
      const r = await svc.payoutToMerchant({
        merchantRef: 'acct_x', amount: 100, ref: 'p3', nonce: 'p3', sourcePaymentRef: 'pi_unknown',
      });
      expect(r.status).toBe('FAILED');
    },
  },
  {
    name: 'returns the first result for a repeated payout nonce',
    run: async (svc) => {
      const ref = await collect(svc, 5_000, 'sale:4');
      const first = await svc.payoutToMerchant({
        merchantRef: 'acct_s', amount: 4_000, ref: 'p4', nonce: 'p4', sourcePaymentRef: ref,
      });
      const again = await svc.payoutToMerchant({
        merchantRef: 'acct_s', amount: 4_000, ref: 'p4', nonce: 'p4', sourcePaymentRef: ref,
      });
      expect(again).toEqual(first);
      expect((await svc.refundPayment({ paymentRef: ref, nonce: 'r13' })).amount).toBe(1_000);
    },
  },
];

describe.each(doubles)('%s refund bounds', (_name, make) => {
  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_n, c) => {
    await c.run(make());
  });
});
