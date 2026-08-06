import 'server-only';

// lib/location/resolveRegion.ts
//
// The ONE place a request is turned into a browse region, and the one place IP
// geolocation is read. Everything above this depends on a `RegionCode`, not on how
// it was obtained.
//
// PROVIDER COUPLING, ISOLATED HERE ON PURPOSE. `x-vercel-ip-country` is set by the
// Vercel Edge Network on every request — no package, no outbound call, no added
// latency. It is also absent everywhere else: locally it does not exist, and
// self-hosting would need MaxMind or Cloudflare's `cf-ipcountry` instead. Keeping
// the header name in a single function means that swap is one edit.
//
// THE HEADER IS A GUESS AND IS TREATED AS ONE. It never reaches
// `profiles.region_code`. A VPN, a corporate proxy or a holiday would otherwise
// assign a member a trading jurisdiction they cannot settle in, discovered only
// when a transfer fails against a Connect account registered elsewhere. IP decides
// what a first-time visitor SEES and nothing more — see the two-values note in
// `domain/region/regions.ts`.

import { cookies, headers } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import {
  FALLBACK_REGION,
  normalizeRegionCode,
  type RegionCode,
  type RegionSource,
} from '@/domain/region';

export type { RegionSource };

/** Cookie holding an explicit browse-region choice. */
export const REGION_COOKIE = 'nd_region';

/**
 * `?region=` value meaning "do not scope at all".
 *
 * A real sentinel rather than an omitted param, because omitting the param falls
 * through to the profile / cookie / IP chain — so there would otherwise be no way
 * to ASK for the worldwide catalog once any of those resolved. It is not a region
 * code and never reaches `profiles.region_code`.
 */
export const ALL_REGIONS = 'all';

/** A year: a browse preference should outlive a session but not be permanent. */
const REGION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Vercel's geolocation header. Absent off-Vercel and in local development. */
const IP_COUNTRY_HEADER = 'x-vercel-ip-country';

/**
 * A browse region plus how confident we are about it.
 *
 * `code` is null only when `source` is `'all'` — an explicit worldwide request.
 * Callers pass it straight to `searchCatalog({ regionCode })`, which treats null
 * as unscoped.
 */
export interface ResolvedRegion {
  code: RegionCode | null;
  source: RegionSource;
}

/**
 * The deployment default, for local development and unrecognised IPs.
 *
 * Env-driven so a non-AU deployment does not need a code change, and validated
 * against the registry so a typo falls back rather than emptying the catalog.
 */
function defaultRegion(): RegionCode {
  return normalizeRegionCode(process.env.DEFAULT_REGION) ?? FALLBACK_REGION;
}

/**
 * Read the region the Edge Network inferred from the request IP.
 *
 * @returns a known region code, or null when the header is absent (local dev,
 *   non-Vercel host) or names a region the product does not list.
 */
export async function geoRegionFromRequest(): Promise<RegionCode | null> {
  try {
    const headerList = await headers();
    return normalizeRegionCode(headerList.get(IP_COUNTRY_HEADER));
  } catch {
    // `headers()` throws outside a request scope (a build-time render, a script).
    // A missing guess is not an error.
    return null;
  }
}

/** The caller's own trading region, or null when signed out / not yet set. */
export async function viewerTradingRegion(): Promise<RegionCode | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from('profiles')
      .select('region_code')
      .eq('id', user.id)
      .maybeSingle();
    return normalizeRegionCode(data?.region_code);
  } catch {
    return null;
  }
}

/**
 * Resolve which region's listings to show.
 *
 * Precedence, most to least specific:
 *
 *   1. `paramRegion` — an explicit `?region=` in the URL. Beats everything,
 *      including a signed-in member's own region, so a shared link shows the same
 *      catalog to whoever opens it.
 *   2. the member's own trading region — the sensible default for someone who has
 *      told us where they trade.
 *   3. the remembered cookie — a previous explicit choice by an anonymous visitor.
 *   4. the IP guess.
 *   5. the configured default.
 *
 * Nothing here WRITES. A read path that set a cookie could not be cached, and Next
 * forbids setting one during a Server Component render anyway; only the explicit
 * control writes, through `setBrowseRegion`.
 *
 * @param paramRegion raw `?region=` value, if the page received one
 */
export async function resolveBrowseRegion(
  paramRegion?: string | string[] | null,
): Promise<ResolvedRegion> {
  const rawParam = Array.isArray(paramRegion) ? paramRegion[0] : paramRegion;

  // Checked BEFORE normalization: `all` is not a region code, so normalizing it
  // yields null, which would fall through the rest of the chain and re-apply the
  // very scope the visitor asked to drop.
  if (typeof rawParam === 'string' && rawParam.trim().toLowerCase() === ALL_REGIONS) {
    return { code: null, source: 'all' };
  }

  const fromParam = normalizeRegionCode(rawParam);
  if (fromParam) return { code: fromParam, source: 'param' };

  const fromProfile = await viewerTradingRegion();
  if (fromProfile) return { code: fromProfile, source: 'profile' };

  try {
    const cookieStore = await cookies();
    const fromCookie = normalizeRegionCode(cookieStore.get(REGION_COOKIE)?.value);
    if (fromCookie) return { code: fromCookie, source: 'cookie' };
  } catch {
    // Same as `headers()`: outside a request scope there is simply no cookie.
  }

  const fromGeo = await geoRegionFromRequest();
  if (fromGeo) return { code: fromGeo, source: 'geo' };

  return { code: defaultRegion(), source: 'default' };
}

/** Cookie options for a persisted browse-region choice. */
export function regionCookieOptions() {
  return {
    maxAge: REGION_COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax' as const,
    // Readable by the server only; nothing client-side needs it, and the region
    // control is driven by the URL.
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  };
}
