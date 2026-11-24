// Unit tests for tests/e2e/audit/core/copyRules.ts (Req 9.5, 31.1, 31.2, 31.3, 31.4, 31.5).

import { describe, expect, it } from 'vitest';
import {
  checkCollateralCopy,
  checkCurrencyCodes,
  checkFeeLabel,
  checkForbiddenTerms,
  checkShopfrontCopy,
} from '../e2e/audit/core/copyRules';
import { formatMoney } from '@/lib/format';
import { processingFeeRateLabel } from '@/lib/fees/feeLabels';

describe('checkForbiddenTerms', () => {
  it('reports whole-word terms in any case', () => {
    const found = checkForbiddenTerms('Your SHOPFRONT is live. Fee Waived during open  beta. Friction_Tax applies.');
    expect(found.map((o) => o.detail?.term)).toEqual(['shopfront', 'Friction_Tax', 'open beta', 'waived']);
    expect(found.every((o) => o.check === 'copy-forbidden')).toBe(true);
  });

  it('ignores a term inside a longer word and counts repeats', () => {
    expect(checkForbiddenTerms('Binders and shopfronts are fine words here.')).toEqual([]);
    const [binder] = checkForbiddenTerms('binder, binder');
    expect(binder.detail?.count).toBe(2);
  });

  it('reports a raw driver error', () => {
    const found = checkForbiddenTerms('Cannot coerce the result to a single JSON object');
    expect(found).toHaveLength(1);
  });
});

describe('checkCurrencyCodes', () => {
  it('passes formatMoney output for every kind of currency', () => {
    for (const currency of ['aud', 'usd', 'eur', 'gbp', 'cad', 'chf', 'jpy', 'sek', 'myr', 'brl']) {
      expect(checkCurrencyCodes(`Price ${formatMoney(123456, currency)} today`)).toEqual([]);
      expect(checkCurrencyCodes(`Refund ${formatMoney(-500, currency)}`)).toEqual([]);
    }
  });

  it('flags a symbol figure with the code removed', () => {
    for (const currency of ['aud', 'usd', 'eur', 'gbp', 'jpy', 'myr', 'brl']) {
      const code = currency.toUpperCase();
      const bare = formatMoney(123456, currency).replace(code, '').trim();
      expect(checkCurrencyCodes(`Price ${bare} today`)).toHaveLength(1);
    }
  });

  it('flags each bare figure and accepts a code before the symbol', () => {
    expect(checkCurrencyCodes('$12.00 and 5 € and AUD $3')).toHaveLength(2);
    expect(checkCurrencyCodes('2 $5.00 AUD')).toEqual([]);
  });
});

describe('checkShopfrontCopy', () => {
  it('needs the wording and the nothing-is-held statement', () => {
    expect(checkShopfrontCopy('Multiple items\nNothing is held for you yet.')).toEqual([]);
    expect(checkShopfrontCopy('This is a listing with multiple items. Nothing in this listing is held for you.')).toEqual([]);
    expect(checkShopfrontCopy('A listing with multiple items. Nothing in the listing is held, and no money has moved yet.')).toEqual([]);
    expect(checkShopfrontCopy('Multiple items')).toHaveLength(1);
    expect(checkShopfrontCopy('Nothing is held.')).toHaveLength(1);
    expect(checkShopfrontCopy('A card for sale.')).toHaveLength(2);
  });
});

describe('checkCollateralCopy', () => {
  const ok = 'Trade collateral\nA temporary card hold, not a charge.';

  it('passes the approved wording', () => {
    expect(checkCollateralCopy(ok)).toEqual([]);
  });

  it('records one observation per sentence putting escrow with collateral or a hold', () => {
    const found = checkCollateralCopy(`${ok} Your collateral is in escrow. Escrow keeps the hold safe! Escrow protects buyers.`);
    expect(found).toHaveLength(2);
    expect(found[0].detail?.sentence).toBe('Your collateral is in escrow.');
  });

  it('reports each missing phrase', () => {
    expect(checkCollateralCopy('Collateral is placed.')).toHaveLength(2);
  });
});

describe('checkFeeLabel', () => {
  it('passes the domain label and fails another rate', () => {
    const aud = processingFeeRateLabel('aud', 'CARD');
    expect(checkFeeLabel(`Service fee ${aud} of the price`, aud)).toEqual([]);
    const usd = processingFeeRateLabel('usd', 'CARD');
    const wrong = checkFeeLabel(`Service fee ${usd}`, aud);
    expect(wrong).toHaveLength(1);
    expect(wrong[0].detail?.shown).toBe(usd);
  });

  it('does not accept the expected label inside a larger rate', () => {
    expect(checkFeeLabel('Service fee 13% + $0.60 AUD', '3% + $0.60 AUD')).toHaveLength(1);
  });

  it('flags a hedged rate', () => {
    const aud = processingFeeRateLabel('aud', 'CARD');
    const found = checkFeeLabel(`Service fee of about ${aud}`, aud);
    expect(found).toHaveLength(1);
    expect(found[0].message).toContain('hedged');
  });

  it('throws on a blank expected label', () => {
    expect(() => checkFeeLabel('anything', ' ')).toThrow();
  });
});
