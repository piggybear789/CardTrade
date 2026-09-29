// tests/unit/privateDealCashSale.test.ts
//
// A private-deal sale opens its room before the seller has verified and before the
// buyer has a card. Both are required at Pay instead, and nothing may be collected,
// reserved-then-released, or failed on the way there.

import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleTerms,
  initiateCashSale,
  openPrivateDealCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import type { PaymentService } from '@/domain/services/types';
import {
  APPROVED_SELLER,
  BUYER,
  fakeTracking,
  ITEM,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';

const NO_CARD = { ...BUYER, payerId: null, paymentSourceId: null };
const UNVERIFIED_SELLER = { ...APPROVED_SELLER, identityCheckStatus: 'NONE' as const };

const MEETUP = {
  fulfillmentMethod: 'IN_PERSON' as const,
  meetingLocation: 'Melbourne Central, main concourse',
  meetingPlaceId: 'geo:meeting-1',
  meetingLat: -37.8183,
  meetingLng: 144.9671,
  meetingAt: '2099-01-15T03:00:00.000Z',
};

function makeWorld(options: { buyerHasCard?: boolean; sellerVerified?: boolean } = {}) {
  const fake = makeCashSaleRepository({
    buyer: options.buyerHasCard === false ? NO_CARD : BUYER,
    payee: options.sellerVerified === false ? UNVERIFIED_SELLER : APPROVED_SELLER,
  });
  const { payments, calls } = makePayments({ transferStatus: 'SETTLED' });
  const deps: CashSaleOrchestratorDeps = {
    repository: fake.repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
  };
  return { ...fake, deps, calls };
}

/** Open the room and agree a meetup, the way the two of them would. */
async function openAndAgree(deps: CashSaleOrchestratorDeps) {
  const opened = await openPrivateDealCashSale(deps, {
    buyerId: BUYER.profileId,
    itemId: ITEM.id,
    agreedPriceCents: 40_000,
  });
  if (!opened.ok) throw new Error(`open failed: ${opened.error}`);
  const agreed = await updateCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: opened.sale.id,
    expectedTermsVersion: opened.sale.termsVersion,
    terms: MEETUP,
  });
  if (!agreed.ok) throw new Error(`terms failed: ${agreed.error}`);
  return agreed.sale;
}

describe('private-deal cash sale — opening the room', () => {
  it('opens without a card or a verified seller, and collects nothing', async () => {
    const { deps, state, calls } = makeWorld({ buyerHasCard: false, sellerVerified: false });

    const opened = await openPrivateDealCashSale(deps, {
      buyerId: BUYER.profileId,
      itemId: ITEM.id,
      agreedPriceCents: 40_000,
    });

    expect(opened.ok).toBe(true);
    expect(state.sale?.status).toBe('AGREEMENT');
    expect(state.sale?.agreedPriceCents).toBe(40_000);
    expect(state.sale?.sellerIdentity).toBeNull();
    expect(state.sale?.buyerSellerIdentityConfirmedAt).toBeNull();
    expect(state.item.status).toBe('RESERVED');
    expect(calls.transfers).toHaveLength(0);
  });

  it('still refuses a buyer from another region', async () => {
    const { deps } = makeWorld();
    const fake = makeCashSaleRepository({ buyer: { ...BUYER, regionCode: 'US' } });

    const opened = await openPrivateDealCashSale(
      { ...deps, repository: fake.repository },
      { buyerId: BUYER.profileId, itemId: ITEM.id, agreedPriceCents: 40_000 },
    );

    expect(opened).toMatchObject({ ok: false, error: 'REGION_MISMATCH' });
    expect(fake.state.sale).toBeNull();
  });

  it('leaves Buy Now asking for a card up front', async () => {
    const { deps } = makeWorld({ buyerHasCard: false });

    const bought = await initiateCashSale(deps, {
      buyerId: BUYER.profileId,
      itemId: ITEM.id,
      sellerIdentityVersion: 'seller-v1',
      buyerConfirmedSellerIdentity: true,
    });

    expect(bought).toMatchObject({ ok: false, error: 'BUYER_NO_PAYMENT_METHOD' });
  });
});

describe('private-deal cash sale — the Pay step', () => {
  it('refuses to collect while the seller is unverified, and changes nothing', async () => {
    const { deps, state, calls } = makeWorld({ sellerVerified: false });
    const sale = await openAndAgree(deps);

    const paid = await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: sale.id,
      termsVersion: sale.termsVersion,
      sellerIdentityVersion: 'seller-v1',
      buyerConfirmedSellerIdentity: true,
    });

    expect(paid).toMatchObject({ ok: false, error: 'SELLER_IDENTITY_UNVERIFIED' });
    expect(state.sale?.status).toBe('AGREEMENT');
    expect(state.sale?.sellerIdentity).toBeNull();
    expect(calls.transfers).toHaveLength(0);
  });

  it('needs the buyer to confirm the seller they were shown', async () => {
    const { deps, state } = makeWorld();
    const sale = await openAndAgree(deps);

    const unconfirmed = await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: sale.id,
      termsVersion: sale.termsVersion,
    });
    const stale = await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: sale.id,
      termsVersion: sale.termsVersion,
      sellerIdentityVersion: 'seller-v0',
      buyerConfirmedSellerIdentity: true,
    });

    expect(unconfirmed).toMatchObject({ ok: false, error: 'BUYER_CONFIRMATION_REQUIRED' });
    expect(stale).toMatchObject({ ok: false, error: 'SELLER_IDENTITY_CHANGED' });
    expect(state.sale?.sellerIdentity).toBeNull();
  });

  it('asks for a card without failing the sale or releasing the item', async () => {
    const { deps, state, calls } = makeWorld({ buyerHasCard: false });
    const sale = await openAndAgree(deps);

    const paid = await acceptCashSaleTerms(deps, {
      actorId: BUYER.profileId,
      cashSaleId: sale.id,
      termsVersion: sale.termsVersion,
      sellerIdentityVersion: 'seller-v1',
      buyerConfirmedSellerIdentity: true,
    });

    expect(paid).toMatchObject({ ok: false, error: 'BUYER_NO_PAYMENT_METHOD' });
    expect(state.sale?.status).toBe('AGREEMENT');
    expect(state.sale?.sellerIdentity).toBeNull();
    expect(state.item.status).toBe('RESERVED');
    expect(calls.transfers).toHaveLength(0);
  });

  it('records the confirmed seller and collects once, after the seller verifies and a card is added', async () => {
    const world = makeWorld({ buyerHasCard: false, sellerVerified: false });
    const sale = await openAndAgree(world.deps);

    world.setPayee(APPROVED_SELLER);
    world.setBuyer(BUYER);

    const paid = await acceptCashSaleTerms(world.deps, {
      actorId: BUYER.profileId,
      cashSaleId: sale.id,
      termsVersion: sale.termsVersion,
      sellerIdentityVersion: 'seller-v1',
      buyerConfirmedSellerIdentity: true,
    });

    expect(paid.ok).toBe(true);
    expect(world.state.sale?.sellerIdentity?.version).toBe('seller-v1');
    expect(world.state.sale?.buyerSellerIdentityConfirmedAt).not.toBeNull();
    expect(world.state.sale?.status).toBe('HANDOVER');
    expect(world.calls.transfers).toHaveLength(1);
    expect(world.calls.transfers[0].amount).toBe(world.state.sale?.amountCents);
  });
});
