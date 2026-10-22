// tests/unit/cashSaleOnBehalfOf.test.ts
//
// A cash sale in a currency its platform does not settle in (a EUR sale on the US
// platform) is charged ON BEHALF OF the seller's connected account
// (`domain/payments/onBehalfOf.ts`): priced and settled in the seller's country and
// currency, with no Currency_Conversion fee. Its seller must therefore be payable
// before the buyer can pay. AUD and USD sales stay plain platform charges.

import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleTerms,
  initiateCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { chargesOnBehalfOfSeller } from '@/domain/payments/onBehalfOf';
import type { PaymentService } from '@/domain/services/types';
import {
  APPROVED_SELLER,
  BUYER,
  fakeTracking,
  ITEM,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';

const IN_PERSON = {
  fulfillmentMethod: 'IN_PERSON' as const,
  shippingCostCents: 0,
  meetingLocation: 'Alexanderplatz, Berlin',
  meetingLat: 52.5219,
  meetingLng: 13.4132,
  meetingPlaceId: 'geo:meeting-1',
  meetingAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
};

function harness(currency: string, region: string) {
  const { repository, state, setPayee } = makeCashSaleRepository({
    currency,
    buyer: { ...BUYER, regionCode: region },
    item: { ...ITEM, ownerRegionCode: region },
  });
  const { payments, calls } = makePayments();
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
  };
  return { deps, state, calls, setPayee };
}

async function openWithTerms(deps: CashSaleOrchestratorDeps) {
  const created = await initiateCashSale(deps, {
    buyerId: BUYER.profileId,
    itemId: ITEM.id,
    sellerIdentityVersion: 'seller-v1',
    buyerConfirmedSellerIdentity: true,
  });
  if (!created.ok) throw new Error(`agreement failed: ${created.error}`);
  const updated = await updateCashSaleTerms(deps, {
    actorId: ITEM.ownerId,
    cashSaleId: created.sale.id,
    expectedTermsVersion: created.sale.termsVersion,
    terms: IN_PERSON,
  });
  if (!updated.ok) throw new Error(`terms failed: ${updated.error}`);
  return updated.sale;
}

describe('which sales are charged on behalf of the seller', () => {
  it('is every currency its platform converts, and never AUD or USD', () => {
    expect(chargesOnBehalfOfSeller('aud')).toBe(false);
    expect(chargesOnBehalfOfSeller('usd')).toBe(false);
    for (const currency of ['eur', 'gbp', 'cad', 'chf', 'sek', 'pln']) {
      expect(chargesOnBehalfOfSeller(currency), currency).toBe(true);
    }
  });
});

describe('paying a cross-border seller', () => {
  it("charges on behalf of the seller's account, for the contract total and no conversion fee", async () => {
    const h = harness('eur', 'DE');
    const sale = await openWithTerms(h.deps);

    const paid = await acceptCashSaleTerms(h.deps, {
      actorId: BUYER.profileId,
      cashSaleId: sale.id,
      termsVersion: sale.termsVersion,
    });

    expect(paid.ok).toBe(true);
    expect(h.calls.transfers).toHaveLength(1);
    expect(h.calls.transfers[0]).toMatchObject({
      onBehalfOf: APPROVED_SELLER.merchantRef,
      currency: 'eur',
      amount: sale.amountCents,
    });
    // Collect-only: nothing is forwarded to the seller at Pay.
    expect(h.calls.transfers[0].merchantRef).toBeUndefined();
  });

  it('refuses to take payment until the seller can be paid, and leaves the sale untouched', async () => {
    const h = harness('eur', 'DE');
    const sale = await openWithTerms(h.deps);
    h.setPayee({ ...APPROVED_SELLER, merchantRef: null, merchantStatus: 'PENDING', settlementsEnabled: false });

    const refused = await acceptCashSaleTerms(h.deps, {
      actorId: BUYER.profileId,
      cashSaleId: sale.id,
      termsVersion: sale.termsVersion,
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toBe('SELLER_NOT_PAYABLE');
    expect(h.calls.transfers).toHaveLength(0);
    expect(h.state.sale?.status).toBe('AGREEMENT');
    expect(h.state.item.status).toBe('RESERVED');
  });
});

describe('paying a domestic seller', () => {
  it('stays a plain platform charge, and a seller without payouts can still be paid later', async () => {
    const h = harness('aud', 'AU');
    const sale = await openWithTerms(h.deps);
    h.setPayee({ ...APPROVED_SELLER, merchantRef: null, merchantStatus: 'PENDING', settlementsEnabled: false });

    const paid = await acceptCashSaleTerms(h.deps, {
      actorId: BUYER.profileId,
      cashSaleId: sale.id,
      termsVersion: sale.termsVersion,
    });

    expect(paid.ok).toBe(true);
    expect(h.calls.transfers).toHaveLength(1);
    expect(h.calls.transfers[0].onBehalfOf).toBeUndefined();
  });
});
