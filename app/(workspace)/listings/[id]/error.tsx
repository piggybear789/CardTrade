'use client';

// app/listings/[id]/error.tsx
//
// Persistence / network failure while loading a listing. Distinct from
// not-found: a 404 means the listing is gone or hidden; this boundary means
// the read failed and the listing may still be there.

import { ErrorScreen } from '@/components/layout/ErrorScreen';

export default function ListingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      error={error}
      onRetry={reset}
      title="This listing didn't load"
      // Says the listing still exists, because that is what distinguishes this
      // boundary from not-found.
      description="It's still there, we just couldn't fetch it. Try again in a moment."
    />
  );
}
