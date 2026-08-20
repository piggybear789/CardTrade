'use client';

// components/ui/confirm-dialog.tsx
//
// Shared confirmation step for irreversible or high-stakes actions (cancelling
// a contract, accepting a binding trade or offer, raising a dispute). Keeps
// the copy structure and button order consistent everywhere it appears.

import type { ReactNode } from 'react';
import Link from 'next/link';

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
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending && !next) return;
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
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
        <DialogFooter className="gap-2">
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
            disabled={pending}
            aria-busy={pending}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
