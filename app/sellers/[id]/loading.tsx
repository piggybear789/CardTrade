// app/sellers/[id]/loading.tsx
//
// Public seller profile lives in MarketplaceShell: back link, avatar header,
// then the same compact catalog tiles as browse.

import { Skeleton } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { CATALOG_TILE_GRID } from '@/components/listings/catalogGrid';
import { CatalogTileSkeleton } from '@/components/layout/WorkspaceSkeletons';

export default function SellerProfileLoading() {
  return (
    <MarketplaceShellSkeleton>
      <div className="min-w-0">
        <nav className="mb-6">
          <Skeleton className="h-4 w-36" />
        </nav>

        <header className="mb-8 space-y-2 border-b pb-6">
          <div className="flex min-w-0 items-start gap-4">
            <Skeleton className="size-14 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-8 w-44" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-full max-w-prose" />
            </div>
          </div>
        </header>

        <section className="mb-10">
          <Skeleton className="mb-4 h-5 w-40" />
          <div className={CATALOG_TILE_GRID}>
            {Array.from({ length: 6 }, (_, index) => (
              <CatalogTileSkeleton key={index} />
            ))}
          </div>
        </section>

        <section>
          <Skeleton className="mb-4 h-5 w-28" />
          <div className="space-y-3">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        </section>
      </div>
    </MarketplaceShellSkeleton>
  );
}
