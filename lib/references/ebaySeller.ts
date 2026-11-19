import 'server-only';

// lib/references/ebaySeller.ts
//
// Reads a seller's PUBLIC eBay feedback (0170) through eBay's own Browse API, with the
// app credentials the eBay sign-in already uses (`EBAY_APP_ID`, `EBAY_CERT_ID`). Free, and
// the only eBay source here: eBay's robots.txt forbids automated access to its pages
// outside its API, and its profile pages block crawlers, so nothing is scraped.
//
// HOW A SELLER IS READ. The Browse API has no "get seller" call. A listing carries its
// seller's feedback score and percentage, and `filter=sellers:{a|b|c}` returns only those
// sellers' listings (up to 250 names per request), so a seller is read through a listing.
// Two consequences shape everything below:
//
//   1. A SELLER WITH NO LIVE LISTINGS CANNOT BE READ. That is `NO_LISTINGS`, which says
//      nothing about their record, and is never shown as "no feedback".
//   2. FOR AN UNKNOWN NAME eBay IGNORES THE FILTER and returns the whole marketplace
//      (checked 2026-11-18: three unknown names returned 20 million listings). A reply is
//      therefore only ever trusted for a seller whose username is one we asked about.
//
// Feedback is the account's own, so a hit on any eBay site reads it. A seller listing only
// on ebay.com.au is missed by the US site, so several sites are tried, in parallel.
//
// NOTHING IS STORED. A figure is cached for an hour (`unstable_cache`) and shown with the
// day it was read. We keep which account is linked (`external_seller_links`), not eBay's
// numbers, which keeps them from going stale and keeps eBay's content out of the database.

import { unstable_cache } from 'next/cache';

import { logBackgroundFailure } from '@/lib/errors/errorLog';
import {
  parseEbaySeller,
  sellsTradingCards,
  type EbayFeedback,
  type EbayListingContext,
  type ExternalRecordState,
} from '@/domain/references/externalSeller';

const API_ORIGIN = 'https://api.ebay.com';
const TOKEN_SCOPE = 'https://api.ebay.com/oauth/api_scope';

/** Cache tag for a read figure, separate from the references tag so a reference edit does not re-read eBay. */
export const EBAY_SELLER_CACHE_TAG = 'ebay-sellers';

/** eBay sites tried for a seller, most common first. */
const SITES = ['EBAY_US', 'EBAY_AU', 'EBAY_GB', 'EBAY_CA', 'EBAY_DE'] as const;

/** Browse needs a keyword or category. These cover a card seller; each is one round of calls. */
const SEARCH_TERMS = ['card', 'pokemon'] as const;

const MAX_SELLERS_PER_REQUEST = 250;
const PAGE_SIZE = 200;
const REQUEST_TIMEOUT_MS = 8_000;
const RECORD_REVALIDATE_SECONDS = 60 * 60;
const MAX_TITLE_LENGTH = 140;

/** eBay did not answer, rejected our token, or this deployment has no eBay credentials. */
export class EbayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EbayUnavailableError';
  }
}

/** The same credentials the eBay claim flow reads (`app/api/oauth/claim/[provider]`). */
function credentials(): { id: string; secret: string } | null {
  const id = (process.env.EBAY_CLIENT_ID ?? process.env.EBAY_APP_ID)?.trim();
  const secret = (process.env.EBAY_CLIENT_SECRET ?? process.env.EBAY_CERT_ID)?.trim();
  return id && secret ? { id, secret } : null;
}

/** Whether this deployment can read eBay at all. */
export function ebayConfigured(): boolean {
  return credentials() !== null;
}

let tokenCache: { value: string; expiresAt: number } | null = null;

/** An application token (client credentials), kept until a minute before it expires. */
async function appToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
  const creds = credentials();
  if (!creds) throw new EbayUnavailableError('eBay is not configured');

  const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString('base64');
  const response = await fetch(`${API_ORIGIN}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: TOKEN_SCOPE }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  }).catch((error: unknown) => {
    throw new EbayUnavailableError(`eBay token request failed: ${error instanceof Error ? error.message : 'unknown'}`);
  });
  if (!response.ok) throw new EbayUnavailableError(`eBay token request returned ${response.status}`);
  const body = (await response.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!body || typeof body.access_token !== 'string') throw new EbayUnavailableError('eBay returned no token');
  const seconds = typeof body.expires_in === 'number' ? body.expires_in : 7_200;
  tokenCache = { value: body.access_token, expiresAt: Date.now() + Math.max(60, seconds - 60) * 1_000 };
  return tokenCache.value;
}

interface BrowseItem {
  title?: unknown;
  seller?: unknown;
  itemLocation?: { country?: unknown } | null;
  categories?: { categoryName?: unknown }[] | null;
}

/** One Browse search on one eBay site, limited to `names`. Throws `EbayUnavailableError`. */
async function browse(site: string, term: string, names: readonly string[]): Promise<BrowseItem[]> {
  const url = new URL(`${API_ORIGIN}/buy/browse/v1/item_summary/search`);
  url.searchParams.set('q', term);
  url.searchParams.set('filter', `sellers:{${names.join('|')}}`);
  url.searchParams.set('limit', String(PAGE_SIZE));
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${await appToken()}`, 'x-ebay-c-marketplace-id': site },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  }).catch((error: unknown) => {
    throw new EbayUnavailableError(`eBay Browse failed: ${error instanceof Error ? error.message : 'unknown'}`);
  });
  if (response.status === 401) {
    tokenCache = null;
    throw new EbayUnavailableError('eBay rejected the app token');
  }
  if (!response.ok) throw new EbayUnavailableError(`eBay Browse returned ${response.status}`);
  const body = (await response.json().catch(() => null)) as { itemSummaries?: BrowseItem[] } | null;
  return Array.isArray(body?.itemSummaries) ? body.itemSummaries : [];
}

export interface EbaySellerFound {
  /** The seller's name as eBay spells it. */
  username: string;
  stats: EbayFeedback;
  context: EbayListingContext;
}

interface Accumulator {
  username: string;
  stats: EbayFeedback;
  titles: string[];
  countries: Set<string>;
  categories: Map<string, number>;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The named sellers that have live listings, with their feedback and what they list.
 * Keys are lower case. A name absent from the result is a seller with no live listings
 * (or no such account): the two cannot be told apart through this API.
 *
 * `stopAfterFirst` ends at the first round that finds anyone, for reading one known seller.
 * Throws `EbayUnavailableError` when eBay could not be read and nothing was found, so a
 * failure is never mistaken for "no such seller".
 */
export async function findEbaySellers(
  usernames: readonly string[],
  options: { stopAfterFirst?: boolean } = {},
): Promise<Map<string, EbaySellerFound>> {
  const wanted = new Set(usernames.map((name) => name.toLowerCase()));
  const found = new Map<string, EbaySellerFound>();
  const seen = new Map<string, Accumulator>();
  let failure: unknown = null;

  for (const term of SEARCH_TERMS) {
    const pending = Array.from(wanted).filter((name) => !found.has(name));
    if (pending.length === 0) break;

    for (const names of chunk(pending, MAX_SELLERS_PER_REQUEST)) {
      const rounds = await Promise.allSettled(SITES.map((site) => browse(site, term, names)));
      for (const round of rounds) {
        if (round.status === 'rejected') {
          failure ??= round.reason;
          continue;
        }
        for (const item of round.value) {
          const seller = parseEbaySeller(item.seller);
          if (!seller) continue;
          const key = seller.username.toLowerCase();
          // THE GUARD: an unknown name makes eBay return everything. Keep only who we asked for.
          if (!wanted.has(key)) continue;

          const entry =
            seen.get(key) ??
            ({
              username: seller.username,
              stats: {
                feedbackPercentage: seller.feedbackPercentage,
                feedbackScore: seller.feedbackScore,
                accountType: seller.accountType,
              },
              titles: [],
              countries: new Set<string>(),
              categories: new Map<string, number>(),
            } satisfies Accumulator);
          seen.set(key, entry);

          if (typeof item.title === 'string' && entry.titles.length < 12) {
            entry.titles.push(item.title.slice(0, MAX_TITLE_LENGTH));
          }
          const country = item.itemLocation?.country;
          if (typeof country === 'string' && /^[A-Z]{2}$/.test(country)) entry.countries.add(country);
          for (const category of item.categories ?? []) {
            if (typeof category.categoryName === 'string') {
              entry.categories.set(category.categoryName, (entry.categories.get(category.categoryName) ?? 0) + 1);
            }
          }
        }
      }
    }

    for (const [key, entry] of seen) {
      if (found.has(key)) continue;
      const categories = Array.from(entry.categories.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name)
        .slice(0, 3);
      found.set(key, {
        username: entry.username,
        stats: entry.stats,
        context: {
          sampleTitles: entry.titles.slice(0, 3),
          countries: Array.from(entry.countries).slice(0, 4),
          categories,
          sellsCards: sellsTradingCards(categories, entry.titles),
        },
      });
    }
    if (options.stopAfterFirst && found.size > 0) break;
  }

  if (found.size === 0 && failure) {
    throw failure instanceof EbayUnavailableError
      ? failure
      : new EbayUnavailableError(failure instanceof Error ? failure.message : 'eBay could not be read');
  }
  return found;
}

async function readRecord(username: string): Promise<ExternalRecordState> {
  const hit = (await findEbaySellers([username], { stopAfterFirst: true })).get(username.toLowerCase());
  const asOf = new Date().toISOString();
  return hit ? { state: 'FOUND', stats: hit.stats, asOf } : { state: 'NO_LISTINGS', asOf };
}

/**
 * Shared across requests for an hour. A thrown read is not cached by `unstable_cache`,
 * so an eBay outage is retried on the next page view rather than remembered.
 */
const readRecordCached = unstable_cache(readRecord, ['ebay-seller-record'], {
  tags: [EBAY_SELLER_CACHE_TAG],
  revalidate: RECORD_REVALIDATE_SECONDS,
});

/**
 * One account's public record, for a references page. Never throws: a page must render
 * with or without eBay, so a failure is logged and shown as `UNAVAILABLE`.
 */
export async function lookupEbayRecord(username: string): Promise<ExternalRecordState> {
  // Not configured is a setup state, not a failure worth a log line per page view.
  if (!ebayConfigured()) return { state: 'UNAVAILABLE' };
  try {
    return await readRecordCached(username.toLowerCase());
  } catch (error) {
    await logBackgroundFailure({
      name: 'references.ebayRecord',
      errorCode: error instanceof EbayUnavailableError ? 'EBAY_UNAVAILABLE' : 'EBAY_READ_FAILED',
      error,
    });
    return { state: 'UNAVAILABLE' };
  }
}
