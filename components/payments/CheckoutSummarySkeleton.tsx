// components/payments/CheckoutSummarySkeleton.tsx
//
// The placeholder for the saved-card row in `BuyButton`'s checkout, shown while the
// dialog reads whether the buyer has a card.
//
// ONLY THE CARD ROW. Everything else in the checkout (the order summary, the binder
// request fields, the "Seller verified as" line, the footer) is known before the read
// returns, so the dialog renders it for real and only this row waits. This used to
// reserve a bordered two-line box for the seller as well, left over from when the
// disclosure was drawn as a box. The real disclosure is one `text-meta` line, so the
// dialog dropped by about 54px the moment the card read came back.
//
// WHY NOT `PaymentFormSkeleton`. The dialog used to show the card-ENTRY placeholder
// while it checked for a saved card: a 240px Stripe-shaped block plus a button and a
// note. No card no longer means card entry (a card is optional, 0158), so the checkout
// always follows the read, and this reserves its row.
//
// Geometry is the real row's, line for line: `rounded-lg border p-cozy`, the 20px
// glyph, two `text-body` lines and a `size="sm"` button.

import { Skeleton, TextLines } from '@/components/ui/skeleton';

export function CheckoutSummarySkeleton() {
  return (
    <div
      className="flex items-center gap-cozy rounded-lg border p-cozy"
      role="status"
      aria-busy="true"
    >
      <span className="sr-only">Checking your payment details…</span>
      {/* The text runs are texture at `text-body` (two lines is the reservation);
          widths draw from the canonical set. The `size-5` glyph and the `sm` button
          keep their reserves. */}
      <Skeleton className="size-5 shrink-0 rounded-sm" />
      <div className="min-w-0 flex-1 text-body max-sm:min-h-[3lh]">
        <TextLines className="text-body" widths={['w-1/2', 'w-1/3']} />
      </div>
      <Skeleton className="h-9 w-16 shrink-0 rounded-md md:h-8" />
    </div>
  );
}
