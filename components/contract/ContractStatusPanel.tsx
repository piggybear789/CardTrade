// components/contract/ContractStatusPanel.tsx
//
// WHERE THIS CONTRACT IS, AND WHOSE MOVE IT IS — the content of the room's Status tab.
//
// It is three things in a fixed order, and the order is the point: the lifecycle as a
// rail, then the live step stated as a heading, then whatever that step needs done. A
// reader who opens this tab is asking one of two questions ("how far along is this?",
// "what am I waiting for?") and both are answered above the fold without clicking.
//
// WHY IT EXISTS AT ALL. `ContractProgressRail` has been defined, exported and documented
// as the top of the room's spine since the rail replaced the seven-row action plan — and
// NOTHING in the cash-sale room rendered it. The e2e suite carries a comment about that
// (`tests/e2e/specs/cash-sale.spec.ts`): the room derived the same steps and drew only
// the live one, so the five states either side of it were invisible. The trade room has
// always shown the rail. This closes that gap rather than inventing a new surface.
//
// WHAT IT IS NOT. Not a second action dock. The chat dock stays the pinned, always-
// visible control for single-tap moves; this panel takes the controls that need TYPING,
// because a strip pinned over a conversation is the wrong place for two text fields.
// `CashSaleView` decides which controls belong where; this component just lays out
// whatever it is handed.

import type { ReactNode } from 'react';

import { ContractProgressRail } from './ContractProgressRail';
import { cn } from '@/lib/utils';
import type { ContractStep } from '@/domain/contract';

export interface ContractStatusPanelProps {
  /** The whole ordered plan, for the rail. */
  steps: ContractStep[];
  /** The live step. `null` once the contract is finished. */
  step: ContractStep | null;
  /**
   * Controls for the live step, when this panel is where they belong.
   *
   * Omit for a step whose control is a single button: the chat dock has it, and a
   * duplicate primary on the same screen makes the reader choose between two identical
   * offers. Pass fields here, never a lone button.
   */
  children?: ReactNode;
  /** One line under the controls — what saving them does. */
  footnote?: ReactNode;
  /**
   * A block of supporting fact under the step: the posted parcel, a deadline, a figure.
   *
   * Distinct from {@link children}, which is the CONTROL for the live step. A fact may
   * still contain a link or a refresh button — a tracking number that cannot be opened
   * is not much of a fact — but it is not what the step is waiting on.
   */
  fact?: ReactNode;
  className?: string;
}

export function ContractStatusPanel({
  steps,
  step,
  children,
  footnote,
  fact,
  className,
}: ContractStatusPanelProps) {
  const mine = step?.owner === 'you';

  return (
    <div className={cn('flex w-full min-w-0 flex-col gap-group', className)}>
      {/* NUMBERED AND CAPTIONED. This rail owns its surface — it is the first thing in
          a tab rather than a thin line over a conversation — so it can afford the second
          line that makes the sequence legible without clicking a tick. That is exactly
          the case the `captions` prop documents. */}
      {steps.length > 0 ? (
        <ContractProgressRail steps={steps} numbered captions />
      ) : null}

      {/* THE LIVE STEP AS A CARD, not as a paragraph.
          
          The panel used to open with the tab's own uppercase micro-heading and then a
          two-line sentence of explanation, with two bare inputs floating underneath in
          an otherwise empty panel. Everything was the same weight, so nothing led. The
          card gives the step an edge to sit in, the eyebrow says whose move it is before
          the heading says what the move is, and the controls sit inside the same box as
          the instruction that asks for them. */}
      <section
        aria-label="Next step"
        className={cn(
          'rounded-xl border p-group',
          // The tint is the same "your move" wash the dock uses, so the two surfaces
          // agree; a step you cannot act on stays on the plain card surface rather than
          // borrowing an urgency it does not have.
          mine ? 'border-border bg-iris/[0.08]' : 'border-border bg-card',
        )}
      >
        {/* THE EYEBROW ONLY EXISTS WHEN IT ADDS SOMETHING, which means only when the
            step is yours.
            
            It used to name the owner in every state, and for a step you cannot act on the
            plan's own label already says exactly that — "WAITING ON PIGGYBEAR" sat above
            "Waiting for piggybear to accept it", the same sentence twice, one in caps. On
            your own step the label is imperative ("Post it and add the tracking number")
            and never says whose move it is, so the eyebrow is the only thing that does. */}
        {mine ? (
          <p className="text-meta font-semibold uppercase tracking-wide text-iris-ink">
            Your move
          </p>
        ) : null}
        <h4 className="text-subhead font-semibold leading-tight tracking-tight">
          {step?.label ?? 'This contract is finished'}
        </h4>
        {step?.detail ? (
          // `max-w-prose` rather than the panel's full width: at 44rem+ a sentence of
          // guidance ran the whole inspector and read as a paragraph of terms.
          <p className="mt-snug max-w-prose text-body text-muted-foreground">
            {step.detail}
          </p>
        ) : null}
        {/* A BLOCK, NOT A STYLED STRING. This used to wrap `fact` in a `<p>` with
            `display-value` on it, which forced tabular figures onto whatever was passed
            and made a `<div>` child — a shipment summary with its own buttons — invalid
            HTML inside a paragraph. The slot now carries the spacing and nothing else;
            the caller owns the content. */}
        {fact ? <div className="mt-cozy">{fact}</div> : null}

        {children ? (
          // A RULE ABOVE THE CONTROLS. Inside one card the instruction and the form need
          // separating or they read as one run of text with boxes in it.
          <div className="mt-group border-t pt-group">{children}</div>
        ) : null}

        {footnote ? (
          <p className="mt-cozy text-meta text-muted-foreground">{footnote}</p>
        ) : null}
      </section>
    </div>
  );
}
