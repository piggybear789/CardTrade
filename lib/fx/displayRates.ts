import 'server-only';

// lib/fx/displayRates.ts
//
// The reference rates behind the approximate prices browsing shows in a viewer's own
// currency (0179, `domain/fx/displayConversion.ts`), and the viewer's currency itself.
//
// SOURCE: the European Central Bank's daily reference rates, read through Frankfurter
// (`api.frankfurter.dev`), which needs no key and receives nothing about the member.
// Daily is enough for a figure marked "≈": it is never charged. Stripe's own FX quote
// API is not used here because it is a preview API built to lock a rate for a
// transfer, and it would cost a provider call per platform for what is a label.
//
// Cached for 12 hours across requests (`unstable_cache`). A failed read is thrown out
// of the cached function, so it is not remembered and the next page retries, and
// returns null to the page, which then shows every price as listed.

import { unstable_cache } from 'next/cache';

import { logBackgroundFailure } from '@/lib/errors/errorLog';
import { geoRegionFromRequest, viewerTradingRegion, defaultRegion } from '@/lib/location/resolveRegion';
import {
  parseEuroRates,
  pickRates,
  type DisplayCurrency,
  type RatesPerEuro,
} from '@/domain/fx/displayConversion';
import { REGIONS, regionCurrency } from '@/domain/region';

const RATES_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR';
const RATES_REVALIDATE_SECONDS = 12 * 60 * 60;
/** A slow rate source must not hold a page: past this, prices show as listed. */
const RATES_TIMEOUT_MS = 2_500;

async function readEuroRates(): Promise<RatesPerEuro> {
  const response = await fetch(RATES_URL, {
    signal: AbortSignal.timeout(RATES_TIMEOUT_MS),
    headers: { accept: 'application/json' },
    // The cache is `unstable_cache` below, keyed on nothing about the request.
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Rates source answered ${response.status}`);
  return parseEuroRates(await response.json());
}

const readEuroRatesCached = unstable_cache(readEuroRates, ['fx-display-rates-eur'], {
  revalidate: RATES_REVALIDATE_SECONDS,
});

/** Every currency a listing can be priced in. */
const LISTING_CURRENCIES = Array.from(new Set(REGIONS.map((region) => region.currency)));

/** The day's rates for every listing currency, or null when they could not be read. */
export async function displayRates(): Promise<RatesPerEuro | null> {
  try {
    return pickRates(await readEuroRatesCached(), LISTING_CURRENCIES);
  } catch (error) {
    await logBackgroundFailure({
      name: 'fx.displayRates',
      errorCode: 'FX_RATES_UNAVAILABLE',
      error,
    });
    return null;
  }
}

/**
 * The currency a viewer reads prices in: their own TRADING region's (what they would
 * pay with), else the region their IP suggests, else the default. Never the browse
 * region: an Australian looking at US listings still wants AUD.
 */
export async function viewerDisplayCurrencyCode(): Promise<string> {
  const region = (await viewerTradingRegion()) ?? (await geoRegionFromRequest()) ?? defaultRegion();
  return regionCurrency(region) ?? regionCurrency(defaultRegion()) ?? 'aud';
}

/** {@link viewerDisplayCurrencyCode} and {@link displayRates}, for the layout. */
export async function viewerDisplayCurrency(): Promise<DisplayCurrency> {
  const [currency, rates] = await Promise.all([viewerDisplayCurrencyCode(), displayRates()]);
  return { currency, rates };
}
