'use client';

import { ContractRoomError } from '@/components/contract/ContractRoomError';

export default function TradeRoomError({
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
      backHref="/trades"
      backLabel="Back to Trades"
    />
  );
}
