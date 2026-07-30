// app/listings/loading.tsx
//
// Mirrors the live catalog page: MarketplaceShell chrome, mobile search +
// Sell/Filters toolbar, the result-count header, and a 2-up (then auto-fill)
// grid of catalog tiles so swapping in real content doesn't shift the layout.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

function FilterRailSkeleton() {
  return (
    <div className="min-w-0">
      <div className="flex flex-col gap-2 py-3 lg:hidden">
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      </div>
      <div className="hidden flex-col gap-3 border-t border-border/70 pt-5 lg:flex">
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

export default function ListingsLoading() {
  return (
    <MarketplaceShellSkeleton hasPrimaryAction filters={<FilterRailSkeleton />}>
      <div className="min-w-0">
        <header className="mb-4 flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-52" />
          </div>
          <Skeleton className="h-9 w-36 shrink-0 rounded-md" />
        </header>

        <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-4 sm:gap-y-6 lg:[grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
          {Array.from({ length: 12 }, (_, index) => (
            <div key={index}>
              <Skeleton className="aspect-[5/6] w-full rounded-xl" />
              <div className="space-y-2 pt-2.5">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
