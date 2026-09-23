// components/layout/catalogSkeletons.tsx
//
// Catalog placeholders, split out of WorkspaceSkeletons. That file also imports
// the tab-strip geometry from SectionFilter, and SectionFilter mounts
// TabIndicator. A loading.tsx that only needs tiles was therefore pulling the
// layout-animation library into the catalog's first-paint JavaScript.

import type { CSSProperties } from 'react';

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import {
  balanceMosaicColumns,
  CATALOG_MOSAIC_GAP,
  CATALOG_TILE_GRID,
} from '@/components/listings/catalogGrid';
import { coverAspectCss, type ImageDim } from '@/lib/images/dimensions';
import { cn } from '@/lib/utils';

/**
 * Compact catalog tile — `CatalogItemCard`. Square like the real cover unless
 * `coverDim` puts it in the phone mosaic, where it takes that shape below md.
 */
export function CatalogTileSkeleton({
  coverDim,
  /**
   * Reserve the seller row. `CatalogItemCard` renders it only when the tile
   * carries a seller, which My Listings deliberately omits — every tile there
   * belongs to the viewer.
   */
  hasSeller = true,
}: {
  coverDim?: ImageDim | null;
  hasSeller?: boolean;
}) {
  const inMosaic = coverDim !== undefined;
  return (
    // Border, padding and gap are `CatalogItemCard`'s, term for term. The text
    // block used to be three bars in `space-y-1.5 px-1.5 pb-snug pt-1.5` — 70px
    // against the card's 108-132px, and inset half as far — so every tile in the
    // feed was ~40px short and the error compounded down both mosaic columns.
    // The border matters as much as the height: card and page are both white, so
    // without it the placeholder tiles had no edge at all and a hairline popped
    // in around every one of them at once.
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <Skeleton
        className={cn(
          'w-full rounded-none',
          // Square at every width, like the real cover. The `md:aspect-[3/4]`
          // that used to be here was left over from a desktop cover that is no
          // longer 3:4.
          inMosaic ? 'catalog-cover' : 'aspect-square',
        )}
        style={
          inMosaic
            ? ({ '--catalog-cover-aspect': coverAspectCss(coverDim) } as CSSProperties)
            : undefined
        }
      />
      <div className="flex min-w-0 flex-col gap-tight px-cozy pb-2.5 pt-snug">
        {/* Title clamps to two lines and, at this column width, almost always
            uses both. */}
        <TextLines
          className="text-body"
          widths={['w-full', 'w-3/5']}
        />
        {/* Category · condition. */}
        <TextLines className="text-body leading-tight" widths={['w-2/5']} />
        {/* Price. The major digits are `text-head`, so this line is the tallest
            in the block. */}
        <TextLines className="text-head" widths={['w-1/2']} />
        {hasSeller ? (
          // 20px row: a `size-5` avatar beside a `text-meta` name, as the card
          // draws it. This was a `text-body` line (22.4px) and the tile ran 2px
          // tall on every swap.
          <div className="flex h-5 min-w-0 items-center gap-1.5">
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <TextLines className="min-w-0 flex-1 text-meta" widths={['w-3/5']} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A repeating run of plausible cover shapes for the phone skeleton.
 *
 * Fixed rather than random so the server and the browser draw the same
 * placeholder, and chosen to stagger the way the arriving content will. A
 * uniform square grid here would itself be the layout shift the stored
 * dimensions exist to prevent.
 *
 * PORTRAIT AND SQUARE ONLY. A 4:3 landscape used to be in the run "to span the
 * clamp range", but this is a card marketplace: photos are cards (63x88), phone
 * shots of cards (3:4), and the occasional square. A landscape placeholder is the
 * one shape that almost never arrives, so it was the one tile that visibly
 * changed on every swap. Measured against a live tile: the text block matched to
 * 2px and the cover was the whole of the mismatch.
 */
const SKELETON_COVER_SHAPES: ImageDim[] = [
  { w: 63, h: 88 },
  { w: 1, h: 1 },
  { w: 3, h: 4 },
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

/**
 * Catalog placeholder for the surfaces that are NOT the mosaic — Saved, My
 * Listings, a seller's shop — where the live grid is `CATALOG_TILE_GRID` at
 * every width and every cover is square.
 *
 * Those three routes used to reach for `CatalogGridSkeleton`, which draws the
 * phone mosaic: two independently-flowing columns of six different cover
 * shapes, standing in for a lockstep grid where both tiles in a row share one
 * height. Every tile below the first row was in the wrong place, and the whole
 * grid snapped on swap. The staggering is right for the feed and wrong here —
 * see the note on `CATALOG_TILE_GRID`.
 */
export function CatalogTileGridSkeleton({
  count = 8,
  hasSeller = true,
}: {
  count?: number;
  hasSeller?: boolean;
}) {
  return (
    <div className={CATALOG_TILE_GRID} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <CatalogTileSkeleton key={index} hasSeller={hasSeller} />
      ))}
    </div>
  );
}
