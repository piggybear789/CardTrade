// components/ui/dialog-row.tsx
//
// A bordered row that opens a dialog holding a group of fields, with a one-line
// summary of whatever that dialog currently holds. Shared by the trade offer
// card and the new-deal form so every "there is more here, in its own window"
// control reads as the same kind of thing.
//
// Folding a group of fields behind one of these keeps a form's height constant
// whichever path the user took through it, without hiding anything: the hint is
// the summary, so the state is readable from the card.

import { HugeiconsIcon } from '@hugeicons/react';
import { PencilIcon, PlusIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

export interface DialogRowProps {
  label: string;
  /** Right-aligned muted text: a summary of what is set, or what this is for. */
  hint: string;
  /**
   * Swaps the plus for a pencil, which is the only signal distinguishing "add"
   * from "change".
   */
  filled?: boolean;
  /**
   * Marks the row the same way a required field label is marked, so a group of
   * fields folded into a dialog is not mistaken for an optional extra.
   */
  required?: boolean;
  /** Marks the row when the fields it holds failed validation. */
  invalid?: boolean;
  onClick: () => void;
}

export function DialogRow({
  label,
  hint,
  filled = false,
  required = false,
  invalid = false,
  onClick,
}: DialogRowProps) {
  const Icon = filled ? PencilIcon : PlusIcon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-left text-body font-medium transition-colors hover:border-iris/50 hover:bg-muted focus-visible:border-iris focus-visible:outline-none',
        invalid && 'border-destructive',
      )}
    >
      <HugeiconsIcon icon={Icon} aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 shrink-0">
        {label}
        {required ? (
          <>
            <span className="ml-0.5 text-destructive" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </span>
      <span className="ml-auto min-w-0 truncate pl-2 text-body font-normal text-muted-foreground">
        {hint}
      </span>
    </button>
  );
}
