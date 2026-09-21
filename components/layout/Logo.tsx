// components/layout/Logo.tsx
//
// NoDitto brand mark and wordmark.
//
// The mark is the "no Ditto" sign — the red prohibition ring and slash over Ditto —
// keyed to transparency so it sits on the obsidian desktop header and the pale phone
// chrome alike. It is produced from the logo artwork by `scripts/prepare-brand-mark.mjs`,
// which also writes `app/icon.png`; regenerate both from there rather than editing
// either file by hand. Served unoptimized so Next's image pipeline does not re-encode
// and soften the PNG.

import Image from 'next/image';

import { cn } from '@/lib/utils';

/** The transparent mark — see `scripts/prepare-brand-mark.mjs`. */
const NODITTO_MARK = '/brand/noditto-mark.png';

/**
 * The icon-only NoDitto mark: the "no Ditto" sign.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('relative inline-flex size-8 shrink-0', className)}
    >
      <Image
        src={NODITTO_MARK}
        alt=""
        width={512}
        height={512}
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
    <span className={cn('flex min-w-0 items-center gap-snug', className)}>
      <LogoMark />
      {/* Wordmark is desktop-only. Below `md` the mark is the home control so
          the bar can hold search / account without crushing the name. */}
      <span
        className="hidden font-display text-subhead font-semibold tracking-tight md:inline"
        translate="no"
      >
        NoDitto
      </span>
    </span>
  );
}
