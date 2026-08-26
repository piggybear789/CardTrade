// app/loading.tsx
//
// Fallback for `/`. Mirrors the landing page: centred hero, listing marquee,
// then the Why NoDitto comparison — not a generic card stack. Routes with their
// own `loading.tsx` never see this.

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

      <div className="mx-auto w-full max-w-workspace px-6 pb-20 pt-20 sm:pt-24 md:pb-16 lg:px-24 lg:pt-28">
        <div className="mx-auto max-w-2xl space-y-6 text-center md:space-y-5">
          <Skeleton className="mx-auto h-5 w-40" />
          <Skeleton className="mx-auto h-14 w-full max-w-xl sm:h-16" />
          <Skeleton className="mx-auto h-5 w-72 max-w-full" />
          <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
            <Skeleton className="h-11 w-48 rounded-md" />
            <Skeleton className="h-11 w-36 rounded-md" />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pt-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden py-12 md:py-8">
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
        <div className="mx-auto grid max-w-workspace gap-16 px-6 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:px-24 lg:py-24">
          <div className="space-y-4">
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
