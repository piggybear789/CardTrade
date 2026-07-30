'use client';

// Propose a 2-way trade from the listing detail page — same form as
// /trades/new, presented as a sheet/dialog so Buy / Trade / Offer stay in place.

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';

import { ListingActionIcon } from '@/components/listings/ListingActionIcon';
import {
  TradeOfferForm,
  type TradeOfferRequested,
} from '@/components/trade/TradeOfferForm';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { ItemRow } from '@/lib/actions/listings';

export interface ProposeTradeDialogProps {
  requested: TradeOfferRequested;
  ownItems: ItemRow[];
  /** `icon` matches the listing action row; `button` for denser placements. */
  appearance?: 'icon' | 'button';
  /** Filled chip when this is the only transactional CTA (trades-only sellers). */
  emphasize?: boolean;
}

export function ProposeTradeDialog({
  requested,
  ownItems,
  appearance = 'icon',
  emphasize = false,
}: ProposeTradeDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function handleSuccess() {
    setOpen(false);
    router.push('/trades');
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {appearance === 'icon' ? (
          <ListingActionIcon
            icon={ArrowLeftRight}
            label="Propose Trade"
            variant={emphasize ? 'default' : 'outline'}
          />
        ) : (
          <Button type="button" variant={emphasize ? 'default' : 'outline'}>
            <ArrowLeftRight aria-hidden="true" />
            Propose Trade
          </Button>
        )}
      </DialogTrigger>
      {/*
        Long form: pin header + footer, scroll the middle. Default DialogContent
        scrolls the whole sheet, so a sticky action bar covers the totals.
      */}
      <DialogContent className="h-[min(92dvh,100dvh-env(safe-area-inset-top))] min-w-0 gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[min(92dvh,100dvh-3rem)] sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 pb-3 pt-2 pr-14 sm:px-6 sm:py-4">
          <DialogTitle>Offer a trade</DialogTitle>
          <DialogDescription>
            Nothing is reserved until {requested.ownerName} accepts.
          </DialogDescription>
        </DialogHeader>
        <TradeOfferForm
          requested={requested}
          ownItems={ownItems}
          layout="dialog"
          onSuccess={handleSuccess}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
