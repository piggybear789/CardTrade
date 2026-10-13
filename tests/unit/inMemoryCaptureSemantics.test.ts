// tests/unit/inMemoryCaptureSemantics.test.ts
//
// SINGLE CAPTURE in the test doubles (ESC-01, ESC-07).
//
// A PaymentIntent is captured once. A partial capture makes the provider release the
// remainder, so a later full capture has nothing to take. The doubles used to accept
// any capture on any hold, which is exactly what let "capture $20 at raise, then try
// to capture the rest at resolution" pass its tests while losing the collateral in
// production. Both doubles are checked against the same cases.

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

describe.each(doubles)('%s capture semantics', (_name, make) => {
  it('refuses a full capture after a partial capture', async () => {
    const svc = make();
    const hold = await svc.placeHold({ payerId: 'p1', amount: 10_000, ref: 'hold:t1:a' });
    expect(hold.status).toBe('ACTIVE');

    const partial = await svc.partialCapture({ holdId: hold.holdId, amount: 2_000 });
    expect(partial.status).toBe('SETTLED');

    const full = await svc.fullCapture(hold.holdId);
    expect(full.status).toBe('FAILED');
    expect(full.amount).toBe(0);
  });

  it('refuses a second partial capture', async () => {
    const svc = make();
    const hold = await svc.placeHold({ payerId: 'p1', amount: 10_000, ref: 'hold:t2:a' });
    await svc.partialCapture({ holdId: hold.holdId, amount: 2_000 });
    const again = await svc.partialCapture({ holdId: hold.holdId, amount: 1_000 });
    expect(again.status).toBe('FAILED');
  });

  it('refuses a capture on a voided hold', async () => {
    const svc = make();
    const hold = await svc.placeHold({ payerId: 'p1', amount: 10_000, ref: 'hold:t3:a' });
    await svc.voidHold(hold.holdId);
    expect((await svc.fullCapture(hold.holdId)).status).toBe('FAILED');
    expect((await svc.partialCapture({ holdId: hold.holdId, amount: 100 })).status).toBe('FAILED');
  });

  it('refuses a capture on a hold it never placed', async () => {
    const svc = make();
    expect((await svc.fullCapture('hold_unknown')).status).toBe('FAILED');
  });

  it('refuses a partial capture above the authorised amount', async () => {
    const svc = make();
    const hold = await svc.placeHold({ payerId: 'p1', amount: 1_000, ref: 'hold:t4:a' });
    expect((await svc.partialCapture({ holdId: hold.holdId, amount: 1_001 })).status).toBe('FAILED');
    // The refusal did not consume the hold.
    expect((await svc.fullCapture(hold.holdId)).status).toBe('SETTLED');
  });

  it('cannot void a captured hold', async () => {
    const svc = make();
    const hold = await svc.placeHold({ payerId: 'p1', amount: 1_000, ref: 'hold:t5:a' });
    await svc.fullCapture(hold.holdId);
    expect((await svc.voidHold(hold.holdId)).status).toBe('FAILED');
  });

  it('reports a hold expiry from the 114-hour planning figure', async () => {
    const svc = make();
    const before = Date.now();
    const hold = await svc.placeHold({ payerId: 'p1', amount: 1_000, ref: 'hold:t6:a' });
    const expires = Date.parse(hold.expiresAt ?? '');
    expect(expires).toBeGreaterThanOrEqual(before + 114 * 3_600_000 - 1_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 114 * 3_600_000 + 1_000);
    expect((await svc.readHoldExpiry?.(hold.holdId))?.expiresAt).toBe(hold.expiresAt);
  });
});

describe('InMemoryService readHoldExpiry test switch', () => {
  it('reports what the test set, including no deadline at all', async () => {
    const svc = new InMemoryService();
    const hold = await svc.placeHold({ payerId: 'p1', amount: 1_000, ref: 'hold:t7:a' });
    svc.setHoldExpiry(hold.holdId, '2030-01-01T00:00:00.000Z');
    expect(await svc.readHoldExpiry(hold.holdId)).toEqual({ expiresAt: '2030-01-01T00:00:00.000Z' });
    svc.setHoldExpiry(hold.holdId, null);
    expect(await svc.readHoldExpiry(hold.holdId)).toEqual({ expiresAt: null });
  });
});
