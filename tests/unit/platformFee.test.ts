// tests/unit/platformFee.test.ts
//
// The cash-sale fee (Req 4.7) is the Service_Fee: a CLEAN rate of price plus postage per
// currency and way of paying, e.g. 3% + A$0.60 by card in Australia
// (`domain/fees/processingFee.ts`). These pin the figures, that every rate is a clean
// number, that every rate still covers what Stripe charges (so a Stripe price change
// that would quietly eat the margin fails here), the member-facing wording, and that the
// retired beta wording is gone for good.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import {
  NODITTO_FEE_BPS,
  cashSaleFeeMinor,
  serviceFeeRateFor,
  stripeCostMinor,
} from '@/domain/fees/processingFee';
import type { PaymentMethodKind } from '@/domain/payments/paymentMethods';
import { buyerPaysCents } from '@/lib/listings/buyerPrice';
import * as feeLabels from '@/lib/fees/feeLabels';

const CURRENCIES = ['aud', 'usd', 'eur', 'gbp', 'cad', 'chf', 'czk', 'dkk', 'nok', 'sek', 'pln', 'ron', 'bgn'] as const;

/** Every priced rail, card in every currency plus each bank rail in its own. */
const RAILS: ReadonlyArray<readonly [string, PaymentMethodKind]> = [
  ...CURRENCIES.map((currency) => [currency, 'CARD'] as const),
  // 0159: a card from abroad, in every currency, and across the UK–EEA line where the
  // currency has that tier (it falls back to international where it does not).
  ...CURRENCIES.map((currency) => [currency, 'CARD_INTERNATIONAL'] as const),
  ...CURRENCIES.map((currency) => [currency, 'CARD_UK_EEA'] as const),
  ['usd', 'US_BANK'],
  ['aud', 'PAYTO'],
  ['eur', 'IDEAL'],
  ['eur', 'BANCONTACT'],
  ['eur', 'EPS'],
  ['eur', 'P24'],
  ['pln', 'P24'],
];

describe('platformFeeCentsFor (the Service_Fee)', () => {
  it('pins known figures', () => {
    expect(platformFeeCentsFor(1000, 'aud')).toBe(90);
    expect(platformFeeCentsFor(5000, 'aud')).toBe(210);
    expect(platformFeeCentsFor(10_000, 'aud')).toBe(360);
    expect(platformFeeCentsFor(100_000, 'aud')).toBe(3060);
    expect(platformFeeCentsFor(10_000, 'usd')).toBe(510);
    expect(platformFeeCentsFor(10_000, 'eur')).toBe(360);
    expect(platformFeeCentsFor(10_000, 'gbp')).toBe(350);
    expect(platformFeeCentsFor(100_000, 'czk')).toBe(4320);
  });

  it('is the rate of price plus postage, plus the fixed part, exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        fc.constantFrom(...RAILS),
        (price, shipping, [currency, method]) => {
          const rate = serviceFeeRateFor(currency, method);
          expect(cashSaleFeeMinor(price, shipping, currency, method)).toBe(
            Math.round(((price + shipping) * rate.bps) / 10_000) + rate.fixedMinor,
          );
        },
      ),
    );
  });

  it('is zero for a zero price', () => {
    expect(platformFeeCentsFor(0, 'aud')).toBe(0);
  });

  it('charges the same rate on postage as on the price', () => {
    expect(platformFeeCentsFor(9000, 'aud', 1000)).toBe(platformFeeCentsFor(10_000, 'aud'));
    expect(platformFeeCentsFor(9000, 'aud', 1000)).toBeGreaterThan(platformFeeCentsFor(9000, 'aud'));
  });

  it('targets about 1% for NoDitto', () => {
    expect(NODITTO_FEE_BPS).toBe(100);
  });

  it('treats no currency as AUD', () => {
    expect(platformFeeCentsFor(10_000, null)).toBe(platformFeeCentsFor(10_000, 'aud'));
  });

  it('uses clean rates: a half-percent step and a fixed part in tens of minor units', () => {
    for (const [currency, method] of RAILS) {
      const rate = serviceFeeRateFor(currency, method);
      expect(rate.bps % 50, `${method}:${currency}`).toBe(0);
      expect(rate.fixedMinor % 10, `${method}:${currency}`).toBe(0);
    }
    // An unknown currency stays the most expensive case.
    expect(serviceFeeRateFor('xyz').bps).toBeGreaterThanOrEqual(
      Math.max(...CURRENCIES.map((currency) => serviceFeeRateFor(currency).bps)),
    );
  });

  it("always covers Stripe's cost on every rail from 1.00 up, and leaves NoDitto close to its 1%", () => {
    // From one whole unit of the currency. Below that (a sale of a few cents) the
    // rounded fixed parts can fall a cent short, which no real sale reaches.
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5_000_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        fc.constantFrom(...RAILS),
        (price, shipping, [currency, method]) => {
          const base = price + shipping;
          const fee = cashSaleFeeMinor(price, shipping, currency, method);
          const kept = fee - stripeCostMinor(base, fee, currency, method);
          expect(kept).toBeGreaterThanOrEqual(0);
          // Above 20.00 the rounding moves NoDitto's share by well under a point.
          if (base >= 2000) {
            expect(kept / base).toBeGreaterThan(0.008);
            expect(kept / base).toBeLessThan(0.017);
          }
        },
      ),
    );
  });

  it('makes the bank rails that cost Stripe less cheaper than card', () => {
    expect(cashSaleFeeMinor(10_000, 0, 'usd', 'US_BANK')).toBeLessThan(cashSaleFeeMinor(10_000, 0, 'usd'));
    expect(cashSaleFeeMinor(10_000, 0, 'aud', 'PAYTO')).toBeLessThan(cashSaleFeeMinor(10_000, 0, 'aud'));
    expect(cashSaleFeeMinor(10_000, 0, 'eur', 'IDEAL')).toBeLessThan(cashSaleFeeMinor(10_000, 0, 'eur'));
  });

  it('prices a card from abroad above a domestic one, and the UK–EEA tier between them', () => {
    for (const currency of CURRENCIES) {
      const domestic = cashSaleFeeMinor(10_000, 0, currency);
      const middle = cashSaleFeeMinor(10_000, 0, currency, 'CARD_UK_EEA');
      const abroad = cashSaleFeeMinor(10_000, 0, currency, 'CARD_INTERNATIONAL');
      expect(abroad, currency).toBeGreaterThan(domestic);
      expect(middle, currency).toBeGreaterThanOrEqual(domestic);
      expect(middle, currency).toBeLessThanOrEqual(abroad);
    }
    expect(platformFeeCentsFor(10_000, 'aud')).toBe(360);
    expect(cashSaleFeeMinor(10_000, 0, 'aud', 'CARD_INTERNATIONAL')).toBe(560);
    expect(cashSaleFeeMinor(10_000, 0, 'eur', 'CARD_UK_EEA')).toBe(460);
    // A currency with no neighbour zone prices that tier as international.
    expect(serviceFeeRateFor('aud', 'CARD_UK_EEA')).toEqual(serviceFeeRateFor('aud', 'CARD_INTERNATIONAL'));
  });

  it('falls back to the card rate for a rail with no row in that currency', () => {
    expect(serviceFeeRateFor('gbp', 'IDEAL')).toEqual(serviceFeeRateFor('gbp'));
  });

  it('never falls as the price rises', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5_000_000 }), fc.constantFrom(...RAILS), (price, [currency, method]) => {
        expect(cashSaleFeeMinor(price + 1, 0, currency, method)).toBeGreaterThanOrEqual(
          cashSaleFeeMinor(price, 0, currency, method),
        );
      }),
    );
  });
});

describe('buyerPaysCents', () => {
  it('is the price plus the fee, with no conversion fee in any currency', () => {
    expect(buyerPaysCents(10_000, 'aud')).toBe(10_000 + platformFeeCentsFor(10_000, 'aud'));
    expect(buyerPaysCents(10_000, 'eur')).toBe(10_000 + platformFeeCentsFor(10_000, 'eur'));
  });
});

describe('fee labels', () => {
  it('state the exact clean rate from the same table the charge uses', () => {
    expect(feeLabels.PROCESSING_FEE_NAME).toBe('Service fee');
    expect(feeLabels.processingFeeRateLabel('aud')).toBe('3% + $0.60 AUD');
    expect(feeLabels.processingFeeRateLabel('usd')).toMatch(/^4\.5% \+ /);
    expect(feeLabels.processingFeeRateLabel('eur')).toMatch(/^3% \+ /);
    expect(feeLabels.processingFeeRateLabel('eur', 'IDEAL')).toMatch(/^1\.5% \+ /);
    expect(feeLabels.processingFeeRateLabel('aud', 'PAYTO')).toMatch(/^2\.5% \+ /);
    expect(feeLabels.nodittoFeeRateLabel()).toBe('1%');
    expect(feeLabels.processingFeeExplanation('aud')).toContain('3% + $0.60 AUD');
    expect(feeLabels.processingFeeExplanation('aud')).toContain('1% to NoDitto');
    expect(feeLabels.PROCESSING_FEE_HINT).toContain('1% to NoDitto');
    expect(feeLabels.termsFeeSentence()).toContain('1% to NoDitto');
  });

  it('never call the rate approximate or the fee "at cost"', () => {
    // "about 1% to NoDitto" is right (the rates are rounded); "about 3% + ..." is not.
    expect(feeLabels.processingFeeExplanation('aud').toLowerCase()).not.toMatch(/about \d+(\.\d+)?% \+/);
    expect(feeLabels.processingFeeExplanation('aud').toLowerCase()).not.toContain('at cost');
    expect(feeLabels.PROCESSING_FEE_HINT.toLowerCase()).not.toContain('at cost');
  });

  it('never say beta, waived, or that NoDitto takes nothing', () => {
    const strings = [
      feeLabels.PROCESSING_FEE_NAME,
      feeLabels.PROCESSING_FEE_HINT,
      feeLabels.TRADE_NO_FEE_NOTE,
      feeLabels.processingFeeRateLabel('aud'),
      feeLabels.processingFeeExplanation('aud'),
      feeLabels.termsFeeSentence(),
    ];
    for (const text of strings) {
      expect(text.toLowerCase()).not.toContain('beta');
      expect(text.toLowerCase()).not.toContain('waived');
      expect(text.toLowerCase()).not.toContain("doesn't take a cut");
      expect(text.toLowerCase()).not.toContain('takes nothing');
    }
  });

  it('exports nothing from the retired beta waiver', () => {
    const retired = [
      'feesWaivedForBeta',
      'betaFeeNote',
      'feeWaiverExplanation',
      'NO_FEE_DURING_BETA',
      'FEE_WAIVED_HINT',
      'TERMS_BETA_FEE_SENTENCE',
      'LISTING_BETA_FEE_NOTE',
    ];
    for (const name of retired) expect(feeLabels).not.toHaveProperty(name);
  });
});
