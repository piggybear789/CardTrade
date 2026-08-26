'use client';

// components/listings/ImageGallery.tsx
//
// An accessible image gallery: one large image with optional "1/N < >"
// controls, a full-bleed cover, or a stacked natural-aspect list. Clicking
// a photo opens the same lightbox used by contract thumbnails.

import { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, ZoomIn } from 'lucide-react';

import { ContractImageLightbox } from '@/components/contract/ContractImageLightbox';
import { ListingPhotoEmpty } from '@/components/listings/ListingPhotoEmpty';
import { cn } from '@/lib/utils';
import type { ImageDim } from '@/lib/images/dimensions';

export interface GalleryImage {
  /** Public image URL (already resolved from the stored object path). */
  src: string;
  /** Accessible label for this image. */
  alt: string;
  /**
   * Intrinsic pixel size from `items.image_dims` (0106), when known.
   *
   * Only the `stack` appearance uses it, and it is what stops the listing page
   * from shuffling downward as each photo arrives: `stack` deliberately draws
   * photos at their natural aspect, so without a reserved height the page has
   * no idea how tall a frame will be until the file has loaded. `stage` and
   * `cover` draw into fixed frames and never had the problem.
   *
   * Unclamped, unlike the catalog mosaic — a panorama on its own listing page
   * should be a panorama.
   */
  dim?: ImageDim | null;
}

/**
 * Default frame when the caller does not pass `frameClassName`. The listing
 * page overrides this with a document-hero height. Contract and peek surfaces
 * pass their own caps. On short viewports the 22rem min-height legally wins
 * over max-height, so the frame never collapses.
 */
const FRAME_HEIGHT =
  'h-full min-h-[min(14rem,36dvh)] max-h-[calc(100dvh-10rem-env(safe-area-inset-top))] md:min-h-[min(22rem,55dvh)] lg:min-h-[22rem] lg:max-h-[calc(100%-3.5rem)]';

/** Flutter listing photo: 350px cover, edge-to-edge on a phone. */
const COVER_FRAME =
  'h-[min(350px,70dvh)] w-full lg:h-full lg:min-h-[22rem] lg:max-h-[calc(100%-3.5rem)]';

/** Empty cover stays shorter so price and description sit above the thumb chrome. */
const COVER_EMPTY_FRAME =
  'h-[min(11.5rem,42dvh)] w-full lg:h-full lg:min-h-[22rem] lg:max-h-[calc(100%-3.5rem)]';

/** Horizontal travel (px) that counts as a swipe, not a tap-to-enlarge. */
const SWIPE_THRESHOLD_PX = 40;

/**
 * Render {@link images} as a single main image with prev/next arrow controls
 * overlaid in the top-right corner showing position (e.g. "1/9").
 */
export function ImageGallery({
  images,
  title,
  /** Override the listing page's viewport-tuned frame for embedded surfaces. */
  frameClassName,
  /**
   * `stage` — mosaic + contain (contracts, peeks).
   * `cover` — full-bleed photo like the Flutter listing, with page dots.
   * `stack` — one full-width frame per photo, natural aspect, no crop.
   */
  appearance = 'stage',
  emptyHint,
}: {
  images: GalleryImage[];
  title: string;
  frameClassName?: string;
  appearance?: 'stage' | 'cover' | 'stack';
  /** Cover empty-state copy. Owners get a prompt to add a photo. */
  emptyHint?: string;
}) {
  const isCover = appearance === 'cover';
  const isStack = appearance === 'stack';
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Track image URLs that fail to load so we can swap in a graceful placeholder
  // instead of a broken-image icon (e.g. a moved/expired Storage object).
  const [failedSrcs, setFailedSrcs] = useState<Record<string, true>>({});
  const swipeStartX = useRef<number | null>(null);
  const didSwipe = useRef(false);

  const goPrev = useCallback(() => {
    setActiveIndex((i) => (i <= 0 ? images.length - 1 : i - 1));
  }, [images.length]);

  const goNext = useCallback(() => {
    setActiveIndex((i) => (i >= images.length - 1 ? 0 : i + 1));
  }, [images.length]);

  const prev = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    goPrev();
  }, [goPrev]);

  const next = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    goNext();
  }, [goNext]);

  const onSwipePointerDown = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    swipeStartX.current = event.clientX;
    didSwipe.current = false;
  }, []);

  const onSwipePointerMove = useCallback((event: React.PointerEvent) => {
    if (swipeStartX.current == null) return;
    if (Math.abs(event.clientX - swipeStartX.current) > 12) {
      didSwipe.current = true;
    }
  }, []);

  const onSwipePointerUp = useCallback((event: React.PointerEvent) => {
    if (swipeStartX.current == null) return;
    const dx = event.clientX - swipeStartX.current;
    swipeStartX.current = null;
    if (images.length < 2 || Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    didSwipe.current = true;
    if (dx > 0) goPrev();
    else goNext();
  }, [goNext, goPrev, images.length]);

  const openLightbox = useCallback(() => {
    if (didSwipe.current) {
      didSwipe.current = false;
      return;
    }
    setLightboxIndex(activeIndex);
  }, [activeIndex]);

  const frame =
    frameClassName ??
    (isCover
      ? images.length === 0
        ? COVER_EMPTY_FRAME
        : COVER_FRAME
      : FRAME_HEIGHT);

  if (isStack) {
    return (
      <StackedGallery
        images={images}
        title={title}
        failedSrcs={failedSrcs}
        onFail={(src) =>
          setFailedSrcs((prevFailed) => ({ ...prevFailed, [src]: true }))
        }
        lightboxIndex={lightboxIndex}
        onLightboxChange={(next) => {
          setLightboxIndex(next);
          if (next !== null) setActiveIndex(next);
        }}
      />
    );
  }

  if (images.length === 0) {
    return (
      <div
        className={cn(
          frame,
          'w-full overflow-hidden',
          isCover ? 'rounded-none lg:rounded-lg lg:border' : 'rounded-lg border',
        )}
      >
        <GalleryMissing title={title} hint={emptyHint} />
      </div>
    );
  }

  const active = images[Math.min(activeIndex, images.length - 1)];
  const activeFailed = Boolean(failedSrcs[active.src]);

  return (
    <>
      <div
        className={cn(
          frame,
          'group relative w-full overflow-hidden bg-muted',
          isCover ? 'rounded-none lg:rounded-lg lg:border' : 'rounded-lg border',
        )}
      >
        {activeFailed ? (
          <GalleryMissing title={title} hint="Photo could not be loaded" />
        ) : (
          <>
            {!isCover ? (
              // Blurred background fill — same image scaled up behind the contained
              // sharp version, like Facebook Marketplace.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={active.src}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg opacity-90"
                draggable={false}
              />
            ) : null}
            <button
              type="button"
              onClick={openLightbox}
              onPointerDown={onSwipePointerDown}
              onPointerMove={onSwipePointerMove}
              onPointerUp={onSwipePointerUp}
              onPointerCancel={() => {
                swipeStartX.current = null;
              }}
              className={cn(
                'absolute inset-0 z-[1] cursor-zoom-in touch-pan-y',
                'border border-transparent focus:outline-none focus-visible:border-gold/40',
              )}
              aria-label={`Enlarge photo ${activeIndex + 1} of ${images.length} for ${title}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={active.src}
                alt={active.alt}
                className={cn('h-full w-full', isCover ? 'object-cover' : 'object-contain')}
                draggable={false}
                onError={() =>
                  setFailedSrcs((prevFailed) => ({ ...prevFailed, [active.src]: true }))
                }
              />
            </button>
          </>
        )}

        {!activeFailed && !isCover ? (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-3 z-[2] flex items-center gap-tight rounded-full border border-white/15 bg-obsidian/65 px-snug py-1 text-meta font-medium text-white/90 shadow-sm backdrop-blur"
          >
            <ZoomIn className="size-3.5" />
            <span className="[@media(hover:none)]:hidden">Click to enlarge</span>
            <span className="hidden [@media(hover:none)]:inline">Tap to enlarge</span>
          </p>
        ) : null}

        {isCover && images.length > 1 ? (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-3 z-[2] flex justify-center gap-1.5"
            aria-hidden
          >
            {images.map((image, index) => (
              <span
                key={image.src}
                className={cn(
                  'size-2 rounded-full',
                  index === activeIndex ? 'bg-gold' : 'bg-card/60',
                )}
              />
            ))}
          </div>
        ) : null}

        {!isCover && images.length > 1 ? (
          <nav
            className="absolute right-3 top-3 z-[2] flex items-center gap-1 rounded-full border border-white/15 bg-obsidian/65 px-1 py-tight shadow-sm backdrop-blur"
            aria-label="Image navigation"
          >
            <button
              type="button"
              onClick={prev}
              className="flex size-11 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 border border-transparent focus:outline-none focus-visible:border-gold/40"
              aria-label="Previous image"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <span
              className="min-w-[3ch] text-center text-meta font-medium tabular-nums text-white/90"
              aria-live="polite"
              aria-atomic="true"
            >
              {activeIndex + 1}/{images.length}
            </span>
            <button
              type="button"
              onClick={next}
              className="flex size-11 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 border border-transparent focus:outline-none focus-visible:border-gold/40"
              aria-label="Next image"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </nav>
        ) : null}
      </div>

      <ContractImageLightbox
        images={images.map((image) => image.src)}
        openIndex={lightboxIndex}
        onOpenChange={(next) => {
          setLightboxIndex(next);
          if (next !== null) setActiveIndex(next);
        }}
        label={title}
      />
    </>
  );
}

function StackedGallery({
  images,
  title,
  failedSrcs,
  onFail,
  lightboxIndex,
  onLightboxChange,
}: {
  images: GalleryImage[];
  title: string;
  failedSrcs: Record<string, true>;
  onFail: (src: string) => void;
  lightboxIndex: number | null;
  onLightboxChange: (next: number | null) => void;
}) {
  if (images.length === 0) return null;

  return (
    <>
      <ul className="flex flex-col gap-3">
        {images.map((image, index) => {
          const failed = Boolean(failedSrcs[image.src]);
          return (
            <li key={image.src}>
              {failed ? (
                <div className="flex min-h-24 w-full items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                  <ImageOff className="size-8" aria-hidden />
                  <span className="sr-only">Photo could not be loaded for {title}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onLightboxChange(index)}
                  className="block w-full cursor-zoom-in overflow-hidden rounded-lg border bg-muted focus:outline-none focus-visible:border-gold/40"
                  aria-label={`Enlarge photo ${index + 1} of ${images.length} for ${title}`}
                >
                  {/* Natural aspect: width fills the column, height follows the
                      file. `aspect-ratio` reserves that height up front when the
                      size is stored, so the description above does not jump as
                      each photo lands; once loaded the intrinsic ratio is the
                      same value, so nothing moves. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.src}
                    alt={image.alt}
                    className="block h-auto w-full"
                    style={
                      image.dim
                        ? { aspectRatio: `${image.dim.w} / ${image.dim.h}` }
                        : undefined
                    }
                    draggable={false}
                    onError={() => onFail(image.src)}
                  />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <ContractImageLightbox
        images={images.map((image) => image.src)}
        openIndex={lightboxIndex}
        onOpenChange={onLightboxChange}
        label={title}
      />
    </>
  );
}

function GalleryMissing({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <>
      <div className="h-full w-full md:hidden">
        <ListingPhotoEmpty title={title} hint={hint} />
      </div>
      <div className="hidden h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground md:flex">
        <ImageOff className="size-12" aria-hidden />
        <span className="sr-only">No image available for {title}</span>
      </div>
    </>
  );
}
