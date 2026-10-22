'use client';

// components/listings/FeeInfoPopover.tsx
//
// The (i) beside a listing's fee-inclusive price. Tapping it shows how the figure
// breaks down: the seller's price, the service fee, and the total before postage.
//
// THE HEADLINE STAYS FEE-INCLUSIVE. Tucking the note away is only acceptable because
// the big number already contains the fee. The note explains that figure. The figure
// itself does not rely on it.

import { InfoPopover } from '@/components/ui/info-popover';
import { PROCESSING_FEE_NAME, nodittoFeeRateLabel } from '@/lib/fees/feeLabels';

export function FeeInfoPopover({
  priceText,
  feeText,
  totalText,
  rateLabel,
  otherCardsNote,
}: {
  /** The seller's asking price, formatted. */
  priceText: string;
  /** The service fee on that price, formatted. */
  feeText: string;
  /** Price plus fee, formatted: the headline figure. */
  totalText: string;
  /** The card rate as members read it, e.g. "3% + A$0.60". */
  rateLabel: string;
  /**
   * The dearer rates for a card issued abroad (`otherCardRatesNote`), e.g. "Cards
   * issued outside Australia: 5% + A$0.60." The breakdown above is for a domestic card.
   */
  otherCardsNote?: string;
}) {
  return (
    <InfoPopover label="Price includes the service fee. Show breakdown">
      <p className="font-medium text-foreground">This price includes the service fee</p>
      <dl className="mt-snug space-y-tight text-muted-foreground">
        <div className="flex justify-between gap-cozy">
          <dt>Seller&apos;s price</dt>
          <dd className="whitespace-nowrap tabular-nums">{priceText}</dd>
        </div>
        <div className="flex justify-between gap-cozy">
          <dt>{PROCESSING_FEE_NAME}</dt>
          <dd className="whitespace-nowrap tabular-nums">{feeText}</dd>
        </div>
        <div className="flex justify-between gap-cozy border-t pt-tight font-medium text-foreground">
          <dt>You pay</dt>
          <dd className="whitespace-nowrap tabular-nums">{totalText}</dd>
        </div>
      </dl>
      <p className="mt-snug text-meta text-muted-foreground">
        {rateLabel} by card.{otherCardsNote ? ` ${otherCardsNote}` : ''} It covers what Stripe
        charges to take the payment and pay the seller, plus about {nodittoFeeRateLabel()} to
        NoDitto. Postage, if any, is agreed with the seller before you pay, and the fee
        includes it at the same rate. You see the rate for your own card, and for your bank
        where offered, before you pay.
      </p>
    </InfoPopover>
  );
}
