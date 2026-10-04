// components/payments/CheckoutSummarySkeleton.tsx
//
// The placeholder for the "you already have a card" checkout block: the verified-seller
// box over the saved-card row, shared by `BuyButton` and `DealJoinForm`.
//
// WHY NOT `PaymentFormSkeleton`. Both surfaces used to show the card-ENTRY placeholder
// while they checked whether a card was saved — a 240px Stripe-shaped block plus a button
// and a note, ~330px in all. The usual answer is "yes, there is a card", which renders a
// ~150px pair of boxes instead, so the dialog (and the vertically centred join card)
// collapsed and re-centred on every open. This reserves the common outcome. A member with
// no saved card sees the panel GROW into the card form, which is the rarer path and the
// one where something genuinely new — card entry — is arriving.
//
// Geometry is the real block's, line for line: `p-cozy text-body` on both boxes, the
// seller box's label and legal-name lines (the optional trading name is not reserved —
// most sellers are individuals without one), and the card row's 20px glyph, two text
// lines and a `size="sm"` Change button.

import { Skeleton, TextLines } from '@/components/ui/skeleton';

export function CheckoutSummarySkeleton() {
  return (
    <div className="space-y-group" role="status" aria-busy="true">
      <span className="sr-only">Checking your payment details…</span>
      {/* No `bg-muted` fill: the bars are `bg-muted/70` and would vanish into it. */}
      {/* Both boxes' text runs are texture at `text-body` (two lines each is the
          reservation); widths draw from the canonical set. The `size-5` glyph and the
          `h-8` Change button keep their reserves. */}
      <div className="rounded-md border p-cozy">
        <TextLines className="text-body" widths={['w-1/3', 'w-2/3']} />
      </div>
      <div className="flex items-center gap-cozy rounded-lg border p-cozy">
        <Skeleton className="size-5 shrink-0 rounded-sm" />
        <div className="min-w-0 flex-1">
          <TextLines className="text-body" widths={['w-1/2', 'w-1/3']} />
        </div>
        <Skeleton className="h-8 w-16 shrink-0 rounded-md md:h-7" />
      </div>
    </div>
  );
}
