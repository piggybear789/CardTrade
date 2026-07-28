// components/contract/ContractConnectionStatus.tsx
//
// The shared contract-room connection indicator. Normal connection and retry activity
// stays quiet; only a terminal Offline state is surfaced because it means the room may
// be showing stale information.

import { cn } from '@/lib/utils';
import type { ContractConnectionStatus as Status } from './types';

export interface ContractConnectionStatusProps {
  status: Status;
  className?: string;
}

/** A small, screen-reader-announced offline indicator. */
export function ContractConnectionStatus({
  status,
  className,
}: ContractConnectionStatusProps) {
  if (status !== 'error') return null;

  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs text-destructive',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label="Connection status: Offline"
    >
      <span className="size-2 rounded-full bg-destructive" aria-hidden />
      Offline
    </span>
  );
}
