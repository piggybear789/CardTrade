'use client';

// components/onboarding/OnboardingSpine.tsx
//
// The visual chrome for the unified seller onboarding (unified-seller-onboarding,
// Req 1.5). Two steps on a vertical spine: the active one expands in place, a finished
// one collapses to a single confirmed line carrying what it produced.
//
// WHY VERTICAL AND NUMBERED. The contract room's `ContractProgressRail` is horizontal
// because it summarises seven states as one thin line. Here there are exactly TWO
// steps and each holds substantial content (a provider modal, an embedded form), so a
// horizontal rail of two dots would be sparse chrome above the real work. Numbering is
// honest rather than decorative: this IS a dependency sequence — the identity check
// unlocks selling, and payout setup needs the account it creates — so the order
// carries information the seller needs.
//
// The colour vocabulary is deliberately borrowed from the contract rail so the two
// read as the same product: `trust` for travelled/complete, `gold` for "you are here".

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';

export type SpineStepState = 'done' | 'active' | 'upcoming';

export interface OnboardingSpineStepProps {
  /** 1-based position, rendered in the marker when not yet complete. */
  index: number;
  state: SpineStepState;
  title: string;
  /** One line on what this step is for. Shown while active or upcoming. */
  description?: string;
  /**
   * What the step produced, shown once complete — a receipt rather than a restated
   * label (e.g. "Verified as Jane Smith").
   */
  receipt?: string;
  /** Whether a connector should run on to a following step. */
  hasNext: boolean;
  /** The step's own controls. Rendered on the right of the title while active. */
  children?: ReactNode;
}

/** One step on the spine. */
export function OnboardingSpineStep({
  index,
  state,
  title,
  description,
  receipt,
  hasNext,
  children,
}: OnboardingSpineStepProps) {
  const done = state === 'done';
  const active = state === 'active';

  // The line's colour is a claim about what has been TRAVELLED, so each half is derived
  // from a different fact. Below the marker: whether THIS step is done. Above it:
  // whether the step could be reached at all, which for a dependency chain means the
  // previous one finished — deriving that from `done` too would leave a grey segment
  // butted against a coloured one at the same marker.
  const lineBelow = done ? 'bg-trust/60' : 'bg-border';
  const lineAbove = index > 1 && state !== 'upcoming' ? 'bg-trust/60' : 'bg-border';

  return (
    // TWO ROWS, NOT ONE: the head (marker + title + receipt) and the body (the step's
    // controls). Splitting them is what lets the marker be CENTRED on its title block
    // rather than top-aligned to it — a grid cell can centre its content, and the head
    // cell's height is the text's height rather than the whole step's.
    <li
      className="grid grid-cols-[auto_1fr] gap-x-group"
      aria-current={active ? 'step' : undefined}
    >
      {/* Head row, marker column. The marker sits between two flexible line segments,
          so it centres itself against whatever height the text beside it takes. The
          segments are decoration; state is carried by text so it is never colour-only. */}
      <div className="flex flex-col items-center">
        <span
          aria-hidden
          className={cn(
            'w-[3px] flex-1 rounded-full transition-colors duration-500',
            index > 1 ? lineAbove : 'bg-transparent',
          )}
        />
        <span
          className={cn(
            'my-tight grid size-7 shrink-0 place-items-center rounded-full border text-meta font-semibold transition-all duration-300',
            done && 'cardtrade-success-chip',
            active && 'border-gold bg-gold/20 text-foreground ring-2 ring-gold/25',
            !done && !active && 'border-border bg-card text-muted-foreground',
          )}
          aria-hidden
        >
          {done ? <Check className="size-3.5" /> : index}
        </span>
        <span
          aria-hidden
          className={cn(
            'w-[3px] flex-1 rounded-full transition-colors duration-500',
            hasNext ? lineBelow : 'bg-transparent',
          )}
        />
      </div>

      {/* Head row, content column. Title and the step's action share one row so the
          control sits to the RIGHT of the copy. The action column is only as wide as
          the button — a full-width sibling is what squeezed the heading onto three
          lines in a narrower dialog. */}
      <div className="min-w-0 py-tight">
        <div className="flex flex-col gap-cozy sm:flex-row sm:items-start sm:justify-between sm:gap-group">
          <div className="min-w-0 flex-1">
            <h3
              className={cn(
                'text-pretty text-lead font-semibold sm:whitespace-nowrap',
                done ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {title}
            </h3>
            <span className="sr-only">
              {done ? '(complete)' : active ? '(current step)' : '(not started)'}
            </span>

            {done && receipt ? (
              <p className="mt-tight text-body text-muted-foreground">{receipt}</p>
            ) : null}

            {!done && description ? (
              <p className="mt-tight text-pretty text-body leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>

          {active && children ? (
            <div className="shrink-0 sm:self-start">{children}</div>
          ) : null}
        </div>
      </div>

      {/* Body row, marker column — the line continues past the head to the next
          step's marker. */}
      <div className="flex justify-center">
        <span
          aria-hidden
          className={cn(
            'w-[3px] rounded-full transition-colors duration-500',
            hasNext ? lineBelow : 'bg-transparent',
          )}
        />
      </div>

      <div className={cn('min-w-0', hasNext ? 'pb-section' : 'pb-0')} />
    </li>
  );
}

/** The spine container. */
export function OnboardingSpine({ children }: { children: ReactNode }) {
  return (
    <ol className="grid gap-0" aria-label="Seller setup steps">
      {children}
    </ol>
  );
}

/**
 * The reassurance line that sits directly under a step's primary control.
 *
 * Placed at the point of action rather than in a page-level banner: this is the
 * moment a member is deciding whether to hand over a document or a bank account, and
 * the answer to "who sees this" has to be where their eyes already are. Mirrors
 * `ProcessorNote` in `components/payments/AddPaymentMethodForm.tsx`.
 */
export function CustodyNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-tight text-meta leading-relaxed text-muted-foreground">
      <svg
        viewBox="0 0 16 16"
        className="mt-0.5 size-3.5 shrink-0 text-trust"
        fill="currentColor"
        aria-hidden
      >
        <path d="M8 1 3 3v4.5c0 3 2.1 5.8 5 6.5 2.9-.7 5-3.5 5-6.5V3L8 1Zm2.7 5.2-3.2 3.2a.7.7 0 0 1-1 0L4.9 7.8a.7.7 0 1 1 1-1l1.1 1.1 2.7-2.7a.7.7 0 1 1 1 1Z" />
      </svg>
      <span>{children}</span>
    </p>
  );
}
