// app/loading.tsx
//
// Fallback for `/`, which is the marketplace catalog. Mirrors the live page:
// MarketplaceShell chrome, the result-count header, the genre strip, and the
// catalog grid, so swapping in real content doesn't shift the layout.
//
// Every other segment ships its own `loading.tsx`, so this boundary only ever
// covers the homepage.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import { CatalogGridSkeleton } from '@/components/layout/WorkspaceSkeletons';

/**
 * DESKTOP ONLY, and that is the whole point.
 *
 * This used to open with a `md:hidden` block drawing a search field and a
 * Filters button — 64px of toolbar above the results on every phone load, which
 * then vanished. The live page prints nothing there: `CatalogFilters` puts every
 * phone control inside a `Sheet` that starts closed, and a closed sheet renders
 * no DOM, while the keyword field is wrapped in `DesktopOnly`. The rail below is
 * the only thing this placeholder has ever stood for.
 */
function FilterRailSkeleton() {
  return (
    <div className="hidden min-w-0 flex-col gap-3 border-t border-border pt-5 md:flex">
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-24 w-full rounded-md" />
      {/* Price: label + readout row, track, then the bound captions. */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-2 w-full rounded-full" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

/**
 * `GenrePills`' phone strip: a 56px band of self-sizing cells, scrolled under a
 * chevron pinned to the right edge.
 *
 * It was five `h-11` tiles in a `gap-0.5` row. Three things wrong with that: the
 * band is `h-14`, not `h-11`, so the grid below sat 12px high; the real cells
 * carry no gap between them (they space themselves with `px-2`); and the strip
 * is pulled 8px left into the page gutter so "All" does not park mid-tile.
 */
function GenreStripSkeleton() {
  return (
    <div className="relative h-14 md:hidden">
      <div className="-ml-2 flex h-14 w-[calc(100%+0.5rem)] min-w-0 overflow-hidden pr-12">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="grid h-14 min-w-14 shrink-0 place-content-center place-items-center gap-0.5 px-2"
          >
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
      <Skeleton className="absolute right-0 top-1.5 size-11 rounded-full" />
    </div>
  );
}

export default function HomeLoading() {
  return (
    <MarketplaceShellSkeleton
      title="Marketplace"
      primaryAction={
        <RailPrimaryAction href="/listings/new" size="lg">
          Create New Listing
        </RailPrimaryAction>
      }
      filters={<FilterRailSkeleton />}
    >
      <div className="min-w-0">
        {/* Header geometry is `CatalogResults`', term for term. The rule and its
            16px of padding are `sm:` — below 640px the header has neither, and
            drawing them cost every phone 17px on swap. */}
        <header className="mb-group bg-background pb-0 sm:mb-4 sm:border-b sm:border-border sm:pb-4 md:bg-transparent">
          <div className="flex flex-col gap-group sm:gap-3">
            {/* A column below `sm`, a row above it. This was a row at every
                width with a 144px sort placeholder pinned to the right — but
                sort is `md:flex`, so on a phone that block was pure invention
                and it took ~160px of width off the title beside it. */}
            <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <TextLines
                  className="text-subhead md:text-head"
                  widths={['w-40']}
                />
                {/* The result count is `sr-only` below `sm`, so it occupies no
                    space there either. */}
                <TextLines
                  className="hidden text-body sm:block"
                  widths={['w-52']}
                />
              </div>
              <Skeleton className="hidden h-9 w-36 shrink-0 rounded-md md:block" />
            </div>
            <GenreStripSkeleton />
            <div className="hidden min-w-0 gap-1.5 overflow-hidden md:flex">
              <Skeleton className="h-7 w-10 shrink-0 rounded-full" />
              <Skeleton className="h-7 w-20 shrink-0 rounded-full" />
              <Skeleton className="h-7 w-24 shrink-0 rounded-full" />
              <Skeleton className="h-7 w-16 shrink-0 rounded-full" />
            </div>
          </div>
        </header>

        <CatalogGridSkeleton count={12} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
