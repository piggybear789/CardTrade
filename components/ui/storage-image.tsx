// components/ui/storage-image.tsx
//
// One remote photo, drawn into a box its parent has already sized, through the
// image optimizer when that is possible and a plain `<img>` when it is not.
//
// WHAT THIS REPLACES. A near-identical wrapper lived here and nothing ever
// imported it, so the app kept hand-rolling ~25 raw `<img>` tags — each with its
// own `eslint-disable @next/next/no-img-element` — and served the ORIGINAL
// uploaded file everywhere except the catalog tile. A 56px filmstrip thumbnail
// downloaded a multi-megabyte phone photo, ten of them per listing.
//
// The old version also documented a claim that is false, and worth naming because
// it is the reason the blurred backdrops cost what they did: that a decorative
// `<img>` on the same URL reuses the bytes the optimised copy already fetched. It
// does not. `/_next/image?url=…` and the Storage origin URL are different
// resources with different cache entries, so pairing an optimised photo with a raw
// decorative copy of itself downloads the full original IN ADDITION to the resized
// one.
//
// WHY A WRAPPER RATHER THAN `next/image` AT EACH SITE. `next/image` THROWS at
// runtime for a host outside `images.remotePatterns`, and three kinds of URL that
// legitimately reach these components are outside it: signed URLs for the private
// buckets, OAuth profile pictures, and `blob:` upload previews. Choosing per call
// site is how that becomes a broken page in the one flow nobody re-tested. Here
// the choice is made once, from the URL, by `isOptimizableImageUrl`.
//
// TWO LAYOUT MODES, AND THE TYPE MAKES YOU PICK ONE.
//
// `sizes` — the image fills a box whose size its parent already decided: an
// aspect-ratio container, a fixed frame, a `size-*` tile. Uses `fill`, so the
// parent must be positioned. `sizes` is REQUIRED in this mode, because a `fill`
// image without it silently falls back to `100vw` and asks for a ~2000px source
// to paint a thumbnail — the exact bug this module exists to remove, wearing the
// costume of a fix.
//
// `width`/`height` — a fixed-size thumbnail in a flex row, with no positioned
// wrapper to fill. Next answers a numeric width and no `sizes` with `1x`/`2x`
// descriptors (`getWidths` in `get-img-props`), which is precisely right here and
// needs no media query. GIVE IT THE CSS SIZE, NOT A DOUBLED ONE: several call
// sites used to declare `width={96}` on a `size-12` tile, hand-rolling a 2x
// descriptor that Next generates anyway, so the browser fetched 192px of source
// for a 48px box.
//
// A union rather than two components, because everything that matters — the
// optimize-or-fall-back decision — is identical, and two components would be two
// places to forget it.
//
// NO `preload` PROP, AND NO `priority`. `priority` is deprecated as of Next 16 in
// favour of `preload`, and `preload` is documented as the wrong tool when several
// images could be the LCP element depending on the viewport — which is the case on
// every surface here. The listing page keeps BOTH galleries in the DOM at once
// (the desktop stage and the phone carousel, switched by CSS), and the catalog's
// LCP tile differs between a 2-column phone grid and a 4-column desktop one. Two
// `<link rel="preload">` tags for images that are alternatives, not companions,
// spend the early connection budget twice and one of them is always wasted. Use
// `loading="eager"` with `fetchPriority="high"`, which is the framework's own
// recommendation for this shape.
//
// NO `quality` PROP EITHER. `images.qualities` defaults to `[75]` in Next 16 and a
// value outside the configured list is silently COERCED to the nearest allowed
// entry, so a `quality={40}` on a blurred backdrop would read as a deliberate
// saving and deliver none. Shrink those with `sizes` instead, where the effect is
// real: a 128px source for a `blur-lg` decoration is a four-order-of-magnitude
// reduction on its own and needs no help from the quality knob.

import Image from 'next/image';
import type { HTMLAttributeReferrerPolicy } from 'react';

import { isOptimizableImageUrl } from '@/lib/images/optimizable';
import { cn } from '@/lib/utils';

/**
 * Pick one: fill a sized box, or draw at a fixed pixel size.
 *
 * The `never` members are what make it exclusive — passing both is a type error
 * rather than a silent precedence rule nobody remembers.
 */
type StorageImageLayout =
  | {
      /**
       * The painted width of this image, as a media-query list. FILL MODE.
       *
       * This is what picks the entry from the generated `srcset`, so `"56px"`
       * fetches 64–128px of source where `"100vw"` fetches 1080–2048px for the
       * same markup.
       *
       * Describe the BOX, not the image: a 56px tile is `"56px"` whatever shape
       * the photo inside it happens to be. Next rounds up to the next configured
       * step (`imageSizes` is `[32, 48, 64, 96, 128, 256, 384]`, then
       * `deviceSizes` from 640), so precision past the nearest one buys nothing.
       */
      sizes: string;
      width?: never;
      height?: never;
    }
  | {
      /** Intrinsic width in CSS pixels — the size it is PAINTED at. FIXED MODE. */
      width: number;
      /** Intrinsic height in CSS pixels. */
      height: number;
      sizes?: never;
    };

interface StorageImageCommonProps {
  /** Resolved absolute URL or root-relative path. */
  src: string;
  /** Accessible label. Pass `''` with `aria-hidden` for decorative copies. */
  alt: string;
  /**
   * Visual classes only — `object-cover`, `blur-lg`, `scale-110`, `size-12`.
   *
   * In fill mode do NOT pass `absolute inset-0 h-full w-full`: `fill` applies
   * that itself, and the `<img>` fallback below re-adds it, so stating it here is
   * a third copy to keep in step.
   */
  className?: string;
  /**
   * `lazy` (the default) for anything that starts off-screen — off-screen
   * carousel slides, thumbnails past the fold, list rows below it.
   *
   * `eager` for the one image the viewer came to see. It does not preload, so it
   * is safe on an element that CSS may be hiding at this breakpoint.
   */
  loading?: 'eager' | 'lazy';
  /**
   * Priority hint without a preload link. Pair `fetchPriority="high"` with
   * `loading="eager"` on a hero; leave both off everywhere else.
   */
  fetchPriority?: 'high' | 'low' | 'auto';
  onError?: () => void;
  draggable?: boolean;
  decoding?: 'sync' | 'async' | 'auto';
  referrerPolicy?: HTMLAttributeReferrerPolicy;
  'aria-hidden'?: boolean | 'true' | 'false';
}

export type StorageImageProps = StorageImageCommonProps & StorageImageLayout;

/**
 * A remote image at the size it is actually painted, optimised when the host
 * allows it.
 *
 * IN FILL MODE the parent MUST establish a positioning context (`relative`,
 * `absolute`, or `fixed`) and a size. `fill` resolves against the nearest
 * positioned ancestor, so on a `static` parent the image escapes to whatever is
 * further up the tree — which looks like a layout bug several components away
 * from its cause.
 *
 * Falls back to a plain `<img>` for signed, `blob:` and unconfigured-host URLs.
 * That path is the app's previous behaviour, so a URL this cannot optimise still
 * renders; it is just no smaller than before.
 */
export function StorageImage({
  src,
  alt,
  sizes,
  width,
  height,
  className,
  loading,
  fetchPriority,
  onError,
  draggable,
  decoding,
  referrerPolicy,
  'aria-hidden': ariaHidden,
}: StorageImageProps) {
  const fill = width === undefined;

  // Shared by both branches and both modes, so the two renderings cannot drift
  // on the things that are not about layout.
  const common = {
    src,
    alt,
    onError,
    draggable,
    decoding,
    referrerPolicy,
    'aria-hidden': ariaHidden,
    fetchPriority,
  };

  if (isOptimizableImageUrl(src)) {
    return fill ? (
      <Image {...common} fill sizes={sizes} className={className} loading={loading} />
    ) : (
      <Image
        {...common}
        width={width}
        height={height}
        className={className}
        loading={loading}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...common}
      width={width}
      height={height}
      // In fill mode, replicate what `fill` would have applied so callers
      // describe the image the same way whichever branch they land in.
      className={fill ? cn('absolute inset-0 h-full w-full', className) : className}
      // `next/image` defaults to lazy; a bare `<img>` defaults to EAGER, so the
      // fallback has to state it or an off-screen signed thumbnail loads
      // immediately — the opposite of what the caller asked for.
      loading={loading ?? 'lazy'}
    />
  );
}
