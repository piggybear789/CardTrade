'use client';

import { ViewTransition } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronLeftIcon, ChevronRightIcon, PackageOpenIcon, Search01Icon } from '@hugeicons/core-free-icons';

import { useIsDesktop } from '@/components/layout/Breakpoint';
import { CatalogSortControl } from '@/components/listings/CatalogControls';
import { CatalogInfiniteGrid } from '@/components/listings/CatalogInfiniteGrid';
import { GenrePills } from '@/components/listings/GenrePills';
import {
  CatalogResultCount,
  useCatalogView,
  type CatalogBrowseCurrent,
} from '@/components/listings/CatalogView';
import type { CatalogItem } from '@/lib/actions/listings';
import { CARD_GAMES } from '@/lib/catalog/cardGames';
import { regionLabel } from '@/domain/region';
import { ALL_REGIONS } from '@/lib/location/regionParams';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

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
    error,
    retry,
  } = useCatalogView();
  const isDesktop = useIsDesktop();

  const hasAnyFilter =
    settled.q !== '' ||
    settled.categories.length > 0 ||
    settled.conditions.length > 0 ||
    settled.min !== '' ||
    settled.max !== '' ||
    settled.includeSold ||
    settled.includeReserved;

  const resultTitle = settled.q
    ? settled.q
    : settled.categories.length === 1
      ? settled.categories[0]
      : 'All Listings';

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const closerNote = result.matchedQuery
    ? `Showing closer matches for “${result.matchedQuery}”`
    : undefined;

  return (
    <div
      role="region"
      aria-label={resultTitle}
      className="min-w-0 max-md:bg-background"
    >
      <header className="mb-group bg-background pb-0 sm:mb-4 sm:border-b sm:border-border md:bg-transparent sm:pb-4">
        <div className="flex flex-col gap-group sm:gap-3">
          {/* `sm:flex-wrap` is kept as a floor even though sort is the only
              control left here: a long single-category title plus a 180px
              select can still outgrow a narrow desktop column, and without wrap
              the only give is the title's `min-w-0`, which breaks the heading
              across lines to keep the select beside it. */}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <h2 className="text-balance text-subhead font-semibold tracking-[-0.025em] md:text-head">
                {resultTitle}
              </h2>
              <CatalogResultCount note={closerNote} />
            </div>
            {/* Sort only. It belongs beside the result count — the thing being
                ordered is on screen — whereas the keyword filter belongs with
                the other filters and now lives in the rail. Below `md` the rail
                is gone and sort lives in the filter sheet, which is why this
                group is desktop-only. */}
            <div className="hidden min-w-0 md:flex md:flex-wrap md:items-center md:justify-end md:gap-2">
              {result.total > 0 ? <CatalogSortControl /> : null}
            </div>
          </div>
          <GenrePills
            selected={current.categories}
            onSelect={selectGame}
            games={PILL_GAMES}
          />
        </div>
      </header>

      {/* The controls have already rolled back to the query the grid below is
          actually showing, so this only has to explain and offer another go. */}
      {error ? (
        <div
          role="alert"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-group py-cozy"
        >
          <p className="text-body text-foreground">
            {error} Showing your previous results.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retry}
            disabled={isPending}
          >
            Try again
          </Button>
        </div>
      ) : null}

      <div
        aria-busy={isPending}
        className={cn(
          'motion-safe:transition-opacity motion-safe:duration-300 motion-safe:ease-out',
          isPending && 'opacity-70 pointer-events-none',
        )}
      >
        {isDesktop ? (
          <ViewTransition
            key={revision}
            name="catalog-grid"
            share="auto"
            default="none"
          >
            <CatalogGridBody
              result={result}
              revision={revision}
              current={current}
              currentUserId={currentUserId}
              regionCode={regionCode}
              hasAnyFilter={hasAnyFilter}
            />
          </ViewTransition>
        ) : (
          <CatalogGridBody
            result={result}
            revision={revision}
            current={current}
            currentUserId={currentUserId}
            regionCode={regionCode}
            hasAnyFilter={hasAnyFilter}
          />
        )}
      </div>

      {result.total > 0 && totalPages > 1 ? (
        <nav
          className="mt-10 hidden flex-wrap items-center justify-between gap-3 border-t border-border pt-6 sm:justify-center sm:gap-4 md:flex"
          aria-label="Marketplace pages"
        >
          {result.page > 1 ? (
            <Button asChild variant="outline">
              <Link href={hrefForPage(result.page - 1)} prefetch={false}>
                <HugeiconsIcon icon={ChevronLeftIcon} aria-hidden />
                Previous
              </Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              <HugeiconsIcon icon={ChevronLeftIcon} aria-hidden />
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
                <HugeiconsIcon icon={ChevronRightIcon} aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              Next
              <HugeiconsIcon icon={ChevronRightIcon} aria-hidden />
            </Button>
          )}
        </nav>
      ) : null}
    </div>
  );
}

function CatalogGridBody({
  result,
  revision,
  current,
  currentUserId,
  regionCode,
  hasAnyFilter,
}: {
  result: {
    items: CatalogItem[];
    total: number;
    page: number;
    hasMore: boolean;
    watchingIds: string[];
  };
  revision: number;
  current: CatalogBrowseCurrent;
  currentUserId: string | null;
  regionCode: string | null;
  hasAnyFilter: boolean;
}) {
  if (result.total === 0) {
    if (hasAnyFilter) return <NoMatches regionCode={regionCode} />;
    if (regionCode == null) return <EmptyCatalog />;
    return <EmptyRegion regionCode={regionCode} />;
  }

  return (
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
        includeReserved: current.includeReserved,
        sort: current.sort,
        regionCode,
      }}
    />
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
      icon={<HugeiconsIcon icon={PackageOpenIcon} className="size-6" aria-hidden />}
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
      icon={<HugeiconsIcon icon={PackageOpenIcon} className="size-6" aria-hidden />}
      title={`Nothing Listed in ${regionLabel(regionCode)} Yet`}
      description={`Listings stay in ${regionLabel(regionCode)}, because a deal completes in one region. Browse every region, or list the first item from Sell.`}
      action={{
        label: 'Browse All Regions',
        href: `/?region=${ALL_REGIONS}`,
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
    !settled.includeSold &&
    !settled.includeReserved;

  return (
    <EmptyState
      icon={<HugeiconsIcon icon={Search01Icon} className="size-6" aria-hidden />}
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
