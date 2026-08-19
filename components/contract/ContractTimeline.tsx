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

import {
  Check,
  CircleAlert,
  CircleDot,
  XCircle,
} from 'lucide-react';

import { formatContractDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ContractEvent } from './types';

/** Turn `COLLATERAL_LOCKED` into `Collateral locked`. Capitalise first word. */
function humanise(event: string): string {
  const lower = event.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Classify an event name into a visual tone for the timeline dot. */
type EventTone = 'success' | 'warning' | 'destructive' | 'neutral';

function classifyEvent(event: string): EventTone {
  const upper = event.toUpperCase();
  if (
    upper.includes('COMPLETED') ||
    upper.includes('ACCEPTED') ||
    upper.includes('CONFIRMED') ||
    upper.includes('SETTLED') ||
    upper.includes('RELEASED') ||
    upper.includes('PAID')
  ) {
    return 'success';
  }
  if (
    upper.includes('FAILED') ||
    upper.includes('CANCELLED') ||
    upper.includes('FRAUD') ||
    upper.includes('EXPIRED')
  ) {
    return 'destructive';
  }
  if (upper.includes('DISPUTE') || upper.includes('HALTED')) {
    return 'warning';
  }
  return 'neutral';
}

function EventIcon({ tone }: { tone: EventTone }) {
  const base = 'size-4 shrink-0';
  switch (tone) {
    case 'success':
      return <Check className={cn(base, 'text-emerald-600')} aria-hidden />;
    case 'destructive':
      return <XCircle className={cn(base, 'text-destructive')} aria-hidden />;
    case 'warning':
      return <CircleAlert className={cn(base, 'text-gold')} aria-hidden />;
    default:
      return <CircleDot className={cn(base, 'text-muted-foreground')} aria-hidden />;
  }
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
    return <p className="text-body text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ol className={cn('space-y-cozy', className)} aria-label={ariaLabel}>
      {events.map((event) => {
        const tone = classifyEvent(event.event);
        return (
          <li key={event.id} className="flex items-center gap-cozy text-body">
            <span className="flex size-5 shrink-0 items-center justify-center">
              <EventIcon tone={tone} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-5">
                {humanise(event.event)}
                {myUserId && event.actor_id === myUserId ? (
                  <span className="ml-1.5 text-meta font-normal text-muted-foreground">
                    (you)
                  </span>
                ) : null}
              </p>
              {event.detail ? (
                <p className="mt-0.5 break-words text-muted-foreground">{event.detail}</p>
              ) : null}
              <p className="mt-0.5 text-meta text-muted-foreground">
                {formatContractDateTime(event.created_at)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
