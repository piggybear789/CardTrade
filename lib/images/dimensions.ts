// lib/images/dimensions.ts
//
// The intrinsic pixel size of a stored photo, and the rules for trusting one.
//
// WHY THIS EXISTS. The phone catalog is a staggered two-column mosaic: every
// tile is as tall as its own cover photo, so the columns run out of sync. That
// only works without the grid reflowing on every image load if the aspect ratio
// is known BEFORE the bytes arrive — which means it has to be stored next to
// the path (`items.image_dims`, migration 0106) rather than discovered from the
// decoded image.
//
// A dimension pair reaches us from three places, and only one of them is
// trustworthy:
//   1. the server decoding bytes it uploaded itself (`lib/images/decode.ts`);
//   2. the browser reporting `naturalWidth`/`naturalHeight` for a file it
//      uploaded straight to Storage, which our server never sees;
//   3. a backfill reading object headers over HTTP Range.
// (2) is a claim from a client. Nothing here can be corrupted by a bad claim
// beyond a wrongly-shaped tile, but a NaN, a zero, or a 10-million-pixel width
// would produce a broken or absurd layout, so every value is filtered through
// {@link sanitizeImageDim} on the way in AND on the way out of the database.
//
// This module is isomorphic on purpose — no `server-only`, no dependencies — so
// the browser uploader, the Server Actions, the catalog grid, and the backfill
// script all agree on one definition of "a usable dimension".

/**
 * Intrinsic pixel size of one image, as stored in `items.image_dims`.
 *
 * A type alias rather than an interface so it satisfies the generated `Json`
 * type without a cast: TypeScript gives object literal *aliases* an implicit
 * index signature and interfaces none, and this shape is written straight into
 * a `jsonb` column.
 */
export type ImageDim = {
  w: number;
  h: number;
};

/**
 * Widest and tallest we will believe. Well past any real camera or scanner
 * (8K is 7680px; a 600dpi A4 flatbed scan is ~5000px) and far short of the
 * point where a bogus value could make a tile absurd.
 */
const MAX_EDGE = 30000;

/**
 * Narrowest plausible shape, as the long edge over the short edge. A 20:1
 * sliver is not a photo of a collectible; it is a decode error or a hostile
 * value. Rejected rather than clamped, so the tile falls back to square
 * instead of silently pretending to a shape the image does not have.
 */
const MAX_PLAUSIBLE_RATIO = 20;

/**
 * Accept a width/height pair only if it could describe a real photo.
 *
 * Returns `null` — never a guess — for anything that fails, because a null
 * dimension has a well-defined meaning downstream ("reserve a square") while a
 * fabricated one silently produces a wrong layout.
 */
export function sanitizeImageDim(value: unknown): ImageDim | null {
  if (value == null || typeof value !== 'object') return null;

  const { w, h } = value as { w?: unknown; h?: unknown };
  if (typeof w !== 'number' || typeof h !== 'number') return null;
  if (!Number.isInteger(w) || !Number.isInteger(h)) return null;
  if (w < 1 || h < 1 || w > MAX_EDGE || h > MAX_EDGE) return null;

  const ratio = w > h ? w / h : h / w;
  if (ratio > MAX_PLAUSIBLE_RATIO) return null;

  return { w, h };
}

/**
 * Normalise a list of claimed dimensions to exactly `length` entries, aligned
 * index-for-index with `image_paths`.
 *
 * Alignment is the whole contract of the column: entry `i` describes photo `i`.
 * A short list is padded with nulls and a long one is truncated, so a caller
 * that sends a mismatched array degrades to "unknown" for the odd images out
 * rather than shifting every subsequent tile onto the wrong shape.
 */
export function sanitizeImageDimList(
  value: unknown,
  length: number,
): (ImageDim | null)[] {
  const source = Array.isArray(value) ? value : [];
  const out: (ImageDim | null)[] = new Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = sanitizeImageDim(source[i]);
  }
  return out;
}

/**
 * True when at least one entry is usable. Used to decide whether writing the
 * column is worth it: a row of all-nulls carries no information, but it does
 * mark the row as "already attempted" for the backfill, so both callers exist.
 */
export function hasKnownDim(dims: readonly (ImageDim | null)[]): boolean {
  return dims.some((dim) => dim !== null);
}

/**
 * Read `items.image_dims` back out of a row.
 *
 * The column is `jsonb`, so it arrives as `Json` — effectively `unknown`. It is
 * re-sanitized here rather than trusted, because part of what is in there came
 * from a browser (see the module header) and because a row written before a
 * schema change is still a row we have to render today.
 */
export function readImageDims(
  value: unknown,
  pathCount: number,
): (ImageDim | null)[] {
  return sanitizeImageDimList(value, pathCount);
}

// ---------------------------------------------------------------------------
// Cover geometry
// ---------------------------------------------------------------------------

/**
 * Narrowest and widest cover the mosaic will draw, as width/height.
 *
 * Clamped rather than honoured exactly for two reasons. One freak panorama or
 * one 9:16 phone screenshot would otherwise dominate a column and leave the
 * other one stranded metres behind. And the balance algorithm only stays
 * approximately left-to-right if no single tile is worth several of its
 * neighbours.
 *
 * The floor is 0.7 rather than the more obvious 3:4, because a trading card is
 * 63x88mm — 0.716 — and clamping the single most common shape in the catalog
 * would flatten the mosaic back into the uniform grid it is replacing.
 */
export const COVER_ASPECT_MIN = 0.7;
export const COVER_ASPECT_MAX = 1.4;

/** The shape used when nothing is known about an image. */
export const COVER_ASPECT_FALLBACK = 1;

/**
 * Cover aspect ratio (width / height) for a tile, clamped to the mosaic range.
 * `null` in, fallback out — an unknown image gets a square, which is exactly
 * what the grid drew before dimensions existed.
 */
export function coverAspectRatio(dim: ImageDim | null | undefined): number {
  if (!dim) return COVER_ASPECT_FALLBACK;
  const ratio = dim.w / dim.h;
  if (!Number.isFinite(ratio) || ratio <= 0) return COVER_ASPECT_FALLBACK;
  return Math.min(COVER_ASPECT_MAX, Math.max(COVER_ASPECT_MIN, ratio));
}

/**
 * The same ratio as a CSS `aspect-ratio` value, rounded to keep the inline
 * style — and therefore the server-rendered HTML — stable and diff-friendly.
 */
export function coverAspectCss(dim: ImageDim | null | undefined): string {
  return `${coverAspectRatio(dim).toFixed(4)} / 1`;
}
