'use client';

// components/listings/ImageGallery.tsx
//
// An accessible image gallery for the item detail page: a single large image
// with a compact "1/N < >" arrow navigation control in the top-right corner.
// No thumbnail rail — keeps the layout clean and lets the image fill the space.

import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';

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

  const prev = useCallback(() => {
    setActiveIndex((i) => (i <= 0 ? images.length - 1 : i - 1));
  }, [images.length]);

  const next = useCallback(() => {
    setActiveIndex((i) => (i >= images.length - 1 ? 0 : i + 1));
  }, [images.length]);

  if (images.length === 0) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <ImageOff className="size-12" aria-hidden />
        <span className="sr-only">No image available for {title}</span>
      </div>
    );
  }

  const active = images[Math.min(activeIndex, images.length - 1)];

  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-lg border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={active.src}
        alt={active.alt}
        className="h-full w-full object-cover"
      />

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
