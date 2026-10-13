// components/listings/ListingTrust.tsx
//
// What protects a buyer, said where they decide: a muted fee note under the price and
// one protection line under the buy actions.
//
// WHY ON THE LISTING. The references (Vinted, Depop) put "payment held until you
// accept" beside the price and the buy button. We had the facts, but they lived in an
// (i) popover, the fifth tab of a contract room, and a Safety page — so the first
// time a buyer met the protection was after they had committed. These restate what
// the Safety page and the contract rooms already promise; they add no new claim.
//
// ONE QUIET LINE EACH. This used to be a green fee-and-hold line under the price and a
// bordered three-row card under the actions, which together said the same thing twice
// at two weights and made the pane read as busy. The fee note names the fee and opens
// the breakdown; the protection line says the one promise and links to the rest.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { FeeInfoPopover } from '@/components/listings/FeeInfoPopover';
import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import { platformFeeRateLabel } from '@/lib/fees/feeLabels';
import { formatMoney } from '@/lib/format';
import { buyerPaysCents } from '@/lib/listings/buyerPrice';
import { cn } from '@/lib/utils';

/**
 * "Includes $X buyer fee" under a single listing's fee-inclusive price, with the (i)
 * that breaks the figure down. The headline already contains the fee; this says so.
 */
export function ListingFeeNote({
  priceCents,
  currency,
  className,
}: {
  /** The seller's asking price; the fee is computed from it. */
  priceCents: number;
  currency: string;
  className?: string;
}) {
  const fee = formatMoney(platformFeeCentsFor(priceCents, currency), currency);
  return (
    <p className={cn('flex items-center gap-tight text-meta text-muted-foreground', className)}>
      <span>Includes {fee} buyer fee</span>
      <FeeInfoPopover
        priceText={formatMoney(priceCents, currency)}
        feeText={fee}
        totalText={formatMoney(buyerPaysCents(priceCents, currency), currency)}
        rateLabel={platformFeeRateLabel(currency)}
      />
    </p>
  );
}

/**
 * How a purchase is protected, in one unboxed line. A Cash_Sale's payment is collected
 * into the platform balance and released only when the buyer accepts the goods (or the
 * inspection window lapses); "How it works" is the Safety page for the details.
 */
export function ListingProtectionLine({
  isShopfront,
  headingId = 'listing-protection-heading',
  className,
}: {
  /** A binder or bulk listing: the buyer accepts "the cards", plural. */
  isShopfront: boolean;
  /** Unique per instance: the phone stack and the desktop pane are both in the DOM. */
  headingId?: string;
  className?: string;
}) {
  return (
    <section aria-labelledby={headingId} className={className}>
      <h2 id={headingId} className="sr-only">
        How this purchase is protected
      </h2>
      <p className="flex items-start gap-snug text-meta text-muted-foreground">
        <HugeiconsIcon
          icon={ShieldCheckIcon}
          className="mt-px size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span>
          <span className="font-medium text-foreground">Buyer protection:</span> your payment
          is held until you accept the {isShopfront ? 'cards' : 'card'}.{' '}
          <Link
            href="/safety"
            className="font-medium text-foreground underline underline-offset-4 hover:text-iris-ink"
          >
            How it works
          </Link>
        </span>
      </p>
    </section>
  );
}
