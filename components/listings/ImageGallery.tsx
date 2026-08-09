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

import { useState, useCallback, useEffect, useRef } from 'react';
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
  /** The frame box, needed to map viewport coords once the pointer is outside it. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  /**
   * Engaged flag kept separate from `zoomPoint` so the window listeners below
   * subscribe once per engage rather than once per pan frame.
   */
  const isZoomed = zoomPoint !== null;

  const resetZoom = useCallback(() => {
    setZoomPoint(null);
    setPanning(false);
    // Clear the drag flag too. Panning is now tracked on the window, so a
    // press-drag that happens OUTSIDE the frame can set it; leaving it set would
    // make the next click on the frame get swallowed as a release-click.
    draggedRef.current = false;
  }, []);

  /**
   * Frame coordinates for a viewport point, CLAMPED to the frame box.
   *
   * The clamp is what lets the zoom survive the pointer leaving the frame. The
   * pan is `-(ZOOM-1) * point`, so point `0..W` already spans the entire zoomed
   * overflow — clamping the input therefore parks the pan on the nearest edge
   * instead of running past the image into blank space.
   */
  const pointFromClient = useCallback((clientX: number, clientY: number) => {
    const frame = frameRef.current;
    if (!frame) return null;
    const bounds = frame.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    return {
      x: Math.min(Math.max(clientX - bounds.left, 0), bounds.width),
      y: Math.min(Math.max(clientY - bounds.top, 0), bounds.height),
    };
  }, []);

  /**
   * HOLD THE ZOOM WHEN THE POINTER LEAVES THE FRAME (eBay behaviour).
   *
   * This previously reset on `pointerleave`, so the magnifier died the moment
   * the pointer crossed the frame edge — which is exactly when you are trying
   * to look at the edge of the slab. Tracking on the window instead keeps it
   * engaged and keeps panning, clamped, wherever the pointer goes.
   *
   * Subscribed on ENGAGE, not on every move: the dependency is the boolean, not
   * `zoomPoint`, so a pan does not tear down and re-add three listeners per
   * mouse move.
   *
   * Because leaving the frame no longer disengages, the zoom needs deliberate
   * exits — clicking the image again (see `handleClick`), Escape, or a press
   * outside the frame.
   */
  useEffect(() => {
    if (!isZoomed) return;

    function handleWindowPointerMove(event: PointerEvent) {
      // Mouse pans on hover; touch and pen pan only while held down, so a bare
      // touch move does not fight the tap-to-toggle.
      if (event.pointerType !== 'mouse' && event.buttons === 0) return;
      if (event.buttons > 0) draggedRef.current = true;
      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      setPanning(true);
      setZoomPoint(point);
    }

    // CAPTURE phase, and swallow the key: the gallery is also rendered inside a
    // dialog (ItemPeekDialog), whose own Escape handler would otherwise close
    // the whole dialog. Escape should back out one level — the zoom — and leave
    // the dialog open.
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      resetZoom();
    }

    // A press anywhere outside the frame dismisses. Presses INSIDE are left
    // alone so the frame's own click handler can toggle off.
    function handleOutsidePointerDown(event: PointerEvent) {
      const frame = frameRef.current;
      if (!frame) return;
      if (event.target instanceof Node && !frame.contains(event.target)) {
        resetZoom();
      }
    }

    window.addEventListener('pointermove', handleWindowPointerMove);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, [isZoomed, pointFromClient, resetZoom]);

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
    const point = pointFromClient(event.clientX, event.clientY);
    if (!point) return;
    setZoomPoint((current) => (current ? null : point));
    setPanning(false);
  }, [pointFromClient]);

  // No per-element `onPointerMove`: the window listener above covers movement
  // over the frame as well as outside it, and having both would double every
  // state update during a pan.

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
      ref={frameRef}
      className={cn(
        frameClassName ?? FRAME_HEIGHT,
        'group relative w-full overflow-hidden rounded-lg border bg-muted',
        zoomPoint ? 'cursor-zoom-out' : 'cursor-zoom-in',
        // While zoomed, touch drags must pan the image, not scroll the page.
        zoomPoint && 'touch-none',
      )}
      onClick={handleClick}
      onPointerDown={() => {
        draggedRef.current = false;
      }}
      // NO `onPointerLeave` reset. Holding the zoom past the frame edge is the
      // point (eBay does the same): the pan clamps to the nearest edge and stays
      // engaged, so inspecting the edge of a slab no longer cancels the zoom.
      // Exits are click-again, Escape, or a press outside the frame.
      onPointerCancel={resetZoom}
    >
      {activeFailed ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <ImageOff className="size-12" aria-hidden />
          <span className="sr-only">{active.alt} failed to load</span>
        </div>
      ) : (
        <>
          {/* Blurred background fill — same image scaled up behind the contained
              sharp version, like Facebook Marketplace. Fills the dead space around
              non-square images with a soft mosaic of the image's own colours. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={active.src}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-lg opacity-90"
            draggable={false}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
              'relative h-full w-full object-contain will-change-transform',
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
        </>
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
          className="absolute right-3 top-3 flex items-center gap-1 rounded-full border border-white/20 bg-black/65 px-1 py-0.5 shadow-sm backdrop-blur"
          aria-label="Image navigation"
        >
          <button
            type="button"
            onClick={prev}
            className="flex size-11 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            className="flex size-11 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Next image"
          >
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  );
}
