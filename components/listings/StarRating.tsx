// components/listings/StarRating.tsx
//
// A compact seller star-rating display used across the marketplace UI. Renders
// five stars with a partial fill matching the numeric rating, plus an optional
// numeric value and review count. Presentational only.

import { HugeiconsIcon } from '@hugeicons/react';
import { StarIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

export interface StarRatingProps {
  /** Rating from 0..5, or null when the seller has no rating yet. */
  rating: number | null | undefined;
  /** Number of reviews behind the rating. */
  count?: number;
  /** Star size in pixels. */
  size?: number;
  /** Hide the numeric "4.8 (124)" label, showing only the stars. */
  hideLabel?: boolean;
  className?: string;
}

/** Five stars with a fractional fill, e.g. 4.6 → four full + one 60% star. */
export function StarRating({
  rating,
  count,
  size = 14,
  hideLabel = false,
  className,
}: StarRatingProps) {
  if (rating == null) {
    return (
      <span className={cn('text-meta text-muted-foreground', className)}>
        No ratings yet
      </span>
    );
  }

  const clamped = Math.max(0, Math.min(5, rating));
  const fillPct = (clamped / 5) * 100;

  return (
    <span
      className={cn('inline-flex items-center gap-1', className)}
      // `role="img"` is load-bearing, not decoration. Every star below is
      // `aria-hidden`, so this label is the ONLY accessible text for the rating —
      // and `aria-label` on a role-less generic element is not required to be
      // exposed, so screen readers were free to announce nothing at all.
      role="img"
      aria-label={`Rated ${clamped.toFixed(1)} out of 5${
        count != null ? ` from ${count} reviews` : ''
      }`}
    >
      <span className="relative inline-block" style={{ height: size }}>
        {/* Empty track */}
        <span className="flex">
          {Array.from({ length: 5 }).map((_, i) => (
            <HugeiconsIcon icon={StarIcon}
              key={`bg-${i}`}
              className="text-muted-foreground/30"
              style={{ width: size, height: size }}
              aria-hidden
            />
          ))}
        </span>
        {/* Filled overlay, clipped to the rating percentage */}
        <span
          className="absolute inset-0 flex overflow-hidden"
          style={{ width: `${fillPct}%` }}
        >
          {Array.from({ length: 5 }).map((_, i) => (
            <HugeiconsIcon icon={StarIcon}
              key={`fg-${i}`}
              className="fill-iris text-iris-ink"
              style={{ width: size, height: size, minWidth: size }}
              aria-hidden
            />
          ))}
        </span>
      </span>
      {!hideLabel && (
        <span className="text-meta tabular-nums text-muted-foreground">
          {clamped.toFixed(1)}
          {count != null ? ` (${count})` : ''}
        </span>
      )}
    </span>
  );
}
