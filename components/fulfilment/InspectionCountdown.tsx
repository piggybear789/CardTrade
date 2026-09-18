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
        // The alarming branch keeps a red edge, because there the border IS the
        // signal and red is not otherwise on the page. The calm branch is a plain
        // hairline over a violet wash: it is a running clock, not a warning, and a
        // violet frame put it at the same weight as the alarm.
        alarming
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-border bg-iris/[0.07]',
        className,
      )}
      role={alarming ? 'alert' : undefined}
    >
      <p
        suppressHydrationWarning
        className="text-balance text-subhead font-semibold tracking-tight"
      >
        Inspection window · {remainingLabel(hours)}
      </p>
      {/* THE DEADLINE INSTANT IS NAMED IN BOTH BRANCHES, and it used to be named in
          only one.

          The waiting party got "You have already acted." and nothing else — no date, no
          time — so the one figure this banner exists to carry was withheld from the
          person who can do nothing but wait for it. "When does this resolve?" is
          precisely their question, and a heading reading "4 days left" is a rounding of
          the answer, not the answer.

          "You have already acted" was also untrue for a Cash_Sale seller. Inspection is
          the BUYER's step; the seller never had an action in it to have already taken.
          The copy now says who it is waiting on and until when. */}
      <p className="mt-tight text-muted-foreground" suppressHydrationWarning>
        {viewerMustAct
          ? `Check what you received, then accept it or raise a dispute by ${formatContractDateTime(deadlineAt)}. ${expiryConsequence}`
          : `Nothing is needed from you until ${formatContractDateTime(deadlineAt)}. ${expiryConsequence}`}
      </p>
      {collateralLapsesFirst ? (
        <p className="mt-snug text-body text-destructive">
          The collateral authorisation on this trade expires before the inspection
          window closes. Raise a dispute now rather than later: after the
          authorisation lapses there is nothing left to capture.
        </p>
      ) : null}
    </div>
  );
}
