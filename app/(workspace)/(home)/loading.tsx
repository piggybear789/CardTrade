// app/(workspace)/(home)/loading.tsx
//
// Fallback for `/`, which is the marketplace catalog. Mirrors the live page:
// MarketplaceShell chrome, the result-count header, the genre strip, and the
// catalog grid, so swapping in real content doesn't shift the layout.
//
// IN ITS OWN ROUTE GROUP, and that is load-bearing. This file used to sit at
// `app/(workspace)/loading.tsx`, beside the home `page.tsx` — which made it the
// Suspense fallback for the WHOLE workspace group, not just the homepage. Every
// sibling route has its own `loading.tsx`, but that file only exists on the
// client once the route's payload has been fetched; until then the nearest
// boundary above it is what renders. So tapping Account from the hub drew twelve
// catalog tiles, then swapped to the account skeleton. `(home)` scopes this to
// `/`. There is deliberately NO group-level fallback above it — see
// `.kiro/steering/structure.md` on why `app/(workspace)/loading.tsx` must not exist.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import { CatalogGridSkeleton } from '@/components/layout/catalogSkeletons';

/**
 * DESKTOP ONLY, and that is the whole point.
 *
 * This used to open with a `md:hidden` block drawing a search field and a
 * Filters button — 64px of toolbar above the results on every phone load, which
 * then vanished. The live page prints nothing there: `CatalogFilters` puts every
 * phone control inside a `Sheet` that starts closed, and a closed sheet renders
 * no DOM, while the keyword field is wrapped in `DesktopOnly`. The rail below is
 * the only thing this placeholder has ever stood for.
 *
 * BLOCK FOR BLOCK `CatalogFilters`' desktop panel: `mt-group space-y-5`, the
 * 36px filter field, Condition as a CLOSED disclosure (it opens on mount only
 * when the URL already filters by condition), Price, then Availability. It used
 * to be a `border-t pt-5` column of five generic slabs — a 96px box standing for
 * a 45px disclosure, three thin bars standing for a 190px price block, and two
 * 36px slabs for an Availability group whose label it never drew — so the whole
 * rail rearranged itself on swap.
 */
function FilterRailSkeleton() {
  return (
    <div className="hidden min-w-0 md:block">
      <div className="mt-group space-y-5">
        <Skeleton className="h-9 w-full rounded-md" />

        {/* Condition, collapsed: `border-t pt-snug`, then the trigger at
            `py-1.5` around one `text-body` line inside a 1px transparent border. */}
        <div className="border-t border-border pt-snug">
          <div className="flex items-center justify-between gap-snug border border-transparent py-1.5">
            <TextLines className="text-body" widths={['w-20']} />
            <Skeleton className="size-4 shrink-0 rounded-sm" />
          </div>
        </div>

        {/* Price: label + readout on one `text-body` line, the 32px histogram,
            the slider (24px thumb inside `py-snug`), the bound captions, then the
            typed min/max pair. */}
        <div className="border-t border-border pt-group">
          <div className="mb-cozy flex items-baseline justify-between gap-snug">
            <TextLines className="text-body" widths={['w-10']} />
            <TextLines className="text-body" widths={['w-20']} />
          </div>
          <div className="flex h-8 items-end gap-px px-cozy" aria-hidden="true">
            {[40, 70, 100, 55, 30, 20, 12, 8].map((height, index) => (
              <Skeleton
                key={index}
                className="min-w-0 flex-1 rounded-none rounded-t-[2px]"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div className="box-content flex h-6 items-center px-tight py-snug">
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
          <div className="mt-tight flex justify-between">
            <TextLines className="text-meta" widths={['w-6']} />
            <TextLines className="text-meta" widths={['w-12']} />
          </div>
          <div className="mt-cozy flex items-center gap-snug">
            <Skeleton className="h-8 min-w-0 flex-1 rounded-md" />
            <TextLines className="text-meta" widths={['w-3']} />
            <Skeleton className="h-8 min-w-0 flex-1 rounded-md" />
          </div>
        </div>

        {/* Availability: a `market-label` caption over two check rows
            (`px-cozy py-snug` around a 16px box and one `text-body` line). */}
        <div className="border-t border-border pt-group">
          <TextLines className="mb-snug text-meta" widths={['w-20']} />
          <div className="space-y-tight">
            {['w-40', 'w-32'].map((width) => (
              <div
                key={width}
                className="flex items-center gap-cozy rounded-lg border border-transparent px-cozy py-snug"
              >
                <Skeleton className="size-4 shrink-0 rounded-[0.25rem]" />
                <TextLines className="min-w-0 flex-1 text-body" widths={[width]} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * `GenrePills`' phone strip: a 56px band of self-sizing cells, scrolled under a
 * chevron pinned to the right edge.
 *
 * It was five `h-11` tiles in a `gap-0.5` row. Three things wrong with that: the
 * band is `h-14`, not `h-11`, so the grid below sat 12px high; the real cells
 * carry no gap between them (they space themselves with `px-snug`); and the strip
 * is pulled 8px left into the page gutter so "All" does not park mid-tile.
 */
function GenreStripSkeleton() {
  return (
    <div className="relative h-14 md:hidden">
      <div className="-ml-snug flex h-14 w-[calc(100%+0.5rem)] min-w-0 overflow-hidden pr-12">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            // `border border-transparent` as on the real `CategoryCell` (its focus
            // ring): 2px of width per cell the strip otherwise gained on swap.
            className="grid h-14 min-w-14 shrink-0 place-content-center place-items-center gap-0.5 border border-transparent px-snug"
          >
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="h-3 w-10" />
            {/* The active-tab underline's slot (`mt-tight h-0.5`), present on
                every cell so the icon and label sit where the real ones do. */}
            <span className="mt-tight h-0.5 w-4" aria-hidden="true" />
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
        <header className="mb-group bg-background pb-0 sm:mb-group sm:border-b sm:border-border sm:pb-group md:bg-transparent">
          <div className="flex flex-col gap-group sm:gap-cozy">
            {/* A column below `sm`, a row above it. This was a row at every
                width with a 144px sort placeholder pinned to the right — but
                sort is `md:flex`, so on a phone that block was pure invention
                and it took ~160px of width off the title beside it. */}
            <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-group">
              {/* Title and count share ONE BASELINE row, as in `CatalogResults`.
                  The count used to be drawn as a second line under the title, so
                  from `sm` the header stood 22px taller than the page it was
                  standing in for. Below `sm` the count is `sr-only` and takes no
                  space, which `hidden sm:block` reproduces. */}
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-cozy gap-y-0.5">
                <TextLines
                  className="text-subhead md:text-head"
                  widths={['w-32']}
                />
                <TextLines
                  className="hidden text-body sm:block"
                  widths={['w-20']}
                />
              </div>
              {/* `CatalogSortControl` is a `SelectTrigger`: `h-9 md:h-8`, and this
                  block only exists from `md`, so 32px. It was `h-9`, which stood the
                  title row 4px tall and dropped the pills and the whole grid 4px on
                  swap — measured by `skeleton-fidelity.spec.ts`. */}
              <Skeleton className="hidden h-8 w-[190px] shrink-0 rounded-md md:block" />
            </div>
            <GenreStripSkeleton />
            {/* `DesktopGenrePills`: `md:h-11` pills (44px), not the 28px these
                were — the row under them landed 16px high on every desktop load.
                Enough pills to run past the column, as the real track does. */}
            <div className="hidden min-w-0 gap-1.5 overflow-hidden md:flex">
              {['w-16', 'w-28', 'w-32', 'w-36', 'w-24', 'w-44', 'w-28', 'w-24'].map(
                (width, index) => (
                  <Skeleton key={index} className={`h-11 shrink-0 rounded-full ${width}`} />
                ),
              )}
            </div>
          </div>
        </header>

        <CatalogGridSkeleton count={12} />
      </div>
    </MarketplaceShellSkeleton>
  );
}
