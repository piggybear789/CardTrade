'use client';

// components/contract/ContractProgressStrip.tsx
//
// Where the contract is, as ONE continuous bar (UX review 2026-11-27). It was a row
// of segments, one per step; the segments read as a loading bar cut into pieces and
// said nothing a single bar does not.
//
// TIME WHEN THERE IS A CLOCK. While the live step has a window that resolves on its
// own (inspection), the bar is that window: how much of it has gone, with the time
// left and the instant it completes underneath. Otherwise it fills by the steps
// finished. Both the desktop header and the phone's step card draw it, so the two
// cannot disagree.
//
// The full numbered rail lives in the Status tab; this is the glanceable version.

import type { ContractStep } from '@/domain/contract';
import {
  hoursUntil,
  remainingLabel,
  useMinuteNow,
} from '@/components/fulfilment/InspectionCountdown';
import { formatContractDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const HOUR_MS = 3_600_000;

/** A running window on the live step, e.g. the inspection period. */
export interface ContractStepClock {
  /** ISO instant the window ends, and the contract resolves on its own. */
  deadlineAt: string;
  /**
   * The window's nominal length, for how full the bar is. A deadline clamped
   * shorter (a trade's collateral expiry, ESC-17b) just starts the bar further
   * along; the end label is always the real instant.
   */
  windowHours: number;
  /** Whether the viewer still has to act before it ends. */
  viewerMustAct: boolean;
  /** What the viewer can do, when they must act. Defaults to the inspection line. */
  actLine?: string;
}

export function ContractProgressStrip({
  steps,
  clock = null,
  bare = false,
  className,
}: {
  steps: readonly ContractStep[];
  clock?: ContractStepClock | null;
  /**
   * The bar and its clock line only, for the phone's step card, whose title
   * already names the step. Without a clock that is the bar alone; the position
   * stays for screen readers.
   */
  bare?: boolean;
  className?: string;
}) {
  const now = useMinuteNow();
  if (steps.length === 0) return null;

  const liveIndex = steps.findIndex((step) => step.status === 'active' || step.status === 'halted');
  const live = liveIndex >= 0 ? steps[liveIndex] : null;
  const allDone = liveIndex < 0 && steps.every((step) => step.status === 'done');
  const halted = live?.status === 'halted';
  const position = live ? `Step ${liveIndex + 1} of ${steps.length}` : null;

  let fill: number;
  let hoursLeft = 0;
  if (clock) {
    hoursLeft = hoursUntil(clock.deadlineAt, now);
    const msLeft = new Date(clock.deadlineAt).getTime() - now;
    const total = Math.max(clock.windowHours * HOUR_MS, msLeft, 1);
    fill = Math.min(1, Math.max(0, 1 - msLeft / total));
  } else {
    const done = steps.filter((step) => step.status === 'done').length;
    fill = allDone ? 1 : done / steps.length;
  }
  const urgent = clock ? hoursLeft < 24 : false;

  const stepLabel = live ? (
    <span className="flex min-w-0 items-baseline gap-x-cozy">
      <span className={cn('truncate font-semibold', halted ? 'text-destructive' : 'text-foreground')}>
        {live.short ?? live.label}
      </span>
      <span className="shrink-0">{position}</span>
    </span>
  ) : allDone ? (
    <span>All steps complete</span>
  ) : null;

  const clockLabel = clock ? (
    <span className="flex min-w-0 items-baseline gap-x-cozy" suppressHydrationWarning>
      <span className={cn('shrink-0', urgent && 'font-medium text-destructive')}>
        {remainingLabel(hoursLeft)}
      </span>
      <span className="truncate">Completes {formatContractDateTime(clock.deadlineAt)}</span>
    </span>
  ) : null;

  const bar = (
    <span
      className="relative block h-1.5 w-full overflow-hidden rounded-full bg-accent"
      aria-hidden
      suppressHydrationWarning
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 rounded-full',
          halted || urgent ? 'bg-destructive/60' : clock ? 'bg-iris/45' : 'bg-iris/70',
        )}
        style={{ width: `${Math.round(fill * 100)}%` }}
      />
    </span>
  );

  if (bare) {
    return (
      <div className={cn('min-w-0', className)}>
        {bar}
        {clockLabel ? (
          <p className="mt-1 flex justify-between gap-cozy text-meta text-muted-foreground">
            {clockLabel}
          </p>
        ) : position ? (
          <p className="sr-only">{position}</p>
        ) : null}
      </div>
    );
  }

  // Desktop header: the bar, then the step on the left and the clock on the right.
  return (
    <div className={cn('min-w-0', className)}>
      {bar}
      <p className="mt-1 flex justify-between gap-group text-meta text-muted-foreground">
        {stepLabel ?? <span />}
        {clockLabel}
      </p>
    </div>
  );
}
