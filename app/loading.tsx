// app/loading.tsx
//
// Route-level loading fallback shown while a Server Component page streams in.
// Deliberately neutral (header + content blocks, not a catalog grid) so it
// reads sensibly for any route that doesn't ship its own loading state.

import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-4 border-b border-border/65 pb-5">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="mt-8 space-y-4">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    </div>
  );
}
