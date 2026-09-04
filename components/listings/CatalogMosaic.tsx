'use client';

// components/listings/CatalogMosaic.tsx
//
// The staggered two-column browse grid on a phone, and the ordinary uniform
// grid everywhere else.
//
// WHAT MAKES IT STAGGER. Every cover is drawn at its photo's own aspect ratio,
// read from `items.image_dims` (migration 0106) rather than from the loaded
// image, so tile heights differ, the two columns fall out of step, and — this
// is the point of storing the dimensions — the space is reserved before the
// photo arrives. Nothing re-flows as the feed loads.
//
// WHY THE COLUMNS ARE BUILT IN JS. CSS `columns-2` is the one-line mosaic and
// it fills column one to the bottom before starting column two, which throws
// the second-best result halfway down the page. This feed is ranked, so reading
// order is load-bearing. `balanceMosaicColumns` walks the items in order and
// drops each into whichever column is currently shorter, which keeps the read
// approximately left-to-right and top-to-bottom.
//
// WHY THERE ARE TWO RENDER PATHS. Columns have to exist as real elements to
// stagger, and a flat list has to exist for the md-and-up grid, and the tiles
// cannot be rendered twice — each cover owns a `<ViewTransition name>` for the
// morph into the listing page, and React rejects a duplicate name. So the
// breakpoint picks one. The server has no viewport and renders the phone
// mosaic; `useIsDesktop` swaps in the flat grid after hydration.
//
// That swap is invisible, because the mosaic markup ALSO lays out correctly at
// md and up on its own: the wrappers go `display: contents` and each tile takes
// an `order` matching its feed position (see `.catalog-tile-slot` in
// `app/globals.css`). A desktop visitor sees the final layout in the very first
// paint; hydration then replaces it with the same pixels in plain source order,
// which is what keyboard and screen-reader users traverse.

import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react';

import { useIsDesktop } from '@/components/layout/Breakpoint';
import {
  balanceMosaicColumns,
  CATALOG_MOSAIC_GAP,
  CATALOG_TILE_GRID,
  CATALOG_TILE_GRID_FROM_MD,
} from '@/components/listings/catalogGrid';
import { readImageDims, type ImageDim } from '@/lib/images/dimensions';
import { cn } from '@/lib/utils';

/**
 * Cover dimensions for a catalog row, or `null` when unknown.
 *
 * Sanitized on the way out of the database as well as on the way in, because
 * some of what is stored was measured by a browser and because a row written
 * before the column existed is still a row we have to draw today.
 */
export function catalogCoverDim(item: {
  image_paths: string[] | null;
  image_dims?: unknown;
}): ImageDim | null {
  const paths = item.image_paths ?? [];
  if (paths.length === 0) return null;
  return readImageDims(item.image_dims, paths.length)[0] ?? null;
}

export interface CatalogMosaicProps<T> {
  items: readonly T[];
  /** Stable identity for reconciliation across pages and re-sorts. */
  keyOf: (item: T) => string;
  /**
   * Cover dimensions per item. Hoist this to module scope in the caller — it
   * is a dependency of the column balance, and a fresh arrow every render
   * would recompute the whole layout on every render.
   */
  dimOf: (item: T) => ImageDim | null;
  /**
   * Renders one tile. `coverDim` is `undefined` at md and up (the tile is not
   * in a mosaic and should stay square) and the item's dimensions below md.
   * Pass it straight through to `CatalogItemCard`.
   */
  children: (item: T, coverDim: ImageDim | null | undefined) => ReactNode;
  className?: string;
}

export function CatalogMosaic<T>({
  items,
  keyOf,
  dimOf,
  children,
  className,
}: CatalogMosaicProps<T>) {
  const isDesktop = useIsDesktop();
  const columns = useMemo(
    () => balanceMosaicColumns(items, dimOf),
    [items, dimOf],
  );

  // md and up, after hydration: the layout the catalog has always had, with no
  // wrappers, no ordering, and no per-tile aspect ratio.
  if (isDesktop) {
    return (
      <div className={cn(CATALOG_TILE_GRID, className)}>
        {items.map((item) => (
          <Fragment key={keyOf(item)}>{children(item, undefined)}</Fragment>
        ))}
      </div>
    );
  }

  return (
    // Plain block on a phone — the mosaic root below is the grid. Becomes the
    // uniform grid at md, where every wrapper collapses to `display: contents`
    // and the tiles become its direct children.
    <div className={cn(CATALOG_TILE_GRID_FROM_MD, className)}>
      {/* `items-start` so a short column does not stretch to match a tall one. */}
      <div
        className={cn(
          'grid grid-cols-2 items-start md:contents',
          CATALOG_MOSAIC_GAP,
        )}
      >
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            className={cn('flex min-w-0 flex-col md:contents', CATALOG_MOSAIC_GAP)}
          >
            {column.map(({ item, index }) => (
              <div
                key={keyOf(item)}
                // `--tile-order` is only read at md and up, where this element
                // is a grid item and has to be put back into feed order.
                className="catalog-tile-slot min-w-0"
                style={{ '--tile-order': index } as CSSProperties}
              >
                {children(item, dimOf(item))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
