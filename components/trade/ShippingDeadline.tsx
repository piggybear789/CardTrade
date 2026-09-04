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

import { HugeiconsIcon } from '@hugeicons/react';
import { Clock01Icon, PackageCheckIcon, TriangleAlertIcon } from '@hugeicons/core-free-icons';

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
  /**
   * Render as a chip rather than a banner.
   *
   * For hanging the clock off the step it constrains — the "Posted" tick on the
   * postage rail — instead of floating a full-width block above the plan, where
   * the deadline and the thing it is a deadline FOR were two unrelated elements.
   * The chip still turns destructive when the dispatch is late; what it drops is
   * the explanatory sentence, which the banner keeps for the overdue case.
   */
  compact?: boolean;
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
  compact = false,
  className,
}: ShippingDeadlineProps) {
  // IN_PERSON, or collateral has not locked yet: nothing to say.
  if (!deadlineAt) return null;

  const bothShipped = viewerShipped && counterpartShipped;

  if (compact) {
    // Both parcels are away, so the deadline is spent — and the rail's own tick
    // already shows Posted as done. A chip saying so would be a third statement
    // of the same fact.
    if (bothShipped) return null;

    const late = Boolean(overdueAt);
    const hours = hoursUntil(deadlineAt);
    return (
      <span
        className={cn(
          'inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-meta font-medium',
          late || (!viewerShipped && hours <= 12)
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-iris/40 bg-iris/10 text-iris-ink',
          className,
        )}
      >
        <HugeiconsIcon icon={Clock01Icon} className="size-3 shrink-0" aria-hidden />
        {late ? 'Overdue' : `${humaniseHours(hours)} left`}
      </span>
    );
  }

  if (bothShipped) {
    return (
      <div
        className={cn(
          'flex items-center gap-snug rounded-lg border bg-muted px-cozy py-snug text-body',
          className,
        )}
        role="status"
      >
        <HugeiconsIcon icon={PackageCheckIcon} className="size-4 shrink-0 text-trust" aria-hidden />
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
          'rounded-lg border border-destructive/40 bg-destructive/5 px-cozy py-snug text-body',
          className,
        )}
        role="alert"
      >
        {/* The icon rides the title line rather than the whole block, matching
            InspectionCountdown. Centred against a two-or-more-line block it
            drifts down beside the body copy and stops reading as a label for
            the headline it belongs to — and how far it drifts depends on how
            much the body wraps, so it moves with the viewport. */}
        <p className="flex items-center gap-snug font-medium text-foreground">
          <HugeiconsIcon icon={TriangleAlertIcon} className="size-4 shrink-0 text-destructive" aria-hidden />
          Dispatch is overdue
        </p>
        <p className="mt-1 text-muted-foreground">
          {viewerShipped
            ? 'You have posted, they have not. Raise a dispute before the collateral lapses.'
            : 'Post now — the trade loses its collateral protection when the hold lapses.'}
        </p>
      </div>
    );
  }

  const hours = hoursUntil(deadlineAt);
  // Only the person who still owes a dispatch gets the urgent treatment.
  const urgent = !viewerShipped && hours <= 12;

  return (
    <div
      className={cn(
        'rounded-lg border px-cozy py-snug text-body',
        urgent ? 'border-destructive/40 bg-destructive/5' : 'bg-muted',
        className,
      )}
      role={urgent ? 'alert' : 'status'}
    >
      <p className="flex items-center gap-snug font-medium text-foreground">
        <HugeiconsIcon icon={Clock01Icon}
          className={cn(
            'size-4 shrink-0',
            urgent ? 'text-destructive' : 'text-muted-foreground',
          )}
          aria-hidden
        />
        {viewerShipped
          ? `Waiting on the other trader · ${humaniseHours(hours)} left`
          : `Post within ${humaniseHours(hours)}`}
      </p>
      {/* The WHY only when it changes what you do. "Posted trades have a dispatch
          deadline so the trade finishes before the collateral authorisation
          expires, about seven days after it was placed" is true, and it sat under
          every countdown from day one telling a trader with nine days left a piece
          of policy they could not act on. With hours to go it is the reason to
          move, so it appears then. */}
      {urgent ? (
        <p className="mt-1 text-muted-foreground">
          Miss it and the trade loses its collateral protection.
        </p>
      ) : null}
    </div>
  );
}
