// app/admin/arbitration/[kind]/[ref]/loading.tsx
//
// One case: section header with assign control, then the two-column
// context / decision workspace.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function ArbitrationCaseLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0">
        <header className="mb-5 flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-9 w-28 shrink-0 rounded-md" />
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <div className="space-y-4">
            <div className="rounded-xl border p-5">
              <Skeleton className="mb-3 h-5 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-4/5" />
              <Skeleton className="mt-2 h-4 w-2/3" />
            </div>
            <div className="rounded-xl border p-5">
              <Skeleton className="mb-3 h-5 w-24" />
              <div className="flex gap-3">
                <Skeleton className="size-16 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/5" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            </div>
            <div className="rounded-xl border p-5">
              <Skeleton className="mb-3 h-5 w-28" />
              <Skeleton className="h-32 w-full" />
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border p-5">
              <Skeleton className="mb-3 h-5 w-20" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="mt-3 h-9 w-full rounded-md" />
            </div>
            <div className="rounded-xl border p-5">
              <Skeleton className="mb-3 h-5 w-24" />
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="mt-2 h-10 w-full rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
