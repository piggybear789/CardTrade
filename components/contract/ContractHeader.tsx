// components/contract/ContractHeader.tsx
//
// The identity strip every contract room opens with: what this contract is, what it is
// worth, who is in it, and what state it is in. One card, two lines.
//
// Deliberately NOT here any more: the eyebrow ("Purchase contract" — the page shell
// already renders that as the route h1) and the "whose move is it" clause, which now
// lives in exactly one place, `ContractActionCard`.
//
// CUT DOWN (UX review 2026-11-27), matching the phone's chat bar: the title and the
// money on one line, the progress under it. The status badge said what the
// progress label beside it already says ("Inspection" over "Step 3 of 4: Inspect"),
// "Holds placed with Stripe" restated the timeline, and "Offline" read as the other
// person being offline. The props stay so existing call sites compile.

import type { ReactNode } from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ContractConnectionStatus as Status } from './types';

export interface ContractHeaderProps {
  /**
   * The contract's own title — the item, the deal name, the counterparty.
   *
   * Say what this contract IS, not what type it is. A bare "Trade" duplicates the
   * rail beside it; "Trade with Ada" does not, and it answers the first question
   * a reader opening the room actually has. A cash sale passes the item for the
   * same reason.
   */
  title?: string;
  /** The money, in a few words. Right-aligned beside the title. */
  money?: ReactNode;
  /** The compact party line, usually `<ContractPartyLine/>`. */
  parties?: ReactNode;
  /** @deprecated Not shown; the progress label names the step. */
  status?: ReactNode;
  /** @deprecated Not shown; the timeline records the holds and the payment. */
  assurance?: ReactNode;
  /** `ContractProgressStrip`, as a second line under the identity row. */
  progress?: ReactNode;
  /** @deprecated Not shown. */
  connectionStatus?: Status;
  className?: string;
}

/** Shared contract-room identity strip. */
export function ContractHeader({
  title,
  money,
  parties,
  progress,
  className,
}: ContractHeaderProps) {
  return (
    <Card className={cn('border-border shadow-sm', className)}>
      <CardContent className="px-group py-cozy">
        {/* Identity on one line: the workspace below (details + chat) owns the
            vertical budget, so the strip packs title · parties on the left and
            status · money on the right, wrapping only when it must. */}
        <div className="flex flex-wrap items-center justify-between gap-x-group gap-y-snug">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-group gap-y-tight">
            {/* The page shell renders the route <h1>; this is the contract's own
                title.

                NO `title` ATTRIBUTE on it. One was there to reveal the full text
                when the heading truncates, but a native tooltip fires on every
                hover — and this heading sits at the top of a room people move the
                pointer across constantly, so it popped up all day for a string
                that is almost never truncated in the first place. */}
            {title ? (
              <h2 className="min-w-0 max-w-full truncate font-display text-subhead font-semibold tracking-tight">
                {title}
              </h2>
            ) : null}
            {parties ? <div className="min-w-0">{parties}</div> : null}
          </div>

          {money ? (
            <p className="display-value shrink-0 text-lead">{money}</p>
          ) : null}
        </div>
        {progress ? <div className="mt-snug">{progress}</div> : null}
      </CardContent>
    </Card>
  );
}
