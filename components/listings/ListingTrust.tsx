// components/listings/ListingTrust.tsx
//
// What protects a buyer, said where they decide: one green line under the price and
// three short rows under the buy actions.
//
// WHY ON THE LISTING. The references (Vinted, Depop) put "payment held until you
// accept" beside the price and the buy button. We had the facts, but they lived in an
// (i) popover, the fifth tab of a contract room, and a Safety page — so the first
// time a buyer met the protection was after they had committed. These restate what
// the Safety page and the contract rooms already promise; they add no new claim.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  DeliveryTruck01Icon,
  JusticeScale01Icon,
  ShieldCheckIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons';

import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The fee and the hold, in one line under a single listing's price. */
export function ListingFeeLine({
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
    <p className={cn('flex items-start gap-tight text-meta font-medium text-trust', className)}>
      <HugeiconsIcon icon={ShieldCheckIcon} className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>Includes the {fee} buyer fee · Payment held until you accept the card</span>
    </p>
  );
}

const ROWS = [
  {
    icon: DeliveryTruck01Icon,
    title: 'Tracked shipping or local handover',
    detail: 'You agree how it reaches you before you pay.',
  },
  {
    icon: ViewIcon,
    title: 'Inspect before it completes',
    detail: 'Days to check it after delivery, 72 hours after a meet-up.',
  },
  {
    icon: JusticeScale01Icon,
    title: 'Disputes handled by NoDitto',
    detail: 'Report a problem and the money stays frozen until support decides.',
  },
] as const;

/** How a purchase is protected, under the buy actions. */
export function ListingTrustRows({ className }: { className?: string }) {
  return (
    <section aria-labelledby="listing-protection-heading" className={cn('rounded-lg border bg-card', className)}>
      <h2 id="listing-protection-heading" className="sr-only">
        How this purchase is protected
      </h2>
      <ul className="divide-y divide-border">
        {ROWS.map((row) => (
          <li key={row.title} className="flex items-start gap-cozy px-cozy py-snug">
            <HugeiconsIcon icon={row.icon} className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-body font-medium leading-snug">{row.title}</p>
              <p className="text-meta text-muted-foreground">{row.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      <Link
        href="/safety"
        className="block border-t px-cozy py-snug text-meta font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        How buyer protection works
      </Link>
    </section>
  );
}
