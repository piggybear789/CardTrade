import 'server-only';

// lib/enrichment/psaCert.ts
//
// Proactive zero-victim anti-scam checks for trading-card deals:
//   1. PSA Cert lookup (PSA Public API when approved + live eBay Browse API exact cert
//      collision check across EBAY_AU & EBAY_US to catch stolen eBay slab photos on
//      hijacked Facebook Marketplace / Instagram accounts).
//   2. Live eBay Market Price Comp: queries EBAY_AU (or EBAY_US) for a card query,
//      filters out accessories/proxies/empty slabs, computes a trimmed median, and flags
//      suspiciously steep discounts (e.g. 40–60% below live market).

import type {
  MarketPriceCompResult,
  PsaCertCheckResult,
  StolenSlabMatch,
} from '@/domain/references/enrichment';
import { getEbayAppToken } from '@/lib/enrichment/ebay';

export type { MarketPriceCompResult, PsaCertCheckResult, StolenSlabMatch };

const PSA_CERT_API_BASE = 'https://api.psacard.com/publicapi/cert/GetByCertNumber';
const BROWSE_SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

/** Normalize a raw PSA cert string (7–10 digits). Returns null if invalid. */
export function normalizePsaCertNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 10) return null;
  return digits;
}

const NOISE_LISTING_RE =
  /\b(empty\s+slab|slab\s+case|bumper|protector|sleeve|stand|display\s+case|acrylic|extended\s+art|frame|proxy|replica|custom\s+card|metal\s+card|fan\s+art|mystery\s+(?:pack|box|slab)|repack|centering\s+tool|graded\s+guard|insert\s+only|box\s+only|empty\s+box|code\s+card|digital|lot\s+of\s+\d+|bulk)\b/i;

/** Computes trimmed median (drops bottom 15% and top 15% outliers when sample >= 6). */
export function computeTrimmedStats(prices: readonly number[]): {
  median: number;
  low: number;
  high: number;
} | null {
  const clean = prices
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  if (clean.length === 0) return null;

  const trim = clean.length >= 6 ? Math.floor(clean.length * 0.15) : 0;
  const slice = clean.slice(trim, clean.length - trim);
  const mid = Math.floor(slice.length / 2);
  const median =
    slice.length % 2 === 1
      ? slice[mid]!
      : (slice[mid - 1]! + slice[mid]!) / 2;

  return {
    median: Number(median.toFixed(2)),
    low: Number(slice[0]!.toFixed(2)),
    high: Number(slice[slice.length - 1]!.toFixed(2)),
  };
}

/** Evaluates asking price vs. live market median (pure, unit-testable). */
export function evaluateAskingPriceVsMarket(
  askingPrice: number,
  medianPrice: number | null,
  sampleCount: number,
): { discountPercent: number | null; riskLevel: 'LOW' | 'ELEVATED' | 'HIGH'; riskReason: string | null } {
  if (!medianPrice || medianPrice <= 0 || sampleCount < 3 || askingPrice <= 0) {
    return { discountPercent: null, riskLevel: 'LOW', riskReason: null };
  }

  const discountPercent = Math.round((1 - askingPrice / medianPrice) * 100);

  if (discountPercent >= 45 && medianPrice >= 60) {
    return {
      discountPercent,
      riskLevel: 'HIGH',
      riskReason: `Asking price is ~${discountPercent}% below live eBay market median ($${medianPrice.toLocaleString('en-US')}). Steep below-market pricing is the #1 bait on Marketplace and IG scams.`,
    };
  }

  if (discountPercent >= 30 && medianPrice >= 80) {
    return {
      discountPercent,
      riskLevel: 'ELEVATED',
      riskReason: `Asking price is ~${discountPercent}% below live eBay market median ($${medianPrice.toLocaleString('en-US')}). Verify live possession before paying.`,
    };
  }

  return { discountPercent, riskLevel: 'LOW', riskReason: null };
}

interface BrowseItem {
  title?: string;
  itemWebUrl?: string;
  price?: { value?: string; currency?: string };
  seller?: { username?: string; feedbackScore?: number };
}

async function queryBrowse(
  token: string,
  marketplace: 'EBAY_AU' | 'EBAY_US',
  q: string,
  limit: number,
): Promise<BrowseItem[]> {
  const url = new URL(BROWSE_SEARCH_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplace,
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(7_000),
  }).catch(() => null);
  if (!res?.ok) return [];
  const json = (await res.json().catch(() => null)) as { itemSummaries?: BrowseItem[] } | null;
  return json?.itemSummaries ?? [];
}

interface PsaApiResponse {
  PSACert?: {
    CertNumber?: string;
    Subject?: string;
    CardGrade?: string;
    Year?: string;
    Brand?: string;
    Variety?: string;
    IsDeactivated?: boolean;
  };
}

/**
 * Checks a PSA Cert number against:
 *  1) PSA Public API (`PSA_API_TOKEN`, if approved)
 *  2) Live eBay Browse API (`EBAY_AU` + `EBAY_US`) for exact cert # matches to detect
 *     stolen slab photos being resold on Facebook Marketplace / Instagram by someone else.
 */
export async function checkPsaCert(
  rawCert: string,
  options: { subjectHandle?: string | null } = {},
): Promise<PsaCertCheckResult | null> {
  const certNumber = normalizePsaCertNumber(rawCert);
  if (!certNumber) return null;

  const psaVerifyUrl = `https://www.psacard.com/cert/${certNumber}/psa`;
  const subjectNorm = options.subjectHandle?.trim().replace(/^@/, '').toLowerCase() || null;

  // 1. PSA Public API (gracefully handles 403 unapproved / rate-limited tokens)
  const psaPromise = (async (): Promise<{
    status: PsaCertCheckResult['psaApiStatus'];
    title: string | null;
    grade: string | null;
    year: string | null;
    brand: string | null;
  }> => {
    const token = process.env.PSA_API_TOKEN?.trim();
    if (!token) return { status: 'UNAVAILABLE', title: null, grade: null, year: null, brand: null };

    const res = await fetch(`${PSA_CERT_API_BASE}/${certNumber}`, {
      headers: {
        Authorization: `bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'NoDitto/1.0',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(6_000),
    }).catch(() => null);

    if (!res) return { status: 'UNAVAILABLE', title: null, grade: null, year: null, brand: null };
    if (res.status === 404) {
      return { status: 'NOT_FOUND', title: null, grade: null, year: null, brand: null };
    }
    if (!res.ok) {
      return { status: 'UNAVAILABLE', title: null, grade: null, year: null, brand: null };
    }

    const json = (await res.json().catch(() => null)) as PsaApiResponse | null;
    const cert = json?.PSACert;
    if (!cert || !cert.CertNumber) {
      return { status: 'NOT_FOUND', title: null, grade: null, year: null, brand: null };
    }

    if (cert.IsDeactivated) {
      return {
        status: 'DEACTIVATED',
        title: cert.Subject ?? null,
        grade: cert.CardGrade ?? null,
        year: cert.Year ?? null,
        brand: cert.Brand ?? null,
      };
    }

    return {
      status: 'VERIFIED',
      title: [cert.Year, cert.Brand, cert.Subject, cert.Variety].filter(Boolean).join(' ') || null,
      grade: cert.CardGrade ?? null,
      year: cert.Year ?? null,
      brand: cert.Brand ?? null,
    };
  })();

  // 2. Live eBay exact-cert lookup (AU + US)
  const ebayPromise = (async (): Promise<StolenSlabMatch[]> => {
    const token = await getEbayAppToken();
    if (!token) return [];
    const [auItems, usItems] = await Promise.all([
      queryBrowse(token, 'EBAY_AU', certNumber, 8),
      queryBrowse(token, 'EBAY_US', certNumber, 8),
    ]);

    // Boundary regex so cert "12345678" never matches "123456789"
    const exactCertRe = new RegExp(`(?<!\\d)${certNumber}(?!\\d)`);
    const seenItemKeys = new Set<string>();
    const matches: StolenSlabMatch[] = [];

    for (const [marketplace, list] of [
      ['EBAY_AU', auItems] as const,
      ['EBAY_US', usItems] as const,
    ]) {
      for (const item of list) {
        const title = item.title?.trim() ?? '';
        const itemUrl = item.itemWebUrl?.trim() ?? '';
        const seller = item.seller?.username?.trim() ?? '';
        const itemIdMatch = /\/itm\/(\d+)/.exec(itemUrl);
        const dedupeKey = itemIdMatch ? `${seller.toLowerCase()}:${itemIdMatch[1]}` : itemUrl.split('?')[0]!;
        if (!title || !itemUrl || !seller || seenItemKeys.has(dedupeKey)) continue;
        if (!exactCertRe.test(title)) continue;
        seenItemKeys.add(dedupeKey);

        const parsedPrice = item.price?.value ? Number.parseFloat(item.price.value) : NaN;
        matches.push({
          marketplace,
          title,
          sellerUsername: seller,
          sellerFeedbackScore:
            typeof item.seller?.feedbackScore === 'number' ? item.seller.feedbackScore : null,
          priceValue: Number.isFinite(parsedPrice) ? parsedPrice : null,
          priceCurrency: item.price?.currency ?? null,
          itemUrl,
          sellerMatchesSubject: Boolean(subjectNorm && seller.toLowerCase() === subjectNorm),
        });
      }
    }
    return matches;
  })();

  const [psa, ebayMatches] = await Promise.all([psaPromise, ebayPromise]);

  const conflictingEbayMatches = ebayMatches.filter((m) => !m.sellerMatchesSubject);

  let riskLevel: PsaCertCheckResult['riskLevel'] = 'LOW';
  let riskReason: string | null = null;

  if (psa.status === 'DEACTIVATED') {
    riskLevel = 'HIGH';
    riskReason = `PSA cert #${certNumber} is DEACTIVATED by PSA (often revoked for counterfeit/altered slabs). Do not buy.`;
  } else if (psa.status === 'NOT_FOUND') {
    riskLevel = 'HIGH';
    riskReason = `PSA cert #${certNumber} isn’t in PSA’s registry. It is likely a fake slab.`;
  } else if (conflictingEbayMatches.length > 0) {
    const sellers = Array.from(new Set(conflictingEbayMatches.map((m) => m.sellerUsername))).join(', ');
    riskLevel = 'HIGH';
    riskReason = `Possible stolen photo: exact PSA cert #${certNumber} is currently actively listed on eBay by another seller (${sellers}). Demand a live Proof-of-Card photo with a one-time code before paying.`;
  } else if (ebayMatches.length > 0 && ebayMatches.every((m) => m.sellerMatchesSubject)) {
    riskLevel = 'LOW';
    riskReason = `PSA cert #${certNumber} matches an active eBay listing by this same username.`;
  }

  return {
    certNumber,
    psaVerifyUrl,
    psaApiStatus: psa.status,
    psaCardTitle: psa.title,
    psaGrade: psa.grade,
    psaYear: psa.year,
    psaBrand: psa.brand,
    ebayMatches,
    riskLevel,
    riskReason,
  };
}

/**
 * Compares a seller's asking price for a card against live eBay Browse API comps
 * (EBAY_AU for AUD, EBAY_US for USD), stripping accessories/empty slabs/proxies.
 */
export async function checkLiveMarketPriceComp(input: {
  cardQuery: string;
  askingPrice: number;
  currency?: 'AUD' | 'USD';
}): Promise<MarketPriceCompResult | null> {
  const cardQuery = input.cardQuery.trim().slice(0, 120);
  const askingPrice = Number(input.askingPrice);
  const currency: 'AUD' | 'USD' = input.currency === 'USD' ? 'USD' : 'AUD';

  if (cardQuery.length < 3 || !Number.isFinite(askingPrice) || askingPrice <= 0) {
    return null;
  }

  const token = await getEbayAppToken();
  if (!token) {
    return {
      cardQuery,
      askingPrice,
      currency,
      sampleCount: 0,
      medianPrice: null,
      lowPrice: null,
      highPrice: null,
      discountPercent: null,
      sampleListings: [],
      riskLevel: 'LOW',
      riskReason: null,
    };
  }

  const marketplace = currency === 'AUD' ? 'EBAY_AU' : 'EBAY_US';
  const items = await queryBrowse(token, marketplace, cardQuery, 20);

  const validSamples: MarketPriceCompResult['sampleListings'] = [];
  for (const item of items) {
    const title = item.title?.trim() ?? '';
    const itemUrl = item.itemWebUrl?.trim() ?? '';
    const itemCurrency = item.price?.currency?.toUpperCase() ?? '';
    const val = item.price?.value ? Number.parseFloat(item.price.value) : NaN;
    if (!title || !itemUrl || !Number.isFinite(val) || val <= 0) continue;
    if (itemCurrency !== currency) continue;
    if (NOISE_LISTING_RE.test(title)) continue;

    validSamples.push({
      title,
      priceValue: val,
      currency: itemCurrency,
      itemUrl,
      sellerUsername: item.seller?.username ?? null,
    });
  }

  const stats = computeTrimmedStats(validSamples.map((s) => s.priceValue));
  const evalResult = evaluateAskingPriceVsMarket(
    askingPrice,
    stats?.median ?? null,
    validSamples.length,
  );

  return {
    cardQuery,
    askingPrice,
    currency,
    sampleCount: validSamples.length,
    medianPrice: stats?.median ?? null,
    lowPrice: stats?.low ?? null,
    highPrice: stats?.high ?? null,
    discountPercent: evalResult.discountPercent,
    sampleListings: validSamples.slice(0, 4),
    riskLevel: evalResult.riskLevel,
    riskReason: evalResult.riskReason,
  };
}
