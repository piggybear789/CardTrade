// components/trade/ShippingDeadline.tsx
//
// Surfaces the dispatch deadline on a DELIVERY trade (Req 5.4 timeline).
//
// WHY IT EXISTS. Collateral is a real card authorisation and lapses after about
// seven days. A posted trade ships in BOTH directions, so transit plus inspection
// can outrun that window and the collateral is released mid-trade — the safety
// guarantee gone. Migration 0039 gives DELIVERY trades a 48-hour dispatch
// deadline and notifies people about it; this is the in-context version, so a
// trader sees the clock on the contract itself rather than only in a
// notification they may have dismissed.
//
// Renders nothing for IN_PERSON trades, which have no deadline: both parties meet
// and inspect on the spot, so they never race the authorisation window.

import { AlertTriangle, Clock, PackageCheck } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ShippingDeadlineProps {
  /** `trades.shipping_deadline_at`. Null for IN_PERSON, or before collateral locks. */
  deadlineAt: string | null;
  /** `trades.shipping_overdue_at`. Set once the deadline passed unmet. */
  overdueAt: string | null;
  /** Whether the VIEWER has already dispatched their item. */
  viewerShipped: boolean;
  /** Whether the counterparty has dispatched theirs. */
  counterpartShipped: boolean;
  className?: string;
}

/** Whole hours remaining, floored, never negative. */
function hoursUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / (60 * 60 * 1000)));
}

/** Render `36` as `1 day 12 hours`, `5` as `5 hours`. */
function humaniseHours(hours: number): string {
  if (hours < 1) return 'under an hour';
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? 'hour' : 'hours'}`);
  return parts.join(' ');
}

/**
 * A dispatch-deadline banner for posted trades.
 *
 * Three states, deliberately different in tone:
 *  - both dispatched → reassurance, no deadline pressure
 *  - overdue → destructive, and explicit that protection is at risk
 *  - counting down → neutral, unless it is the viewer who still has to post
 */
export function ShippingDeadline({
  deadlineAt,
  overdueAt,
  viewerShipped,
  counterpartShipped,
  className,
}: ShippingDeadlineProps) {
  // IN_PERSON, or collateral has not locked yet: nothing to say.
  if (!deadlineAt) return null;

  const bothShipped = viewerShipped && counterpartShipped;

  if (bothShipped) {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm',
          className,
        )}
        role="status"
      >
        <PackageCheck className="mt-0.5 size-4 shrink-0 text-trust" aria-hidden />
        <p className="text-muted-foreground">
          Both items are on their way. The dispatch deadline no longer applies.
        </p>
      </div>
    );
  }

  if (overdueAt) {
    return (
      <div
        className={cn(
          'flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm',
          className,
        )}
        role="alert"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-medium text-foreground">Dispatch is overdue</p>
          <p className="text-muted-foreground">
            {viewerShipped
              ? 'You have posted, but the other trader has not. The collateral ' +
                'authorisation expires about seven days after it was placed, so if ' +
                'their item does not arrive, raise a dispute before then rather than after.'
              : 'Post your item as soon as possible. The collateral authorisation ' +
                'expires about seven days after it was placed, and this trade loses ' +
                'its protection when that happens.'}
          </p>
        </div>
      </div>
    );
  }

  const hours = hoursUntil(deadlineAt);
  // Only the person who still owes a dispatch gets the urgent treatment.
  const urgent = !viewerShipped && hours <= 12;

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm',
        urgent ? 'border-destructive/40 bg-destructive/5' : 'bg-muted/30',
        className,
      )}
      role={urgent ? 'alert' : 'status'}
    >
      <Clock
        className={cn(
          'mt-0.5 size-4 shrink-0',
          urgent ? 'text-destructive' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-foreground">
          {viewerShipped
            ? `Waiting on the other trader · ${humaniseHours(hours)} left`
            : `Post within ${humaniseHours(hours)}`}
        </p>
        <p className="text-muted-foreground">
          {viewerShipped
            ? 'You have posted. Their dispatch deadline keeps the trade inside the ' +
              'collateral authorisation window.'
            : 'Posted trades have a dispatch deadline so the trade finishes before ' +
              'the collateral authorisation expires, about seven days after it was placed.'}
        </p>
      </div>
    </div>
  );
}
