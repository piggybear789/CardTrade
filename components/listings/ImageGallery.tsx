'use client';

// components/listings/ImageGallery.tsx
//
// An accessible image gallery for the item detail page: a single large image
// with a compact "1/N < >" arrow navigation control in the top-right corner.
// No thumbnail rail — keeps the layout clean and lets the image fill the space.
//
// Hovering a mouse magnifies the image around the cursor (the familiar
// marketplace "hover to zoom"), so a buyer can inspect grading, centring, and
// surface wear without leaving the page. It is a mouse-only progressive
// enhancement: touch and keyboard users are unaffected, and nothing about the
// layout or the accessible content depends on it.

import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, ZoomIn } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface GalleryImage {
  /** Public image URL (already resolved from the stored object path). */
  src: string;
  /** Accessible label for this image. */
  alt: string;
}

/**
 * Render {@link images} as a single main image with prev/next arrow controls
 * overlaid in the top-right corner showing position (e.g. "1/9").
 */
export function ImageGallery({
  images,
  title,
}: {
  images: GalleryImage[];
  title: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  // Track image URLs that fail to load so we can swap in a graceful placeholder
  // instead of a broken-image icon (e.g. a moved/expired Storage object).
  const [failedSrcs, setFailedSrcs] = useState<Record<string, true>>({});
  /**
   * Cursor position as a percentage of the frame while a mouse hovers, used as
   * the zoom's transform-origin. `null` means "not zooming".
   */
  const [zoomOrigin, setZoomOrigin] = useState<{ x: number; y: number } | null>(null);

  const prev = useCallback(() => {
    setActiveIndex((i) => (i <= 0 ? images.length - 1 : i - 1));
    setZoomOrigin(null);
  }, [images.length]);

  const next = useCallback(() => {
    setActiveIndex((i) => (i >= images.length - 1 ? 0 : i + 1));
    setZoomOrigin(null);
  }, [images.length]);

  /**
   * Track the cursor so the magnified image follows it. Mouse only: a touch
   * "hover" would zoom on tap and then stick, and a pen behaves likewise.
   */
  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    setZoomOrigin({
      x: ((event.clientX - bounds.left) / bounds.width) * 100,
      y: ((event.clientY - bounds.top) / bounds.height) * 100,
    });
  }, []);

  const clearZoom = useCallback(() => setZoomOrigin(null), []);

  if (images.length === 0) {
    return (
      <div className="flex h-full min-h-[22rem] w-full items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <ImageOff className="size-12" aria-hidden />
        <span className="sr-only">No image available for {title}</span>
      </div>
    );
  }

  const active = images[Math.min(activeIndex, images.length - 1)];
  const activeFailed = Boolean(failedSrcs[active.src]);

  return (
    // Fills the height of its column rather than forcing a 1:1 box, so the
    // gallery lines up with the details beside it instead of ending early and
    // leaving dead space. `min-h` carries the height when the columns wrap to a
    // single stack and there is no definite parent height to fill.
    <div
      className="group relative h-full min-h-[22rem] w-full overflow-hidden rounded-lg border bg-muted"
      onPointerMove={handlePointerMove}
      onPointerLeave={clearZoom}
      onPointerCancel={clearZoom}
    >
      {activeFailed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <ImageOff className="size-12" aria-hidden />
          <span className="sr-only">{active.alt} failed to load</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={active.src}
          alt={active.alt}
          // `contain`, not `cover`: a graded collectible must never be cropped —
          // the slab label and edges are part of what the buyer is inspecting.
          // The zoom scales around the cursor via transform-origin; `transform`
          // keeps it on the compositor, so panning stays smooth.
          className="h-full w-full object-contain transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none [@media(hover:hover)]:cursor-zoom-in"
          style={
            zoomOrigin
              ? {
                  transform: 'scale(2.5)',
                  transformOrigin: `${zoomOrigin.x}% ${zoomOrigin.y}%`,
                }
              : undefined
          }
          draggable={false}
          onError={() =>
            setFailedSrcs((prevFailed) => ({ ...prevFailed, [active.src]: true }))
          }
        />
      )}

      {/* Affordance hint. Only rendered where hover exists, and it fades out
          once the zoom engages so it never sits on top of the detail the buyer
          is trying to look at. Decorative: the zoom adds no information that is
          not already in the image itself. */}
      {!activeFailed && (
        <p
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute bottom-3 left-3 hidden items-center gap-1.5 rounded-full border border-white/20 bg-black/65 px-2.5 py-1 text-xs font-medium text-white/90 shadow-sm backdrop-blur transition-opacity duration-200 [@media(hover:hover)]:flex',
            zoomOrigin ? 'opacity-0' : 'opacity-100',
          )}
        >
          <ZoomIn className="size-3.5" />
          Hover to zoom
        </p>
      )}

      {images.length > 1 && (
        <nav
          className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-white/20 bg-black/65 px-2 py-1 shadow-sm backdrop-blur"
          aria-label="Image navigation"
        >
          <button
            type="button"
            onClick={prev}
            className="flex size-6 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Previous image"
          >
            <ChevronLeft className="size-4" aria-hidden />
          </button>
          <span
            className="min-w-[3ch] text-center text-xs font-medium tabular-nums text-white/90"
            aria-live="polite"
            aria-atomic="true"
          >
            {activeIndex + 1}/{images.length}
          </span>
          <button
            type="button"
            onClick={next}
            className="flex size-6 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Next image"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
