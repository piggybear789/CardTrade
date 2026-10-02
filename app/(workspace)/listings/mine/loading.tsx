// app/listings/mine/loading.tsx
//
// My Listings is a MANAGEMENT TABLE, not a tile grid: `ListingsSection` renders a
// four-figure stats strip, then one bordered card holding a desktop-only column
// header and a divided list of rows (48px thumbnail, title + meta, then price,
// watching, status and one action from `md`).
//
// This file used to draw eight catalog tiles in `CATALOG_TILE_GRID`, left over
// from when the section rendered `CatalogItemCard`. On a phone that was two
// columns of ~300px tiles standing in for ~90px rows, so the placeholder was
// several screens taller than the page and the whole view collapsed upwards on
// swap.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import { SectionHeaderSkeleton } from '@/components/layout/WorkspaceSkeletons';
// The real table's own column template, so header and rows land at the same x as
// the page they stand in for.
import { ROW_GRID } from '@/components/account/ListingsSection';
import { cn } from '@/lib/utils';

/** `Stat`: a `text-meta` label over a `text-head` figure in a bordered cell. */
function StatSkeleton({ labelWidth }: { labelWidth: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-cozy py-snug">
      <TextLines className="text-meta" widths={[labelWidth]} />
      <TextLines className="mt-0.5 text-head" widths={['w-6']} />
    </div>
  );
}

/** One table row, desktop columns included and phone sub-line folded in. */
function RowSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <li className={cn(ROW_GRID, 'px-group py-cozy')}>
      {/* `RowThumb`: 48px, bordered. */}
      <Skeleton className="size-12 shrink-0 rounded-md" />
      <div className="min-w-0">
        {/* `border border-transparent`, as the real title link has (its focus ring):
            1px each side makes the line 24.4px, and without it every row was 2px
            short — about 12px over the table. */}
        <TextLines className="border border-transparent text-body" widths={[titleWidth]} />
        <TextLines className="mt-0.5 text-meta" widths={['w-2/5']} />
        {/* Below `md`: price + status badge as a sub-line. A badge is a
            `text-meta` line inside `py-0.5` and a 1px border — 23px. */}
        <div className="mt-tight flex items-center gap-x-cozy md:hidden">
          <TextLines className="text-meta" widths={['w-14']} />
          <Skeleton className="h-[1.425rem] w-12 rounded-md" />
        </div>
      </div>
      <TextLines className="hidden text-right text-body md:block" widths={['w-16']} />
      <TextLines className="hidden text-center text-body md:block" widths={['w-4']} />
      <div className="hidden justify-center md:flex">
        <Skeleton className="h-[1.425rem] w-14 rounded-md" />
      </div>
      {/* One `size="sm"` action: h-8 on touch, h-7 from `md`. */}
      <div className="flex shrink-0 items-center justify-end">
        <Skeleton className="h-8 w-12 rounded-md md:h-7" />
      </div>
    </li>
  );
}

const ROW_TITLE_WIDTHS = ['w-3/5', 'w-4/5', 'w-1/2', 'w-2/3', 'w-3/4', 'w-1/2'];

export default function MyListingsLoading() {
  return (
    <MarketplaceShellSkeleton
      title="My Listings"
      primaryAction={
        <RailPrimaryAction href="/listings/new">Create New Listing</RailPrimaryAction>
      }
    >
      {/* No wrapper div — see the note in `saved/loading.tsx`. */}
      <SectionHeaderSkeleton hasMobileAction mobileActionClassName="w-44" />
      <div className="space-y-group" aria-hidden="true">
        <div className="grid grid-cols-2 gap-snug sm:grid-cols-4 sm:gap-cozy">
          <StatSkeleton labelWidth="w-8" />
          <StatSkeleton labelWidth="w-24" />
          <StatSkeleton labelWidth="w-24" />
          <StatSkeleton labelWidth="w-8" />
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {/* Column headings, desktop only: `market-label` captions in a muted
              `py-snug` band. */}
          <div
            className={cn(
              ROW_GRID,
              'hidden border-b border-border bg-muted px-group py-snug md:grid',
            )}
          >
            <span />
            <TextLines className="text-meta" widths={['w-14']} />
            <TextLines className="text-right text-meta" widths={['w-10']} />
            <TextLines className="text-center text-meta" widths={['w-16']} />
            <TextLines className="text-center text-meta" widths={['w-12']} />
            <span />
          </div>
          <ul className="divide-y divide-border">
            {ROW_TITLE_WIDTHS.map((width, index) => (
              <RowSkeleton key={index} titleWidth={width} />
            ))}
          </ul>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
