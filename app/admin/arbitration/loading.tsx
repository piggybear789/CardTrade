// app/admin/arbitration/loading.tsx
//
// The arbitration queue assembles itself from four record types plus assignments, notes
// and per-case held-funds figures, which makes it the heaviest read in the app. Without a
// skeleton it shows the generic root placeholder and then jumps, which on a page whose
// whole job is triage reads as "nothing is waiting".
//
// Mirrors the real page's geometry in order: section header, four summary tiles, the
// three-tab strip, then case rows.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function ArbitrationLoading() {
  return (
    // No `hasPrimaryAction`: the queue passes no rail CTA, and reserving a button's
    // height here would drop the rail by that much when the real shell arrives.
    <MarketplaceShellSkeleton>
      <div className="min-w-0">
        {/* SectionHeader: title + description, with the assign control on the right. */}
        <header className="mb-5 flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
        </header>

        {/* The four triage stats. */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-lg border bg-muted/30 p-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-6 w-14" />
            </div>
          ))}
        </div>

        {/* SectionTabs. */}
        <div className="mb-5 flex gap-1 border-b border-border/70 pb-px">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-28 rounded-t-md" />
          ))}
        </div>

        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-xl border border-border/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-44" />
                </div>
                <Skeleton className="h-5 w-20 shrink-0" />
              </div>
              <Skeleton className="mt-3 h-3 w-64 max-w-full" />
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <Skeleton className="h-3 w-52 max-w-full" />
                <Skeleton className="h-8 w-28 shrink-0 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
