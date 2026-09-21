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
//
// `unoptimized` IS WHY THE SOURCE SIZE MATTERS SO MUCH HERE. Nothing resizes this on
// the way to the browser — the file that ships is the file that arrives — so a 512px
// mark meant 156 KB to paint a 32px square, in the header, on every route in the
// product. It is now generated at 128 (see `MARK_SIZE`), which is 7.6 KB.

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
      {/* NO `sizes`, AND NO PRELOAD. `sizes="32px"` used to sit here and did
          nothing: `unoptimized` makes Next emit neither `srcset` nor `sizes`, so
          it read as a saving that was never applied. The `priority` beside it is
          gone on two counts — it is deprecated in favour of `preload` as of Next
          16, and a 32px header glyph is not the Largest Contentful Paint element
          on any page, so preloading it only competed with the image that is. At
          7.6 KB it does not need the help. */}
      <Image
        src={NODITTO_MARK}
        alt=""
        width={128}
        height={128}
        unoptimized
        className="size-full object-contain"
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
