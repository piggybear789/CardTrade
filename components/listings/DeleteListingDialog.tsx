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
import { Loader2, Trash2 } from 'lucide-react';

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
    'This listing could not be deleted — it may be part of an active trade or sale.',
};

export function DeleteListingDialog({
  itemId,
  itemTitle,
}: {
  itemId: string;
  itemTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteItem(itemId);
      if (result.ok) {
        setOpen(false);
        toast.success('Listing deleted.');
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
        <Button type="button" variant="destructive" className="w-full sm:w-auto">
          <Trash2 aria-hidden />
          Delete listing
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this listing?</DialogTitle>
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
            {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            {isPending ? 'Deleting…' : 'Delete listing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
