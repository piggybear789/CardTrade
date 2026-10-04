'use client';

// components/contract/ContractImageLightbox.tsx
//
// Evidence photos, viewable. Contract rooms showed item images at 40–112px with no
// way to enlarge them — and in the cash sale room the thumbnail strip was a 7rem
// vertical scroll container, so the third and fourth photos were effectively
// hidden. That is a problem for a marketplace where the photos ARE the condition
// report and part of the dispute record.
//
// `ContractThumbnails` renders a fixed horizontal strip (up to four, then a `+N`
// tile) and opens this lightbox on click. Arrow keys page through. Click the
// photo to zoom; move the pointer to pan.
//
// THE FRAME TAKES THE PHOTO'S SHAPE. It was a fixed box, up to 64rem wide and at
// most 36rem tall, so on any screen wider than it was tall the viewer was landscape
// whatever it held — and what it holds is nearly always a portrait card, which
// opened as a narrow strip between two black bars. The frame is now as large as
// the viewport allows at the photo's own aspect ratio: a stored dimension when the
// caller has one, the loaded image's size once it arrives, card-shaped until then.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronLeftIcon, ChevronRightIcon, ImageOffIcon, XIcon } from '@hugeicons/core-free-icons';

import { ZoomableImage } from '@/components/listings/ZoomableImage';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { StorageImage } from '@/components/ui/storage-image';
import type { ImageDim } from '@/lib/images/dimensions';
import { cn } from '@/lib/utils';

/**
 * The frame's shape (width / height) until the photo's own is known.
 *
 * A card is 63 × 88mm (0.716) and a phone photo of one is 3:4 (0.75), so 3:4 is the
 * closest single guess to nearly everything this viewer opens. A wrong guess costs a
 * resize when the photo lands, never a crop: the image is `object-contain`.
 */
const DEFAULT_PHOTO_ASPECT = 3 / 4;

/**
 * Bounds on the FRAME, not the photo, which is never cropped. They stop an extreme
 * shape from leaving a sliver too small to hold the close and paging controls. A
 * phone screenshot is about 0.46; a panorama is 3.
 */
const MIN_PHOTO_ASPECT = 0.4;
const MAX_PHOTO_ASPECT = 3;

/**
 * The largest frame the viewport allows, as CSS lengths. The height keeps room for
 * the dialog's margin and the one-line caption under the frame, so the dialog never
 * needs its own scrollbar.
 */
const FRAME_MAX_WIDTH = '100vw - 1.5rem';
const FRAME_MAX_HEIGHT = '100dvh - 6rem';

function clampAspect(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return DEFAULT_PHOTO_ASPECT;
  return Math.min(MAX_PHOTO_ASPECT, Math.max(MIN_PHOTO_ASPECT, ratio));
}

/**
 * Painted width of each tile size, taken from the `size-*` classes below rather
 * than guessed: `size-11` is 2.75rem and `size-16` is 4rem.
 *
 * These are the numbers that make the thumbnails cheap. Every tile here used to
 * fetch the FULL uploaded photo — a contract room with four item photos and four
 * evidence photos pulled eight originals to paint eight tiles the size of a
 * postage stamp.
 */
const TILE_SIZES = {
  sm: '44px',
  md: '64px',
} as const;

/**
 * Painted width of the promoted photo in the `stacked` layout.
 *
 * The showcase column it sits in is `minmax(0, 15rem)` from `sm` up (see
 * `ContractExchangePanel`), and full width below that.
 */
const STACKED_PRIMARY_SIZES = '(max-width: 639px) 100vw, 240px';

/** Dark, translucent control that floats over the photo rather than beside it. */
const LIGHTBOX_CONTROL =
  'z-10 grid size-10 touch-manipulation place-items-center rounded-full bg-obsidian/60 text-mist backdrop-blur transition-colors hover:bg-obsidian/80 border border-transparent focus:outline-none focus-visible:border-mist';

export interface ContractImageLightboxProps {
  /** Resolved image URLs, in order. */
  images: string[];
  /** Index to open at; `null` keeps the lightbox closed. */
  openIndex: number | null;
  onOpenChange: (openIndex: number | null) => void;
  /** Accessible caption, e.g. the item title. */
  label: string;
  /**
   * Stored pixel sizes, index-aligned with {@link images} (`items.image_dims`).
   *
   * Optional, and only a head start: with one, the frame opens at the photo's shape
   * instead of resizing when it loads. The loaded image's own size always wins,
   * because it is measured after EXIF rotation and a stored pair may not have been.
   */
  dims?: readonly (ImageDim | null | undefined)[];
}

/** A full-size, keyboard-pageable view of a contract's photos. */
export function ContractImageLightbox({
  images,
  openIndex,
  onOpenChange,
  label,
  dims,
}: ContractImageLightboxProps) {
  const [index, setIndex] = useState(openIndex ?? 0);
  // Measured shapes, by URL, so paging back to a photo does not resize twice.
  const [measured, setMeasured] = useState<Record<string, number>>({});

  useEffect(() => {
    if (openIndex !== null) setIndex(openIndex);
  }, [openIndex]);

  const step = useCallback(
    (delta: number) => {
      setIndex((current) => {
        if (images.length === 0) return 0;
        return (current + delta + images.length) % images.length;
      });
    },
    [images.length],
  );

  const open = openIndex !== null;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  const src = images[index];
  const stored = dims?.[index];
  const aspect = clampAspect(
    (src ? measured[src] : undefined) ??
      (stored ? stored.w / stored.h : DEFAULT_PHOTO_ASPECT),
  );

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next ? index : null)}>
      {/* A photo viewer is not a paper card. Cream padding and a bordered
          chevron next to a slab makes the chrome compete with the thing being
          inspected, so the panel is stripped to the image and dark controls
          that float over it.

          SIZED IN CSS, NOT MEASURED. The width is the smaller of "the viewport's
          width" and "the viewport's height at this photo's aspect", and the frame's
          height is the same pair the other way round, so a rotation or a resized
          window refits without a listener. Inline because the arithmetic reads a
          custom property, which Tailwind's arbitrary-value maths does not handle
          reliably. `max-md:px-0` removes the phone safe-area padding every dialog
          carries, which would otherwise make the frame narrower than the height it
          was computed from and put the letterbox back. */}
      <DialogContent
        mobile="center"
        showClose={false}
        style={
          {
            '--photo-aspect': aspect,
            width: `min(${FRAME_MAX_WIDTH}, (${FRAME_MAX_HEIGHT}) * var(--photo-aspect))`,
          } as CSSProperties
        }
        className="max-w-none gap-cozy border-0 bg-transparent p-0 shadow-none max-md:px-0 sm:max-w-none sm:p-0"
      >
        <DialogTitle className="sr-only">{label}</DialogTitle>

        <div
          className="relative min-w-0 shrink-0 overflow-hidden rounded-xl bg-obsidian"
          style={{
            height: `min((${FRAME_MAX_WIDTH}) / var(--photo-aspect), ${FRAME_MAX_HEIGHT})`,
          }}
        >
          {src ? (
            <ZoomableImage
              key={src}
              src={src}
              alt={`${label} — photo ${index + 1} of ${images.length}`}
              onNaturalSize={(width, height) =>
                setMeasured((current) =>
                  current[src] === width / height
                    ? current
                    : { ...current, [src]: width / height },
                )
              }
            />
          ) : (
            <div className="grid size-full place-items-center text-mist/50">
              <HugeiconsIcon icon={ImageOffIcon} className="size-8" aria-hidden />
            </div>
          )}

          <DialogClose className={cn(LIGHTBOX_CONTROL, 'absolute right-2 top-2')}>
            <HugeiconsIcon icon={XIcon} className="size-4" aria-hidden />
            <span className="sr-only">Close</span>
          </DialogClose>

          {images.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous photo"
                className={cn(
                  LIGHTBOX_CONTROL,
                  'absolute left-2 top-1/2 -translate-y-1/2',
                )}
              >
                <HugeiconsIcon icon={ChevronLeftIcon} className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next photo"
                className={cn(
                  LIGHTBOX_CONTROL,
                  'absolute right-2 top-1/2 -translate-y-1/2',
                )}
              >
                <HugeiconsIcon icon={ChevronRightIcon} className="size-5" aria-hidden />
              </button>
            </>
          ) : null}
        </div>

        {/* ONE LINE, COUNT FIRST. The dialog is now only as wide as the photo, so a
            long title would wrap under a narrow portrait frame and push the dialog
            past the height the frame was sized to leave. Truncating keeps it to one
            line, and leading with the count means the ellipsis eats the title, not
            the "3 of 9" a member is paging by. */}
        <p
          className="truncate text-center text-meta tabular-nums text-mist/70"
          aria-live="polite"
        >
          {index + 1} of {images.length} · {label}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export interface ContractThumbnailsProps {
  /** Resolved image URLs. */
  images: string[];
  /** Accessible caption for the set. */
  label: string;
  /** How many tiles to show before collapsing the rest into `+N`. */
  max?: number;
  /** Tile size. `sm` for inline item rows, `md` for a section's own preview. */
  size?: 'sm' | 'md';
  /**
   * `strip` (default) is the equal-tile row used by item rows and evidence sets.
   *
   * `stacked` promotes the first photo to a full-width 3:4 frame with the rest as a
   * small strip underneath — the listing-page treatment, for surfaces where the
   * item is the subject of the panel rather than one row in a list. A 64px tile
   * cannot show the condition of a collectible, which is the whole reason a buyer
   * opens the Item tab. Portrait, not square: the photo is nearly always a card,
   * and a square frame spent a quarter of its width on empty sides.
   */
  layout?: 'strip' | 'stacked';
  className?: string;
}

/**
 * Shows a deliberate unavailable state instead of the browser's broken-image glyph.
 *
 * Goes through {@link StorageImage} rather than `next/image` directly, because
 * `ContractThumbnails` renders BOTH kinds of URL: item photos from the public
 * bucket, which optimise, and dispute and private-deal evidence, which arrive as
 * short-lived signed URLs from a private bucket and must not. The wrapper decides
 * from the URL; this component does not need to know which it was handed.
 */
function ContractThumbnailImage({
  src,
  alt = '',
  sizes,
  loading,
  className,
  fallbackClassName,
}: {
  src: string;
  alt?: string;
  /** Painted width of the tile. See {@link TILE_SIZES}. */
  sizes: string;
  loading?: 'eager' | 'lazy';
  className?: string;
  fallbackClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt || 'Image unavailable'}
        className={cn(
          'grid h-full w-full place-items-center text-muted-foreground',
          fallbackClassName ?? className,
        )}
      >
        <HugeiconsIcon icon={ImageOffIcon} className="size-7" aria-hidden />
      </span>
    );
  }

  return (
    <StorageImage
      src={src}
      alt={alt}
      sizes={sizes}
      loading={loading}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Clickable thumbnails that open a full-size lightbox. Never a scroll container;
 * overflow collapses into a `+N` tile that opens at that photo.
 */
export function ContractThumbnails({
  images,
  label,
  max = 4,
  size = 'md',
  layout = 'strip',
  className,
}: ContractThumbnailsProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const tile = size === 'sm' ? 'size-11' : 'size-16';
  const stacked = layout === 'stacked';

  if (images.length === 0) {
    return (
      <div
        className={cn(
          'grid place-items-center text-muted-foreground',
          stacked
            ? 'aspect-[3/4] w-full'
            : cn('shrink-0 rounded-md border bg-muted', tile),
          className,
        )}
      >
        <HugeiconsIcon icon={ImageOffIcon} className={stacked ? 'size-8' : 'size-4'} aria-hidden />
        <span className="sr-only">No photos for {label}</span>
      </div>
    );
  }

  if (stacked) {
    const [primary, ...rest] = images;
    const restShown = rest.slice(0, 3);
    const restOverflow = rest.length - restShown.length;

    return (
      <>
        <div className={cn('flex w-full min-w-0 flex-col gap-tight', className)}>
          <button
            type="button"
            onClick={() => setOpenIndex(0)}
            aria-label={`Enlarge photo 1 of ${images.length} for ${label}`}
            // `relative` so the photo can fill it — StorageImage is always `fill`.
            className="relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-transparent transition hover:opacity-90 focus:outline-none focus-visible:border-iris/60"
          >
            <ContractThumbnailImage
              src={primary}
              sizes={STACKED_PRIMARY_SIZES}
              className="object-contain"
            />
          </button>

          {rest.length > 0 ? (
            <ul className="flex items-center gap-tight" aria-label={`${label} photos`}>
              {restShown.map((src, index) => (
                <li key={src}>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(index + 1)}
                    aria-label={`Enlarge photo ${index + 2} of ${images.length} for ${label}`}
                    className={cn(
                      'relative overflow-hidden rounded-md border bg-muted transition',
                      'hover:opacity-90 border border-transparent focus:outline-none focus-visible:border-iris/60',
                      'size-11',
                    )}
                  >
                    <ContractThumbnailImage
                      src={src}
                      sizes={TILE_SIZES.sm}
                      loading="lazy"
                      className="object-cover"
                    />
                  </button>
                </li>
              ))}
              {restOverflow > 0 ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(restShown.length + 1)}
                    aria-label={`See all ${images.length} photos for ${label}`}
                    className="size-11 rounded-md border bg-muted text-meta font-semibold tabular-nums text-muted-foreground transition hover:bg-accent focus:outline-none focus-visible:border-iris/60"
                  >
                    +{restOverflow}
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <ContractImageLightbox
          images={images}
          openIndex={openIndex}
          onOpenChange={setOpenIndex}
          label={label}
        />
      </>
    );
  }

  const shown = images.slice(0, max);
  const overflow = images.length - shown.length;

  return (
    <>
      <ul className={cn('flex shrink-0 items-center gap-tight', className)} aria-label={`${label} photos`}>
        {shown.map((src, index) => (
          <li key={src}>
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              aria-label={`Enlarge photo ${index + 1} of ${images.length} for ${label}`}
              className={cn(
                'relative overflow-hidden rounded-md border bg-muted transition',
                'border border-transparent hover:opacity-90 focus:outline-none focus-visible:border-iris/60',
                tile,
              )}
            >
              <ContractThumbnailImage
                src={src}
                sizes={TILE_SIZES[size]}
                loading="lazy"
                className="object-cover"
              />
            </button>
          </li>
        ))}
        {overflow > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => setOpenIndex(max)}
              aria-label={`See all ${images.length} photos for ${label}`}
              className={cn(
                'rounded-md border bg-muted text-meta font-semibold tabular-nums text-muted-foreground transition',
                'hover:bg-accent border border-transparent focus:outline-none focus-visible:border-iris/60',
                tile,
              )}
            >
              +{overflow}
            </button>
          </li>
        ) : null}
      </ul>

      <ContractImageLightbox
        images={images}
        openIndex={openIndex}
        onOpenChange={setOpenIndex}
        label={label}
      />
    </>
  );
}
