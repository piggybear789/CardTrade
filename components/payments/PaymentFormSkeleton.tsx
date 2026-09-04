// components/payments/PaymentFormSkeleton.tsx
//
// The placeholder for `AddPaymentMethodForm`, in its own module so the four
// `next/dynamic` call sites can render it without importing the form — and with
// it Stripe.js — into their own bundles.
//
// ONE SHAPE FOR BOTH WAITS. Adding a card used to resize the sheet twice before
// it settled: a 160px centred spinner while the chunk downloaded, then an 88px
// pair of bars while the SetupIntent was created, then the real ~350px form. The
// middle step was the worst of the three because it moved the dialog UP, which
// on a phone drags the Save button out from under the reader's thumb. Both waits
// now reserve the same box, so the only movement left is Stripe's own iframe
// settling on its final height.

import { Skeleton, TextLines } from '@/components/ui/skeleton';

export function PaymentFormSkeleton() {
  return (
    <div className="space-y-group" role="status" aria-busy="true">
      <span className="sr-only">Loading secure card entry…</span>
      {/* The Payment Element in `tabs` layout: a row of method tabs over the
          card fields. Its exact height belongs to Stripe and varies with the
          methods enabled on the account, so this reserves the common case rather
          than pretending to know it. */}
      <Skeleton className="h-60 w-full rounded-md" />
      {/* Save card — a default `Button`, so 36px below `md`. */}
      <Skeleton className="h-9 w-full rounded-md" />
      {/* `ProcessorNote`, which wraps to two lines at phone width. */}
      <TextLines
        className="text-center text-body leading-relaxed"
        widths={['w-full', 'w-2/3']}
      />
    </div>
  );
}
