// components/ui/pending-label.tsx
//
// A button label that keeps its width while the action runs.
//
// Submits across the app swapped their text on press — "Save address" -> "Saving…",
// "Freeze and report" -> "Submitting…" — and most also prepended a spinner to a label
// that did not change at all. A button sized by its content then resized under the
// pointer that had just pressed it, and in a right-aligned dialog footer the Cancel
// beside it slid sideways by the difference.
//
// Both states are laid in ONE grid cell, so the button is always as wide as the wider
// of the two and only the visible one changes. The hidden state is `invisible`
// (visibility: hidden) AND `aria-hidden`, so a screen reader — and a jsdom test that
// computes no styles — hears exactly the label it heard before.
//
// Inherits the button's `[&_svg]` sizing because the spinner is a descendant, and
// re-declares the button's `gap-1.5` because the gap does not reach inside a span.

import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

export interface PendingLabelProps {
  /** True while the action is running. */
  pending: boolean;
  /** The resting label — text, or an icon plus text. */
  children: ReactNode;
  /**
   * The label while running. Omit to keep the resting text and only add the spinner,
   * which is what most of these buttons did.
   */
  pendingLabel?: ReactNode;
  /** Prepend the spinning glyph in the pending state. Default true. */
  spinner?: boolean;
}

/** Width-stable label for a button that has a pending state. */
export function PendingLabel({
  pending,
  children,
  pendingLabel,
  spinner = true,
}: PendingLabelProps) {
  const cell = 'col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5';
  return (
    <span className="inline-grid">
      <span className={cn(cell, pending && 'invisible')} aria-hidden={pending || undefined}>
        {children}
      </span>
      <span className={cn(cell, !pending && 'invisible')} aria-hidden={!pending || undefined}>
        {spinner ? (
          <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
        ) : null}
        {pendingLabel ?? children}
      </span>
    </span>
  );
}
