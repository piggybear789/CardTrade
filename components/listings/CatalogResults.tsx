'use client';

import { ViewTransition } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  PackageOpen,
  Search,
} from 'lucide-react';

import {
  CatalogActiveFilters,
  CatalogFilterSearch,
  CatalogSortControl,
} from '@/components/listings/CatalogControls';
import { CatalogInfiniteGrid } from '@/components/listings/CatalogInfiniteGrid';
import { GenrePills } from '@/components/listings/GenrePills';
import { CatalogResultCount, useCatalogView } from '@/components/listings/CatalogView';
import { CARD_GAMES } from '@/lib/catalog/cardGames';
import { regionLabel } from '@/domain/region';
import { ALL_REGIONS } from '@/lib/location/regionParams';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

const PILL_GAMES = CARD_GAMES.map((game) => ({
  slug: game.slug,
  name: game.name,
}));

export function CatalogResults() {
  const {
    current,
    settled,
    result,
    revision,
    isPending,
    currentUserId,
    regionCode,
    selectGame,
    hrefForPage,
  } = useCatalogView();

  const hasAnyFilter =
    settled.q !== '' ||
    settled.categories.length > 0 ||
    settled.conditions.length > 0 ||
    settled.min !== '' ||
    settled.max !== '' ||
    settled.includeSold;

  const resultTitle = settled.q
    ? settled.q
    : settled.categories.length === 1
      ? settled.categories[0]
      : 'All listings';

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const closerNote = result.matchedQuery
    ? `Showing closer matches for “${result.matchedQuery}”`
    : undefined;

  return (
    <div
      role="region"
      aria-labelledby="catalog-heading"
      className="min-w-0"
    >
      <header className="mb-3 border-b border-border pb-3 sm:mb-4 sm:pb-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h2
                id="catalog-heading"
                className="text-balance text-head font-semibold tracking-[-0.025em]"
              >
                {resultTitle}
              </h2>
              <CatalogResultCount note={closerNote} />
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
              {result.total > 0 ? <CatalogFilterSearch /> : null}
              <div className="min-w-0 md:hidden">
                <CatalogSortControl />
              </div>
            </div>
          </div>
          <GenrePills
            selected={current.categories}
            onSelect={selectGame}
            games={PILL_GAMES}
          />
          <CatalogActiveFilters />
        </div>
      </header>

      <div
        className={
          isPending
            ? 'opacity-70 motion-safe:transition-opacity motion-safe:duration-500 motion-safe:ease-out'
            : 'motion-safe:transition-opacity motion-safe:duration-500 motion-safe:ease-out'
        }
      >
        <ViewTransition
          key={revision}
          name="catalog-grid"
          share="auto"
          default="none"
        >
          {result.total === 0 ? (
            hasAnyFilter ? (
              <NoMatches regionCode={regionCode} />
            ) : regionCode == null ? (
              <EmptyCatalog />
            ) : (
              <EmptyRegion regionCode={regionCode} />
            )
          ) : (
            <CatalogInfiniteGrid
              revision={revision}
              initialItems={result.items}
              initialPage={result.page}
              initialHasMore={result.hasMore}
              currentUserId={currentUserId}
              initialWatchingIds={result.watchingIds}
              query={{
                q: current.q,
                categories: current.categories,
                conditions: current.conditions,
                minCents: dollarsToCents(current.min),
                maxCents: dollarsToCents(current.max),
                includeSold: current.includeSold,
                sort: current.sort,
                regionCode,
              }}
            />
          )}
        </ViewTransition>
      </div>

      {result.total > 0 && totalPages > 1 ? (
        <nav
          className="mt-10 hidden flex-wrap items-center justify-between gap-3 border-t border-border pt-6 sm:justify-center sm:gap-4 md:flex"
          aria-label="Marketplace pages"
        >
          {result.page > 1 ? (
            <Button asChild variant="outline">
              <Link href={hrefForPage(result.page - 1)} prefetch={false}>
                <ChevronLeft aria-hidden />
                Previous
              </Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              <ChevronLeft aria-hidden />
              Previous
            </Button>
          )}
          <span className="text-body font-medium tabular-nums text-muted-foreground">
            Page {result.page} of {totalPages}
          </span>
          {result.hasMore ? (
            <Button asChild variant="outline">
              <Link href={hrefForPage(result.page + 1)} prefetch={false}>
                Next
                <ChevronRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              Next
              <ChevronRight aria-hidden />
            </Button>
          )}
        </nav>
      ) : null}
    </div>
  );
}

function dollarsToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return undefined;
  return Math.round(num * 100);
}

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

function EmptyRegion({ regionCode }: { regionCode: string }) {
  return (
    <EmptyState
      icon={<PackageOpen className="size-6" aria-hidden />}
      title={`Nothing Listed in ${regionLabel(regionCode)} Yet`}
      description={`Listings stay in ${regionLabel(regionCode)}, because a deal completes in one region. Browse every region, or list the first item from Sell.`}
      action={{
        label: 'Browse All Regions',
        href: `/listings?region=${ALL_REGIONS}`,
        variant: 'outline',
      }}
      compact
    />
  );
}

function NoMatches({ regionCode }: { regionCode: string | null }) {
  const { apply, reset, settled, isPending } = useCatalogView();
  const scope = regionCode ? ` in ${regionLabel(regionCode)}` : '';
  const isSearch = settled.q !== '';
  const onlySearch =
    isSearch &&
    settled.categories.length === 0 &&
    settled.conditions.length === 0 &&
    settled.min === '' &&
    settled.max === '' &&
    !settled.includeSold;

  return (
    <EmptyState
      icon={<Search className="size-6" aria-hidden />}
      title={isSearch ? 'No Listings Match This Search' : 'No Collectibles Match These Filters'}
      description={
        isSearch
          ? `Nothing${scope} uses those words. Try the player or card name, or pick a game above.`
          : `Nothing${scope} matches. Broaden the price range or clear the filters to see more listings.`
      }
      action={{
        label: onlySearch ? 'Clear Search' : 'Clear Filters',
        onClick: onlySearch ? () => apply({ q: null }) : reset,
        disabled: isPending,
        variant: 'outline',
      }}
      compact
    />
  );
}
