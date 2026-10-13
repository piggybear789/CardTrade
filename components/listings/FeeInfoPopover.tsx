'use client';

// components/listings/FeeInfoPopover.tsx
//
// The (i) beside a listing's fee-inclusive price. Tapping it shows how the figure
// breaks down: the seller's price, the NoDitto fee, and the total before postage.
//
// THE HEADLINE STAYS FEE-INCLUSIVE. Tucking the note away is only acceptable because
// the big number already contains the fee. The note explains that figure. The figure
// itself does not rely on it.
//
// BETA WAIVER. With `waived`, the popover says there is no NoDitto fee during the beta
// and names the normal rate. The wording comes from `lib/fees/feeLabels.ts`.

import { InfoPopover } from '@/components/ui/info-popover';
import {
  FEE_POPOVER_WAIVED_FOOTNOTE,
  FEE_POPOVER_WAIVED_TITLE,
  FEE_POPOVER_WAIVED_TRIGGER,
} from '@/lib/fees/feeLabels';

export function FeeInfoPopover({
  priceText,
  feeText,
  totalText,
  rateLabel,
  waived = false,
}: {
  /** The seller's asking price, formatted. */
  priceText: string;
  /** The Platform_Fee on that price, formatted. */
  feeText: string;
  /** Price plus fee, formatted: the headline figure. */
  totalText: string;
  /** The rate as members read it, e.g. "5%". */
  rateLabel: string;
  /** Fees are waived for the beta: say so, and name the normal rate. */
  waived?: boolean;
}) {
  return (
    <InfoPopover
      label={waived ? FEE_POPOVER_WAIVED_TRIGGER : 'Price includes the NoDitto fee. Show breakdown'}
    >
      <p className="font-medium text-foreground">
        {waived ? FEE_POPOVER_WAIVED_TITLE : 'This price includes the NoDitto fee'}
      </p>
      <dl className="mt-snug space-y-tight text-muted-foreground">
        <div className="flex justify-between gap-cozy">
          <dt>Seller&apos;s price</dt>
          <dd className="whitespace-nowrap tabular-nums">{priceText}</dd>
        </div>
        <div className="flex justify-between gap-cozy">
          <dt>{waived ? `NoDitto fee (normally ${rateLabel})` : `NoDitto fee (${rateLabel})`}</dt>
          <dd className="whitespace-nowrap tabular-nums">{feeText}</dd>
        </div>
        <div className="flex justify-between gap-cozy border-t pt-tight font-medium text-foreground">
          <dt>You pay</dt>
          <dd className="whitespace-nowrap tabular-nums">{totalText}</dd>
        </div>
      </dl>
      <p className="mt-snug text-meta text-muted-foreground">
        {waived
          ? FEE_POPOVER_WAIVED_FOOTNOTE
          : 'Postage, if any, is agreed with the seller before you pay.'}
      </p>
    </InfoPopover>
  );
}
