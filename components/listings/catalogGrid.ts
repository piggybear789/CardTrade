// components/listings/catalogGrid.ts
//
// Geometry for the browse grid, shared by the live catalog and its skeletons.
//
// Two layouts live here, and which one you get depends only on the viewport:
//
//   * md and up — a uniform grid, three to five columns by breakpoint, each row
//     divided exactly so no gutter is left over. Every cover is square, so rows
//     line up. Nothing in the mosaic work below changes it.
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
// AN EXPLICIT COLUMN COUNT PER BREAKPOINT. The count is the design decision;
// the tile width follows from it.
//
// This replaces `repeat(auto-fill, 15rem)`, which pinned every tile at 240px and
// left whatever did not divide evenly as trailing gutter. That was a deliberate
// choice — a ragged right edge, as fixed-tile feeds have — but measured against
// this shell it was not a ragged edge, it was a hole:
//
//   1280px viewport  3 tiles, 209px empty  (22% of the row)
//   1440px           4 tiles,  81px empty
//   1536px           4 tiles, 161px empty
//   1920px+          5 tiles, 177px empty  (content caps at 90rem, so it never
//                                           grows out of it)
//
// The rail takes a fifth of the viewport and the content column caps at 90rem,
// so the grid only ever sees a few discrete widths — and none of them is a clean
// multiple of 240 + 16. A fixed track cannot fill a container it does not divide.
//
// `grid-cols-N` is `repeat(N, minmax(0, 1fr))`: tracks share the row exactly, so
// there is no remainder to leave anywhere, and `minmax(0, …)` keeps a long title
// from pushing its own track wider than its share. `justify-start` is gone with
// the remainder it used to park.
//
// The counts are chosen to hold the rendered tile near 240px — the size the old
// fixed track named, and what the square cover and three text rows were drawn
// for — rather than to maximise how many fit:
//
//   md   768-1279   3 cols   153-311px
//   xl   1280-1535  4 cols   226-280px
//   2xl  1536+      5 cols   219-273px   (content caps at 90rem, so 273 is the
//                                         widest a tile ever gets)
//
// Two denser ladders were measured and rejected. Five columns from xl puts 191px
// tiles at 1366px, the most common laptop width, where four give 243px and the
// old layout was only wasting 22px anyway. Four columns from lg puts 174px tiles
// at 1024px, too cramped for a title, a price and a seller row. Filling the row
// is the goal; shrinking the card is not, so where a breakpoint had to choose,
// the wider tile won.
//
// Adding a column necessarily shrinks the tile at that boundary. That is the
// trade for filling the row, and it is only visible while dragging a window.
export const CATALOG_TILE_GRID =
  'grid grid-cols-2 gap-1.5 sm:gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4 2xl:grid-cols-5';

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
  'md:grid md:grid-cols-3 md:gap-4 xl:grid-cols-4 2xl:grid-cols-5';

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
