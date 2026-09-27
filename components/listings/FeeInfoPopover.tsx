'use client';

// components/listings/FeeInfoPopover.tsx
//
// The (i) beside a listing's fee-inclusive price. Tapping it shows how the figure
// breaks down: the seller's price, the NoDitto fee, and the total before postage.
//
// A POPOVER, NOT A TOOLTIP. A tooltip opens on hover and focus only, so on a phone,
// where most buyers are, it would never open. A popover opens on tap and on
// Enter/Space.
//
// THE HEADLINE STAYS FEE-INCLUSIVE. Tucking the note away is only acceptable because
// the big number already contains the fee. The note explains that figure. The figure
// itself does not rely on it.

import { HugeiconsIcon } from '@hugeicons/react';
import { InformationCircleIcon } from '@hugeicons/core-free-icons';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export function FeeInfoPopover({
  priceText,
  feeText,
  totalText,
  rateLabel,
}: {
  /** The seller's asking price, formatted. */
  priceText: string;
  /** The Platform_Fee on that price, formatted. */
  feeText: string;
  /** Price plus fee, formatted: the headline figure. */
  totalText: string;
  /** The rate as members read it, e.g. "5%, min $1.50". */
  rateLabel: string;
}) {
  return (
    <Popover>
      <PopoverTrigger
        type="button"
        aria-label="Price includes the NoDitto fee. Show breakdown"
        // 24px target with the 16px icon centred, clear of WCAG 2.5.8's minimum.
        className="inline-flex size-6 shrink-0 items-center justify-center self-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <HugeiconsIcon icon={InformationCircleIcon} className="size-4" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 text-body">
        <p className="font-medium text-foreground">This price includes the NoDitto fee</p>
        <dl className="mt-snug space-y-tight text-muted-foreground">
          <div className="flex justify-between gap-cozy">
            <dt>Seller&apos;s price</dt>
            <dd className="tabular-nums">{priceText}</dd>
          </div>
          <div className="flex justify-between gap-cozy">
            <dt>NoDitto fee ({rateLabel})</dt>
            <dd className="tabular-nums">{feeText}</dd>
          </div>
          <div className="flex justify-between gap-cozy border-t pt-tight font-medium text-foreground">
            <dt>You pay</dt>
            <dd className="tabular-nums">{totalText}</dd>
          </div>
        </dl>
        <p className="mt-snug text-meta text-muted-foreground">
          Postage, if any, is agreed with the seller before you pay.
        </p>
      </PopoverContent>
    </Popover>
  );
}
