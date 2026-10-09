// components/listings/GuestTrustBand.tsx
//
// The guest's first reason to trust the catalog: one line saying what NoDitto is and
// three facts that make buying from a stranger reasonable.
//
// A guest landed on the member's screen — a grid of cards from people they do not
// know, with nothing saying why that is safe. Members have seen this; guests have
// not, so it renders for guests only. Kept to one compact band so the grid stays
// above the fold: the cards are still the pitch.
//
// Every point is a mechanism the product enforces, not a hope: listing requires the
// Stripe identity check, sale payments are held by Stripe until the buyer accepts,
// and disputes go to NoDitto's case team.

import { HugeiconsIcon } from '@hugeicons/react';
import { LockIcon, ScaleIcon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

const POINTS = [
  { icon: ShieldCheckIcon, text: 'Every seller ID-checked by Stripe' },
  { icon: LockIcon, text: 'Payment held until you accept the card' },
  { icon: ScaleIcon, text: 'Disputes reviewed by our case team' },
] as const;

export function GuestTrustBand() {
  return (
    <section
      aria-labelledby="guest-trust-heading"
      className="mb-group flex flex-col gap-snug rounded-lg border border-border bg-card px-group py-cozy lg:flex-row lg:items-center lg:justify-between lg:gap-group"
    >
      <h2 id="guest-trust-heading" className="text-body font-semibold text-foreground">
        Buy, sell and trade cards with verified collectors
      </h2>
      <ul className="flex flex-wrap gap-x-group gap-y-tight">
        {POINTS.map((point) => (
          <li key={point.text} className="flex items-center gap-tight text-meta text-muted-foreground">
            <HugeiconsIcon icon={point.icon} className="size-3.5 shrink-0 text-trust" aria-hidden />
            {point.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
