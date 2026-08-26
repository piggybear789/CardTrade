// app/listings/[id]/loading.tsx
//
// Phone: seller, price, copy, then a photo frame. Desktop: left-pane cover.

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

        <div className="flex min-h-0 flex-col items-stretch lg:flex-1 lg:flex-row lg:gap-6">
          <div className="hidden min-w-0 lg:block lg:flex-1">
            <Skeleton className="h-full min-h-[22rem] w-full rounded-lg" />
          </div>

          <div className="flex min-w-0 flex-col pt-0 lg:flex-1 lg:pt-0">
            <div className="flex items-center gap-2">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="ml-auto h-3 w-20" />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="ml-auto h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-2 h-3 w-2/3" />
            <Skeleton className="mt-4 h-6 w-4/5" />
            <div className="mt-2 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
            <Skeleton className="mt-4 h-48 w-full rounded-lg lg:hidden" />
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
