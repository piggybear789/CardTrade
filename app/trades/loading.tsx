// app/trades/loading.tsx
//
// MarketplaceShell chrome + section header + list-row placeholders for the
// trades inbox.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function TradesLoading() {
  return (
    <MarketplaceShellSkeleton hasPrimaryAction>
      <div className="min-w-0 space-y-5">
        <header className="mb-5 flex flex-col gap-3 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
          {/* SectionHeader's mobileAction — the rail's CTA below `lg`. */}
          <Skeleton className="h-10 w-full shrink-0 rounded-md sm:w-36 lg:hidden" />
        </header>
        <Skeleton className="h-9 w-56 rounded-md" />
        <div className="overflow-hidden rounded-xl border border-border/70">
          {Array.from({ length: 5 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-border/70 p-4 last:border-b-0"
            >
              <Skeleton className="size-12 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-5 w-24 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
