'use client';

// components/listings/ImageGallery.tsx
//
// An accessible image gallery for the item detail page: a single large image
// with a compact "1/N < >" arrow navigation control in the top-right corner.
// No thumbnail rail — keeps the layout clean and lets the image fill the space.
//
// Clicking the image engages a magnifier; moving the pointer then pans the
// zoomed image linearly (eBay-style "click to zoom"). Clicking again or
// leaving the frame disengages. It is a pointer-only progressive enhancement:
// keyboard users are unaffected, and nothing about the layout or the
// accessible content depends on it.

import { useState, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, ZoomIn } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface GalleryImage {
  /** Public image URL (already resolved from the stored object path). */
  src: string;
  /** Accessible label for this image. */
  alt: string;
}

/**
 * Frame height: fill the column, but leave ~3.5rem of breathing room so the
 * image doesn't dominate the pane. At lg the column has a definite height
 * (the bounded split row), so the cap is a simple percentage. Below lg the
 * columns stack and the column's height comes from the frame itself, which
 * would be circular — the viewport cap bounds it instead (header + padding +
 * breadcrumb ≈ 10rem, so the image always fits above the fold). On short
 * viewports the 22rem min-height legally wins over max-height, so the frame
 * never collapses.
 */
const FRAME_HEIGHT =
  'h-full min-h-[22rem] max-h-[calc(100dvh-10rem-env(safe-area-inset-top))] lg:max-h-[calc(100%-3.5rem)]';

/** Magnification while engaged — strong enough to read a slab label. */
const ZOOM_SCALE = 2.5;

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
  // Track image URLs that fail to load so we can swap in a graceful placeholder
  // instead of a broken-image icon (e.g. a moved/expired Storage object).
  const [failedSrcs, setFailedSrcs] = useState<Record<string, true>>({});
  /**
   * Cursor position in frame pixels while the magnifier is engaged, driving
   * the pan. `null` means "not zooming" — the zoom only engages on click.
   */
  const [zoomPoint, setZoomPoint] = useState<{ x: number; y: number } | null>(null);
  /**
   * True once the pointer starts steering an engaged zoom. Transitions are
   * killed while panning so the image tracks the pointer exactly, and restored
   * on engage/disengage so the zoom animates instead of snapping.
   */
  const [panning, setPanning] = useState(false);
  /**
   * Browsers fire `click` after any press-release on the frame — including at
   * the end of a drag-to-pan. Tracking drags per gesture lets the click
   * handler ignore those release clicks so a pan never toggles the zoom off.
   */
  const draggedRef = useRef(false);

  const resetZoom = useCallback(() => {
    setZoomPoint(null);
    setPanning(false);
  }, []);

  // The arrows sit inside the click-to-zoom frame, so their clicks must not
  // bubble up and toggle the zoom while changing images.
  const prev = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setActiveIndex((i) => (i <= 0 ? images.length - 1 : i - 1));
    resetZoom();
  }, [images.length, resetZoom]);

  const next = useCallback((event: React.MouseEvent) => {
    event.stopPropagation();
    setActiveIndex((i) => (i >= images.length - 1 ? 0 : i + 1));
    resetZoom();
  }, [images.length, resetZoom]);

  /** Click toggles the magnifier, anchored at the clicked point. */
  const handleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    setZoomPoint((current) =>
      current
        ? null
        : { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
    );
    setPanning(false);
  }, []);

  /**
   * Pan the engaged zoom with the pointer. Mouse pans freely; touch and pen
   * pan while dragging (a bare touch move would fight the tap-to-toggle).
   */
  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!zoomPoint) return;
      if (event.pointerType !== 'mouse' && event.buttons === 0) return;
      if (event.buttons > 0) draggedRef.current = true;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;
      setPanning(true);
      setZoomPoint({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
    },
    [zoomPoint],
  );

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
    // Fills the height of its column rather than forcing a 1:1 box, so the
    // gallery lines up with the details beside it instead of ending early and
    // leaving dead space. `min-h` carries the height when the columns wrap to a
    // single stack and there is no definite parent height to fill; FRAME_HEIGHT
    // caps it at the viewport so a tall details rail can't drag the image
    // below the fold.
    <div
      className={cn(
        frameClassName ?? FRAME_HEIGHT,
        'group relative w-full overflow-hidden rounded-lg border bg-muted',
        zoomPoint ? 'cursor-zoom-out' : 'cursor-zoom-in',
        // While zoomed, touch drags must pan the image, not scroll the page.
        zoomPoint && 'touch-action-none',
      )}
      onClick={handleClick}
      onPointerDown={() => {
        draggedRef.current = false;
      }}
      onPointerMove={handlePointerMove}
      onPointerLeave={resetZoom}
      onPointerCancel={resetZoom}
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
          //
          // eBay-style zoom: scaling around origin 0,0, the pan is
          // `-(ZOOM-1) * cursor`, which maps the pointer linearly across the
          // zoomed overflow — pointer at a frame edge shows that edge of the
          // image, and the point under the pointer never jumps. Transitions
          // run on engage/disengage so the zoom animates, but are killed while
          // panning so the image tracks the pointer exactly (transition lag
          // during a pan was the old "finicky" feel). `transform` keeps it on
          // the compositor, so tracking stays smooth.
          className={cn(
            'h-full w-full object-contain will-change-transform',
            zoomPoint ? 'cursor-zoom-out' : 'cursor-zoom-in',
            panning
              ? 'transition-none'
              : 'transition-transform duration-150 ease-out motion-reduce:transition-none',
          )}
          // The origin must NEVER change between idle and zoomed frames: it
          // isn't part of the transition, so removing it on zoom-out snapped
          // it to the default 50%/50% mid-animation — the visible "flash".
          style={{
            transformOrigin: '0 0',
            ...(zoomPoint
              ? {
                  transform: `translate(${-(ZOOM_SCALE - 1) * zoomPoint.x}px, ${
                    -(ZOOM_SCALE - 1) * zoomPoint.y
                  }px) scale(${ZOOM_SCALE})`,
                }
              : {}),
          }}
          draggable={false}
          onError={() =>
            setFailedSrcs((prevFailed) => ({ ...prevFailed, [active.src]: true }))
          }
        />
      )}

      {/* Affordance hint, fading out once the zoom engages so it never sits on
          top of the detail the buyer is trying to look at. Decorative: the zoom
          adds no information that is not already in the image itself. */}
      {!activeFailed && (
        <p
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border border-white/20 bg-black/65 px-2.5 py-1 text-xs font-medium text-white/90 shadow-sm backdrop-blur transition-opacity duration-200',
            zoomPoint ? 'opacity-0' : 'opacity-100',
          )}
        >
          <ZoomIn className="size-3.5" />
          <span className="[@media(hover:none)]:hidden">Click to zoom</span>
          <span className="hidden [@media(hover:none)]:inline">Tap to zoom</span>
        </p>
      )}

      {images.length > 1 && (
        <nav
          className="absolute right-3 top-3 flex items-center gap-0.5 rounded-full border border-white/20 bg-black/65 px-1 py-0.5 shadow-sm backdrop-blur"
          aria-label="Image navigation"
        >
          <button
            type="button"
            onClick={prev}
            className="flex size-9 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            className="flex size-9 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Next image"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
