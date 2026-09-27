'use client';

// components/contract/ContractRoomError.tsx
//
// Segment error UI for live contract rooms (trade / sale). The shared `ErrorScreen`
// with a way back to the member's own list, and the reassurance that matters most
// here: a page failing to load does not change the contract.

import { ErrorScreen } from '@/components/layout/ErrorScreen';

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
  return (
    <ErrorScreen
      error={error}
      onRetry={reset}
      title="This contract didn't load"
      description="Nothing about the contract has changed. Try again, or go back to your list."
      backHref={backHref}
      backLabel={backLabel}
    />
  );
}
