'use client';

// components/listings/ListingCarousel.tsx
//
// A full-bleed, continuously scrolling wall of real listings.
//
// WHY THIS REPLACED A SCROLL-SNAP CAROUSEL. The old version was four cards in a
// snapping row with prev/next buttons. It worked, but it read as a UI control rather
// than a shop window: a visitor had to operate it to see anything past the first four,
// and most never did. A marquee shows depth of inventory without asking for a click,
// which is the one thing a landing page needs to prove.
//
// THE TILES ARE BIG AND THE GAPS ARE SMALL, ON PURPOSE. An earlier pass shrank them to
// ~7.5rem with a 1rem gap and the row turned into a thin strip of stamps — it read as a
// footer ornament rather than as stock. Large tiles nearly touching read as a wall of
// product, which is the whole point.
//
// THE TRACK IS DUPLICATED, AND THE CLONE IS HIDDEN FROM ASSISTIVE TECH. A seamless loop
// needs the content twice — translating by -50% then lands exactly where 0% started. But
// the clone is the same listings again, so without `aria-hidden` and `tabIndex={-1}`
// every listing would appear twice in the tab order and twice to a screen reader. That
// is the detail most marquee implementations get wrong.
//
// MOTION IS OPT-OUT, NOT DECORATION. The animation pauses on hover and on focus — a link
// that moves is close to unclickable, and a target that runs away from the pointer is a
// genuine accessibility failure rather than a polish issue. `prefers-reduced-motion`
// stops it entirely and hands the row back to native horizontal scrolling, so the
// content stays reachable either way.

import { ViewTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';

import { formatAud, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { CatalogItem } from '@/lib/actions/listings';

/**
 * Smallest number of tiles a track should carry before it repeats.
 *
 * Two constraints, and the larger one wins. A short loop shows the same card twice on
 * screen at once, which reads as a rendering bug. And ONE HALF of the track has to be
 * wider than the viewport, or the seam becomes visible as a gap on an ultrawide display
 * — at 13.5rem a tile is ~216px, so 18 of them clears 3900px and covers everything short
 * of a wall.
 */
const MIN_TILES = 18;

/** One listing, as a poster-style tile. */
/** Slight desk-scatter so the wall reads as cards, not a stamp strip. */
const TILE_TILTS = [
  'rotate-[2.4deg]',
  '-rotate-[1.6deg]',
  'rotate-[0.7deg]',
  '-rotate-[2.1deg]',
] as const;

function MarqueeTile({
  item,
  cloned,
  index,
  shareImage,
}: {
  item: CatalogItem;
  /** True for the duplicated half: hidden from assistive tech and unfocusable. */
  cloned: boolean;
  index: number;
  /** First visible occurrence only — named VTs must be unique on screen. */
  shareImage: boolean;
}) {
  const imageUrl = itemImageUrl(item.image_paths?.[0] ?? null);
  const isShopfront = item.listing_kind === 'SHOPFRONT';

  return (
    <li
      className={cn(
        'group relative w-[11rem] shrink-0 origin-bottom sm:w-[12.5rem] lg:w-[13.5rem]',
        TILE_TILTS[index % TILE_TILTS.length],
        'transition-transform duration-300 ease-out motion-safe:hover:z-10 motion-safe:hover:-translate-y-2 motion-safe:hover:rotate-0',
      )}
      aria-hidden={cloned ? 'true' : undefined}
    >
      <Link
        href={`/listings/${item.id}`}
        transitionTypes={['nav-forward']}
        tabIndex={cloned ? -1 : undefined}
        className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <div className="relative aspect-[5/7] overflow-hidden rounded-lg bg-card shadow-market ring-1 ring-inset ring-border transition-[box-shadow,ring-color] duration-200 group-hover:ring-gold/50">
          {imageUrl ? (
            <>
              {/* Blurred fill behind the contained scan, so a non-square photo sits on
                  its own colours rather than on a hard empty panel. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imageUrl}
                alt=""
                width={176}
                height={246}
                aria-hidden="true"
                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-[0.05] blur-xl"
                loading="lazy"
              />
              {shareImage ? (
                <ViewTransition
                  name={`listing-image-${item.id}`}
                  share="morph"
                  default="none"
                >
                  <div className="absolute inset-0">
                    <Image
                      src={imageUrl}
                      alt={item.title}
                      fill
                      sizes="(max-width: 640px) 11rem, (max-width: 1024px) 12.5rem, 13.5rem"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                      loading="lazy"
                    />
                  </div>
                </ViewTransition>
              ) : (
                <Image
                  src={imageUrl}
                  alt={item.title}
                  fill
                  sizes="(max-width: 640px) 11rem, (max-width: 1024px) 12.5rem, 13.5rem"
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                  loading="lazy"
                />
              )}
            </>
          ) : (
            <div className="grid h-full place-items-center px-cozy text-center text-meta leading-tight text-muted-foreground">
              No photo
            </div>
          )}

          {/* Title and price. Always visible so visitors can scan the inventory
              at a glance without hovering. */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-obsidian via-obsidian/85 to-transparent px-cozy pb-snug pt-7">
            <p className="truncate text-lead font-medium leading-tight text-parchment">
              {item.title}
            </p>
            <p className="mt-tight text-body tabular-nums text-gold">
              {isShopfront ? 'from ' : ''}
              {formatAud(item.fmv_cents)}
            </p>
          </div>
        </div>
      </Link>
    </li>
  );
}

export function ListingCarousel({ items }: { items: CatalogItem[] }) {
  if (items.length === 0) return null;

  // Pad a thin catalog up to the tile floor so the loop is long enough not to show the
  // same card twice on screen. `key` carries the pass index, because the same item id
  // can legitimately appear more than once here.
  const padded: CatalogItem[] = [];
  while (padded.length < MIN_TILES) padded.push(...items);
  const tiles = padded.slice(0, Math.max(MIN_TILES, items.length));

  return (
    // Edge masks fade the row into the page rather than cutting it off. `mask-image`
    // rather than overlay gradients, so it works over whatever sits behind with no
    // colour to keep in sync.
    <div className="overflow-hidden py-3 [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
      <div
        className={cn(
          'flex w-max gap-snug sm:gap-cozy',
          // The animation lives on the flex track, so both halves move as one.
          'motion-safe:animate-listing-marquee will-change-transform',
          // Pause while a pointer is over the row or a tile has focus — a link that
          // moves is a link you cannot reliably hit.
          'hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] active:[animation-play-state:paused]',
          // Touch devices cannot hover to pause. Native scroll is the control.
          '[@media(hover:none)]:w-full [@media(hover:none)]:animate-none [@media(hover:none)]:overflow-x-auto [@media(hover:none)]:will-change-auto',
          // With motion reduced the track does not move, so it must be scrollable by
          // hand or the listings past the fold become unreachable.
          'motion-reduce:w-full motion-reduce:overflow-x-auto',
        )}
      >
        <ul className="flex gap-snug sm:gap-cozy" aria-label="Recent listings">
          {tiles.map((item, index) => (
            <MarqueeTile
              key={`a-${index}-${item.id}`}
              item={item}
              cloned={false}
              index={index}
              shareImage={index === tiles.findIndex((tile) => tile.id === item.id)}
            />
          ))}
        </ul>
        {/* The seamless half. Same tiles, invisible to assistive tech and skipped by the
            keyboard — see the header note. Hidden outright when motion is reduced, where
            there is no loop for it to complete. */}
        <ul className="flex gap-snug motion-reduce:hidden sm:gap-cozy" aria-hidden="true">
          {tiles.map((item, index) => (
            <MarqueeTile
              key={`b-${index}-${item.id}`}
              item={item}
              cloned
              index={index}
              shareImage={false}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
