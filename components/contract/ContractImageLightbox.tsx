'use client';

// components/contract/ContractImageLightbox.tsx
//
// Evidence photos, viewable. Contract rooms showed item images at 40–112px with no
// way to enlarge them — and in the cash sale room the thumbnail strip was a 7rem
// vertical scroll container, so the third and fourth photos were effectively
// hidden. That is a problem for a marketplace where the photos ARE the condition
// report and part of the dispute record.
//
// `ContractThumbnails` renders a fixed horizontal strip (up to four, then a `+N`
// tile) and opens this lightbox on click. Arrow keys page through.

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface ContractImageLightboxProps {
  /** Resolved image URLs, in order. */
  images: string[];
  /** Index to open at; `null` keeps the lightbox closed. */
  openIndex: number | null;
  onOpenChange: (openIndex: number | null) => void;
  /** Accessible caption, e.g. the item title. */
  label: string;
}

/** A full-size, keyboard-pageable view of a contract's photos. */
export function ContractImageLightbox({
  images,
  openIndex,
  onOpenChange,
  label,
}: ContractImageLightboxProps) {
  const [index, setIndex] = useState(openIndex ?? 0);

  useEffect(() => {
    if (openIndex !== null) setIndex(openIndex);
  }, [openIndex]);

  const step = useCallback(
    (delta: number) => {
      setIndex((current) => {
        if (images.length === 0) return 0;
        return (current + delta + images.length) % images.length;
      });
    },
    [images.length],
  );

  const open = openIndex !== null;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, step]);

  const src = images[index];

  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next ? index : null)}>
      <DialogContent className="max-w-3xl">
        <DialogTitle className="sr-only">{label}</DialogTitle>
        <div className="flex items-center gap-2">
          {images.length > 1 ? (
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous photo"
              className="grid size-9 shrink-0 place-items-center rounded-full border bg-card hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
          ) : null}

          <div className="grid min-w-0 flex-1 place-items-center overflow-hidden rounded-lg bg-muted">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={`${label} — photo ${index + 1} of ${images.length}`}
                className="max-h-[65dvh] w-auto object-contain"
              />
            ) : (
              <div className="grid h-64 w-full place-items-center text-muted-foreground">
                <ImageOff className="size-8" aria-hidden />
              </div>
            )}
          </div>

          {images.length > 1 ? (
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next photo"
              className="grid size-9 shrink-0 place-items-center rounded-full border bg-card hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>

        <p className="text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {label} · {index + 1} of {images.length}
        </p>
      </DialogContent>
    </Dialog>
  );
}

export interface ContractThumbnailsProps {
  /** Resolved image URLs. */
  images: string[];
  /** Accessible caption for the set. */
  label: string;
  /** How many tiles to show before collapsing the rest into `+N`. */
  max?: number;
  /** Tile size. `sm` for inline item rows, `md` for a section's own preview. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A fixed horizontal strip of clickable thumbnails — never a scroll container —
 * with the overflow collapsed into a `+N` tile that opens at the fifth photo.
 */
export function ContractThumbnails({
  images,
  label,
  max = 4,
  size = 'md',
  className,
}: ContractThumbnailsProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const tile = size === 'sm' ? 'size-11' : 'size-16';

  if (images.length === 0) {
    return (
      <div
        className={cn(
          'grid shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground',
          tile,
          className,
        )}
      >
        <ImageOff className="size-4" aria-hidden />
        <span className="sr-only">No photos for {label}</span>
      </div>
    );
  }

  const shown = images.slice(0, max);
  const overflow = images.length - shown.length;

  return (
    <>
      <ul className={cn('flex shrink-0 items-center gap-1.5', className)} aria-label={`${label} photos`}>
        {shown.map((src, index) => (
          <li key={src}>
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              aria-label={`Enlarge photo ${index + 1} of ${images.length} for ${label}`}
              className={cn(
                'overflow-hidden rounded-md border bg-muted transition',
                'hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                tile,
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          </li>
        ))}
        {overflow > 0 ? (
          <li>
            <button
              type="button"
              onClick={() => setOpenIndex(max)}
              aria-label={`See all ${images.length} photos for ${label}`}
              className={cn(
                'rounded-md border bg-muted/60 text-xs font-semibold tabular-nums text-muted-foreground transition',
                'hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                tile,
              )}
            >
              +{overflow}
            </button>
          </li>
        ) : null}
      </ul>

      <ContractImageLightbox
        images={images}
        openIndex={openIndex}
        onOpenChange={setOpenIndex}
        label={label}
      />
    </>
  );
}
