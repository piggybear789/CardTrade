import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  PackageOpen,
  Search,
} from 'lucide-react';

import {
  getCatalogFacets,
  searchCatalog,
  type CatalogSort,
} from '@/lib/actions/listings';
import { getWatchingSet } from '@/lib/actions/watchlist';
import { createClient } from '@/lib/supabase/server';
import {
  CatalogActiveFilters,
  CatalogFilters,
  CatalogSortControl,
} from '@/components/listings/CatalogControls';
import { CatalogInfiniteGrid } from '@/components/listings/CatalogInfiniteGrid';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
import { SectionLoadError } from '@/components/layout/SectionHeader';

// Always render fresh — the catalog reflects live availability + URL filters
// (Req 3.8, Phase 7). Search/filter/sort/pagination are driven by search params.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Marketplace · NoDitto',
  description: 'Browse available collectibles for sale or trade.',
};

/** The set of sort keys we accept from the URL. */
const SORT_KEYS: CatalogSort[] = ['newest', 'price-asc', 'price-desc', 'rating'];

/** Locale-aware result counter (avoids hardcoded number formatting). */
const COUNT_FORMATTER = new Intl.NumberFormat('en-AU');

type RawSearchParams = Record<string, string | string[] | undefined>;

/** Coerce a repeatable param to the first string value (or ''). */
function firstString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

/** Parse repeatable or comma-separated category params into a unique list. */
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

/** Parse a dollars string into integer AUD cents (or `undefined` if invalid). */
function dollarsToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.round(num * 100);
}

/** Build a filter-preserving href for a target catalog page. */
function buildPageHref(raw: RawSearchParams, page: number): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(raw)) {
    if (key === 'page') continue;
    if (Array.isArray(value)) {
      for (const v of value) if (v) params.append(key, v);
    } else if (value) {
      params.set(key, value);
    }
  }

  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/listings?${qs}` : '/listings';
}
/**
 * Server-rendered browse surface for the AVAILABLE catalog (Req 3.8, Phase 7).
 * Filtering remains URL-driven and database-backed; only the controls hydrate.
 * Mobile appends pages via infinite scroll; desktop keeps page links.
 */
export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const q = firstString(raw.q).trim();
  const categories = parseCategories(raw.category);
  const minDollars = firstString(raw.min).trim();
  const maxDollars = firstString(raw.max).trim();
  const includeSold = firstString(raw.sold).trim() === '1';
  const sortRaw = firstString(raw.sort) as CatalogSort;
  const sort: CatalogSort = SORT_KEYS.includes(sortRaw) ? sortRaw : 'newest';
  const pageRaw = Number(firstString(raw.page));
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.trunc(pageRaw) : 1;
  const minCents = dollarsToCents(minDollars);
  const maxCents = dollarsToCents(maxDollars);

  const [result, facets] = await Promise.all([
    searchCatalog({
      q,
      categories,
      minCents,
      maxCents,
      includeSold,
      sort,
      page,
    }),
    getCatalogFacets(),
  ]);

  const items = result.ok ? result.items : [];
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Only decorate the heart for signed-in viewers; ownership is per-card.
  const watchingSet = user ? await getWatchingSet(items.map((i) => i.id)) : new Set<string>();
  const total = result.ok ? result.total : 0;
  const pageSize = result.ok ? result.pageSize : 24;
  const hasMore = result.ok ? result.hasMore : false;
  const currentPage = result.ok ? result.page : page;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = {
    q,
    categories,
    min: minDollars,
    max: maxDollars,
    includeSold,
  };
  const hasAnyFilter =
    q !== '' ||
    categories.length > 0 ||
    minDollars !== '' ||
    maxDollars !== '' ||
    includeSold;
  const resultTitle = q
    ? `Results for “${q}”`
    : categories.length === 1
      ? categories[0]
      : 'Today’s picks';

  const gridKey = [
    q,
    categories.join('\0'),
    minDollars,
    maxDollars,
    includeSold ? '1' : '0',
    sort,
    String(currentPage),
  ].join('|');

  return (
    <MarketplaceShell
      title="Marketplace"
      primaryAction={
        <RailPrimaryAction href="/listings/new">Create New Listing</RailPrimaryAction>
      }
      filters={<CatalogFilters facets={facets} current={current} />}
    >
      {!result.ok ? (
        <div className="mb-5">
          <SectionLoadError label="marketplace" />
        </div>
      ) : (
      <div aria-labelledby="catalog-heading" className="min-w-0">
          <header className="mb-3 border-b border-border/70 pb-3 sm:mb-4 sm:pb-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
              <div className="min-w-0">
                <h2
                  id="catalog-heading"
                  className="text-balance text-lg font-semibold tracking-[-0.025em] sm:text-2xl"
                >
                  {resultTitle}
                </h2>
                <p className="mt-0.5 text-[0.8125rem] text-muted-foreground" aria-live="polite">
                  {COUNT_FORMATTER.format(total)}{' '}
                  {total === 1 ? 'collectible' : 'collectibles'} available in Australia
                </p>
              </div>
              <CatalogSortControl current={sort} />
            </div>
            <CatalogActiveFilters current={current} />
          </header>

          {total === 0 ? (
            hasAnyFilter ? <NoMatches /> : <EmptyCatalog />
          ) : (
            <>
              <CatalogInfiniteGrid
                key={gridKey}
                initialItems={items}
                initialPage={currentPage}
                initialHasMore={hasMore}
                currentUserId={user?.id ?? null}
                initialWatchingIds={Array.from(watchingSet)}
                query={{
                  q,
                  categories,
                  minCents,
                  maxCents,
                  includeSold,
                  sort,
                }}
              />

              {totalPages > 1 ? (
                <nav
                  className="mt-10 hidden flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-6 sm:justify-center sm:gap-4 lg:flex"
                  aria-label="Marketplace pages"
                >
                  {currentPage <= 1 ? (
                    <Button variant="outline" disabled>
                      <ChevronLeft aria-hidden />
                      Previous
                    </Button>
                  ) : (
                    <Button asChild variant="outline">
                      <Link href={buildPageHref(raw, currentPage - 1)} rel="prev">
                        <ChevronLeft aria-hidden />
                        Previous
                      </Link>
                    </Button>
                  )}
                  <span className="text-sm font-medium tabular-nums text-muted-foreground" aria-live="polite">
                    Page {currentPage} of {totalPages}
                  </span>
                  {!hasMore ? (
                    <Button variant="outline" disabled>
                      Next
                      <ChevronRight aria-hidden />
                    </Button>
                  ) : (
                    <Button asChild variant="outline">
                      <Link href={buildPageHref(raw, currentPage + 1)} rel="next">
                        Next
                        <ChevronRight aria-hidden />
                      </Link>
                    </Button>
                  )}
                </nav>
              ) : null}
            </>
          )}
      </div>
      )}
    </MarketplaceShell>
  );
}

/** Shown when the entire catalog is empty (no AVAILABLE items, no filters). */
function EmptyCatalog() {
  return (
    <EmptyState
      icon={<PackageOpen className="size-6" aria-hidden />}
      title="The Marketplace Is Ready for Its First Listing"
      description="List a collectible for sale or trade and it will appear here."
      action={{ label: 'List an Item', href: '/listings/new' }}
      compact
    />
  );
}

/** Shown when the active search and filters exclude every item. */
function NoMatches() {
  return (
    <EmptyState
      icon={<Search className="size-6" aria-hidden />}
      title="No Collectibles Match These Filters"
      description="Broaden the price range, choose another category, or clear the filters to see more listings."
      action={{ label: 'Clear Filters', href: '/listings', variant: 'outline' }}
      compact
    />
  );
}
