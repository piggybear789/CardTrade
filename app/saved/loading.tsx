// app/saved/loading.tsx
//
// Streaming fallback for the saved/watchlist page. Shows a shell skeleton with
// a header and placeholder rows while saved listings load.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function SavedLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0 space-y-5">
        <header className="mb-5 border-b border-border/70 pb-5">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-2 h-4 w-64 max-w-full" />
        </header>
        <div className="overflow-hidden rounded-xl border border-border/70">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border/70 p-4 last:border-b-0">
              <Skeleton className="size-12 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
