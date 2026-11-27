'use client';

// components/contract/ContractStepCard.tsx
//
// The phone's "where is this contract" card, under the person line of the chat bar
// (UX review 2026-11-27, header option A with the time bar).
//
// It replaced three things that each said part of it: the status badge on the
// subject line, the "Step 3 of 4 · Accept items" strip, and the grey inspection
// banner above the room. One card now says which step, how far along, and, while a
// window is running, how much of it is left and when it ends on its own. The bar
// is `ContractProgressStrip`, the same one the desktop header draws.
//
// Tapping the card opens the contract details sheet, which is what the (i) on the
// old subject line did. In the split layout the contract header above carries all
// of this, so the chat bar does not render the card there.

import { Icon } from '@/components/ui/icon';
import { CaretRightIcon } from '@/components/ui/icons';

import { StorageImage } from '@/components/ui/storage-image';
import {
  ContractProgressStrip,
  type ContractStepClock,
} from '@/components/contract/ContractProgressStrip';
import { useContractFocus } from '@/components/contract/ContractFocus';
import { cn } from '@/lib/utils';
import type { ContractStep } from '@/domain/contract';

export type { ContractStepClock };

export interface ContractStepCardProps {
  steps: readonly ContractStep[];
  /** Resolved item image URL. */
  thumb?: string | null;
  clock?: ContractStepClock | null;
  /** The other party, for "Waiting for Ada" on their move. */
  waitingFor?: string;
  className?: string;
}

export function ContractStepCard({
  steps,
  thumb,
  clock,
  waitingFor,
  className,
}: ContractStepCardProps) {
  const { openDetails } = useContractFocus();
  if (steps.length === 0) return null;

  const liveIndex = steps.findIndex((s) => s.status === 'active' || s.status === 'halted');
  const live = liveIndex >= 0 ? steps[liveIndex] : null;
  const allDone = liveIndex < 0 && steps.every((s) => s.status === 'done');
  const theirMove = live?.status === 'active' && live.owner === 'them';

  const name = live ? (live.short ?? live.label) : allDone ? 'Complete' : 'Closed';
  const position = live && live.status === 'active' ? `Step ${liveIndex + 1} of ${steps.length}` : null;

  let subline: string;
  if (clock) {
    subline = clock.viewerMustAct
      ? (clock.actLine ?? 'Accept it or report a problem')
      : theirMove && waitingFor
        ? `Waiting for ${waitingFor}`
        : 'Nothing is needed from you';
  } else if (live) {
    // The full sentence: "Waiting for Ada to pay", "Post it and add the tracking number".
    subline = live.label === name ? (live.detail ?? '') : live.label;
  } else {
    subline = allDone ? 'All steps complete' : '';
  }

  return (
    <button
      type="button"
      onClick={openDetails}
      aria-haspopup="dialog"
      className={cn(
        // The card edge everywhere (`.surface`), not a border and a shadow; hover
        // is a faint slate step, where `bg-card/80` on a white page was no change.
        'surface block w-full rounded-xl bg-card px-cozy py-2.5 text-left transition-colors hover:bg-muted/50',
        'focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        className,
      )}
    >
      <span className="flex items-center gap-cozy">
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-x-cozy leading-snug">
            <span className="truncate text-body font-semibold">{name}</span>
            {position ? (
              <span className="shrink-0 text-meta text-muted-foreground">{position}</span>
            ) : null}
          </span>
          {/* Always drawn, one line, so the card holds its height between steps. */}
          <span className="block min-h-[1lh] truncate text-meta text-muted-foreground">
            {subline}
          </span>
        </span>
        {thumb ? (
          <StorageImage
            src={thumb}
            alt=""
            width={36}
            height={36}
            className="size-9 shrink-0 rounded-md border object-cover"
            loading="lazy"
          />
        ) : null}
        <Icon
          icon={CaretRightIcon}
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </span>
      <span className="sr-only">Contract details</span>

      <ContractProgressStrip steps={steps} clock={clock} bare className="mt-2" />
    </button>
  );
}
