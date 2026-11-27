// domain/fx/displayConversion.ts
//
// An APPROXIMATE price in the viewer's own currency, for browsing only (0179).
//
// Members browse every region's listings, and since cross-platform cash sales an
// Australian can buy a US listing, charged in USD. The catalog, the listing page and
// search suggestions then show the price in the viewer's currency with a "≈", so an
// Australian reads "≈ $155 AUD" rather than doing the sum on "$100 USD".
//
// DISPLAY ONLY, AND NEVER A CHARGE. The figure comes from a daily reference rate
// (`lib/fx/displayRates.ts`), not from what any bank or Stripe will apply, so it is
// always marked as approximate and never fed into a fee, a total, a comparison or a
// stored value. The Buy and Pay dialogs show the real amount in the contract's own
// currency, and say the buyer's bank converts it.
//
// Pure, so the server and the browser share one rule.

import { minorToMajor, minorUnitDigits } from '../region';

/**
 * Reference rates as units of each currency per ONE euro (the European Central Bank's
 * base), keyed by lowercase ISO 4217 code. `eur` is 1.
 */
export type RatesPerEuro = Readonly<Record<string, number>>;

/** A viewer's display currency and the rates to reach it. */
export interface DisplayCurrency {
  /** Lowercase ISO 4217: the viewer's own trading region's currency, or a guess. */
  currency: string;
  /** Null when no rates could be read; every price then shows as listed. */
  rates: RatesPerEuro | null;
}

/**
 * `amountMinor` in `from`, converted to `to`'s minor units, or null when it cannot or
 * need not be converted: the same currency, an unknown rate, or an unusable amount.
 *
 * Rounded to the nearest minor unit. Callers round further for display.
 */
export function approximateMinor(
  amountMinor: number,
  from: string,
  to: string,
  rates: RatesPerEuro | null | undefined,
): number | null {
  const source = from?.trim().toLowerCase();
  const target = to?.trim().toLowerCase();
  if (!rates || !source || !target || source === target) return null;
  if (!Number.isFinite(amountMinor) || amountMinor < 0) return null;
  const fromRate = rates[source];
  const toRate = rates[target];
  if (!(fromRate > 0) || !(toRate > 0)) return null;
  let digits: number;
  try {
    digits = minorUnitDigits(target);
    minorUnitDigits(source);
  } catch {
    return null;
  }
  const major = (minorToMajor(amountMinor, source) / fromRate) * toRate;
  return Math.round(major * 10 ** digits);
}

/**
 * Parse the rate table a reference-rate source returns into {@link RatesPerEuro}:
 * `{ base: 'EUR', rates: { AUD: 1.65, ... } }`. Throws on a body it cannot read, so a
 * broken source fails loudly rather than caching an empty table.
 */
export function parseEuroRates(body: unknown): RatesPerEuro {
  const value = body as { base?: unknown; rates?: unknown } | null;
  if (!value || typeof value !== 'object') throw new Error('Rates body is not an object');
  if (String(value.base ?? '').toUpperCase() !== 'EUR') throw new Error('Rates are not EUR-based');
  if (!value.rates || typeof value.rates !== 'object') throw new Error('Rates body has no rates');
  const out: Record<string, number> = { eur: 1 };
  for (const [code, rate] of Object.entries(value.rates as Record<string, unknown>)) {
    if (/^[A-Za-z]{3}$/.test(code) && typeof rate === 'number' && rate > 0 && Number.isFinite(rate)) {
      out[code.toLowerCase()] = rate;
    }
  }
  if (Object.keys(out).length < 2) throw new Error('Rates body has no usable rates');
  return out;
}

/** Keep only the currencies a page can show, so the table sent to the browser is small. */
export function pickRates(rates: RatesPerEuro, currencies: Iterable<string>): RatesPerEuro {
  const out: Record<string, number> = {};
  for (const code of currencies) {
    const key = code.toLowerCase();
    const rate = rates[key];
    if (rate > 0) out[key] = rate;
  }
  return out;
}
