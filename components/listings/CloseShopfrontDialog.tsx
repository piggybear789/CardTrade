'use client';

// components/listings/CloseShopfrontDialog.tsx
//
// Owner control for retiring a SHOPFRONT listing (0064).
//
// A shopfront never reaches SOLD, because nothing about the listing itself is
// ever sold — the contracts opened against it are. So unlike a single listing it
// has no natural end, and closing is that end: it leaves the catalog and stops
// taking new requests.
//
// Deliberately NOT a delete. `deleteListing` removes the row and its Storage
// objects, which live contracts snapshot their images from, and a shopfront is
// the one listing kind likely to have several contracts open at once. Closing
// leaves every one of them running.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Archive, Loader2 } from 'lucide-react';

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
import { closeShopfrontListing } from '@/lib/actions/listings';

const ERROR_MESSAGES: Record<string, string> = {
  'not-authenticated': 'Please sign in again.',
  'not-found': 'This listing no longer exists.',
  unauthorized: 'You can only close your own listing.',
  'persistence-error': 'This listing could not be closed. Please try again.',
};

export function CloseShopfrontDialog({
  itemId,
  itemTitle,
}: {
  itemId: string;
  itemTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleClose() {
    startTransition(async () => {
      const result = await closeShopfrontListing(itemId);
      if (result.ok) {
        setOpen(false);
        toast.success('Listing closed. Open contracts are unaffected.');
        router.refresh();
        return;
      }
      toast.error(
        result.message ?? ERROR_MESSAGES[result.error] ?? 'Something went wrong.',
      );
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-w-0 w-full px-2">
          <Archive aria-hidden />
          <span className="truncate">Close</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Close listing</DialogTitle>
          <DialogDescription className="break-words">
            {itemTitle} will stop appearing in the catalog and will not take new
            requests. Contracts already open stay open. You still need to finish
            those.
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
            onClick={handleClose}
            disabled={isPending}
            aria-busy={isPending}
          >
            {isPending ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <Archive aria-hidden />
            )}
            {isPending ? 'Closing…' : 'Close listing'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
