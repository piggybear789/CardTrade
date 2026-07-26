// tests/unit/cashSaleDirectPayout.test.ts
//
// `direct` payout mode on a Cash_Sale contract (Req 4.8, 4.9): once both parties
// accept the terms, funds are collected into the Seller's sub-merchant with the
// flat Platform_Fee retained as the application fee, the Buyer's stored token
// materialises a payer on that sub-merchant, and an unpayable Seller never gets
// a payment submitted.

import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleTerms,
  initiateCashSale,
  PLATFORM_FEE_CENTS,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { MerchantRecord } from '@/domain/orchestrator/merchantOnboarding';
import type { PaymentService } from '@/domain/services/types';
import {
  APPROVED_SELLER,
  BUYER,
  fakeTracking,
  ITEM,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';

const CONFIRMED_PURCHASE = {
  buyerId: BUYER.profileId,
  itemId: ITEM.id,
  sellerIdentityVersion: 'seller-v1',
  buyerConfirmedSellerIdentity: true,
};

const IN_PERSON_TERMS = {
  fulfillmentMethod: 'IN_PERSON' as const,
  meetingLocation: 'Melbourne Central, main concourse',
};

/** Build a direct-payout orchestrator and drive it to both-accepted. */
async function runToPayment(options: {
  payee?: MerchantRecord | null;
  buyer?: typeof BUYER;
  existingPayerRef?: string | null;
}) {
  const { repository, state } = makeCashSaleRepository({
    payee: options.payee,
    buyer: options.buyer,
    existingPayerRef: options.existingPayerRef,
  });
  const { payments, calls } = makePayments();
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
    payoutMode: 'direct',
  };

  const created = await initiateCashSale(deps, CONFIRMED_PURCHASE);
  if (!created.ok) return { created, state, calls, result: created };

  const terms = await updateCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: created.sale.id,
    expectedTermsVersion: created.sale.termsVersion,
    terms: IN_PERSON_TERMS,
  });
  if (!terms.ok) throw new Error(`terms failed: ${terms.error}`);

  await acceptCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: created.sale.id,
    termsVersion: terms.sale.termsVersion,
  });
  const result = await acceptCashSaleTerms(deps, {
    actorId: ITEM.ownerId,
    cashSaleId: created.sale.id,
    termsVersion: terms.sale.termsVersion,
  });

  return { created, state, calls, result };
}

describe('cash sale — direct payout mode', () => {
  it('reuses the stored token to create a payer on the seller sub-merchant and passes the platform fee as the application fee', async () => {
    const { state, calls, result } = await runToPayment({});

    expect(result.ok).toBe(true);
    expect(calls.createPayer).toEqual([
      { merchantRef: 'mch_seller', token: 'tkn_reusable' },
    ]);
    expect(state.payerRefs).toEqual({ mch_seller: 'payer_on_mch_seller' });
    expect(calls.transfers).toEqual([
      {
        payerId: 'payer_on_mch_seller',
        nonce: expect.any(String),
        merchantRef: 'mch_seller',
        applicationFee: PLATFORM_FEE_CENTS,
        amount: ITEM.fmvCents + PLATFORM_FEE_CENTS,
      },
    ]);
  });

  it('reuses an existing payer reference instead of creating another', async () => {
    const { calls } = await runToPayment({ existingPayerRef: 'payer_known' });

    expect(calls.createPayer).toHaveLength(0);
    expect(calls.transfers[0].payerId).toBe('payer_known');
  });

  it('rejects an unpayable seller without reserving the item', async () => {
    const { result, state, calls } = await runToPayment({
      payee: {
        ...APPROVED_SELLER,
        merchantStatus: 'PENDING',
        settlementsEnabled: false,
      },
    });

    expect(result).toMatchObject({ ok: false, error: 'SELLER_IDENTITY_UNVERIFIED' });
    expect(state.item.status).toBe('AVAILABLE');
    expect(calls.transfers).toHaveLength(0);
  });
});
