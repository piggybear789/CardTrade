'use client';

// components/contract/CollateralExplainerDialog.tsx
//
// Keeps the contract Collateral tab focused on the live protection status. The
// detailed lifecycle belongs in this focused dialog, where it can be read at the
// member's pace without turning the inspector into a wall of text.

import type { ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface CollateralExplainerDialogProps {
  /** Short, member-facing dialog title. */
  title: string;
  /** One sentence that sets expectations before the detailed content. */
  description: string;
  /** Button copy appropriate to the current transaction model. */
  triggerLabel: string;
  children: ReactNode;
}

/** Opens a full explanation without crowding the live Collateral tab. */
export function CollateralExplainerDialog({
  title,
  description,
  triggerLabel,
  children,
}: CollateralExplainerDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto">
          <CircleHelp className="mr-2 size-4" aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl" mobile="sheet">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto pr-0.5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
