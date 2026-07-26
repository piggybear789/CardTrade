'use client';

// Horizontal marketplace preview with keyboard-accessible controls and native
// touch scrolling. Items remain real ItemCards, so catalog behavior stays shared.

import { useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { ItemCard } from '@/components/listings/ItemCard';
import { Button } from '@/components/ui/button';
import type { CatalogItem } from '@/lib/actions/listings';

/** Displays recent listings as a responsive, scroll-snap carousel. */
export function ListingCarousel({ items }: { items: CatalogItem[] }) {
  const viewportRef = useRef<HTMLUListElement>(null);

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
            className="mt-2 text-balance font-sans text-4xl font-bold tracking-[-0.035em] sm:text-5xl"
          >
            Recently Listed
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
            aria-label="Previous listings"
            className="rounded-full bg-card shadow-sm"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => scroll(1)}
            aria-label="Next listings"
            className="rounded-full bg-card shadow-sm"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>

      <ul
        ref={viewportRef}
        aria-label="Recent marketplace listings"
        className="mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-4 motion-reduce:scroll-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
  );
}
