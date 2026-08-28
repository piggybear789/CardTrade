// app/loading.tsx
//
// Fallback for `/`, which is the marketplace catalog. Mirrors the live page:
// MarketplaceShell chrome, mobile Sell/Filters toolbar, the result-count header
// + filter field, and a 2-up (then auto-fill) grid of catalog tiles so swapping
// in real content doesn't shift the layout.
//
// Every other segment ships its own `loading.tsx`, so this boundary only ever
// covers the homepage.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';
import { CatalogGridSkeleton } from '@/components/layout/WorkspaceSkeletons';

function FilterRailSkeleton() {
  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-2 py-3 md:hidden">
        <div className="flex gap-2">
          <Skeleton className="h-10 min-w-0 flex-1 rounded-md" />
          <Skeleton className="h-10 w-24 shrink-0 rounded-md" />
        </div>
      </div>
      <div className="hidden flex-col gap-3 border-t border-border pt-5 md:flex">
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
        <header className="mb-4 border-b border-border pb-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-7 w-40" />
                <Skeleton className="hidden h-4 w-52 sm:block" />
              </div>
              <Skeleton className="h-9 w-36 shrink-0 rounded-md" />
            </div>
            <div className="flex min-w-0 gap-0.5 overflow-hidden md:hidden">
              <Skeleton className="h-11 w-12 shrink-0 rounded-md" />
              <Skeleton className="h-11 w-16 shrink-0 rounded-md" />
              <Skeleton className="h-11 w-[4.5rem] shrink-0 rounded-md" />
              <Skeleton className="h-11 w-16 shrink-0 rounded-md" />
              <Skeleton className="h-11 w-14 shrink-0 rounded-md" />
            </div>
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
