// tests/unit/platformFee.test.ts
//
// The cash-sale fee (Req 4.7) is the Service_Fee: a CLEAN rate of price plus postage per
// currency and way of paying, e.g. 3% by card in Australia, with no fixed part since 2026-11-24
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
  processingRateFor,
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
  ['usd', 'BANK_TRANSFER'],
  ['aud', 'PAYTO'],
  ['eur', 'IDEAL'],
  ['eur', 'BANCONTACT'],
  ['eur', 'EPS'],
  ['eur', 'P24'],
  ['pln', 'P24'],
];

describe('platformFeeCentsFor (the Service_Fee)', () => {
  it('pins known figures', () => {
    // Percentage only (2026-11-24): no fixed part on any rail.
    expect(platformFeeCentsFor(1000, 'aud')).toBe(30);
    expect(platformFeeCentsFor(5000, 'aud')).toBe(150);
    expect(platformFeeCentsFor(10_000, 'aud')).toBe(300);
    expect(platformFeeCentsFor(100_000, 'aud')).toBe(3000);
    expect(platformFeeCentsFor(10_000, 'usd')).toBe(450);
    expect(platformFeeCentsFor(10_000, 'eur')).toBe(300);
    expect(platformFeeCentsFor(10_000, 'gbp')).toBe(300);
    expect(platformFeeCentsFor(100_000, 'czk')).toBe(3000);
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

  it("covers Stripe's percentage costs on every rail; NoDitto absorbs the fixed fee", () => {
    // Product decision 2026-11-24: no fixed part is passed to the buyer, so a small sale
    // loses up to Stripe's fixed fee. What must hold is that the PERCENTAGE never falls
    // short of Stripe's percentages (a Stripe rate rise would make every sale a loss),
    // and that the loss on any sale is bounded by that fixed fee.
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5_000_000 }),
        fc.integer({ min: 0, max: 50_000 }),
        fc.constantFrom(...RAILS),
        (price, shipping, [currency, method]) => {
          const base = price + shipping;
          const fee = cashSaleFeeMinor(price, shipping, currency, method);
          const cost = stripeCostMinor(base, fee, currency, method);
          const fixed = processingRateFor(currency, method).fixedMinor;
          const kept = fee - cost;
          // Percentage parts covered (two ceil()s may each round up a minor unit).
          expect(kept + fixed).toBeGreaterThanOrEqual(-2);
          // Well past break-even (about 1% of the base covers the fixed fee) NoDitto is in
          // profit on every rail, near its 1%. Scaled by the fixed fee because it is in
          // local minor units (NOK 6.00, CZK 13.00).
          if (base >= fixed * 150) {
            expect(kept).toBeGreaterThan(0);
            expect(kept / base).toBeLessThan(0.017);
          }
        },
      ),
    );
  });

  it('makes the bank rails that cost Stripe less cheaper than card', () => {
    expect(cashSaleFeeMinor(10_000, 0, 'usd', 'US_BANK')).toBeLessThan(cashSaleFeeMinor(10_000, 0, 'usd'));
    expect(cashSaleFeeMinor(10_000, 0, 'usd', 'BANK_TRANSFER')).toBeLessThan(cashSaleFeeMinor(10_000, 0, 'usd', 'US_BANK'));
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
    expect(platformFeeCentsFor(10_000, 'aud')).toBe(300);
    expect(cashSaleFeeMinor(10_000, 0, 'aud', 'CARD_INTERNATIONAL')).toBe(500);
    expect(cashSaleFeeMinor(10_000, 0, 'eur', 'CARD_UK_EEA')).toBe(400);
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
    expect(feeLabels.PROCESSING_FEE_NAME).toBe('Buyer protection fee');
    expect(feeLabels.processingFeeRateLabel('aud')).toBe('3%');
    expect(feeLabels.processingFeeRateLabel('usd')).toBe('4.5%');
    expect(feeLabels.processingFeeRateLabel('eur')).toBe('3%');
    expect(feeLabels.processingFeeRateLabel('eur', 'IDEAL')).toBe('1.5%');
    expect(feeLabels.processingFeeRateLabel('aud', 'PAYTO')).toBe('2.5%');
    expect(feeLabels.processingFeeRateLabel('usd', 'BANK_TRANSFER')).toBe('2%');
    expect(feeLabels.nodittoFeeRateLabel()).toBe('1%');
    expect(feeLabels.processingFeeExplanation('aud')).toContain('3% of the price');
    expect(feeLabels.processingFeeExplanation('aud')).toContain('NoDitto keeps about 1%');
    expect(feeLabels.PROCESSING_FEE_HINT).toContain('NoDitto keeps about 1%');
    expect(feeLabels.termsFeeSentence()).toContain('NoDitto keeps about 1%');
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
