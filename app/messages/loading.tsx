// app/messages/loading.tsx
//
// MarketplaceShell chrome + inbox list placeholders.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function MessagesLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0 space-y-5">
        <header className="mb-5 space-y-2 border-b border-border/70 pb-5">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-40" />
        </header>
        <div className="overflow-hidden rounded-xl border border-border/70">
          {Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-border/70 p-4 last:border-b-0"
            >
              <Skeleton className="size-12 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
