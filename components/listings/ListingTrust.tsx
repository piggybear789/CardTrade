// components/listings/ListingTrust.tsx
//
// What protects a buyer, said where they decide: one protection line under the buy
// actions (with the price on a phone, where the actions are the sticky buyer bar).
// The fee note that sat under the price was removed on 2026-11-23 (product decision:
// the buyer just needs the price); the Pay dialog itemises the fee.
//
// WHY ON THE LISTING. The references (Vinted, Depop) put "payment held until you
// accept" beside the price and the buy button. We had the facts, but they lived in an
// (i) popover, the fifth tab of a contract room, and a Safety page — so the first
// time a buyer met the protection was after they had committed. These restate what
// the Safety page and the contract rooms already promise; they add no new claim.
//
// ONE QUIET LINE EACH. This used to be a green fee-and-hold line under the price and a
// bordered three-row card under the actions, which together said the same thing twice
// at two weights and made the pane read as busy. The protection line says the one
// promise and links to the rest.

import Link from 'next/link';
import { Icon } from '@/components/ui/icon';
import { ShieldCheckIcon } from '@/components/ui/icons';


/**
 * How a purchase is protected, in one unboxed line. A Cash_Sale's payment is collected
 * into the platform balance and released only when the buyer accepts the goods (or the
 * inspection window lapses). "Buyer protection" itself links to the Safety page for the
 * details, rather than a trailing "How it works" link.
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
        <Icon
          icon={ShieldCheckIcon}
          className="mt-px size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span>
          {/* Copy must always say nothing is held on a listing with multiple items (product
              rule). It sits here because this line is on both the phone and the desktop
              listing, and the buy control alone does not say it before a buyer opens it. */}
          {isShopfront ? 'Nothing in this listing is held for you. ' : null}
          <Link
            href="/safety"
            className="font-medium text-foreground underline underline-offset-4 hover:text-iris-ink"
          >
            Buyer protection
          </Link>
          <span className="font-medium text-foreground">:</span> your payment is held until you
          accept the {isShopfront ? 'cards' : 'card'}.
        </span>
      </p>
    </section>
  );
}
