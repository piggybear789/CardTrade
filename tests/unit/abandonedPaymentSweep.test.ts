// tests/unit/abandonedPaymentSweep.test.ts
//
// ESC-03: a buyer who walks away from a 3-D Secure check must not leave the sale stuck
// in PAYMENT_PENDING. After 30 minutes the sweep cancels the intent and returns the
// sale to AGREEMENT with nothing charged, or settles it when the check finished
// meanwhile. A re-pay then uses a NEW idempotency key, so the provider cannot replay
// the cancelled intent.

import { describe, expect, it } from 'vitest';

import {
  ABANDONED_PAYMENT_MINUTES,
  acceptCashSaleTerms,
  sweepAbandonedPayments,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { BUYER } from './fakes/cashSaleRepository';
import { agreedSale } from './helpers/agreedSale';

const T0 = Date.parse('2026-10-13T00:00:00.000Z');

async function challengedSale() {
  const payments = new InMemoryService();
  payments.forceRequiresAction = true;
  const setup = await agreedSale(payments);
  let now = T0;
  const deps: CashSaleOrchestratorDeps = { ...setup.deps, now: () => new Date(now) };
  const paid = await acceptCashSaleTerms(deps, {
    cashSaleId: setup.id,
    actorId: BUYER.profileId,
    termsVersion: setup.termsVersion,
  });
  if (!paid.ok || paid.sale.status !== 'PAYMENT_PENDING') throw new Error('setup: expected a challenge');
  return {
    ...setup,
    deps,
    payments,
    transferId: paid.sale.transferId!,
    advance(minutes: number) {
      now += minutes * 60_000;
    },
  };
}

describe('abandoned-payment sweep (ESC-03)', () => {
  it('leaves a challenge younger than 30 minutes alone', async () => {
    const s = await challengedSale();
    s.advance(ABANDONED_PAYMENT_MINUTES - 1);
    const tally = await sweepAbandonedPayments(s.deps);
    expect(tally.abandoned).toBe(0);
    expect((await s.deps.repository.loadCashSale(s.id))?.status).toBe('PAYMENT_PENDING');
  });

  it('cancels an abandoned challenge and returns the sale to AGREEMENT with the nonce cleared', async () => {
    const s = await challengedSale();
    s.advance(ABANDONED_PAYMENT_MINUTES + 1);
    const tally = await sweepAbandonedPayments(s.deps);
    expect(tally.abandoned).toBe(1);
    const sale = await s.deps.repository.loadCashSale(s.id);
    expect(sale?.status).toBe('AGREEMENT');
    expect(sale?.paymentNonce).toBeNull();
    expect(sale?.transferId).toBeNull();
  });

  it('settles when the challenge finished before the cancel', async () => {
    const s = await challengedSale();
    s.payments.completeChallenge(s.transferId, 'SETTLED');
    s.advance(ABANDONED_PAYMENT_MINUTES + 1);
    const tally = await sweepAbandonedPayments(s.deps);
    expect(tally.settled).toBe(1);
    expect((await s.deps.repository.loadCashSale(s.id))?.status).toBe('ESCROW_HELD');
  });

  it('a re-pay after abandon uses a different key and gets a fresh intent', async () => {
    const s = await challengedSale();
    const firstNonce = (await s.deps.repository.loadCashSale(s.id))?.paymentNonce;
    s.advance(ABANDONED_PAYMENT_MINUTES + 1);
    await sweepAbandonedPayments(s.deps);

    s.payments.forceRequiresAction = false;
    const repaid = await acceptCashSaleTerms(s.deps, {
      cashSaleId: s.id,
      actorId: BUYER.profileId,
      termsVersion: s.termsVersion,
    });
    expect(repaid.ok).toBe(true);
    const sale = await s.deps.repository.loadCashSale(s.id);
    expect(sale?.paymentNonce).not.toBe(firstNonce);
    expect(sale?.paymentNonce).toContain(':attempt:2');
    expect(sale?.transferId).not.toBe(s.transferId);
    expect(sale?.status).toBe('ESCROW_HELD');
  });
});
