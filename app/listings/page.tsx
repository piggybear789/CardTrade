import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  PackageOpen,
  Plus,
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
import { ItemCard } from '@/components/listings/ItemCard';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';

// Always render fresh — the catalog reflects live availability + URL filters
// (Req 3.8, Phase 7). Search/filter/sort/pagination are driven by search params.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Marketplace · Poke-xchange',
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
 */
export default async function ListingsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const raw = await searchParams;
  const q = firstString(raw.q).trim();
  const categories = parseCategories(raw.category);
  const condition = firstString(raw.condition).trim();
  const minDollars = firstString(raw.min).trim();
  const maxDollars = firstString(raw.max).trim();
  const verifiedOnly = firstString(raw.verified).trim() === '1';
  const sortRaw = firstString(raw.sort) as CatalogSort;
  const sort: CatalogSort = SORT_KEYS.includes(sortRaw) ? sortRaw : 'newest';
  const pageRaw = Number(firstString(raw.page));
  const page = Number.isFinite(pageRaw) && pageRaw > 1 ? Math.trunc(pageRaw) : 1;

  const [result, facets] = await Promise.all([
    searchCatalog({
      q,
      categories,
      condition,
      minCents: dollarsToCents(minDollars),
      maxCents: dollarsToCents(maxDollars),
      verifiedOnly,
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
    condition,
    min: minDollars,
    max: maxDollars,
    verifiedOnly,
  };
  const hasAnyFilter =
    q !== '' ||
    categories.length > 0 ||
    condition !== '' ||
    minDollars !== '' ||
    maxDollars !== '' ||
    verifiedOnly;
  const resultTitle = q
    ? `Results for “${q}”`
    : categories.length === 1
      ? categories[0]
      : 'Today’s picks';

  return (
    <MarketplaceShell
      title="Marketplace"
      primaryAction={
        <Button
          asChild
          variant="outline"
          className="w-full border-gold/45 bg-gold/12 text-foreground hover:border-gold/60 hover:bg-gold/20"
        >
          <Link href="/listings/new">
            <Plus aria-hidden="true" className="text-gold" />
            Create New Listing
          </Link>
        </Button>
      }
      filters={<CatalogFilters facets={facets} current={current} />}
    >
      {!result.ok ? (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          We couldn&apos;t load the marketplace right now. Try again shortly.
        </p>
      ) : (
      <div aria-labelledby="catalog-heading" className="min-w-0">
          <header className="mb-4 border-b border-border/70 pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0">
                <h2
                  id="catalog-heading"
                  className="text-balance text-xl font-semibold tracking-[-0.025em] sm:text-2xl"
                >
                  {resultTitle}
                </h2>
                <p className="mt-1 text-[0.8125rem] text-muted-foreground" aria-live="polite">
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
              {/* Column count follows the available width, not the viewport.
                  Fixed breakpoints fought the workspace rail: the grid stepped
                  3 -> 4 columns at `lg`, the same point the rail claims its
                  slice, so cards were squeezed hardest exactly there. auto-fill
                  keeps tile size stable and lets the count fall out of the real
                  content box at every size. */}
              <div className="grid gap-x-4 gap-y-6 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]">
                {items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    variant="catalog"
                    initialWatching={
                      user && item.owner_id !== user.id
                        ? watchingSet.has(item.id)
                        : undefined
                    }
                  />
                ))}
              </div>

              {totalPages > 1 ? (
                <nav
                  className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-6 sm:justify-center sm:gap-4"
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
