'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import { Icon } from '@/components/ui/icon';
import { MagnifyingGlassIcon, PackageIcon } from '@/components/ui/icons';

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
import { isTradingRegion, regionLabel } from '@/domain/region';
import { ALL_REGIONS } from '@/lib/location/regionParams';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

const CATALOG_ERROR_TOAST = 'catalog-filter-error';

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
    error,
    retry,
  } = useCatalogView();

  // A FAILED FILTER IS A TOAST, NOT A BANNER. It used to be a bordered alert inserted
  // between the results header and the grid when the fetch came back, pushing every
  // tile down ~56px a second or more after the member's click. The controls have
  // already rolled back to the query the grid is showing, so all this needs to do is
  // explain and offer another go — which a toast with an action does without moving
  // anything. A stable id keeps repeated failures to one toast.
  useEffect(() => {
    if (!error) {
      toast.dismiss(CATALOG_ERROR_TOAST);
      return;
    }
    toast.error(`${error} Showing your previous results.`, {
      id: CATALOG_ERROR_TOAST,
      action: { label: 'Try again', onClick: retry },
    });
  }, [error, retry]);

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
      : 'All listings';

  const closerNote = result.matchedQuery
    ? `Showing closer matches for “${result.matchedQuery}”`
    : undefined;

  return (
    <div
      role="region"
      aria-label={resultTitle}
      // A column, so an empty catalog can take the space the grid would have had and
      // centre in it (see `fill` on EmptyState). With a grid present it is inert:
      // header and grid stack the same either way.
      className="flex min-h-0 min-w-0 flex-1 flex-col max-md:bg-background"
    >
      <header className="mb-group bg-background pb-0 sm:mb-group sm:border-b sm:border-border md:bg-transparent sm:pb-group">
        <div className="flex flex-col gap-group sm:gap-cozy">
          {/* `sm:flex-wrap` is kept as a floor even though sort is the only
              control left here: a long single-category title plus a 180px
              select can still outgrow a narrow desktop column, and without wrap
              the only give is the title's `min-w-0`, which breaks the heading
              across lines to keep the select beside it. */}
          <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-group">
            <div className="min-w-0">
              {/* Title and count on ONE BASELINE. `items-baseline` rather than
                  `items-center`, because the two are different sizes and centring them
                  leaves the count floating above the title's baseline. */}
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-cozy gap-y-0.5">
                {/* Same register as `SectionHeader`: 28px bold from `md`. */}
                <h2 className="text-balance text-head font-bold tracking-[-0.025em] md:text-display">
                  {resultTitle}
                </h2>
                <CatalogResultCount />
              </div>
              {closerNote ? (
                <p className="mt-0.5 text-pretty text-meta text-muted-foreground sm:text-body">
                  {closerNote}
                </p>
              ) : null}
            </div>
            {/* Sort only. It belongs beside the result count — the thing being
                ordered is on screen — whereas the keyword filter belongs with
                the other filters and now lives in the rail. Below `md` the rail
                is gone and sort lives in the filter sheet, which is why this
                group is desktop-only. */}
            {/* The sort stays MOUNTED with no results, only hidden: taking it out of
                the row made the row 10px shorter, so the game pills and everything
                under them jumped up the moment a filter matched nothing. */}
            <div
              className={cn(
                'hidden min-w-0 md:flex md:flex-wrap md:items-center md:justify-end md:gap-snug',
                result.total === 0 && 'invisible',
              )}
              aria-hidden={result.total === 0 || undefined}
            >
              <CatalogSortControl />
            </div>
          </div>
          <GenrePills
            selected={current.categories}
            onSelect={selectGame}
            games={PILL_GAMES}
          />
        </div>
      </header>


      <div
        aria-busy={isPending}
        className={cn(
          // Second link in the chain that carries the column's leftover height down to
          // an empty-catalog state. A grid child keeps its natural height.
          'flex min-h-0 flex-1 flex-col',
          'motion-safe:transition-opacity motion-safe:duration-150',
          isPending && 'opacity-70 pointer-events-none',
        )}
      >
        {/* No cross-fade between filter results: the grid swaps instantly.
            Infinite scroll at every width; a new query resets the list through
            `revision` rather than a remount. */}
        <CatalogGridBody
          result={result}
          revision={revision}
          current={current}
          currentUserId={currentUserId}
          regionCode={regionCode}
          hasAnyFilter={hasAnyFilter}
        />
      </div>
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
        savedOnly: current.savedOnly,
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

/** The one call to action an empty marketplace has, worded the same everywhere. */
const ADD_LISTING_ACTION = { label: 'Add a listing', href: '/listings/new' } as const;

function EmptyCatalog() {
  return (
    <EmptyState
      icon={<Icon icon={PackageIcon} className="size-6" aria-hidden />}
      title="Be the first to list"
      action={ADD_LISTING_ACTION}
      compact
      fill
    />
  );
}

/**
 * An empty catalog scoped to one region.
 *
 * TWO STATES, BECAUSE THE VISITOR CAN DO TWO DIFFERENT THINGS. In a region that is
 * open for deals the only useful answer is the button: this used to lead with
 * "Nothing listed in Australia yet" and a paragraph about regional scoping, which
 * told a member with something to sell what they could already see. In a region
 * that is NOT open there is nothing to add — a listing there could never be bought
 * — so that state says why and points at the regions that do have listings.
 */
function EmptyRegion({ regionCode }: { regionCode: string }) {
  if (isTradingRegion(regionCode)) {
    return (
      <EmptyState
        icon={<Icon icon={PackageIcon} className="size-6" aria-hidden />}
        title="Be the first to list"
        action={ADD_LISTING_ACTION}
        compact
        fill
      />
    );
  }

  return (
    <EmptyState
      icon={<Icon icon={PackageIcon} className="size-6" aria-hidden />}
      title={`NoDitto isn't open in ${regionLabel(regionCode)} yet`}
      description="You can browse what other regions have listed, but a deal only completes in a region that is open."
      action={{
        label: 'Browse all regions',
        href: `/?region=${ALL_REGIONS}`,
        variant: 'secondary',
      }}
      compact
      fill
    />
  );
}

/** The games offered as a way out of a zero-result search: the most listed first. */
const ESCAPE_GAMES = CARD_GAMES.slice(0, 4);

function NoMatches({ regionCode }: { regionCode: string | null }) {
  const { apply, reset, settled, isPending, selectGame } = useCatalogView();
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
      icon={<Icon icon={MagnifyingGlassIcon} className="size-6" aria-hidden />}
      title={isSearch ? 'No listings match this search' : 'No collectibles match these filters'}
      description={
        <>
          {isSearch
            ? `Nothing${scope} uses those words. Try the player or card name, or browse a game.`
            : `Nothing${scope} matches. Broaden the price range or clear the filters to see more listings.`}
          {/* A WAY FORWARD, NOT ONLY A WAY BACK. Clear undoes; a game chip goes
              somewhere. Picking one from a failed search drops the words, the same
              escape hatch the game pills above already behave as. */}
          {isSearch ? (
            <span className="mt-cozy flex flex-wrap justify-center gap-snug" role="group" aria-label="Browse a game">
              {ESCAPE_GAMES.map((game) => (
                <Button
                  key={game.slug}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isPending}
                  onClick={() => selectGame(game.name)}
                >
                  {game.name}
                </Button>
              ))}
            </span>
          ) : null}
        </>
      }
      action={{
        label: onlySearch ? 'Clear search' : 'Clear filters',
        onClick: onlySearch ? () => apply({ q: null }) : reset,
        disabled: isPending,
        variant: 'secondary',
      }}
      compact
      fill
    />
  );
}
