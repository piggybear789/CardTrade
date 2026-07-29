'use client';

// components/contract/ContractRoomError.tsx
//
// Segment error UI for live contract rooms (trade / deal / sale). Keeps recovery
// on-brand without exposing stack traces.

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export function ContractRoomError({
  error,
  reset,
  backHref,
  backLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  backHref: string;
  backLabel: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <EmptyState
        icon={<AlertTriangle className="size-6" aria-hidden />}
        title="Contract Unavailable"
        description="Something went wrong loading this contract room. Try again, or go back to your list."
        compact
      />
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button type="button" onClick={reset}>
          Try Again
        </Button>
        <Button asChild variant="outline">
          <Link href={backHref}>{backLabel}</Link>
        </Button>
      </div>
    </main>
  );
}
