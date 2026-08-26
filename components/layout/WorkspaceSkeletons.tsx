// components/layout/WorkspaceSkeletons.tsx
//
// Page-shaped placeholders shared by route `loading.tsx` files. Each primitive
// mirrors a live workspace pattern (section heading, Active/Past tabs, catalog
// tile, contract card, inbox row) so the swap on data arrival does not jump.

import type { CSSProperties } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import {
  balanceMosaicColumns,
  CATALOG_MOSAIC_GAP,
  CATALOG_TILE_GRID,
} from '@/components/listings/catalogGrid';
import { coverAspectCss, type ImageDim } from '@/lib/images/dimensions';
import { cn } from '@/lib/utils';

export function SectionHeaderSkeleton({
  hasMobileAction = false,
  hasActions = false,
  actionsClassName = 'w-28',
  titleClassName = 'w-40',
  descriptionClassName = 'w-64',
}: {
  hasMobileAction?: boolean;
  /**
   * Match `SectionHeader.actions` — the slot that stays visible at every width (the
   * Operations console's hand-off to Cases, for instance). Distinct from
   * `hasMobileAction`, which is the `md:hidden` one.
   */
  hasActions?: boolean;
  actionsClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
}) {
  return (
    <header className="mb-snug flex flex-row items-center justify-between gap-cozy border-b border-border pb-snug md:mb-5 md:items-end md:gap-3 md:pb-5">
      <div className="min-w-0 space-y-2">
        <Skeleton className={cn('h-6 md:h-8', titleClassName)} />
        <Skeleton className={cn('hidden h-4 max-w-full md:block', descriptionClassName)} />
      </div>
      {hasActions ? (
        <div className="flex shrink-0 gap-2">
          <Skeleton className={cn('h-10 shrink-0 rounded-md', actionsClassName)} />
        </div>
      ) : null}
      {hasMobileAction ? (
        <Skeleton className="h-10 w-36 shrink-0 rounded-md md:hidden" />
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

/**
 * Compact catalog tile — `CatalogItemCard`. Square like the real cover unless
 * `coverDim` puts it in the phone mosaic, where it takes that shape below md.
 */
export function CatalogTileSkeleton({
  coverDim,
}: {
  coverDim?: ImageDim | null;
}) {
  const inMosaic = coverDim !== undefined;
  return (
    <div className="overflow-hidden rounded-lg bg-card shadow-sm">
      <Skeleton
        className={cn(
          'w-full rounded-none',
          inMosaic ? 'catalog-cover' : 'aspect-square md:aspect-[3/4]',
        )}
        style={
          inMosaic
            ? ({ '--catalog-cover-aspect': coverAspectCss(coverDim) } as CSSProperties)
            : undefined
        }
      />
      <div className="space-y-1.5 px-1.5 pb-2 pt-1.5">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}

/**
 * A repeating run of plausible cover shapes for the phone skeleton.
 *
 * Fixed rather than random so the server and the browser draw the same
 * placeholder, and chosen to span the mosaic's clamp range — trading-card
 * portrait (63x88), square, and landscape — so the placeholder staggers the way
 * the arriving content will. A uniform square grid here would itself be the
 * layout shift the stored dimensions exist to prevent.
 */
const SKELETON_COVER_SHAPES: ImageDim[] = [
  { w: 63, h: 88 },
  { w: 1, h: 1 },
  { w: 4, h: 3 },
  { w: 4, h: 5 },
  { w: 1, h: 1 },
  { w: 63, h: 88 },
];

const skeletonDim = (tile: { dim: ImageDim }) => tile.dim;

/**
 * Catalog placeholder in both layouts.
 *
 * Unlike the live grid this renders the phone mosaic AND the md grid, hiding
 * one with CSS: a skeleton owns no view-transition names, so duplicating it is
 * free, and doing it this way keeps the placeholder correct at both breakpoints
 * without waiting for JavaScript to discover the viewport.
 */
export function CatalogGridSkeleton({ count = 12 }: { count?: number }) {
  const tiles = Array.from({ length: count }, (_, index) => ({
    index,
    dim: SKELETON_COVER_SHAPES[index % SKELETON_COVER_SHAPES.length],
  }));
  // The real balancer, so the placeholder's columns break where the content's
  // will rather than merely looking uneven.
  const columns = balanceMosaicColumns(tiles, skeletonDim);

  return (
    <>
      <div
        className={cn('grid grid-cols-2 items-start md:hidden', CATALOG_MOSAIC_GAP)}
        aria-hidden="true"
      >
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            className={cn('flex min-w-0 flex-col', CATALOG_MOSAIC_GAP)}
          >
            {column.map(({ item }) => (
              <CatalogTileSkeleton key={item.index} coverDim={item.dim} />
            ))}
          </div>
        ))}
      </div>
      <div className={cn(CATALOG_TILE_GRID, 'max-md:hidden')} aria-hidden="true">
        {tiles.map((tile) => (
          <CatalogTileSkeleton key={tile.index} />
        ))}
      </div>
    </>
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
    <Card className="p-cozy max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
      <div className="flex min-h-11 items-center gap-group py-3.5 md:py-0">
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
    <div className="max-md:divide-y max-md:divide-border md:space-y-cozy">
      {Array.from({ length: count }, (_, index) => (
        <ContractRowSkeleton key={index} thumbSize={thumbSize} />
      ))}
    </div>
  );
}

export function InboxRowSkeleton() {
  return (
    <>
      <div className="flex items-start gap-3 py-3.5 md:hidden">
        <Skeleton className="size-12 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-12" />
        </div>
        <Skeleton className="size-11 shrink-0 rounded-md" />
      </div>
      <div className="hidden items-center gap-3 p-4 md:flex">
        <Skeleton className="size-12 shrink-0 rounded-md" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-12 shrink-0" />
          </div>
          <Skeleton className="h-3 w-3/4" />
        </div>
      </div>
    </>
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

/**
 * Contract room. Below `md` that is a thread — bar, log, composer — because the
 * details are a sheet, not a pane; from `md` it is the identity card above the
 * details/chat split.
 */
export function ContractRoomSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-group lg:h-[calc(100dvh-8.25rem-1px-env(safe-area-inset-top))] lg:flex-none">
      <Card className="hidden border-border shadow-sm md:block">
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

      {/* Phone: the thread. Mirrors ContractChatBar's back + thumb + two-line
          subject, then the log, then the composer. */}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <div className="flex shrink-0 items-center gap-cozy border-b px-cozy py-2.5">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <Skeleton className="size-9 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-9 w-24 shrink-0 rounded-md" />
        </div>
        <div className="min-h-0 flex-1 space-y-3 p-cozy">
          <Skeleton className="h-12 w-2/3 rounded-2xl" />
          <Skeleton className="ml-auto h-12 w-3/5 rounded-2xl" />
          <Skeleton className="h-10 w-1/2 rounded-2xl" />
        </div>
        <div className="flex shrink-0 items-end gap-2 border-t p-cozy">
          <Skeleton className="size-11 shrink-0 rounded-md" />
          <Skeleton className="h-11 min-w-0 flex-1 rounded-2xl" />
          <Skeleton className="size-11 shrink-0 rounded-md" />
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 gap-group md:block lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(24rem,2fr)]">
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
