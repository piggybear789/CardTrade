// app/listings/[id]/loading.tsx
//
// Mirrors the item detail page's split view: a breadcrumb, the ImageGallery
// frame on one side (same min/max height clamp), and the details rail on the
// other (title, price, category/condition badges, seller card, description,
// action row) — rather than the catalog-grid skeleton that
// app/listings/loading.tsx would otherwise supply for this route.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function ItemDetailLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div
        className="flex min-h-0 flex-col lg:h-[calc(100dvh-7.5rem-1px-env(safe-area-inset-top))]"
        role="status"
        aria-busy="true"
        aria-label="Loading listing"
      >
        <span className="sr-only">Loading…</span>
        <div className="mb-4 sm:mb-6">
          <Skeleton className="h-9 w-40 rounded-md" />
        </div>

        <div className="flex min-h-0 flex-col items-stretch gap-8 lg:flex-1 lg:flex-row">
          {/* Gallery frame — same min/max height clamp as ImageGallery. */}
          <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
            <Skeleton className="h-full min-h-[22rem] max-h-[calc(100dvh-10rem-env(safe-area-inset-top))] w-full rounded-lg lg:max-h-[calc(100%-3.5rem)]" />
          </div>

          {/* Details rail. */}
          <div className="flex min-w-0 flex-col lg:flex-1">
            <div className="space-y-6">
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Skeleton className="h-8 w-3/5" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <Skeleton className="h-8 w-32" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>

              {/* Icon action row — above description, matching ItemActions. */}
              <div className="grid grid-cols-5 justify-items-center gap-1 sm:gap-2">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className="flex flex-col items-center gap-1.5">
                    <Skeleton className="size-12 rounded-full" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                ))}
              </div>

              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
