'use client';

// app/admin/error.tsx
//
// Admin error boundary. Catches errors within /admin and /admin/arbitration
// routes, allowing staff to retry without dropping them back to customer listings.

import { useEffect } from 'react';
import Link from 'next/link';
import { ShieldAlert, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Admin route error boundary caught:', error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-20 text-center sm:px-6">
      <div className="flex size-14 items-center justify-center rounded-full border border-destructive/40 bg-destructive/10 text-destructive">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </div>
      <p className="cardtrade-eyebrow mt-6">Staff Console Error</p>
      <h1 className="mt-4 text-balance font-display text-display font-semibold tracking-[-0.025em]">
        Admin Console Error
      </h1>
      <p className="mt-3 text-pretty text-body leading-relaxed text-muted-foreground">
        An error occurred while loading this administrative view. You can try refreshing
        or return to the main administration panel.
      </p>
      {error.digest ? (
        <p className="mt-4 font-mono text-meta text-muted-foreground">
          Reference: {error.digest}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Button size="lg" onClick={reset}>
          <RotateCcw aria-hidden="true" />
          Retry
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/admin">Return to Admin</Link>
        </Button>
      </div>
    </main>
  );
}
