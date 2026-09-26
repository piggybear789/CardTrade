// tests/unit/moneyCurrencyRendering.test.ts
//
// What money actually LOOKS like once more than one region is live.
//
// Written after a wrong diagnosis, and it pins the correction. The claim being
// chased was that `formatAud` renders a USD amount as "A$1,234.56". It does not:
// `formatAud` is `formatMoney(cents, 'AUD', 'en-AU')`, and en-AU renders AUD as a
// BARE dollar sign. So a USD figure pushed through `formatAud` comes out
// "$1,234.56" — byte-identical to correct USD output.
//
// That matters in both directions:
//
//   1. Migrating an AUD-or-USD figure off `formatAud` is SEMANTIC hygiene, not a
//      visible fix. Nobody was shown a wrong symbol between those two currencies.
//   2. The visible danger is the opposite one, and `formatMoney` alone does NOT
//      solve it: AUD-in-en-AU and USD-in-en-US both render "$", so a cross-region
//      catalog shows an AU listing and a US listing with the same glyph and no way
//      to tell them apart. See the last block.
//
// Where `formatAud` IS straightforwardly, badly wrong is any currency that is not
// a 2-decimal dollar — JPY off by 100x, GBP under the wrong symbol.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { CURRENCY_CODE, CURRENCY_LOCALE, formatAud, formatMoney } from '@/lib/format';
import { minorUnitDigits, regionCurrency, regionLocale } from '@/domain/region';

const AMOUNT = 123_456; // $1,234.56 in a 2-decimal currency

describe('the deprecated alias', () => {
  it('is AUD in the en-AU locale, which renders a BARE dollar sign', () => {
    expect(CURRENCY_CODE).toBe('AUD');
    expect(CURRENCY_LOCALE).toBe('en-AU');
    expect(formatAud(AMOUNT)).toBe('$1,234.56');
    // NOT 'A$1,234.56'. That form only appears when AUD is rendered in a locale
    // whose own currency is something else — see the disambiguation block below.
    expect(formatAud(AMOUNT)).not.toContain('A$');
  });

  it('is visually indistinguishable from correct USD output', () => {
    // THE CORRECTION. Migrating these two currencies off the alias changes the
    // meaning of the string, not its pixels.
    expect(formatAud(AMOUNT)).toBe(formatMoney(AMOUNT, 'usd'));
  });

  it('is off by a factor of 100 for a zero-decimal currency', () => {
    // The genuine, unambiguous breakage. 12345 minor units of JPY is twelve
    // thousand yen; the alias divides by 100 and calls it dollars.
    expect(minorUnitDigits('jpy')).toBe(0);
    expect(formatAud(12_345)).toBe('$123.45');
    expect(formatMoney(12_345, 'jpy')).toBe('¥12,345');
  });

  it('shows the wrong symbol for any non-dollar currency', () => {
    expect(formatAud(AMOUNT)).toBe('$1,234.56');
    expect(formatMoney(AMOUNT, 'gbp')).toContain('1,234.56');
    expect(formatMoney(AMOUNT, 'gbp')).not.toBe(formatAud(AMOUNT));
    expect(formatMoney(AMOUNT, 'eur')).toContain('€');
  });
});

describe('formatMoney drives everything off the currency', () => {
  it('respects the minor unit rather than assuming hundredths', () => {
    expect(formatMoney(12_345, 'aud')).toBe('$123.45');
    expect(formatMoney(12_345, 'jpy')).toBe('¥12,345');
  });

  it('falls back to the default presentation for a junk code instead of throwing', () => {
    // A display helper must not be able to take down a contract room over a label.
    expect(formatMoney(AMOUNT, 'not-a-currency')).toBe(formatAud(AMOUNT));
    expect(formatMoney(AMOUNT, '')).toBe(formatAud(AMOUNT));
  });

  it('never renders NaN into a money field', () => {
    expect(formatMoney(Number.NaN, 'aud')).toBe('$0.00');
    expect(formatMoney(Number.POSITIVE_INFINITY, 'aud')).toBe('$0.00');
  });

  it('picks each trading region currency without assuming a divisor', () => {
    for (const code of ['AU', 'US'] as const) {
      const currency = regionCurrency(code)!;
      expect(currency).toBeTruthy();
      expect(() => formatMoney(AMOUNT, currency)).not.toThrow();
      expect(formatMoney(AMOUNT, currency)).toContain('1,234.56');
    }
  });
});

describe('cross-region disambiguation is NOT solved by formatMoney alone', () => {
  // THE PROBLEM THAT IS ACTUALLY USER-VISIBLE, recorded here because the obvious
  // migration does not fix it and someone will otherwise assume it did.
  //
  // The catalog is browsable across regions (`?region=all`), so one grid can hold
  // an AU listing and a US listing. Each formatted in its OWN currency's locale,
  // they are the same string.
  it('renders AUD and USD identically when each uses its own locale', () => {
    expect(formatMoney(AMOUNT, 'aud')).toBe('$1,234.56');
    expect(formatMoney(AMOUNT, 'usd')).toBe('$1,234.56');
    expect(formatMoney(AMOUNT, 'aud')).toBe(formatMoney(AMOUNT, 'usd'));
  });

  it('disambiguates as soon as ONE viewer locale formats both', () => {
    // This is the lever: `formatMoney` already takes a locale. Formatting both
    // amounts in the VIEWER's locale makes the foreign one self-labelling, which is
    // what a mixed-currency surface needs.
    // Intl separates a currency CODE from the number with a non-breaking space
    // (U+00A0), not an ordinary one. Normalised here so the assertion is about the
    // disambiguation rather than about Unicode spacing.
    const normalise = (value: string) => value.replace(/\u00a0/g, ' ');

    const viewer = regionLocale('AU')!;
    expect(normalise(formatMoney(AMOUNT, 'aud', viewer))).toBe('$1,234.56');
    expect(normalise(formatMoney(AMOUNT, 'usd', viewer))).toBe('USD 1,234.56');

    const usViewer = regionLocale('US')!;
    expect(normalise(formatMoney(AMOUNT, 'usd', usViewer))).toBe('$1,234.56');
    expect(normalise(formatMoney(AMOUNT, 'aud', usViewer))).toBe('A$1,234.56');
  });
});

describe('the formatAud ratchet', () => {
  // A RATCHET, NOT A BAN. `formatAud` is deprecated and being migrated out file by
  // file, and the surfaces below have not been done yet. They are listed explicitly so
  // the debt can only SHRINK: deleting a name from this list is the migration, and a
  // new file reaching for the alias fails here rather than being noticed years later
  // when a non-dollar region opens.
  //
  // To retire an entry: thread the contract's own currency to the call site, switch to
  // `formatMoney`, and delete the line. When only `lib/format.ts` is left, delete the
  // alias and this test with it.
  //
  // Why a list rather than a count: a count lets one file's migration pay for another
  // file's regression, which is how a ratchet quietly stops ratcheting.
  const ALLOWED = [
    'app/(workspace)/admin/(console)/page.tsx',
    // NOT JUST A FORMATTING JOB. `summariseQueue` SUMS `amountAtRiskCents` across every
    // open case, and with two trading regions that total adds AUD to USD and reports
    // one number. Threading a currency here would put a confident label on a figure
    // that is not a quantity of anything; the fix is to group the summary BY currency
    // in `domain/arbitration/arbitrationCase.ts` first. Per-case rows on this page can
    // be migrated on their own, but the headline cannot.
    'app/(workspace)/admin/arbitration/(queue)/page.tsx',
    // `contract.amountCents` on the owner's open-contracts list. The page already reads
    // the item, so its `currency` column is one prop away.
    'app/(workspace)/listings/[id]/(detail)/page.tsx',
    'components/account/CashSalesSection.tsx',
    'components/account/ListingsSection.tsx',
    'components/account/OffersSection.tsx',
    'components/account/TradesSection.tsx',
    'components/contract/DittoBondExplainer.tsx',
    'components/deals/DealComposeForm.tsx',
    'components/deals/DealInviteFacts.tsx',
    'components/deals/DealInviteList.tsx',
    'components/deals/DealInviteShare.tsx',
    'components/listings/ItemCard.tsx',
    'components/listings/ListingDesktopPane.tsx',
    'components/listings/ListingDetailStack.tsx',
    'components/offers/MakeOfferDialog.tsx',
    'components/reviews/ReviewList.tsx',
    'components/sales/CashSaleDisputeResolution.tsx',
    'components/trade/ItemPeekDialog.tsx',
    'components/trade/OwnItemsPickerDialog.tsx',
    'components/trade/TradeOfferForm.tsx',
    'lib/actions/offers.ts',
    // The declaration itself. Last one out.
    'lib/format.ts',
    'lib/handover/terms.ts',
  ] as const;

  /** Every source file under the app roots that still calls the alias. */
  function filesUsingFormatAud(): string[] {
    const roots = ['app', 'components', 'lib', 'domain'];
    const found: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.tsx?$/.test(entry.name)) {
          if (/formatAud\(/.test(readFileSync(full, 'utf8'))) {
            found.push(path.relative(process.cwd(), full).split(path.sep).join('/'));
          }
        }
      }
    };

    for (const root of roots) walk(path.join(process.cwd(), root));
    return found.sort();
  }

  it('has no NEW call sites outside the known migration backlog', () => {
    const actual = filesUsingFormatAud();
    const surplus = actual.filter((file) => !ALLOWED.includes(file as never));

    expect(
      surplus,
      'These files reach for the deprecated `formatAud`. Use `formatMoney` with the ' +
        "currency from the row being displayed — a contract's `currency` column, or " +
        "the member's own region for a personal ledger.",
    ).toEqual([]);
  });

  it('keeps the backlog honest by failing on a stale entry', () => {
    // The other half of a ratchet. Without this, a migrated file lingers on the list
    // and the next person reads the backlog as larger than it is.
    const actual = filesUsingFormatAud();
    const stale = ALLOWED.filter((file) => !actual.includes(file));

    expect(
      stale,
      'These files no longer call `formatAud` — delete them from ALLOWED.',
    ).toEqual([]);
  });
});
