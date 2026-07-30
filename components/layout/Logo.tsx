// components/layout/Logo.tsx
//
// NoDitto brand mark and wordmark.
//
// The mark is official Ditto artwork with a classic red prohibition overlay —
// literally "no Ditto" — which is the joke the name is built on. Served
// unoptimized so Next's image pipeline does not re-encode and soften the PNG.

import Image from 'next/image';

import { cn } from '@/lib/utils';

/** Local official-artwork asset — see public/brand/ditto.png. */
const DITTO_MARK = '/brand/ditto.png';

/**
 * The icon-only NoDitto mark: real Ditto with a red cancel / prohibition sign.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-flex size-8 shrink-0', className)}
    >
      <Image
        src={DITTO_MARK}
        alt=""
        width={128}
        height={128}
        sizes="32px"
        quality={100}
        unoptimized
        className="size-full object-contain"
        priority
      />
      {/* Classic "no" sign — faint so Ditto still reads underneath. */}
      <svg
        viewBox="0 0 32 32"
        fill="none"
        className="pointer-events-none absolute inset-0 size-full opacity-45"
      >
        <circle
          cx="16"
          cy="16"
          r="13.25"
          stroke="#e11d2e"
          strokeWidth="2.75"
        />
        <path
          d="M7.2 24.8 24.8 7.2"
          stroke="#e11d2e"
          strokeWidth="2.75"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

/**
 * Mark plus wordmark, used in the site header. The name is a proper noun, so it
 * is marked `translate="no"` to stop browser translation mangling it.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <LogoMark />
      {/* Always show the wordmark — the header keeps the logo cluster at its
          natural width so the name is not squeezed out by flex-1 siblings. */}
      <span
        className="truncate font-display text-lg font-semibold tracking-[-0.025em] sm:text-xl"
        translate="no"
      >
        NoDitto
      </span>
    </span>
  );
}
