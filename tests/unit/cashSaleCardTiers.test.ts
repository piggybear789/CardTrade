// tests/unit/cashSaleCardTiers.test.ts
//
// A cash-sale card payment is priced by where the card was issued (0159): Stripe charges
// the settlement merchant more for a card from outside its card zone, so the service fee
// has a domestic, a UK–EEA and an international card rate (domain/fees/processingFee.ts).
// These pin which cards land in which tier, that Pay prices and charges the buyer's own
// saved card at its tier, and that a total shown for another tier is refused untouched.

import { describe, expect, it } from 'vitest';

import {
  acceptCashSaleTerms,
  initiateCashSale,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { cardTierFor, cashSaleFeeMinor } from '@/domain/fees/processingFee';
import {
  cardMethodFor,
  cardTierPhrase,
  isBankMethod,
  isCardMethod,
  paymentMethodsFor,
  paymentRailOf,
  totalForMethod,
} from '@/domain/payments/paymentMethods';
import { InMemoryService } from '@/domain/services/testing/InMemoryService';
import { otherCardRatesNote, processingFeeExplanation } from '@/lib/fees/feeLabels';
import { BUYER, ITEM, fakeTracking, makeCashSaleRepository } from './fakes/cashSaleRepository';
import { DELIVERY_TERMS, PURCHASE } from './helpers/disputedCashSale';

async function payableSale(cardCountry?: string) {
  const payments = new InMemoryService();
  payments.cardCountry = cardCountry;
  const { repository } = makeCashSaleRepository();
  const deps: CashSaleOrchestratorDeps = { repository, payments, tracking: fakeTracking };
  const created = await initiateCashSale(deps, PURCHASE);
  if (!created.ok) throw new Error(`setup: ${created.error}`);
  const priced = await updateCashSaleTerms(deps, {
    cashSaleId: created.sale.id,
    actorId: ITEM.ownerId,
    expectedTermsVersion: created.sale.termsVersion,
    terms: { ...DELIVERY_TERMS, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error('setup: postage');
  const addressed = await updateCashSaleTerms(deps, {
    cashSaleId: created.sale.id,
    actorId: BUYER.profileId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms: DELIVERY_TERMS,
  });
  if (!addressed.ok) throw new Error('setup: address');
  return { deps, payments, sale: addressed.sale };
}

describe('which card tier a card is priced at', () => {
  it('reads the issuing country against the seller currency', () => {
    expect(cardTierFor('aud', 'AU')).toBe('DOMESTIC');
    expect(cardTierFor('aud', 'US')).toBe('INTERNATIONAL');
    expect(cardTierFor('usd', 'US')).toBe('DOMESTIC');
    expect(cardTierFor('usd', 'GB')).toBe('INTERNATIONAL');
    // An EEA seller: any EEA card is domestic, a UK card the middle tier.
    expect(cardTierFor('eur', 'DE')).toBe('DOMESTIC');
    expect(cardTierFor('eur', 'NO')).toBe('DOMESTIC');
    expect(cardTierFor('eur', 'GB')).toBe('UK_EEA');
    expect(cardTierFor('eur', 'US')).toBe('INTERNATIONAL');
    expect(cardTierFor('pln', 'FR')).toBe('DOMESTIC');
    // A UK seller: an EEA card is the middle tier.
    expect(cardTierFor('gbp', 'GB')).toBe('DOMESTIC');
    expect(cardTierFor('gbp', 'IE')).toBe('UK_EEA');
    expect(cardTierFor('gbp', 'AU')).toBe('INTERNATIONAL');
    // Norway prices a UK card as international.
    expect(cardTierFor('nok', 'GB')).toBe('INTERNATIONAL');
    expect(cardTierFor('chf', 'DE')).toBe('INTERNATIONAL');
  });

  it('never prices a buyer up on a guess', () => {
    expect(cardTierFor('aud', null)).toBe('DOMESTIC');
    expect(cardTierFor('aud', '')).toBe('DOMESTIC');
    expect(cardTierFor('xyz', 'US')).toBe('DOMESTIC');
    expect(cardTierFor('eur', 'gb')).toBe('UK_EEA');
  });

  it('maps tiers to card kinds that are prices, not choices', () => {
    expect(cardMethodFor('aud', 'US')).toBe('CARD_INTERNATIONAL');
    expect(cardMethodFor('eur', 'GB')).toBe('CARD_UK_EEA');
    expect(cardMethodFor('aud', 'AU')).toBe('CARD');
    for (const kind of ['CARD', 'CARD_UK_EEA', 'CARD_INTERNATIONAL'] as const) {
      expect(isCardMethod(kind)).toBe(true);
      expect(isBankMethod(kind)).toBe(false);
      expect(paymentRailOf(kind)).toBe('CARD');
    }
    // The Pay step lists card once.
    for (const region of ['AU', 'NL', 'GB', 'US']) {
      const listed = paymentMethodsFor({ currency: 'eur', buyerRegion: region });
      expect(listed.filter(isCardMethod)).toEqual(['CARD']);
    }
  });

  it('names the cards each tier covers, and the listing note states the dearer rates', () => {
    expect(cardTierPhrase('aud', 'CARD')).toBe('issued in Australia');
    expect(cardTierPhrase('aud', 'CARD_INTERNATIONAL')).toBe('issued outside Australia');
    expect(cardTierPhrase('aud', 'CARD_UK_EEA')).toBeNull();
    expect(cardTierPhrase('eur', 'CARD_UK_EEA')).toBe('issued in the UK');
    expect(cardTierPhrase('eur', 'CARD_INTERNATIONAL')).toBe('issued outside the EEA and the UK');
    expect(otherCardRatesNote('aud')).toBe('Cards issued outside Australia: 5% + $0.60 AUD.');
    expect(otherCardRatesNote('eur')).toContain('Cards issued in the UK: 4% + ');
    expect(processingFeeExplanation('aud')).toContain('by a card issued in Australia');
    expect(processingFeeExplanation('aud')).toContain('Cards issued outside Australia');
  });
});

describe('paying a cash sale by card at the card’s own tier', () => {
  it('prices and charges a domestic card exactly as before', async () => {
    const s = await payableSale('AU');
    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      expectedAmountCents: s.sale.amountCents,
    });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.sale.amountCents).toBe(s.sale.amountCents);
    expect(s.payments.transfers.at(-1)?.amount).toBe(s.sale.amountCents);
  });

  it('charges an overseas card its international total, on that exact card', async () => {
    const s = await payableSale('US');
    const expected = totalForMethod(s.sale, 'CARD_INTERNATIONAL');
    expect(expected).toBeGreaterThan(s.sale.amountCents);

    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      expectedAmountCents: expected,
    });
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.sale.paymentMethod).toBe('CARD_INTERNATIONAL');
    expect(paid.sale.platformFeeCents).toBe(
      cashSaleFeeMinor(ITEM.fmvCents, DELIVERY_TERMS.shippingCostCents, 'aud', 'CARD_INTERNATIONAL'),
    );
    expect(paid.sale.amountCents).toBe(expected);
    // The seller's net is untouched: the buyer pays the dearer card's cost.
    expect(paid.sale.amountCents - paid.sale.platformFeeCents).toBe(s.sale.amountCents - s.sale.platformFeeCents);
    const charge = s.payments.transfers.at(-1);
    expect(charge?.amount).toBe(expected);
    expect(charge?.sourceId).toBe(BUYER.paymentSourceId);
  });

  it('refuses the domestic total for an overseas card, with the sale untouched', async () => {
    const s = await payableSale('US');
    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      expectedAmountCents: s.sale.amountCents,
    });
    expect(paid).toMatchObject({ ok: false, error: 'CARD_REPRICED' });
    if (!paid.ok) expect(paid.detail).toContain('issued outside Australia');
    const sale = await s.deps.repository.loadCashSale(s.sale.id);
    expect(sale?.status).toBe('AGREEMENT');
    expect(sale?.paymentNonce).toBeNull();
    expect(s.payments.transfers).toHaveLength(0);
  });

  it('holds a caller that sends no total (the app) to the stored total', async () => {
    const overseas = await payableSale('US');
    expect(
      await acceptCashSaleTerms(overseas.deps, {
        actorId: BUYER.profileId,
        cashSaleId: overseas.sale.id,
        termsVersion: overseas.sale.termsVersion,
      }),
    ).toMatchObject({ ok: false, error: 'CARD_REPRICED' });

    const domestic = await payableSale('AU');
    const paid = await acceptCashSaleTerms(domestic.deps, {
      actorId: BUYER.profileId,
      cashSaleId: domestic.sale.id,
      termsVersion: domestic.sale.termsVersion,
    });
    expect(paid.ok).toBe(true);
  });

  it('ignores a card tier the caller names: the card decides', async () => {
    const s = await payableSale('AU');
    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      expectedAmountCents: s.sale.amountCents,
      paymentMethod: 'CARD_INTERNATIONAL',
    });
    expect(paid.ok).toBe(true);
    if (paid.ok) expect(paid.sale.amountCents).toBe(s.sale.amountCents);
  });

  it('refuses a card it cannot read, and changes nothing', async () => {
    const s = await payableSale('AU');
    s.payments.failDescribeInstrument = true;
    const paid = await acceptCashSaleTerms(s.deps, {
      actorId: BUYER.profileId,
      cashSaleId: s.sale.id,
      termsVersion: s.sale.termsVersion,
      expectedAmountCents: s.sale.amountCents,
    });
    expect(paid).toMatchObject({ ok: false, error: 'BUYER_NO_PAYMENT_METHOD' });
    expect((await s.deps.repository.loadCashSale(s.sale.id))?.status).toBe('AGREEMENT');
    expect(s.payments.transfers).toHaveLength(0);
  });
});
