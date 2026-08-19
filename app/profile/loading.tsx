// app/profile/loading.tsx
//
// Settings is a centred max-w-2xl column: title, three tabs, then the
// identity card and stacked settings sections — not three anonymous blobs.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function ProfileLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6">
          <Skeleton className="h-8 w-32" />
        </header>

        <nav className="mb-8 flex gap-8 border-b pb-px" aria-hidden>
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </nav>

        <div className="space-y-8">
          <div className="rounded-xl border bg-card p-5">
            <div className="flex items-start gap-5">
              <Skeleton className="size-16 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-5 w-40" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-56 max-w-full" />
                </div>
              </div>
              <Skeleton className="h-8 w-16 shrink-0 rounded-md" />
            </div>
          </div>

          <div className="space-y-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
