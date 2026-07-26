// components/layout/Logo.tsx
//
// Poke-xchange brand mark and wordmark.
//
// The mark shows two trading cards mid-swap — one tilting out, one tilting in —
// joined by a circular exchange arrow, with a collectible orb on each card. That
// reads as "cards being traded", which is the product in one glyph.
//
// The artwork is entirely original geometry: no Pokemon characters, Poke Ball, or
// other third-party marks are reproduced, so the logo carries no licensed IP.
// Demo card imagery from the Pokemon TCG API stays confined to listing content,
// where the non-affiliation notice in the footer applies.

import { cn } from '@/lib/utils';

/**
 * The icon-only brand mark. Inherits `currentColor` for the cards and uses the
 * gold token for the exchange arrow, so it sits correctly on both the dark
 * header and light surfaces.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('size-7 shrink-0', className)}
    >
      {/* Back card, tilting away */}
      <g transform="rotate(-14 11 17)">
        <rect
          x="4"
          y="8"
          width="11.5"
          height="16"
          rx="2"
          fill="currentColor"
          fillOpacity="0.14"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="9.75" cy="16" r="2.4" fill="hsl(var(--gold))" />
      </g>

      {/* Front card, tilting in */}
      <g transform="rotate(14 21 15)">
        <rect
          x="16.5"
          y="8"
          width="11.5"
          height="16"
          rx="2"
          fill="currentColor"
          fillOpacity="0.14"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="22.25" cy="16" r="2.4" fill="hsl(var(--trust))" />
      </g>

      {/* Exchange arrows arcing between the two cards */}
      <path
        d="M11.4 5.6a7.2 7.2 0 0 1 9.2 0"
        stroke="hsl(var(--gold))"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M19.1 3.1 21 5.6l-2.6 1.5"
        stroke="hsl(var(--gold))"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20.6 26.4a7.2 7.2 0 0 1-9.2 0"
        stroke="hsl(var(--gold))"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M12.9 28.9 11 26.4l2.6-1.5"
        stroke="hsl(var(--gold))"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Mark plus wordmark, used in the site header. The name is a proper noun, so it
 * is marked `translate="no"` to stop browser translation mangling it.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <LogoMark />
      <span className="font-display text-xl font-semibold tracking-[-0.025em]" translate="no">
        Poke-xchange
      </span>
    </span>
  );
}
