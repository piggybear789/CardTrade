// components/contract/ContractConnectionStatus.tsx
//
// The one Live / Connecting / Offline pill used by every contract room. Replaces
// the three near-identical indicators the sale room, deal room and trade contract
// each carried (Req 11.5).
//
// A distinct Offline state matters: once the realtime hook has exhausted its
// reconnect attempts, the room is showing a stale snapshot and must say so rather
// than claiming to be "connecting" forever.

import { cn } from '@/lib/utils';
import type { ContractConnectionStatus as Status } from './types';

/** Label + dot colour for each realtime connection state. */
const INDICATOR: Record<Status, { label: string; dotClassName: string }> = {
  live: { label: 'Live', dotClassName: 'bg-emerald-500' },
  connecting: { label: 'Connecting', dotClassName: 'bg-amber-500' },
  reconnecting: { label: 'Connecting', dotClassName: 'bg-amber-500' },
  error: { label: 'Offline', dotClassName: 'bg-destructive' },
};

export interface ContractConnectionStatusProps {
  status: Status;
  className?: string;
}

/** A small, screen-reader-announced realtime connection indicator. */
export function ContractConnectionStatus({
  status,
  className,
}: ContractConnectionStatusProps) {
  const { label, dotClassName } = INDICATOR[status];
  return (
    <span
      className={cn(
        'flex items-center gap-1.5 text-xs text-muted-foreground',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={`Connection status: ${label}`}
    >
      <span className={cn('size-2 rounded-full', dotClassName)} aria-hidden />
      {label}
    </span>
  );
}
