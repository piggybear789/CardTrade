// components/layout/WorkspaceSkeletons.tsx
//
// Page-shaped placeholders shared by route `loading.tsx` files. Each primitive
// mirrors a live workspace pattern (section heading, Active/Past tabs, catalog
// tile, contract card, inbox row) so the swap on data arrival does not jump.

import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { CATALOG_TILE_GRID } from '@/components/listings/catalogGrid';
import { cn } from '@/lib/utils';

export function SectionHeaderSkeleton({
  hasMobileAction = false,
  titleClassName = 'w-40',
  descriptionClassName = 'w-64',
}: {
  hasMobileAction?: boolean;
  titleClassName?: string;
  descriptionClassName?: string;
}) {
  return (
    <header className="mb-snug flex flex-col gap-tight border-b border-border pb-snug md:mb-5 md:gap-3 md:pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-2">
        <Skeleton className={cn('h-6 md:h-8', titleClassName)} />
        <Skeleton className={cn('hidden h-4 max-w-full md:block', descriptionClassName)} />
      </div>
      {hasMobileAction ? (
        <Skeleton className="h-10 w-full shrink-0 rounded-md sm:w-36 md:hidden" />
      ) : null}
    </header>
  );
}

/** Active / Past tab strip — same geometry as `SectionFilter`. */
export function SectionFilterSkeleton({ tabs = 2 }: { tabs?: number }) {
  return (
    <div className="mb-3 flex gap-1 border-b border-border pb-px md:mb-5">
      {Array.from({ length: tabs }, (_, index) => (
        <Skeleton key={index} className="h-10 w-24 rounded-t-md" />
      ))}
    </div>
  );
}

/** Compact catalog tile — `CatalogItemCard`. */
export function CatalogTileSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg bg-card shadow-sm">
      <Skeleton className="aspect-[3/4] w-full rounded-none" />
      <div className="space-y-1.5 px-1.5 pb-2 pt-1.5">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

export function CatalogGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className={CATALOG_TILE_GRID}>
      {Array.from({ length: count }, (_, index) => (
        <CatalogTileSkeleton key={index} />
      ))}
    </div>
  );
}

/** Richer auction card — `ItemCard` (watchlist, seller profile). */
export function AuctionCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Skeleton className="aspect-[4/5] w-full rounded-none" />
      <div className="space-y-2 px-3 pb-3 pt-2.5">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export function AuctionGridSkeleton({
  count = 8,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        CATALOG_TILE_GRID,
        className,
      )}
    >
      {Array.from({ length: count }, (_, index) => (
        <AuctionCardSkeleton key={index} />
      ))}
    </div>
  );
}

/** One contract / offer card — `TradesSection`, `CashSalesSection`, `OffersSection`. */
export function ContractRowSkeleton({
  thumbSize = 'md',
}: {
  thumbSize?: 'sm' | 'md';
}) {
  return (
    <Card className="p-cozy">
      <div className="flex items-center gap-group">
        <Skeleton
          className={cn(
            'shrink-0 rounded-md',
            thumbSize === 'md' ? 'size-16' : 'size-12',
          )}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
        <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
      </div>
    </Card>
  );
}

export function ContractCardListSkeleton({
  count = 5,
  thumbSize = 'md',
}: {
  count?: number;
  thumbSize?: 'sm' | 'md';
}) {
  return (
    <div className="space-y-cozy">
      {Array.from({ length: count }, (_, index) => (
        <ContractRowSkeleton key={index} thumbSize={thumbSize} />
      ))}
    </div>
  );
}

export function InboxRowSkeleton() {
  return (
    <div className="flex items-center gap-3 p-4">
      <Skeleton className="size-12 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
        <Skeleton className="h-3 w-3/4" />
      </div>
    </div>
  );
}

export function NotificationRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5">
      <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-12 shrink-0" />
        </div>
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

/** Contract room: compact header + mobile tabs + desktop details/chat split. */
export function ContractRoomSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-group lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))] lg:flex-none">
      <Card className="border-border shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-group gap-y-snug px-group py-cozy">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-group gap-y-1">
            <Skeleton className="h-5 w-40" />
            <div className="flex items-center gap-2">
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-cozy">
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
      </Card>

      <div className="flex min-h-0 flex-1 flex-col gap-group">
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1 lg:hidden">
          <Skeleton className="h-11 rounded-md" />
          <Skeleton className="h-11 rounded-md" />
        </div>

        <div className="min-h-0 flex-1 gap-group lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)]">
          <div className="space-y-3">
            <Card className="p-5">
              <Skeleton className="mb-3 h-5 w-56" />
              <Skeleton className="mb-4 h-4 w-full max-w-md" />
              <Skeleton className="h-10 w-36 rounded-md" />
            </Card>
            <Card className="p-5">
              <Skeleton className="mb-3 h-4 w-24" />
              <Skeleton className="h-20 w-full" />
            </Card>
            <Card className="p-5">
              <Skeleton className="mb-3 h-4 w-28" />
              <Skeleton className="h-16 w-full" />
            </Card>
          </div>
          <Card className="mt-4 hidden min-h-[22rem] flex-col p-4 lg:mt-0 lg:flex">
            <div className="mb-4 flex items-center gap-3 border-b pb-3">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex-1 space-y-3">
              <Skeleton className="ml-auto h-12 w-3/5 rounded-2xl" />
              <Skeleton className="h-12 w-2/3 rounded-2xl" />
              <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
            </div>
            <Skeleton className="mt-4 h-11 w-full rounded-md" />
          </Card>
        </div>
      </div>
    </div>
  );
}

export function ChatThreadSkeleton() {
  return (
    <section
      className="flex min-h-0 w-full flex-1 flex-col"
      aria-label="Loading conversation"
    >
      <header className="flex items-center gap-3 border-b pb-3">
        <Skeleton className="size-10 shrink-0 rounded-full" />
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <Skeleton className="h-5 w-36" />
      </header>
      <div className="flex shrink-0 items-center gap-3 border-b bg-muted px-1 py-3">
        <Skeleton className="size-14 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
      </div>
      <div className="min-h-0 flex-1 space-y-3 py-4">
        <Skeleton className="h-12 w-3/5 rounded-2xl" />
        <Skeleton className="ml-auto h-12 w-1/2 rounded-2xl" />
        <Skeleton className="h-10 w-2/5 rounded-2xl" />
        <Skeleton className="ml-auto h-16 w-3/5 rounded-2xl" />
      </div>
      <Skeleton className="h-12 w-full rounded-md" />
    </section>
  );
}
