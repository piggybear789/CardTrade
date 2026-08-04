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
      <DialogContent mobile="center" className="max-w-3xl">
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
              <ContractThumbnailImage
                src={src}
                alt={`${label} — photo ${index + 1} of ${images.length}`}
                className="max-h-[65dvh] w-auto object-contain"
                fallbackClassName="h-64 w-full"
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
  /**
   * `strip` (default) is the equal-tile row used by item rows and evidence sets.
   *
   * `stacked` promotes the first photo to a full-width square with the rest as a
   * small strip underneath — the listing-page treatment, for surfaces where the
   * item is the subject of the panel rather than one row in a list. A 64px tile
   * cannot show the condition of a collectible, which is the whole reason a buyer
   * opens the Item tab.
   */
  layout?: 'strip' | 'stacked';
  className?: string;
}

/** Shows a deliberate unavailable state instead of the browser's broken-image glyph. */
function ContractThumbnailImage({
  src,
  alt = '',
  loading,
  className,
  fallbackClassName,
}: {
  src: string;
  alt?: string;
  loading?: 'eager' | 'lazy';
  className?: string;
  fallbackClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  if (failed) {
    return (
      <span
        role="img"
        aria-label={alt || 'Image unavailable'}
        className={cn(
          'grid h-full w-full place-items-center text-muted-foreground',
          fallbackClassName ?? className,
        )}
      >
        <ImageOff className="size-7" aria-hidden />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={loading}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Clickable thumbnails that open a full-size lightbox. Never a scroll container;
 * overflow collapses into a `+N` tile that opens at that photo.
 */
export function ContractThumbnails({
  images,
  label,
  max = 4,
  size = 'md',
  layout = 'strip',
  className,
}: ContractThumbnailsProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const tile = size === 'sm' ? 'size-11' : 'size-16';
  const stacked = layout === 'stacked';

  if (images.length === 0) {
    return (
      <div
        className={cn(
          'grid place-items-center text-muted-foreground',
          stacked
            ? 'aspect-square w-full'
            : cn('shrink-0 rounded-md border bg-muted', tile),
          className,
        )}
      >
        <ImageOff className={stacked ? 'size-8' : 'size-4'} aria-hidden />
        <span className="sr-only">No photos for {label}</span>
      </div>
    );
  }

  if (stacked) {
    const [primary, ...rest] = images;
    const restShown = rest.slice(0, 3);
    const restOverflow = rest.length - restShown.length;

    return (
      <>
        <div className={cn('flex w-full min-w-0 flex-col gap-1.5', className)}>
          <button
            type="button"
            onClick={() => setOpenIndex(0)}
            aria-label={`Enlarge photo 1 of ${images.length} for ${label}`}
            className="aspect-square w-full overflow-hidden rounded-lg transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <ContractThumbnailImage
              src={primary}
              className="h-full w-full object-contain"
            />
          </button>

          {rest.length > 0 ? (
            <ul className="flex items-center gap-1.5" aria-label={`${label} photos`}>
              {restShown.map((src, index) => (
                <li key={src}>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(index + 1)}
                    aria-label={`Enlarge photo ${index + 2} of ${images.length} for ${label}`}
                    className={cn(
                      'overflow-hidden rounded-md border bg-muted transition',
                      'hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      'size-11',
                    )}
                  >
                    <ContractThumbnailImage
                      src={src}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>
                </li>
              ))}
              {restOverflow > 0 ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setOpenIndex(restShown.length + 1)}
                    aria-label={`See all ${images.length} photos for ${label}`}
                    className="size-11 rounded-md border bg-muted/60 text-xs font-semibold tabular-nums text-muted-foreground transition hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    +{restOverflow}
                  </button>
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <ContractImageLightbox
          images={images}
          openIndex={openIndex}
          onOpenChange={setOpenIndex}
          label={label}
        />
      </>
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
              <ContractThumbnailImage
                src={src}
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
