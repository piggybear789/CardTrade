// tests/unit/cashSalePayRequiresAction.test.ts
//
// ESC-03 layer 2: a cash sale is paid BUYER-PRESENT. When the issuer asks for a 3-D
// Secure check the sale stays PAYMENT_PENDING with a client secret, the read-back
// after the check settles it, and the secret can be fetched again (reload, second
// device) only while the check is outstanding.

import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleTerms,
  confirmCashSalePayment,
  getCashSalePaymentAction,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { BUYER, ITEM } from './fakes/cashSaleRepository';
import { agreedSale } from './helpers/agreedSale';

describe('buyer-present payment with a 3-D Secure check (ESC-03)', () => {
  it('keeps the sale PAYMENT_PENDING and returns the client secret', async () => {
    const payments = new InMemoryService();
    payments.forceRequiresAction = true;
    const { deps, id, termsVersion } = await agreedSale(payments);

    const paid = await acceptCashSaleTerms(deps, { cashSaleId: id, actorId: BUYER.profileId, termsVersion });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.sale.status).toBe('PAYMENT_PENDING');
    expect(paid.nextAction?.clientSecret).toBeTruthy();
    expect(paid.sale.transferId).toBeTruthy();
  });

  it('settles on the read-back once the check passed', async () => {
    const payments = new InMemoryService();
    payments.forceRequiresAction = true;
    const { deps, id, termsVersion } = await agreedSale(payments);
    const paid = await acceptCashSaleTerms(deps, { cashSaleId: id, actorId: BUYER.profileId, termsVersion });
    if (!paid.ok) throw new Error('setup');

    payments.completeChallenge(paid.sale.transferId!, 'SETTLED');
    const confirmed = await confirmCashSalePayment(deps, { actorId: BUYER.profileId, cashSaleId: id });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.sale.status).toBe('ESCROW_HELD');
      expect(confirmed.settledNow).toBe(true);
    }
  });

  it('fails the payment on the read-back when the check failed', async () => {
    const payments = new InMemoryService();
    payments.forceRequiresAction = true;
    const { deps, id, termsVersion } = await agreedSale(payments);
    const paid = await acceptCashSaleTerms(deps, { cashSaleId: id, actorId: BUYER.profileId, termsVersion });
    if (!paid.ok) throw new Error('setup');

    payments.completeChallenge(paid.sale.transferId!, 'FAILED');
    const confirmed = await confirmCashSalePayment(deps, { actorId: BUYER.profileId, cashSaleId: id });
    expect(confirmed).toMatchObject({ ok: false, error: 'TRANSFER_FAILED' });
    expect((await deps.repository.loadCashSale(id))?.status).toBe('FAILED');
  });

  it('returns the secret only while the check is outstanding, and only to the buyer', async () => {
    const payments = new InMemoryService();
    payments.forceRequiresAction = true;
    const { deps, id, termsVersion } = await agreedSale(payments);
    const paid = await acceptCashSaleTerms(deps, { cashSaleId: id, actorId: BUYER.profileId, termsVersion });
    if (!paid.ok) throw new Error('setup');

    const open = await getCashSalePaymentAction(deps, { actorId: BUYER.profileId, cashSaleId: id });
    expect(open).toMatchObject({ ok: true });
    expect(open.ok && open.clientSecret).toBeTruthy();

    const seller = await getCashSalePaymentAction(deps, { actorId: ITEM.ownerId, cashSaleId: id });
    expect(seller).toMatchObject({ ok: false, error: 'NOT_PARTICIPANT' });

    payments.completeChallenge(paid.sale.transferId!, 'SETTLED');
    const done = await getCashSalePaymentAction(deps, { actorId: BUYER.profileId, cashSaleId: id });
    // 0158: the action also says which rail the secret belongs to.
    expect(done).toEqual({ ok: true, clientSecret: null, paymentMethod: 'CARD' });
  });

  it('collects on-session with the attempt-suffixed key', async () => {
    const payments = new InMemoryService();
    const { deps, id, termsVersion } = await agreedSale(payments);
    const paid = await acceptCashSaleTerms(deps, { cashSaleId: id, actorId: BUYER.profileId, termsVersion });
    expect(paid.ok).toBe(true);
    const sale = await deps.repository.loadCashSale(id);
    expect(sale?.paymentNonce).toBe(`cash-sale:${id}:terms:${termsVersion}:attempt:1`);
  });
});
