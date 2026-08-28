// app/page.tsx
//
// The marketplace catalog IS the homepage. There is no separate marketing
// landing route: every authenticated path already terminated here (auth
// callback, email confirmation, onboarding completion), and a member who
// clicked the logo used to land on a pitch for a product they had already
// joined. `/listings` permanently redirects here — see `next.config.ts`.

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

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'NoDitto — Buy, sell, and swap trading cards',
  description:
    'Browse trading cards for sale or trade. Sellers verify with Stripe Identity, payments stay Stripe, and swaps are backed by collateral from both traders.',
  // The root layout no longer declares a blanket canonical, so the homepage
  // states its own.
  alternates: { canonical: '/' },
};

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
        <CatalogResults />
      </MarketplaceShell>
    </CatalogViewProvider>
  );
}
