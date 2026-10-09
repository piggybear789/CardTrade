// components/contract/FundsHeldMark.tsx
//
// "Payment held by Stripe" / "Holds placed": the reassurance a contract room states
// while money is actually held, in the header strip and the chat bar.
//
// It lived only in the sale room's fifth tab, so the one fact that makes paying a
// stranger reasonable was the last thing a buyer could find. The wording is the one
// phrase the Help and Terms pages use — held by Stripe — never "escrow", which
// NoDitto does not offer. Callers decide WHEN with `isCashSaleFundsHeld` /
// `isTradeHoldsPlaced` (`lib/lifecycle.ts`); this only draws it.

import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

const LABEL = {
  payment: { full: 'Payment held by Stripe', short: 'Payment held' },
  holds: { full: 'Holds placed with Stripe', short: 'Holds placed' },
} as const;

export function FundsHeldMark({
  kind,
  compact = false,
  className,
}: {
  /** A sale's captured payment, or a trade's two collateral holds. */
  kind: keyof typeof LABEL;
  /** The short label, for the chat bar's single row. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-tight text-meta font-medium text-trust',
        className,
      )}
    >
      <HugeiconsIcon icon={ShieldCheckIcon} className="size-3.5" aria-hidden />
      {compact ? LABEL[kind].short : LABEL[kind].full}
    </span>
  );
}
