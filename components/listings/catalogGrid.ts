// components/listings/catalogGrid.ts
//
// Geometry for the browse grid, shared by the live catalog and its skeletons.
//
// Two layouts live here, and which one you get depends only on the viewport:
//
//   * md and up — a uniform grid. Three columns on a tablet, then fluid
//     auto-fill once there is room for a 13rem cell. Every cover is square, so
//     rows line up. This is the long-standing desktop layout and nothing in the
//     mosaic work below changes it.
//   * below md — a staggered two-column mosaic. Each tile is as tall as its own
//     cover photo, so the columns run out of sync, the way Xianyu and every
//     other phone-first marketplace feed does it. Made possible by
//     `items.image_dims` (migration 0106): without a stored aspect ratio the
//     grid would have to wait for each photo to load before it knew how tall
//     the tile was, and would re-flow on every arrival.

import { coverAspectRatio, type ImageDim } from '@/lib/images/dimensions';

/**
 * The uniform grid at every breakpoint. Still the right class for surfaces that
 * are not the mosaic — My Listings, Saved, a seller's shop — where a tidy grid
 * of equal tiles reads better than a mosaic of six items.
 */
export const CATALOG_TILE_GRID =
  'grid grid-cols-2 gap-1.5 sm:gap-3 md:grid-cols-3 md:gap-4 lg:[grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]';

/**
 * The md-and-up half of {@link CATALOG_TILE_GRID}, with the phone rules left
 * out so the mosaic can own everything below md.
 *
 * The container carrying this is a plain block on a phone — the mosaic's own
 * root is the grid down there — and becomes the familiar uniform grid at md,
 * where the mosaic's column wrappers collapse to `display: contents` and hand
 * their tiles straight to it.
 */
export const CATALOG_TILE_GRID_FROM_MD =
  'md:grid md:grid-cols-3 md:gap-4 lg:[grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]';

/** Gap between mosaic tiles. Matches the phone gap in the uniform grid. */
export const CATALOG_MOSAIC_GAP = 'gap-1.5 sm:gap-3';

/** Columns in the phone mosaic. Two, as on every phone-width marketplace feed. */
export const CATALOG_MOSAIC_COLUMNS = 2;

/**
 * Height of the text under a cover — title, price, seller — as a fraction of
 * the tile's width.
 *
 * A constant, because the block is the same three rows on every tile and its
 * height is set by the type scale rather than the tile width: roughly 87px
 * under a column that is roughly 176px wide on a 390pt phone. It exists only so
 * the balancer compares whole tiles rather than bare covers; being a few
 * percent out shifts nothing, since a constant added to every tile cannot
 * change which column is shorter unless the columns hold different numbers of
 * tiles — which is exactly when it should count.
 */
const TILE_TEXT_RATIO = 0.48;

/** Nominal mosaic column width in rem, for intrinsic-size estimates. */
const TILE_WIDTH_REM = 11;

/**
 * Estimated rendered height of a tile as a multiple of its width. Used only to
 * decide which column is shorter.
 */
function tileHeightRatio(dim: ImageDim | null | undefined): number {
  return 1 / coverAspectRatio(dim) + TILE_TEXT_RATIO;
}

/**
 * A rough tile height for `contain-intrinsic-size`, so a tile that has been
 * skipped by `content-visibility: auto` still reserves close to the right space
 * and the scrollbar does not jump as the reader moves down the feed.
 *
 * An estimate is enough: the `auto` keyword means the browser replaces it with
 * the real measurement the first time the tile renders.
 */
export function tileIntrinsicHeight(dim: ImageDim | null | undefined): string {
  return `${(tileHeightRatio(dim) * TILE_WIDTH_REM).toFixed(2)}rem`;
}

/** One tile's place in the mosaic: the item, and where it sat in the feed. */
export interface MosaicTile<T> {
  item: T;
  /**
   * Position in the source order. Carried through because the md-and-up
   * layout has to restore it — see `--tile-order` in `app/globals.css`.
   */
  index: number;
}

/**
 * Deal items into columns by always adding the next one to whichever column is
 * currently shortest.
 *
 * WHY NOT CSS `columns-2`. Multicol is the one-line way to get a mosaic and it
 * is wrong for this feed: it fills the first column to the bottom before it
 * starts the second, so item 2 lands halfway down the page and the sort order —
 * relevance, or recency — is destroyed. Reading order matters here; the mosaic
 * is a presentation of a ranked list, not a wall of pictures.
 *
 * Greedy shortest-column keeps reading order approximately left-to-right and
 * top-to-bottom: each item goes to the column where it will sit highest, so it
 * is never far below its predecessor. It is deterministic and depends only on
 * the items, so the server and the browser produce the same layout and
 * hydration is silent.
 *
 * Heights come from the stored aspect ratios, clamped by `coverAspectRatio` so
 * one panorama cannot leave a column stranded. Items with no stored dimensions
 * count as square, which is also how they are drawn.
 */
export function balanceMosaicColumns<T>(
  items: readonly T[],
  dimOf: (item: T) => ImageDim | null | undefined,
  columnCount: number = CATALOG_MOSAIC_COLUMNS,
): MosaicTile<T>[][] {
  const columns: MosaicTile<T>[][] = Array.from(
    { length: columnCount },
    () => [],
  );
  const heights = new Array<number>(columnCount).fill(0);

  for (let index = 0; index < items.length; index += 1) {
    let shortest = 0;
    for (let column = 1; column < columnCount; column += 1) {
      // Strictly less than, so a tie goes to the leftmost column and the feed
      // reads left-to-right from the very first row.
      if (heights[column] < heights[shortest]) shortest = column;
    }
    columns[shortest].push({ item: items[index], index });
    heights[shortest] += tileHeightRatio(dimOf(items[index]));
  }

  return columns;
}
