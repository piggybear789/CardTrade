'use client';

// app/listings/[id]/error.tsx
//
// Persistence / network failure while loading a listing. Distinct from
// not-found: a 404 means the listing is gone or hidden; this boundary means
// the read failed and the listing may still be there.

import { useEffect } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { RotateCcwIcon, TriangleAlertIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';

export default function ListingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Listing load error:', error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-group py-20 text-center sm:px-6">
      <div className="flex size-14 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-destructive">
        <HugeiconsIcon icon={TriangleAlertIcon} className="size-6" aria-hidden="true" />
      </div>
      <p className="cardtrade-eyebrow mt-6">Couldn&apos;t load listing</p>
      <h1 className="mt-group text-balance font-display text-display font-semibold tracking-tight">
        This listing didn&apos;t load
      </h1>
      <p className="mt-cozy text-pretty text-body text-muted-foreground">
        This is a load failure, not a removed listing. Try again, and if it
        keeps happening, head back to the marketplace.
      </p>
      {error.digest ? (
        <p className="mt-group font-mono text-meta text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-section flex flex-col gap-cozy sm:flex-row">
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
