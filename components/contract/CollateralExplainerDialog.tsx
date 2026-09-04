'use client';

// components/contract/CollateralExplainerDialog.tsx
//
// Keeps the contract Collateral tab focused on the live protection status. The
// detailed lifecycle belongs in this focused dialog, where it can be read at the
// member's pace without turning the inspector into a wall of text.

import type { ReactNode } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { HelpCircleIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
          <HugeiconsIcon icon={HelpCircleIcon} className="mr-2 size-4" aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      {/* No inner scroll container: DialogContent already scrolls, and nesting a
          second one meant the wheel stalled at the boundary. `sm:max-w-lg`,
          not 2xl — this is prose, and a 42rem measure left a wide empty band. */}
      <DialogContent className="sm:max-w-lg" mobile="sheet">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Got it
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
