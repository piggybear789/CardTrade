'use client';

// components/ui/confirm-dialog.tsx
//
// Shared confirmation step for irreversible or high-stakes actions (cancelling
// a contract, accepting a binding trade or offer, raising a dispute). Keeps
// the copy structure and button order consistent everywhere it appears.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon, TriangleAlertIcon } from '@hugeicons/core-free-icons';

import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = 'default',
  cancelLabel = 'Keep as is',
  onConfirm,
  pending = false,
  helpHref,
  helpLabel = 'How holds and disputes work',
  children,
  confirmDisabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  confirmVariant?: NonNullable<ButtonProps['variant']>;
  cancelLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  helpHref?: string;
  helpLabel?: string;
  /**
   * Anything the confirmation needs COLLECTED before it can proceed — a reason,
   * a choice, a checkbox.
   *
   * The alternative is what the cash sale used to do: put the field inline on the
   * page and use the dialog only to say "are you sure". That asks for the hardest
   * part of the decision — writing down what is wrong — before the reader has
   * been told what raising it does, and it leaves a permanent dispute form
   * sitting open on a contract that is going fine.
   */
  children?: ReactNode;
  /** Gate the confirm while {@link children} is incomplete. */
  confirmDisabled?: boolean;
}) {
  // A destructive confirm is the one shape where scanning the buttons is not
  // enough — by the time the red button is read the title has already been
  // skimmed. The icon marks the stakes at the top, where reading starts.
  const destructive = confirmVariant === 'destructive';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        {/* Header and help link share one block. Left as siblings of the footer
            they were separated by the dialog's own gap, so the link read as a
            stray band floating between the question and the answer instead of
            as a continuation of the explanation. */}
        <div className="space-y-cozy">
          <DialogHeader>
            {destructive ? (
              <div className="flex items-center gap-snug">
                <HugeiconsIcon icon={TriangleAlertIcon}
                  className="size-4 shrink-0 text-destructive"
                  aria-hidden
                />
                <div className="min-w-0 space-y-1.5">
                  <DialogTitle>{title}</DialogTitle>
                  <DialogDescription>{description}</DialogDescription>
                </div>
              </div>
            ) : (
              <>
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
              </>
            )}
          </DialogHeader>
          {helpHref ? (
            <p className="text-body">
              <Link
                href={helpHref}
                className="font-medium underline underline-offset-4 hover:text-foreground"
              >
                {helpLabel}
              </Link>
            </p>
          ) : null}
        </div>
        {children}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
            aria-busy={pending}
          >
            {pending ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
