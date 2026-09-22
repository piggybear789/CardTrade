// app/page.tsx
//
// The marketplace catalog IS the homepage. There is no separate marketing
// landing route: every authenticated path already terminated here (auth
// callback, email confirmation, onboarding completion), and a member who
// clicked the logo used to land on a pitch for a product they had already
// joined. `/listings` permanently redirects here — see `next.config.ts`.

import type { Metadata } from 'next';

import {
  getCatalogFacets,
  searchCatalog,
  type CatalogSort,
} from '@/lib/actions/listings';
import { getMyWatchingSet } from '@/lib/actions/watchlist';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { resolveBrowseRegion } from '@/lib/location/resolveRegion';
import { CatalogFilters } from '@/components/listings/CatalogControls';
import { CatalogResults } from '@/components/listings/CatalogResults';
import { CatalogViewProvider } from '@/components/listings/CatalogView';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
import { SectionLoadError } from '@/components/layout/SectionHeader';
import { JsonLd } from '@/components/seo/JsonLd';
import { DEFAULT_OG_IMAGE } from '@/lib/seo/site';
import { siteStructuredData } from '@/lib/seo/structuredData';

const BASE_DESCRIPTION =
  'Browse trading cards for sale or trade. Sellers verify with Stripe Identity, payments stay Stripe, and swaps are backed by collateral from both traders.';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
//
// GENERATED, NOT STATIC, BECAUSE THE CATALOG IS ONE ROUTE WITH UNBOUNDED URLS.
// `q`, `category`, `condition`, `min`, `max`, `sold`, `reserved`, `sort`, `page`
// and `region` combine into thousands of addressable permutations, and a static
// `metadata` gave every one of them the same title, the same description and a
// canonical pointing at `/`. Two separate problems came out of that:
//
//   * every filtered and paginated URL claimed to be a duplicate of the
//     homepage, so `?category=Pokémon` and `?page=4` asked to be dropped from
//     the index — including pages that are the only route to most of the stock,
//     since the pager only links one step either way
//   * Google's pagination guidance is explicitly that page 2 must NOT
//     canonicalise to page 1, because that hides everything only reachable
//     deeper in the chain
//
// So `category` and `page` survive into the canonical (they select genuinely
// different stock and deserve their own entries) and the rest is stripped, which
// consolidates sort orders and price bands onto one URL instead of competing
// with it.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const raw = await searchParams;
  const q = firstString(raw.q).trim();
  const categories = parseCategories(raw.category);
  const pageRaw = Number(firstString(raw.page));
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.trunc(pageRaw) : 1;

  // A SEARCH RESULTS PAGE IS NOT A PAGE. `?q=` is an internal search, and Google's
  // quality guidance treats indexed site-search results as thin, near-duplicate
  // content; left indexable, an unbounded space of them competes with the real
  // listings. `follow` stays on so the listings linked from a search result are
  // still discovered.
  //
  // NO CANONICAL ON THIS BRANCH, deliberately. `noindex` plus a canonical naming a
  // DIFFERENT url are contradictory instructions — one says drop this page, the
  // other says merge its signals into another — and Google resolves the conflict
  // unpredictably. Pick one; here it is `noindex`.
  if (q) {
    return {
      title: `Search · NoDitto`,
      description: BASE_DESCRIPTION,
      robots: { index: false, follow: true },
    };
  }

  const facet = categories.length === 1 ? categories[0] : null;
  const titleParts = [facet, page > 1 ? `Page ${page}` : null].filter(Boolean);
  const title = titleParts.length > 0 ? `${titleParts.join(' · ')} · NoDitto` : 'NoDitto';

  const canonicalParams = new URLSearchParams();
  for (const category of categories) canonicalParams.append('category', category);
  if (page > 1) canonicalParams.set('page', String(page));
  const query = canonicalParams.toString();

  return {
    title,
    description: facet
      ? `Buy, sell and swap ${facet} on NoDitto. Every seller passes a Stripe Identity check and your payment is held until you accept the card.`
      : BASE_DESCRIPTION,
    alternates: { canonical: query ? `/?${query}` : '/' },
    openGraph: {
      title,
      description: BASE_DESCRIPTION,
      url: query ? `/?${query}` : '/',
      // Restated rather than inherited: setting `openGraph` at all replaces the
      // root's resolved value, so omitting this would leave the most-shared URL on
      // the site with no social card.
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

const SORT_KEYS: CatalogSort[] = ['newest', 'price-asc', 'price-desc', 'rating'];

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function parseCategories(value: string | string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value != null ? [value] : [];
  const out = new Set<string>();
  for (const entry of raw) {
    for (const part of entry.split(',')) {
      const trimmed = part.trim();
      if (trimmed) out.add(trimmed);
    }
  }
  return Array.from(out);
}

function dollarsToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.round(num * 100);
}

/**
 * First paint is still server-rendered so a shared `/?category=` link shows the
 * right grid. After that, pills / sort / filters / paging stay on the client so
 * the page is not torn down on every click.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const q = firstString(raw.q).trim();
  const categories = parseCategories(raw.category);
  const conditions = parseCategories(raw.condition);
  const minDollars = firstString(raw.min).trim();
  const maxDollars = firstString(raw.max).trim();
  const includeSold = firstString(raw.sold).trim() === '1';
  const includeReserved = firstString(raw.reserved).trim() === '1';
  const sortRaw = firstString(raw.sort) as CatalogSort;
  const sort: CatalogSort = SORT_KEYS.includes(sortRaw) ? sortRaw : 'newest';
  const pageRaw = Number(firstString(raw.page));
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.trunc(pageRaw) : 1;
  const minCents = dollarsToCents(minDollars);
  const maxCents = dollarsToCents(maxDollars);
  const regionParam = firstString(raw.region).trim() || null;

  const userPromise = getCachedAuthUser();
  const region = await resolveBrowseRegion(raw.region);

  const watchingPromise = userPromise.then((user) =>
    user ? getMyWatchingSet() : new Set<string>(),
  );

  const [result, facets, user, watchingSet] = await Promise.all([
    searchCatalog({
      q,
      categories,
      conditions,
      minCents,
      maxCents,
      includeSold,
      includeReserved,
      sort,
      page,
      regionCode: region.code,
    }),
    getCatalogFacets(region.code),
    userPromise,
    watchingPromise,
  ]);

  const items = result.ok ? result.items : [];

  const shell = {
    title: 'Marketplace' as const,
    // `lg` here and nowhere else. The catalog is the one section where the rail
    // CTA is outgunned by the content beside it — a full grid of card imagery —
    // and it is the action the whole marketplace exists to collect. This route
    // passes no `mobileAction`, so the override lands on desktop only.
    primaryAction: (
      <RailPrimaryAction href="/listings/new" size="lg">
        Create New Listing
      </RailPrimaryAction>
    ),
  };

  if (!result.ok) {
    return (
      <MarketplaceShell {...shell}>
        <div className="mb-5">
          <SectionLoadError label="marketplace" />
        </div>
      </MarketplaceShell>
    );
  }

  return (
    <CatalogViewProvider
      initial={{
        items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
        hasMore: result.hasMore,
        matchedQuery: result.matchedQuery,
        watchingIds: items.filter((item) => watchingSet.has(item.id)).map((item) => item.id),
        currentUserId: user?.id ?? null,
        regionCode: region.code,
        regionParam,
        facets,
        current: {
          q,
          categories,
          conditions,
          min: minDollars,
          max: maxDollars,
          includeSold,
          includeReserved,
          sort,
          page: result.page,
        },
      }}
    >
      <MarketplaceShell {...shell} filters={<CatalogFilters />}>
        {/* Site-level identity, emitted once from the catalog rather than the root
            layout: the layout also wraps the signed-in transactional routes, and
            an Organization block on a contract room is markup for a page no
            crawler may read. The SearchAction targets the real `?q=` param. */}
        <JsonLd data={siteStructuredData()} />
        <CatalogResults />
      </MarketplaceShell>
    </CatalogViewProvider>
  );
}
