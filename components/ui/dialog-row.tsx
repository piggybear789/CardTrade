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

import { Pencil, Plus } from 'lucide-react';

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
  const Icon = filled ? Pencil : Plus;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium ring-offset-background transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        invalid && 'border-destructive',
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      {label}
      {required ? (
        <>
          <span className="-ml-1 text-destructive" aria-hidden="true">
            *
          </span>
          <span className="sr-only">(required)</span>
        </>
      ) : null}
      <span className="ml-auto truncate pl-2 text-xs font-normal text-muted-foreground">
        {hint}
      </span>
    </button>
  );
}
