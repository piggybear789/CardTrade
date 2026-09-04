'use client';

// components/listings/DeleteListingDialog.tsx
//
// A real, confirmed delete control for the owner's listing page. Previously the
// "Delete listing" button silently routed to the edit page instead of calling
// `deleteItem` (demo-contract-ux Task 7.1) — this replaces it with a genuine
// destructive confirmation dialog wired to the existing owner-gated server
// action. RLS scopes the delete to the owner, and the `items` foreign keys are
// `ON DELETE RESTRICT` for any active trade/sale/proposal, so deleting an item
// mid-transaction fails safely rather than corrupting a contract in progress.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { Delete02Icon, LoaderCircleIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { deleteItem } from '@/lib/actions/listings';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Please sign in again.',
  'not-found': 'This listing no longer exists.',
  unauthorized: 'You can only delete your own listing.',
  'persistence-error':
    'This listing could not be deleted. It may be part of an active trade or sale.',
};

export function DeleteListingDialog({
  itemId,
  itemTitle,
  className,
  compact = false,
}: {
  itemId: string;
  itemTitle: string;
  className?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteItem(itemId);
      if (result.ok) {
        setOpen(false);
        
        router.push('/listings/mine');
        router.refresh();
        return;
      }
      const message =
        result.message ?? ERROR_MESSAGES[result.error] ?? 'Something went wrong.';
      toast.error(message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          className={className ?? 'w-full sm:w-auto'}
          aria-label="Delete listing"
        >
          <HugeiconsIcon icon={Delete02Icon} aria-hidden />
          {compact ? null : 'Delete listing'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete listing</DialogTitle>
          <DialogDescription className="break-words">
            {itemTitle} will be permanently removed. This cannot be undone, and
            it cannot be done while the item is part of an active trade or sale.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : <HugeiconsIcon icon={Delete02Icon} aria-hidden />}
            {isPending ? 'Deleting…' : 'Delete listing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
