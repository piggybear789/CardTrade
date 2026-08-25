// components/layout/Logo.tsx
//
// NoDitto brand mark and wordmark.
//
// The mark is the local photo Ditto asset. Served unoptimized so Next's image
// pipeline does not re-encode and soften the PNG.

import Image from 'next/image';

import { cn } from '@/lib/utils';

/** Local official-artwork asset — see public/brand/ditto.png. */
const DITTO_MARK = '/brand/ditto.png';

/**
 * The icon-only NoDitto mark: photo Ditto.
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
        unoptimized
        className="size-full object-contain"
        priority
      />
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
      {/* Wordmark is desktop-only. Below `md` the mark is the home control so
          the bar can hold search / account without crushing the name. */}
      <span
        className="hidden font-display text-subhead font-semibold tracking-[-0.025em] md:inline"
        translate="no"
      >
        NoDitto
      </span>
    </span>
  );
}
