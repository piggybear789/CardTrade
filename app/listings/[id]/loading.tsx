// app/listings/[id]/loading.tsx
//
// Mirrors the item detail split: breadcrumb, ImageGallery frame, and the
// details rail (title, price, seller, action pair, description).

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function ItemDetailLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div
        className="flex min-h-0 flex-col lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))]"
        role="status"
        aria-busy="true"
        aria-label="Loading listing"
      >
        <span className="sr-only">Loading…</span>
        <div className="mb-4 sm:mb-6">
          <Skeleton className="h-9 w-40 rounded-md" />
        </div>

        <div className="flex min-h-0 flex-col items-stretch gap-8 lg:flex-1 lg:flex-row">
          <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center">
            <Skeleton className="h-full min-h-[22rem] max-h-[calc(100dvh-10rem-env(safe-area-inset-top))] w-full rounded-lg lg:max-h-[calc(100%-3.5rem)]" />
          </div>

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
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <Skeleton className="size-10 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-12 w-full rounded-md" />
                <Skeleton className="h-12 w-full rounded-md" />
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
