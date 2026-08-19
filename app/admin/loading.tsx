// app/admin/loading.tsx
//
// Operations console chrome: section header with the Cases hand-off, the three queue
// tabs, then list rows. Mirrors the real page's order so the swap causes no jump.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function AdminLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0">
        <header className="mb-5 flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-4 w-96 max-w-full" />
          </div>
          {/* SectionHeader's `actions` slot — the Cases button. */}
          <Skeleton className="h-10 w-28 shrink-0 rounded-md" />
        </header>

        <div className="mb-5 flex gap-1 border-b border-border pb-px">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-32 rounded-t-md" />
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-9 w-36 shrink-0 rounded-md" />
        </div>
        <Skeleton className="mb-4 h-4 w-full max-w-2xl" />

        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-48" />
                </div>
                <Skeleton className="h-4 w-24 shrink-0" />
              </div>
              <Skeleton className="mt-3 h-3 w-72 max-w-full" />
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-8 w-24 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
