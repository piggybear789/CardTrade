'use client';

import { ContractRoomError } from '@/components/contract/ContractRoomError';

export default function DealRoomError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ContractRoomError
      error={error}
      reset={reset}
      backHref="/deals"
      backLabel="Back to Deals"
    />
  );
}
