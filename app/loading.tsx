// app/loading.tsx
//
// Fallback for `/`. Mirrors the landing page: centred hero, listing marquee, then the
// Why NoDitto comparison. Routes with their own `loading.tsx` never see this.
//
// THE HERO IS WHERE THIS WAS WORST ON A PHONE. It reserved `pt-20 pb-20` against the
// page's `pt-10 pb-8`, so the whole landing sat 40px low and 48px too tall before
// anything resolved; it laid the two CTAs out side by side where the page stacks them
// full-width under `max-w-xs`; and it drew the trust list, which is `hidden md:flex`.
// Heights are now taken from the same type tokens the hero sets, so a line of
// placeholder occupies a line of text.

import { ViewTransition } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <ViewTransition exit="slide-down">
      <div
        className="flex flex-col bg-background"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="sr-only">Loading…</span>

        <div className="mx-auto w-full max-w-workspace px-6 pb-8 pt-10 sm:pt-24 md:pb-16 lg:px-24 lg:pt-28">
          <div className="mx-auto max-w-2xl text-center">
            {/* The "ditto not welcome" badge above the headline. */}
            <Skeleton className="mx-auto h-5 w-40" />

            {/* Two headline lines. Each bar is `1.08em` inside a box carrying the
                heading's own size and leading, so the block is exactly two line
                boxes tall at every breakpoint instead of a fixed 56px. */}
            <div className="mt-5 text-display leading-[1.08] sm:text-5xl lg:text-7xl">
              <Skeleton className="mx-auto h-[1.08em] w-full max-w-lg" />
              <Skeleton className="mx-auto mt-1 h-[1.08em] w-2/3 max-w-sm" />
            </div>

            <div className="mx-auto mt-5 max-w-xl text-body leading-6 md:mt-6 md:text-lead">
              <Skeleton className="mx-auto h-[1em] w-80 max-w-full align-middle" />
            </div>

            {/* Stacked and full-width on a phone, side by side from `md` — the page's
                own `flex-col … md:flex-row` under a `max-w-xs` cap. */}
            <div className="mx-auto mt-7 flex w-full max-w-xs flex-col items-stretch gap-3 md:mt-10 md:max-w-none md:flex-row md:flex-wrap md:justify-center">
              <Skeleton className="h-11 w-full rounded-md md:w-48" />
              <Skeleton className="h-11 w-full rounded-md md:w-36" />
            </div>

            {/* Trust list is `hidden md:flex` on the page, so it must not draw here
                below `md` either. */}
            <div className="mt-10 hidden flex-wrap items-center justify-center gap-x-6 gap-y-2 md:flex">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        </div>

        {/* Marquee: the page uses `pt-8 pb-12` on a phone, not a symmetric `py-12`. */}
        <div className="relative overflow-hidden pb-12 pt-8 md:py-8">
          <div className="flex gap-4 px-6">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton
                key={index}
                className="aspect-[4/5] w-44 shrink-0 rounded-xl sm:w-52"
              />
            ))}
          </div>
        </div>

        <div className="border-t border-border bg-card">
          <div className="mx-auto grid max-w-workspace gap-16 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:items-center lg:gap-20 lg:px-24 lg:py-24">
            <div className="max-w-xl space-y-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-56 max-w-full" />
              <Skeleton className="h-4 w-full max-w-md" />
              <Skeleton className="h-4 w-4/5" />
            </div>
            <div className="space-y-0 border-t border-border">
              {Array.from({ length: 4 }, (_, index) => (
                <div
                  key={index}
                  className="grid gap-2 border-b border-border py-5 sm:grid-cols-[1.1fr_1fr_1fr] sm:gap-6"
                >
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-36" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ViewTransition>
  );
}
