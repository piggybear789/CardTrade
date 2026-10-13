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

import { CURRENCY_CODE, CURRENCY_LOCALE, formatAud, formatMoney, formatMoneyCompact } from '@/lib/format';
import { minorUnitDigits, REGIONS, regionCurrency, regionLocale } from '@/domain/region';

const AMOUNT = 123_456; // $1,234.56 in a 2-decimal currency

describe('every formatted amount names its currency (0136)', () => {
  // WHY THE CODE IS ALWAYS THERE. AUD in en-AU, USD in en-US and CAD in en-CA all
  // render a bare "$", and since the US platform opened the UK, the EEA, Canada and
  // Switzerland, one catalog genuinely holds all three. A bare "$1,234.56" stopped
  // saying which. The ISO code is what makes every figure unambiguous on its own.
  const normalise = (value: string) => value.replace(/\u00a0/g, ' ');

  it('suffixes the ISO code', () => {
    expect(formatMoney(AMOUNT, 'aud')).toBe('$1,234.56 AUD');
    expect(formatMoney(AMOUNT, 'usd')).toBe('$1,234.56 USD');
    expect(formatMoney(AMOUNT, 'cad')).toBe('$1,234.56 CAD');
    expect(formatMoney(AMOUNT, 'eur')).toContain('€');
    expect(formatMoney(AMOUNT, 'eur')).toMatch(/ EUR$/);
  });

  it('tells AUD and USD apart, which the bare symbol could not', () => {
    expect(formatMoney(AMOUNT, 'aud')).not.toBe(formatMoney(AMOUNT, 'usd'));
  });

  it('does not repeat a code Intl already printed', () => {
    const viewer = regionLocale('AU')!;
    expect(normalise(formatMoney(AMOUNT, 'usd', viewer))).toBe('USD 1,234.56');
  });

  it('respects the minor unit rather than assuming hundredths', () => {
    expect(minorUnitDigits('jpy')).toBe(0);
    expect(formatMoney(12_345, 'aud')).toBe('$123.45 AUD');
    expect(formatMoney(12_345, 'jpy')).toBe('¥12,345 JPY');
  });

  it('falls back to the default presentation for a junk code instead of throwing', () => {
    // A display helper must not be able to take down a contract room over a label.
    expect(formatMoney(AMOUNT, 'not-a-currency')).toBe(formatAud(AMOUNT));
    expect(formatMoney(AMOUNT, '')).toBe(formatAud(AMOUNT));
  });

  it('never renders NaN into a money field', () => {
    expect(formatMoney(Number.NaN, 'aud')).toBe('$0.00 AUD');
    expect(formatMoney(Number.POSITIVE_INFINITY, 'aud')).toBe('$0.00 AUD');
  });

  it('formats every trading region currency without assuming a divisor', () => {
    for (const region of REGIONS.filter((r) => r.tradingEnabled)) {
      const currency = regionCurrency(region.code)!;
      expect(() => formatMoney(AMOUNT, currency)).not.toThrow();
      expect(formatMoney(AMOUNT, currency)).toContain(currency.toUpperCase());
    }
  });

  it('keeps the deprecated alias in AUD, now labelled as such', () => {
    expect(CURRENCY_CODE).toBe('AUD');
    expect(CURRENCY_LOCALE).toBe('en-AU');
    expect(formatAud(AMOUNT)).toBe('$1,234.56 AUD');
  });

  it('offers a compact form for places that state the currency beside the figure', () => {
    expect(formatMoneyCompact(AMOUNT, 'aud')).toBe('$1,234.56');
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
    // The declaration itself. Last one out.
    'lib/format.ts',
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
