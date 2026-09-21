'use client';

// components/listings/ImageGallery.tsx
//
// An accessible image gallery: one large image with optional "1/N < >"
// controls, a full-bleed cover, or a stacked natural-aspect list. Clicking
// a photo opens the same lightbox used by contract thumbnails.

import { useCallback, useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ChevronLeftIcon, ChevronRightIcon, ImageOffIcon, ZoomInIcon } from '@hugeicons/core-free-icons';

import { ContractImageLightbox } from '@/components/contract/ContractImageLightbox';
import { ListingPhotoEmpty } from '@/components/listings/ListingPhotoEmpty';
import { StorageImage } from '@/components/ui/storage-image';
import { cn } from '@/lib/utils';
import type { ImageDim } from '@/lib/images/dimensions';

/**
 * Painted width of the main frame, for `srcset` selection.
 *
 * The desktop listing pane is one of two `lg:flex-1` columns, so the frame is
 * about half the content box once the thumbnail rail is taken off it. Below `lg`
 * the only caller of `stage` is a contract panel at full width.
 */
const FRAME_SIZES = '(max-width: 1023px) 100vw, 45vw';

/**
 * Painted width of one carousel slide: a phone, edge to edge.
 */
const SLIDE_SIZES = '100vw';

/** Painted width of a filmstrip thumbnail — `size-14`, i.e. 3.5rem. */
const THUMB_SIZES = '56px';

/**
 * What the blurred backdrop asks for, which is as little as possible.
 *
 * IT IS SCALED UP AND THEN BLURRED, so resolution is wasted on it twice. At
 * `blur-lg` (a 16px radius) over a frame several hundred pixels wide, a 128px
 * source upscales to roughly 5px per source pixel — a third of the blur radius,
 * so the interpolation is finer than the blur that follows it and there is
 * nothing left to see. Before this the backdrop fetched the FULL original, a
 * second multi-megabyte download per photo purely for decoration, because it sat
 * on a plain `<img>` beside an optimised copy of the same URL.
 */
const BACKDROP_SIZES = '128px';

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
  'h-full min-h-[min(14rem,36dvh)] max-h-[calc(100dvh-10rem-env(safe-area-inset-top))] md:min-h-[min(22rem,55dvh)] lg:min-h-[22rem] lg:max-h-full';

/** Flutter listing photo: 350px cover, edge-to-edge on a phone. */
const COVER_FRAME =
  'h-[min(350px,70dvh)] w-full lg:h-full lg:min-h-[22rem] lg:max-h-full';

/** Empty cover stays shorter so price and description sit above the thumb chrome. */
const COVER_EMPTY_FRAME =
  'h-[min(11.5rem,42dvh)] w-full lg:h-full lg:min-h-[22rem] lg:max-h-full';

/**
 * Frame plus filmstrip, side by side from `lg` with the strip as a rail to the LEFT of the
 * photo.
 *
 * THE SIDE RAIL IS WHAT MAKES THE PHOTO'S BOTTOM EDGE THE COLUMN'S BOTTOM EDGE. While the
 * strip sat underneath, the gallery column ended one thumbnail band lower than the photo
 * did, so the listing page's action stack — pinned to the bottom of the column beside it —
 * finished 64px below the image no matter what that column was told to do. Every fix on
 * that side was a correction after the fact: centring the gallery left slack under the
 * strip, bottom-aligning it moved the slack above the photo, and padding the details
 * column by the band's height put the same 4rem in two files to be kept in step by hand.
 * Beside the frame, the strip occupies width instead of height and the mismatch does not
 * exist to correct.
 *
 * It also reads better at this size: a 3.5rem rail costs a rounding error of width on a
 * `lg` viewport, and a vertical strip can show eight or nine thumbnails at once where a
 * horizontal one under a wide frame shows four and hides the rest behind a scroll.
 *
 * The rail is centred against the photo rather than hung from its top edge, so a listing
 * with three photos reads as a pair of centred blocks instead of a short strip and a tall
 * gap. `items-stretch` is therefore deliberately absent from the shell — the rail sets its
 * own cross-axis alignment.
 *
 * IN PRACTICE THIS IS ALWAYS THE `lg` ROW. The only caller that opts into a filmstrip is
 * the listing page's desktop pane, which is itself `hidden lg:flex`; a phone gets the
 * `carousel` appearance, which has no strip at all. The column direction below `lg` is a
 * defensible default for a future narrower caller rather than a layout that ships — worth
 * knowing before reading the stacked classes as evidence of a phone design.
 */
const GALLERY_SHELL = 'flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-snug';

/**
 * The horizontal band the rail occupies at `lg`: its `w-14` plus the shell's `gap-snug`,
 * so `3.5rem + 0.5rem = 4rem`. Applied as a left margin by anything that needs to line up
 * with the PHOTO rather than with the gallery column's left edge.
 *
 * THE RAIL MADE THOSE TWO EDGES DIFFERENT. Everything in the listing header brackets the
 * page's content box, and so does the gallery column — but the column's first child is now
 * the rail, so the photo starts one band inboard and the back button above it no longer
 * sits over the thing it goes back from. 64px is small enough to read as a mistake rather
 * than as a margin, which is worse than a large gap would be.
 *
 * This is shared geometry in the sense `ROW_GRID` and `CONTRACT_ROW_GRID` already are: two
 * elements in different files aligning to one line. It is NOT the `pb` constant this file
 * used to export, which existed to cancel out a layout the structure got wrong — moving
 * the rail deleted the need for that one, and no structural change removes the need for
 * this one short of making the whole hero a single grid.
 */
export const GALLERY_RAIL_BAND_ML = 'lg:ml-region';

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
   * `stage` — mosaic + contain (contracts, peeks, the desktop listing).
   * `cover` — full-bleed photo like the Flutter listing, with page dots.
   * `carousel` — one photo at a time, swiped horizontally, with dots. Phones.
   */
  appearance = 'stage',
  emptyHint,
  filmstrip = false,
  hero = false,
}: {
  images: GalleryImage[];
  title: string;
  frameClassName?: string;
  appearance?: 'stage' | 'cover' | 'carousel';
  /** Cover empty-state copy. Owners get a prompt to add a photo. */
  emptyHint?: string;
  /**
   * Show a row of thumbnails under the frame, each jumping straight to that photo.
   *
   * OPT-IN rather than automatic on `stage`, because `stage` is also the contract room's
   * item panel and a peek — surfaces where the photo is a reference, not the evidence.
   * The listing page turns it on: for a graded card the photo set IS the valuation, and a
   * buyer wanting the back or the slab label should not have to page through eight images
   * to reach it.
   *
   * Turning this on also puts the gallery in {@link GALLERY_SHELL}, which from `lg` lays
   * the strip out as a rail to the left of the frame. That is a layout contract with the
   * caller as much as a look: the shell is `flex-1`, so the element handed to it should be
   * a flex child that is allowed to grow.
   */
  filmstrip?: boolean;
  /**
   * This gallery is the main subject of its page, so its first photo is worth
   * fetching ahead of the rest of the page's images.
   *
   * A PRIORITY HINT, NOT A PRELOAD. The listing page keeps both galleries mounted
   * at once — the desktop stage and the phone carousel, chosen by CSS — so which
   * photo is the Largest Contentful Paint depends on the viewport, and Next's own
   * guidance is that `preload` is the wrong tool for exactly that case: two
   * `<link rel="preload">` tags for images that are alternatives would spend the
   * early connection budget twice and waste one of them every time.
   *
   * `fetchPriority="high"` on a LAZY image is the combination that works here, and
   * the two are orthogonal rather than contradictory: lazy decides WHETHER and
   * WHEN (an image inside `display: none` never intersects the viewport, so the
   * gallery this breakpoint is not using costs nothing at all), and the hint
   * decides how urgently once a fetch does start. Marking them eager instead
   * would download a full-size photo for the hidden one on every visit.
   *
   * Off for the contract room and the peek, where the photo is a reference and the
   * action card is what the member came for.
   */
  hero?: boolean;
}) {
  const isCover = appearance === 'cover';
  const isCarousel = appearance === 'carousel';
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

  if (isCarousel) {
    return (
      <SwipeCarousel
        images={images}
        title={title}
        hero={hero}
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
      <GalleryShell enabled={filmstrip}>
      <div
        className={cn(
          frame,
          'group relative w-full overflow-hidden bg-muted',
          // Beside the rail the frame takes the width that is left. `w-full` would still
          // ask for all of it and push the rail out of the box.
          filmstrip ? 'lg:w-auto lg:min-w-0 lg:flex-1' : null,
          isCover ? 'rounded-none lg:rounded-lg lg:border' : 'rounded-lg border',
        )}
      >
        {activeFailed ? (
          <GalleryMissing title={title} hint="Photo could not be loaded" />
        ) : (
          <>
            {!isCover ? (
              // Blurred background fill — same image scaled up behind the contained
              // sharp version, like Facebook Marketplace. Asks for 128px; see
              // BACKDROP_SIZES for why that is not a compromise.
              <StorageImage
                src={active.src}
                alt=""
                aria-hidden="true"
                sizes={BACKDROP_SIZES}
                className="scale-110 object-cover blur-lg opacity-90"
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
                'border border-transparent focus:outline-none focus-visible:border-iris',
              )}
              aria-label={`Enlarge photo ${activeIndex + 1} of ${images.length} for ${title}`}
            >
              <StorageImage
                src={active.src}
                alt={active.alt}
                sizes={FRAME_SIZES}
                className={isCover ? 'object-cover' : 'object-contain'}
                fetchPriority={hero ? 'high' : undefined}
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
            className="pointer-events-none absolute bottom-3 left-3 z-[2] flex items-center gap-tight rounded-full border border-white/15 bg-obsidian/65 px-snug py-tight text-meta font-medium text-white/90 shadow-sm backdrop-blur"
          >
            <HugeiconsIcon icon={ZoomInIcon} className="size-3.5" />
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
                  index === activeIndex ? 'bg-iris' : 'bg-card/60',
                )}
              />
            ))}
          </div>
        ) : null}

        {!isCover && images.length > 1 ? (
          <nav
            className="absolute right-3 top-3 z-[2] flex items-center gap-tight rounded-full border border-white/15 bg-obsidian/65 px-tight py-tight shadow-sm backdrop-blur"
            aria-label="Image navigation"
          >
            <button
              type="button"
              onClick={prev}
              className="flex size-11 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 border border-transparent focus:outline-none focus-visible:border-iris"
              aria-label="Previous image"
            >
              <HugeiconsIcon icon={ChevronLeftIcon} className="size-4" aria-hidden />
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
              className="flex size-11 items-center justify-center rounded-full text-white/90 transition-colors hover:bg-white/15 border border-transparent focus:outline-none focus-visible:border-iris"
              aria-label="Next image"
            >
              <HugeiconsIcon icon={ChevronRightIcon} className="size-4" aria-hidden />
            </button>
          </nav>
        ) : null}
      </div>

      {/* THUMBNAILS, ONE TAP EACH. Only worth drawing for more than one photo — a strip
          of one is a smaller copy of the image above it.
          
          `lg:order-first` rather than `lg:flex-row-reverse` on the shell: it moves this
          one element and leaves the frame's position stated by the DOM, so a third child
          added to the shell later lands where it reads. The photo stays first in the DOM
          either way, which is the order a screen reader wants — the content, then the
          control that navigates it. */}
      {filmstrip && images.length > 1 ? (
        <ul
          className={cn(
            'flex shrink-0 items-stretch gap-snug',
            // Narrow fallback: a horizontal strip under the frame. No shipping caller
            // reaches it today — see GALLERY_SHELL.
            'mt-snug h-14 overflow-x-auto overscroll-x-contain',
            // Desktop: a fixed-width rail on the left, scrolling vertically.
            //
            // CENTRED BY SIZING THE RAIL TO ITS THUMBNAILS AND CENTRING THE RAIL, not by
            // centring the thumbnails inside a full-height rail. `justify-center` on a
            // scroll container is the bug where the overflowing end is unreachable:
            // centred content spills equally past both edges, and nothing can scroll
            // above its own start, so with more photos than fit the first thumbnails
            // become permanently invisible. `h-auto` + `max-h-full` + `self-center` gives
            // a rail that is as tall as its contents and vertically centred when the
            // photos fit, and exactly as tall as the frame — scrolling from the top, with
            // every thumbnail reachable — when they do not.
            'lg:order-first lg:mt-0 lg:h-auto lg:max-h-full lg:w-14 lg:flex-col lg:self-center lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-y-contain',
            '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
          aria-label={`Photos of ${title}`}
        >
          {images.map((image, index) => {
            const selected = index === activeIndex;
            const failed = Boolean(failedSrcs[image.src]);
            return (
              <li key={image.src} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveIndex(index)}
                  // `aria-current` rather than `aria-pressed`: these are not toggles,
                  // they select which of a set is showing.
                  aria-current={selected ? 'true' : undefined}
                  aria-label={`Show photo ${index + 1} of ${images.length}`}
                  className={cn(
                    // `relative` so the thumbnail inside can fill it — see
                    // StorageImage, which is always `fill` and resolves against the
                    // nearest positioned ancestor.
                    'relative size-14 overflow-hidden rounded-md border bg-muted transition-colors',
                    'focus:outline-none focus-visible:border-iris',
                    // The selected thumbnail carries a 2px iris edge. Not a scale or an
                    // opacity change: the strip scrolls, and a transform would make the
                    // selected tile clip against its neighbours mid-scroll.
                    selected
                      ? 'border-2 border-iris'
                      : 'border-border opacity-70 hover:opacity-100',
                  )}
                >
                  {failed ? (
                    <span className="grid h-full w-full place-items-center text-muted-foreground">
                      <HugeiconsIcon icon={ImageOffIcon} className="size-4" aria-hidden />
                    </span>
                  ) : (
                    // 56px of source for a 56px box. This rail is where the old
                    // full-resolution `<img>` cost the most: a nine-photo listing
                    // fetched nine originals to paint nine fingernail-sized tiles,
                    // and because the rail is visible at `lg` no amount of lazy
                    // loading would have saved it — only asking for less.
                    <StorageImage
                      src={image.src}
                      alt=""
                      aria-hidden="true"
                      sizes={THUMB_SIZES}
                      className="object-cover"
                      draggable={false}
                      onError={() =>
                        setFailedSrcs((prevFailed) => ({ ...prevFailed, [image.src]: true }))
                      }
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      </GalleryShell>

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

/**
 * Wraps the frame and the filmstrip in {@link GALLERY_SHELL} — but only when there is a
 * filmstrip to place.
 *
 * CONDITIONAL BECAUSE AN UNCONDITIONAL WRAPPER WOULD BREAK EVERY OTHER CALLER. The frame
 * sizes itself with `h-full` against whatever box contains it, and the contract room, the
 * peek and the mosaic all pass their own `frameClassName` cap expecting that box to be
 * the panel they put the gallery in. Slipping an auto-height div in between resolves
 * `h-full` against content instead and the frame collapses.
 *
 * A component rather than a ternary around the JSX so the frame and strip are written
 * once. `display: contents` would also work and is a smaller diff, but the listing page
 * wraps this gallery in a `ViewTransition`, and a box with `display: contents` generates
 * no box for the transition to capture.
 */
function GalleryShell({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return <div className={GALLERY_SHELL}>{children}</div>;
}

/**
 * One photo at a time, swiped horizontally. The phone listing gallery.
 *
 * REPLACES A VERTICAL STACK. That stack drew every photo full-width at its natural
 * aspect, one under the next, which is honest about shape but means a nine-photo listing
 * puts several thousand pixels of scroll between the description and anything below it —
 * and a buyer comparing the front against the back has to scroll back and forth past the
 * ones in between. A carousel puts them a swipe apart.
 *
 * NATIVE SCROLL-SNAP, NOT A JS PAGER. `snap-x snap-mandatory` gives momentum, rubber
 * banding, trackpad and keyboard scrolling and RTL for free, and it keeps working if
 * hydration is slow — the photos are swipeable before any handler attaches. The only JS
 * is reading `scrollLeft` back to light the right dot.
 *
 * ONE FRAME ASPECT FOR EVERY SLIDE, with `object-contain` and a blurred fill behind, the
 * same treatment `stage` uses. Per-photo natural aspect cannot work in a carousel: the
 * frame would change height as you swipe, shifting everything below it on every gesture.
 * `object-contain` still never crops, so no photo is misrepresented — the letterboxing is
 * just filled rather than left blank. `dim` is therefore unused here, and does not need
 * to reserve height because the frame's own aspect does it.
 */
function SwipeCarousel({
  images,
  title,
  hero,
  failedSrcs,
  onFail,
  lightboxIndex,
  onLightboxChange,
}: {
  images: GalleryImage[];
  title: string;
  /** See `ImageGallery`'s `hero`: hints the FIRST slide only. */
  hero: boolean;
  failedSrcs: Record<string, true>;
  onFail: (src: string) => void;
  lightboxIndex: number | null;
  onLightboxChange: (next: number | null) => void;
}) {
  const trackRef = useRef<HTMLUListElement | null>(null);
  const [visibleIndex, setVisibleIndex] = useState(0);

  if (images.length === 0) return null;

  /** Which slide is under the viewport, from the scroll offset. */
  function syncIndex() {
    const track = trackRef.current;
    if (!track || track.clientWidth === 0) return;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    setVisibleIndex(Math.max(0, Math.min(next, images.length - 1)));
  }

  return (
    <>
      <div className="relative">
        <ul
          ref={trackRef}
          onScroll={syncIndex}
          className={cn(
            'flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain',
            // The scrollbar is suppressed because the dots and counter already say
            // there is more, and a horizontal bar under a photo reads as chrome.
            '[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          )}
          aria-label={`Photos of ${title}`}
        >
          {images.map((image, index) => {
            const failed = Boolean(failedSrcs[image.src]);
            return (
              <li
                key={image.src}
                // `snap-center` with a full-width slide behaves as snap-start, and
                // survives the case where a partial slide peeks at the edges.
                className="relative aspect-[4/5] w-full shrink-0 snap-center overflow-hidden rounded-lg border bg-muted"
              >
                {failed ? (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <HugeiconsIcon icon={ImageOffIcon} className="size-8" aria-hidden />
                    <span className="sr-only">Photo could not be loaded for {title}</span>
                  </div>
                ) : (
                  <>
                    <StorageImage
                      src={image.src}
                      alt=""
                      aria-hidden="true"
                      sizes={BACKDROP_SIZES}
                      className="scale-110 object-cover opacity-90 blur-lg"
                      draggable={false}
                    />
                    <button
                      type="button"
                      onClick={() => onLightboxChange(index)}
                      className="absolute inset-0 z-[1] cursor-zoom-in border border-transparent focus:outline-none focus-visible:border-iris"
                      aria-label={`Enlarge photo ${index + 1} of ${images.length} for ${title}`}
                    >
                      {/* EVERY SLIDE USED TO LOAD ON PAGE LOAD. This track is a
                          horizontal scroller, so slides past the first are
                          off-screen and lazy loading applies to them exactly as it
                          would down a page — a nine-photo listing fetched nine
                          full-resolution photos, twice each counting the backdrop,
                          to show one. Native lazy handles horizontal overflow, so
                          the remaining eight now arrive as they are swiped to. */}
                      <StorageImage
                        src={image.src}
                        alt={image.alt}
                        sizes={SLIDE_SIZES}
                        className="object-contain"
                        fetchPriority={hero && index === 0 ? 'high' : undefined}
                        draggable={false}
                        onError={() => onFail(image.src)}
                      />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        {images.length > 1 ? (
          <>
            <p
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-3 z-[2] rounded-full border border-white/15 bg-obsidian/70 px-snug py-0.5 text-meta font-medium tabular-nums text-white/90 shadow-sm backdrop-blur"
            >
              {visibleIndex + 1}/{images.length}
            </p>
            <div
              className="pointer-events-none absolute inset-x-0 bottom-3 z-[2] flex justify-center gap-1.5"
              aria-hidden
            >
              {images.map((image, index) => (
                <span
                  key={image.src}
                  className={cn(
                    'h-2 rounded-full transition-all',
                    index === visibleIndex ? 'w-4 bg-iris' : 'w-2 bg-card/70',
                  )}
                />
              ))}
            </div>
            {/* Spoken position, since the counter and dots are both decorative. */}
            <p className="sr-only" aria-live="polite" aria-atomic="true">
              Photo {visibleIndex + 1} of {images.length}
            </p>
          </>
        ) : null}
      </div>

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
      <div className="hidden h-full w-full flex-col items-center justify-center gap-snug text-muted-foreground md:flex">
        <HugeiconsIcon icon={ImageOffIcon} className="size-12" aria-hidden />
        <span className="sr-only">No image available for {title}</span>
      </div>
    </>
  );
}
