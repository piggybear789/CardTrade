'use client';

import { ContractRoomError } from '@/components/contract/ContractRoomError';

export default function SaleRoomError({
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
      backHref="/sales"
      backLabel="Back to Sales"
    />
  );
}
