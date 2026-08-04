'use client';

// Horizontal marketplace preview with keyboard-accessible controls and native
// touch scrolling. Items remain real ItemCards, so catalog behavior stays shared.
//
// The arrows used to be permanently enabled because nothing tracked scroll
// position, so on first paint "Previous listings" was a visibly-clickable control
// that did nothing — which reads as a broken page rather than a boundary. The
// native scrollbar is also hidden by design, so the arrows plus the edge fade are
// the ONLY signifiers that more content exists sideways; if both said nothing,
// users had no way to know the row scrolled at all.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { ItemCard } from '@/components/listings/ItemCard';
import { Button } from '@/components/ui/button';
import type { CatalogItem } from '@/lib/actions/listings';

/** Displays recent listings as a responsive, scroll-snap carousel. */
export function ListingCarousel({ items }: { items: CatalogItem[] }) {
  const viewportRef = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // Sub-pixel scroll offsets and fractional card widths mean `scrollLeft` rarely
  // lands exactly on the maximum, so the extremes need a tolerance or "Next"
  // never disables.
  const syncEdges = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxScroll = viewport.scrollWidth - viewport.clientWidth;
    setAtStart(viewport.scrollLeft <= 1);
    setAtEnd(maxScroll <= 1 || viewport.scrollLeft >= maxScroll - 1);
  }, []);

  useEffect(() => {
    syncEdges();
    const viewport = viewportRef.current;
    if (!viewport) return;
    // A resize changes clientWidth, which changes where the end is — without this
    // the buttons desync from the content on rotation or a window drag.
    const observer = new ResizeObserver(syncEdges);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [syncEdges, items.length]);

  function scroll(direction: -1 | 1) {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({ left: direction * viewport.clientWidth * 0.85 });
  }

  return (
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <header>
          <p className="market-label text-gold">Live Marketplace</p>
          <h2
            id="recent-listings"
            className="mt-2 text-balance font-sans text-4xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-5xl"
          >
            Recently listed
          </h2>
        </header>

        <div className="flex items-center gap-2 sm:pb-1">
          <Link
            href="/listings"
            className="mr-2 inline-flex text-sm font-semibold underline decoration-gold/55 underline-offset-4 hover:decoration-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Browse All Listings
          </Link>
          <Button
            variant="outline"
            size="icon"
            onClick={() => scroll(-1)}
            disabled={atStart}
            aria-label="Previous listings"
            className="size-11 rounded-full bg-card shadow-sm"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => scroll(1)}
            disabled={atEnd}
            aria-label="Next listings"
            className="size-11 rounded-full bg-card shadow-sm"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* The fade is the second signifier, for users who never look at the arrows.
          `mask-image` rather than an overlay gradient so it works over the page's
          textured background without having to match it. Only applied while there
          is actually more to scroll, or it would imply hidden content at the end. */}
      <div
        className="relative mt-8"
        style={
          atEnd
            ? undefined
            : {
                maskImage:
                  'linear-gradient(to right, black calc(100% - 4rem), transparent)',
                WebkitMaskImage:
                  'linear-gradient(to right, black calc(100% - 4rem), transparent)',
              }
        }
      >
        <ul
          ref={viewportRef}
          onScroll={syncEdges}
          aria-label="Recent marketplace listings"
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-4 motion-reduce:scroll-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => (
            <li
              key={item.id}
              className="w-[82%] shrink-0 snap-start min-[420px]:w-[46%] lg:w-[calc(25%-0.75rem)]"
            >
              <ItemCard item={item} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
