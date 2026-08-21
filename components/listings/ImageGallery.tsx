'use client';

// components/listings/ImageGallery.tsx
//
// An accessible image gallery: one large image, plus a compact "1/N < >"
// control in the top-right. Clicking the image opens a full-size lightbox —
// the same popout used by contract thumbnails and dispute evidence — so every
// product photo enlarges the same way.

import { useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, ZoomIn } from 'lucide-react';

import { ContractImageLightbox } from '@/components/contract/ContractImageLightbox';
import { cn } from '@/lib/utils';

export interface GalleryImage {
  /** Public image URL (already resolved from the stored object path). */
  src: string;
  /** Accessible label for this image. */
  alt: string;
}

/**
 * Default frame when the caller does not pass `frameClassName`. The listing
 * page overrides this with a document-hero height. Contract and peek surfaces
 * pass their own caps. On short viewports the 22rem min-height legally wins
 * over max-height, so the frame never collapses.
 */
const FRAME_HEIGHT =
  'h-full min-h-[min(22rem,55dvh)] max-h-[calc(100dvh-10rem-env(safe-area-inset-top))] lg:min-h-[22rem] lg:max-h-[calc(100%-3.5rem)]';

/**
 * Render {@link images} as a single main image with prev/next arrow controls
 * overlaid in the top-right corner showing position (e.g. "1/9").
 */
export function ImageGallery({
  images,
  title,
  /** Override the listing page's viewport-tuned frame for embedded surfaces. */
  frameClassName,
}: {
  images: GalleryImage[];
  title: string;
  frameClassName?: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Track image URLs that fail to load so we can swap in a graceful placeholder
  // instead of a broken-image icon (e.g. a moved/expired Storage object).
  const [failedSrcs, setFailedSrcs] = useState<Record<string, true>>({});

  const prev = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setActiveIndex((i) => (i <= 0 ? images.length - 1 : i - 1));
  }, [images.length]);

  const next = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setActiveIndex((i) => (i >= images.length - 1 ? 0 : i + 1));
  }, [images.length]);

  if (images.length === 0) {
    return (
      <div
        className={cn(
          frameClassName ?? FRAME_HEIGHT,
          'flex w-full items-center justify-center rounded-lg border bg-muted text-muted-foreground',
        )}
      >
        <ImageOff className="size-12" aria-hidden />
        <span className="sr-only">No image available for {title}</span>
      </div>
    );
  }

  const active = images[Math.min(activeIndex, images.length - 1)];
  const activeFailed = Boolean(failedSrcs[active.src]);

  return (
    <>
      <div
        className={cn(
          frameClassName ?? FRAME_HEIGHT,
          'group relative w-full overflow-hidden rounded-lg border bg-muted',
        )}
      >
        {activeFailed ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <ImageOff className="size-12" aria-hidden />
            <span className="sr-only">{active.alt} failed to load</span>
          </div>
        ) : (
          <>
            {/* Blurred background fill — same image scaled up behind the contained
                sharp version, like Facebook Marketplace. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.src}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg opacity-90"
              draggable={false}
            />
            <button
              type="button"
              onClick={() => setLightboxIndex(activeIndex)}
              className={cn(
                'absolute inset-0 z-[1] cursor-zoom-in',
                'border border-transparent focus:outline-none focus-visible:border-gold/40',
              )}
              aria-label={`Enlarge photo ${activeIndex + 1} of ${images.length} for ${title}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={active.src}
                alt={active.alt}
                className="h-full w-full object-contain"
                draggable={false}
                onError={() =>
                  setFailedSrcs((prevFailed) => ({ ...prevFailed, [active.src]: true }))
                }
              />
            </button>
          </>
        )}

        {!activeFailed ? (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-3 z-[2] flex items-center gap-tight rounded-full border border-white/15 bg-obsidian/65 px-snug py-1 text-meta font-medium text-white/90 shadow-sm backdrop-blur"
          >
            <ZoomIn className="size-3.5" />
            <span className="[@media(hover:none)]:hidden">Click to enlarge</span>
            <span className="hidden [@media(hover:none)]:inline">Tap to enlarge</span>
          </p>
        ) : null}

        {images.length > 1 ? (
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
