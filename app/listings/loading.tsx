// app/listings/loading.tsx
//
// Mirrors the live catalog page: MarketplaceShell chrome, the result-count
// header with its sort control, and a grid of catalog-variant tiles using the
// same auto-fill/minmax(13rem) track as the real grid (Req 3.8), so swapping
// in real content doesn't shift the layout.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

function FilterRailSkeleton() {
  return (
    <div className="space-y-3 border-t border-border/70 pt-5">
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-24 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

export default function ListingsLoading() {
  return (
    <MarketplaceShellSkeleton filters={<FilterRailSkeleton />}>
      <div className="min-w-0">
        <header className="mb-4 flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-52" />
          </div>
          <Skeleton className="h-9 w-36 shrink-0 rounded-md" />
        </header>

        {/* Same track as the live grid: auto-fill, minmax(13rem, 1fr). */}
        <div className="grid gap-x-4 gap-y-6 [grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
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
