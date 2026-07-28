// components/contract/ContractTimeline.tsx
//
// The audit trail every contract room ends with. Cash sales, trades and deals all
// append rows of `{ event, detail, actor_id, created_at }`, so they get one
// timeline: humanised enum name, optional detail, "(you)" attribution and an
// absolute timestamp.
//
// Timestamps are absolute (`formatContractDateTime`) rather than relative: these
// rooms are server-rendered and hydrated, and a relative label computed at two
// different instants mismatches on hydration.

import { CircleDot } from 'lucide-react';

import { formatContractDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ContractEvent } from './types';

/** Turn `COLLATERAL_LOCKED` into `collateral locked`. */
function humanise(event: string): string {
  return event.toLowerCase().replace(/_/g, ' ');
}

export interface ContractTimelineProps {
  events: ContractEvent[];
  /** The viewer, so their own actions are marked "(you)". */
  myUserId?: string;
  /** Accessible name, e.g. "Contract history". */
  ariaLabel?: string;
  /** Copy shown when nothing has happened yet. */
  emptyLabel?: string;
  className?: string;
}

/** The shared contract audit trail, oldest first. */
export function ContractTimeline({
  events,
  myUserId,
  ariaLabel = 'Contract history',
  emptyLabel = 'Nothing has happened yet.',
  className,
}: ContractTimelineProps) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ol className={cn('space-y-3', className)} aria-label={ariaLabel}>
      {events.map((event) => (
        <li key={event.id} className="flex gap-3 text-sm">
          <CircleDot
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0">
            <p className="font-medium">
              {humanise(event.event)}
              {myUserId && event.actor_id === myUserId ? ' (you)' : ''}
            </p>
            {event.detail ? (
              <p className="break-words text-muted-foreground">{event.detail}</p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {formatContractDateTime(event.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
