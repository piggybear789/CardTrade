// app/listings/mine/loading.tsx
//
// My Listings is a MANAGEMENT TABLE, not a tile grid: `ListingsSection` renders the
// status tab strip, then one bordered card holding a desktop-only column header and a
// divided list of rows (48px thumbnail, title + meta, then price, top offer, watching,
// status and the row's actions from `md`).

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import {
  SectionFilterSkeleton,
  SectionHeaderSkeleton,
} from '@/components/layout/WorkspaceSkeletons';
// The real table's own column template, so header and rows land at the same x as
// the page they stand in for.
import { ROW_GRID } from '@/components/account/ListingsSection';
import { cn } from '@/lib/utils';

/** One table row, desktop columns included and phone sub-line folded in. */
function RowSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <li className={cn(ROW_GRID, 'px-group py-cozy')}>
      {/* `RowThumb`: 48px, bordered. */}
      <Skeleton className="size-12 shrink-0 rounded-md" />
      <div className="min-w-0">
        {/* `border border-transparent`, as the real title link has (its focus ring). */}
        <TextLines className="border border-transparent text-body" widths={[titleWidth]} />
        <TextLines className="mt-0.5 text-meta" widths={['w-1/2']} />
        {/* Below `md`: price + status badge as a sub-line. */}
        <div className="mt-tight flex items-center gap-x-cozy md:hidden">
          <TextLines className="text-meta" widths={['w-1/3']} />
          <Skeleton className="h-[1.425rem] w-12 rounded-md" />
        </div>
      </div>
      <TextLines className="hidden text-right text-body md:block" widths={['w-1/3']} />
      <TextLines className="hidden text-right text-body md:block" widths={['w-1/3']} />
      <TextLines className="hidden text-center text-body md:block" widths={['w-1/3']} />
      <div className="hidden justify-center md:flex">
        <Skeleton className="h-[1.425rem] w-14 rounded-md" />
      </div>
      {/* One `size="sm"` action (h-9 on touch, h-8 from `md`) and the 32px "⋯". */}
      <div className="flex shrink-0 items-center justify-end gap-tight">
        <Skeleton className="h-9 w-12 rounded-md md:h-8" />
        <Skeleton className="size-9 rounded-md md:size-8" />
      </div>
    </li>
  );
}

const ROW_TITLE_WIDTHS = ['w-2/3', 'w-1/2', 'w-2/3', 'w-1/2', 'w-2/3', 'w-1/2'];

export default function MyListingsLoading() {
  return (
    <MarketplaceShellSkeleton
      title="My listings"
      primaryAction={<RailPrimaryAction href="/listings/new">Sell an item</RailPrimaryAction>}
    >
      {/* No wrapper div — see the note in `saved/loading.tsx`. */}
      <SectionHeaderSkeleton hasMobileAction mobileActionClassName="w-[8.5rem]" />
      <div aria-hidden="true">
        <SectionFilterSkeleton labels={['All', 'Live', 'Under contract', 'Sold']} />
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className={cn(ROW_GRID, 'hidden border-b border-border bg-muted px-group py-snug md:grid')}>
            <span />
            <TextLines className="text-meta" widths={['w-1/3']} />
            <TextLines className="text-right text-meta" widths={['w-1/3']} />
            <TextLines className="text-right text-meta" widths={['w-1/3']} />
            <TextLines className="text-center text-meta" widths={['w-1/3']} />
            <TextLines className="text-center text-meta" widths={['w-1/3']} />
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
