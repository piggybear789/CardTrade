// app/profile/loading.tsx
//
// MarketplaceShell chrome + account settings placeholders.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';

export default function ProfileLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0 space-y-6">
        <header className="mb-5 space-y-2 border-b border-border/70 pb-5">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </header>
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-36 w-full rounded-xl" />
      </div>
    </MarketplaceShellSkeleton>
  );
}
