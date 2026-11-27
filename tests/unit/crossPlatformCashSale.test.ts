// tests/unit/crossPlatformCashSale.test.ts
//
// Cross-platform cash sales (0179): an Australian may buy a US listing, charged in USD
// on the US platform, and a US member an Australian one, in AUD on the AU platform.
//
// WHAT THIS PINS.
//   1. The rule. A cash sale may cross Stripe platforms only with the switch on; a
//      trade never may; an unknown or closed region is refused either way.
//   2. The card. The buyer pays with the card saved on the SELLER's platform, never
//      their home card: a Stripe Customer belongs to one platform account, so the home
//      card would be "No such customer" on the other one, with the item reserved.
//   3. The price shown while browsing. It is approximate and display-only.

import { describe, expect, it } from 'vitest';

import {
  checkCashSaleRegionCompatibility,
  checkRegionCompatibility,
  platformForCurrency,
} from '@/domain/region';
import {
  acceptCashSaleTerms,
  initiateCashSale,
  updateCashSaleTerms,
  type BuyerRecord,
  type CashSaleOrchestratorDeps,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { cardMethodFor } from '@/domain/payments/paymentMethods';
import { crossPlatformCashSalesEnabled } from '@/domain/services';
import type { PaymentService } from '@/domain/services/types';
import {
  approximateMinor,
  parseEuroRates,
  pickRates,
} from '@/domain/fx/displayConversion';
import {
  BUYER,
  fakeTracking,
  ITEM,
  makeCashSaleRepository,
  makePayments,
} from './fakes/cashSaleRepository';

const AU_BUYER: BuyerRecord = { ...BUYER, regionCode: 'AU', payerId: 'cus_au', paymentSourceId: 'pm_au' };
const US_ITEM = { ...ITEM, ownerRegionCode: 'US' };
const PURCHASE = {
  buyerId: AU_BUYER.profileId,
  itemId: US_ITEM.id,
  sellerIdentityVersion: 'seller-v1',
  buyerConfirmedSellerIdentity: true,
};

function crossPlatformDeps(options: {
  crossPlatform: boolean;
  usCard: { payerId: string | null; paymentSourceId: string | null } | null;
}) {
  const { repository, state } = makeCashSaleRepository({
    buyer: AU_BUYER,
    item: US_ITEM,
    currency: 'usd',
  });
  const lookups: { profileId: string; platform: string }[] = [];
  repository.loadPlatformPayer = async (profileId, platform) => {
    lookups.push({ profileId, platform });
    return platform === 'US' ? options.usCard : null;
  };
  const { payments, calls } = makePayments();
  const deps: CashSaleOrchestratorDeps = {
    repository,
    payments: payments as unknown as PaymentService,
    tracking: fakeTracking,
    crossPlatformCashSales: options.crossPlatform,
  };
  return { deps, state, calls, lookups };
}

describe('the cross-platform region rule', () => {
  it('maps every currency to the one platform that holds it', () => {
    expect(platformForCurrency('aud')).toBe('AU');
    expect(platformForCurrency('USD')).toBe('US');
    expect(platformForCurrency('eur')).toBe('US');
    expect(platformForCurrency('gbp')).toBe('US');
    expect(platformForCurrency('xyz')).toBeNull();
    expect(platformForCurrency('')).toBeNull();
  });

  it('refuses an AU buyer and a US seller unless cross-platform sales are on', () => {
    expect(checkCashSaleRegionCompatibility('AU', 'US')?.reason).toBe('CROSS_REGION');
    expect(checkCashSaleRegionCompatibility('AU', 'US', undefined, { crossPlatform: false })?.reason).toBe(
      'CROSS_REGION',
    );
    expect(checkCashSaleRegionCompatibility('AU', 'US', undefined, { crossPlatform: true })).toBeNull();
    expect(checkCashSaleRegionCompatibility('DE', 'AU', undefined, { crossPlatform: true })).toBeNull();
  });

  it('still refuses an unknown or closed region with the switch on', () => {
    const on = { crossPlatform: true };
    expect(checkCashSaleRegionCompatibility(null, 'US', undefined, on)?.reason).toBe('UNKNOWN_REGION');
    expect(checkCashSaleRegionCompatibility('AU', 'NZ', undefined, on)?.reason).toBe('REGION_NOT_ENABLED');
    expect(checkCashSaleRegionCompatibility('AU', 'US', new Set(['AU']), on)?.reason).toBe(
      'REGION_NOT_ENABLED',
    );
  });

  it('never lets a trade cross platforms', () => {
    expect(checkRegionCompatibility('AU', 'US')?.reason).toBe('CROSS_REGION');
  });

  it('is off unless the environment turns it on', () => {
    expect(crossPlatformCashSalesEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(crossPlatformCashSalesEnabled({ CROSS_PLATFORM_CASH_SALES: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    expect(crossPlatformCashSalesEnabled({ CROSS_PLATFORM_CASH_SALES: 'on' } as NodeJS.ProcessEnv)).toBe(true);
    expect(crossPlatformCashSalesEnabled({ CROSS_PLATFORM_CASH_SALES: 'TRUE' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('Buy Now across platforms', () => {
  it('refuses with REGION_MISMATCH while the switch is off, before asking for a card', async () => {
    const { deps, lookups } = crossPlatformDeps({ crossPlatform: false, usCard: null });
    const result = await initiateCashSale(deps, PURCHASE);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBe('REGION_MISMATCH');
    expect(lookups).toEqual([]);
  });

  it('does not accept the home-platform card for a sale on another platform', async () => {
    const { deps, lookups } = crossPlatformDeps({ crossPlatform: true, usCard: null });
    const result = await initiateCashSale(deps, PURCHASE);
    expect(!result.ok && result.error).toBe('BUYER_NO_PAYMENT_METHOD');
    expect(lookups).toEqual([{ profileId: AU_BUYER.profileId, platform: 'US' }]);
  });

  it('opens the sale once the buyer has a card on the seller platform', async () => {
    const { deps } = crossPlatformDeps({
      crossPlatform: true,
      usCard: { payerId: 'cus_us', paymentSourceId: 'pm_us' },
    });
    const result = await initiateCashSale(deps, PURCHASE);
    expect(result.ok).toBe(true);
  });

  it('a same-platform sale reads the home card and never the platform table', async () => {
    const { repository } = makeCashSaleRepository({ buyer: AU_BUYER });
    let lookedUp = false;
    repository.loadPlatformPayer = async () => {
      lookedUp = true;
      return null;
    };
    const { payments } = makePayments();
    const result = await initiateCashSale(
      {
        repository,
        payments: payments as unknown as PaymentService,
        tracking: fakeTracking,
        crossPlatformCashSales: true,
      },
      PURCHASE,
    );
    expect(result.ok).toBe(true);
    expect(lookedUp).toBe(false);
  });
});

describe('paying across platforms', () => {
  it('charges the Customer saved on the seller platform, in the seller currency', async () => {
    const { deps, calls } = crossPlatformDeps({
      crossPlatform: true,
      usCard: { payerId: 'cus_us', paymentSourceId: 'pm_us' },
    });
    const opened = await initiateCashSale(deps, PURCHASE);
    if (!opened.ok) throw new Error(`open failed: ${opened.error}`);
    // Seller prices postage, buyer gives the address: two saves, as in regionParity.
    const delivery = {
      fulfillmentMethod: 'DELIVERY' as const,
      shippingCostCents: 2_500,
      deliveryAddress: {
        label: '1 Example St, Sydney',
        placeId: 'geo:delivery-cross-platform',
        countryCode: 'AU',
        lat: -33.8688,
        lng: 151.2093,
      },
    };
    const priced = await updateCashSaleTerms(deps, {
      actorId: US_ITEM.ownerId,
      cashSaleId: opened.sale.id,
      expectedTermsVersion: opened.sale.termsVersion,
      terms: { ...delivery, deliveryAddress: undefined },
    });
    if (!priced.ok) throw new Error(`postage failed: ${priced.error}`);
    const termed = await updateCashSaleTerms(deps, {
      actorId: AU_BUYER.profileId,
      cashSaleId: opened.sale.id,
      expectedTermsVersion: priced.sale.termsVersion,
      terms: delivery,
    });
    if (!termed.ok) throw new Error(`terms failed: ${termed.error}`);

    const paid = await acceptCashSaleTerms(deps, {
      actorId: AU_BUYER.profileId,
      cashSaleId: opened.sale.id,
      termsVersion: termed.sale.termsVersion,
    });
    if (!paid.ok) throw new Error(`pay failed: ${paid.error}`);

    expect(calls.transfers).toHaveLength(1);
    expect(calls.transfers[0].payerId).toBe('cus_us');
    expect(calls.transfers[0].currency).toBe('usd');
  });

  it('prices an Australian card on the US platform at the international card rate', () => {
    expect(cardMethodFor('usd', 'AU')).toBe('CARD_INTERNATIONAL');
    expect(cardMethodFor('aud', 'US')).toBe('CARD_INTERNATIONAL');
    expect(cardMethodFor('usd', 'US')).toBe('CARD');
  });
});

describe('approximate browse prices', () => {
  const rates = parseEuroRates({ base: 'EUR', rates: { AUD: 1.65, USD: 1.1, JPY: 160 } });

  it('converts through the euro and rounds to the minor unit', () => {
    // US$100.00 -> EUR 90.909... -> A$150.00
    expect(approximateMinor(10_000, 'usd', 'aud', rates)).toBe(15_000);
    // A$150.00 -> ¥14,545 (JPY has no minor unit)
    expect(approximateMinor(15_000, 'aud', 'jpy', rates)).toBe(14_545);
  });

  it('returns null when there is nothing to convert', () => {
    expect(approximateMinor(10_000, 'aud', 'aud', rates)).toBeNull();
    expect(approximateMinor(10_000, 'usd', 'gbp', rates)).toBeNull();
    expect(approximateMinor(10_000, 'usd', 'aud', null)).toBeNull();
    expect(approximateMinor(Number.NaN, 'usd', 'aud', rates)).toBeNull();
  });

  it('refuses a rate table it cannot read rather than caching an empty one', () => {
    expect(() => parseEuroRates({ base: 'USD', rates: { AUD: 1.5 } })).toThrow();
    expect(() => parseEuroRates({ base: 'EUR', rates: {} })).toThrow();
    expect(() => parseEuroRates(null)).toThrow();
  });

  it('keeps only the currencies asked for', () => {
    expect(pickRates(rates, ['aud', 'USD', 'nzd'])).toEqual({ aud: 1.65, usd: 1.1 });
  });
});
