'use client';

// app/error.tsx
//
// Route-segment error boundary. Catches uncaught errors thrown while rendering
// any page in the app and offers a recovery path instead of a blank screen.
// A Client Component, as required by Next.js for error boundaries.

import { useEffect } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { RotateCcwIcon, TriangleAlertIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the failure for observability without leaking details to the UI.
    console.error('Route error boundary caught:', error);
  }, [error]);

  // `py-12` on a phone — see the same note in `not-found.tsx`. No bottom nav
  // renders under this boundary, so 80px either side put "Try again" and the way
  // back to the marketplace below the fold at 375x667.
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-12 text-center sm:px-6 sm:py-20">
      <div className="flex size-14 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-destructive">
        <HugeiconsIcon icon={TriangleAlertIcon} className="size-6" aria-hidden="true" />
      </div>
      <p className="mt-6 text-body font-medium text-muted-foreground">Something went wrong</p>
      <h1 className="mt-4 text-balance font-display text-display font-semibold tracking-[-0.025em]">
        This page hit a snag
      </h1>
      <p className="mt-3 text-pretty text-body leading-7 text-muted-foreground">
        Your money and trades are safe. The page just failed to load. Try again,
        and if it keeps happening, head back to the marketplace.
      </p>
      {error.digest ? (
        <p className="mt-4 font-mono text-meta text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" onClick={reset}>
          <HugeiconsIcon icon={RotateCcwIcon} aria-hidden="true" />
          Try again
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/">Back to marketplace</Link>
        </Button>
      </div>
    </main>
  );
}
