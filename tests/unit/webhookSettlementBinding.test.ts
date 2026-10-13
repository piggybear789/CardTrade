// tests/unit/webhookSettlementBinding.test.ts
//
// ESC-37: a cash-sale settlement is bound to the sale's own collection. A succeeded
// PaymentIntent that merely names the sale in its metadata, for a different intent or
// a smaller amount, must not release the goods. And an event from a CONNECTED account
// (a member's own Stripe account, where they can mint intents carrying our metadata
// keys) is not ours at all.

import { describe, expect, it } from 'vitest';
import type Stripe from 'stripe';

import {
  acceptCashSaleTerms,
  initiateCashSale,
  settleCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import { translateStripeEvent } from '@/domain/services/stripe/webhook';
import { BUYER, ITEM, fakeTracking, makeCashSaleRepository, makePayments } from './fakes/cashSaleRepository';
import { DELIVERY_TERMS, PURCHASE } from './helpers/disputedCashSale';

async function pendingSale() {
  const { repository } = makeCashSaleRepository();
  // PENDING: the collection is submitted but the webhook has not landed yet.
  const { payments } = makePayments({ transferStatus: 'PENDING' });
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
  };
  const created = await initiateCashSale(deps, PURCHASE);
  if (!created.ok) throw new Error('setup');
  const id = created.sale.id;
  const priced = await updateCashSaleTerms(deps, {
    cashSaleId: id,
    actorId: ITEM.ownerId,
    expectedTermsVersion: created.sale.termsVersion,
    terms: { ...DELIVERY_TERMS, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error('setup: price');
  await updateCashSaleTerms(deps, {
    cashSaleId: id,
    actorId: BUYER.profileId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms: DELIVERY_TERMS,
  });
  const sale = await deps.repository.loadCashSale(id);
  await acceptCashSaleTerms(deps, { cashSaleId: id, actorId: BUYER.profileId, termsVersion: sale!.termsVersion });
  const paid = await deps.repository.loadCashSale(id);
  if (paid?.status !== 'PAYMENT_PENDING' || !paid.transferId) {
    throw new Error(`setup: expected PAYMENT_PENDING with a transfer, got ${paid?.status}`);
  }
  return { deps, sale: paid };
}

describe('settleCashSale is bound to the collection (ESC-37)', () => {
  it('settles when the ref and amount match', async () => {
    const { deps, sale } = await pendingSale();
    const result = await settleCashSale(deps, {
      cashSaleId: sale.id,
      paymentRef: sale.transferId!,
      amountReceived: sale.amountCents,
    });
    expect(result.ok).toBe(true);
  });

  it('refuses a different PaymentIntent and leaves the sale PAYMENT_PENDING', async () => {
    const { deps, sale } = await pendingSale();
    const result = await settleCashSale(deps, {
      cashSaleId: sale.id,
      paymentRef: 'pi_someone_else',
      amountReceived: sale.amountCents,
    });
    expect(result).toMatchObject({ ok: false, error: 'SETTLEMENT_MISMATCH' });
    expect((await deps.repository.loadCashSale(sale.id))?.status).toBe('PAYMENT_PENDING');
  });

  it('refuses a short collection', async () => {
    const { deps, sale } = await pendingSale();
    const result = await settleCashSale(deps, {
      cashSaleId: sale.id,
      paymentRef: sale.transferId!,
      amountReceived: sale.amountCents - 1,
    });
    expect(result).toMatchObject({ ok: false, error: 'SETTLEMENT_MISMATCH' });
    expect((await deps.repository.loadCashSale(sale.id))?.status).toBe('PAYMENT_PENDING');
  });
});

describe('connected-account events are dropped (ESC-37)', () => {
  function succeeded(account?: string): Stripe.Event {
    return {
      id: 'evt_1',
      object: 'event',
      type: 'payment_intent.succeeded',
      created: 1_700_000_000,
      ...(account ? { account } : {}),
      data: {
        object: {
          id: 'pi_1',
          object: 'payment_intent',
          amount: 1000,
          amount_received: 1000,
          status: 'succeeded',
          metadata: {
            cardtrade_kind: 'TRANSFER',
            cardtrade_cash_sale_id: '00000000-0000-4000-8000-000000000001',
          },
        },
      },
    } as unknown as Stripe.Event;
  }

  it('translates nothing for a payment_intent event carrying event.account', () => {
    expect(translateStripeEvent(succeeded('acct_member'))).toEqual([]);
  });

  it('identity and charge events from a connected account are dropped too', () => {
    for (const type of ['charge.failed', 'identity.verification_session.verified']) {
      const event = { ...succeeded('acct_member'), type } as unknown as Stripe.Event;
      expect(translateStripeEvent(event)).toEqual([]);
    }
  });
});
