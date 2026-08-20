'use client';

// components/fulfilment/InspectionCountdown.tsx
//
// "You have until X to accept or dispute." Shared by the Cash_Sale and 2-way Trade
// rooms.
//
// A deadline that exists but is not shown is a trap, which is precisely what the
// trade room had until 0057: no clock at all, so an unresponsive counterpart parked
// both traders' collateral until the card authorisation lapsed. The Cash_Sale had the
// clock but never rendered it either — the sale simply completed one day and the
// buyer had no warning.

import { AlertTriangle, Clock } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatContractDateTime } from '@/lib/format';
import type { InspectionHoldRisk } from '@/domain/fulfilment';

/** One hour in milliseconds. */
const HOUR_MS = 3_600_000;

/** Round hours remaining down, so "1 hour left" never means 119 minutes. */
function hoursUntil(deadlineIso: string, now: number): number {
  return Math.floor((new Date(deadlineIso).getTime() - now) / HOUR_MS);
}

/** Human remaining time, coarse on purpose: an exact second count invites refreshing. */
function remainingLabel(hours: number): string {
  if (hours <= 0) return 'closing now';
  if (hours === 1) return '1 hour left';
  if (hours < 24) return `${hours} hours left`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day left' : `${days} days left`;
}

export interface InspectionCountdownProps {
  /** ISO instant. Renders nothing when absent. */
  deadlineAt: string | null | undefined;
  /** Whether the viewer still has to act. A settled viewer gets the calmer copy. */
  viewerMustAct?: boolean;
  /**
   * Whether the collateral authorisation outlives the window. Trades only: a
   * Cash_Sale holds collected funds, which do not expire.
   */
  holdRisk?: InspectionHoldRisk;
  /** What happens when the clock runs out, phrased per flow. */
  expiryConsequence: string;
  className?: string;
}

/**
 * Inspection window banner. Escalates from informational to warning inside the last
 * day, and flags the case where collateral lapses before the deadline — which is
 * reported rather than silently corrected, because shortening the window removes a
 * stated right and extending it promises a guarantee the provider has already let go.
 */
export function InspectionCountdown({
  deadlineAt,
  viewerMustAct = true,
  holdRisk = 'safe',
  expiryConsequence,
  className,
}: InspectionCountdownProps) {
  if (!deadlineAt) return null;

  const hours = hoursUntil(deadlineAt, Date.now());
  const urgent = hours < 24;
  const collateralLapsesFirst = holdRisk === 'expired-first';
  const alarming = urgent || collateralLapsesFirst;

  return (
    <div
      className={cn(
        'rounded-lg border px-group py-cozy text-body',
        alarming
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-dashed border-gold/40 bg-gold/10',
        className,
      )}
      role={alarming ? 'alert' : undefined}
    >
      <p suppressHydrationWarning className="flex items-center gap-snug font-medium">
        {alarming ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
        ) : (
          <Clock className="size-4 shrink-0" aria-hidden />
        )}
        Inspection window · {remainingLabel(hours)}
      </p>
      <p className="mt-1 text-muted-foreground">
        {viewerMustAct
          ? `Check what you received, then accept it or raise a dispute by ${formatContractDateTime(deadlineAt)}. ${expiryConsequence}`
          : `You have already acted. ${expiryConsequence}`}
      </p>
      {collateralLapsesFirst ? (
        <p className="mt-2 text-body text-destructive">
          The collateral authorisation on this trade expires before the inspection
          window closes. Raise a dispute now rather than later: after the
          authorisation lapses there is nothing left to capture.
        </p>
      ) : null}
    </div>
  );
}
