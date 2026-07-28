// app/listings/mine/loading.tsx
//
// Mirrors My Listings: the shared SectionHeader plus a 1/2/3-column grid of
// ListingsSection's square-image cards (image + price + title + status badge
// + View/Edit actions), rather than the catalog-grid skeleton that
// app/listings/loading.tsx would otherwise supply for this route.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function MyListingsLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0">
        <header className="mb-5 flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="overflow-hidden rounded-xl border">
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-6 w-2/5" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/3" />
                <div className="flex gap-2 pt-2">
                  <Skeleton className="h-8 flex-1 rounded-md" />
                  <Skeleton className="h-8 flex-1 rounded-md" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
