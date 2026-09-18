// components/contract/contractEventTone.tsx
//
// ONE classification of contract event codes into a visual tone.
//
// The same codes reach two surfaces: the room's audit trail reads
// `cash_sale_events.event`, and the SYSTEM lines mirrored into chat by
// `mirror_cash_sale_event_to_chat` (0012) carry the identical code on
// `messages.system_event`. Classifying them in each renderer let the two
// disagree about whether a milestone went well — the timeline could mark a
// payment green while the thread showed it as a neutral dot.

import { HugeiconsIcon } from '@hugeicons/react';
import { AlertCircleIcon, CancelCircleIcon, CheckIcon, CircleDotIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

export type ContractEventTone = 'success' | 'warning' | 'destructive' | 'neutral';

/**
 * Classify an event code into a tone.
 *
 * SUBSTRING MATCHING, NOT AN EXHAUSTIVE MAP, on purpose. The codes come from
 * three event tables (cash sales, trades, deals) and SQL's `describe_*_event`
 * functions all end in an `else` branch that lower-cases and prints an unknown
 * code rather than failing. An unrecognised code must therefore degrade to
 * `neutral` here too, or a new event added in a migration would render as a
 * blank row in the one record an arbitrator reads.
 */
export function classifyContractEvent(
  event: string | null | undefined,
): ContractEventTone {
  if (!event) return 'neutral';
  const upper = event.toUpperCase();
  if (
    upper.includes('COMPLETED') ||
    upper.includes('ACCEPTED') ||
    upper.includes('CONFIRMED') ||
    // CLEARED and DELIVERED are the money and the goods actually arriving —
    // `PAYMENT_CLEARED` and `CARRIER_DELIVERED` read as neutral progress
    // without them, which understates the two milestones that matter most.
    upper.includes('CLEARED') ||
    upper.includes('DELIVERED') ||
    upper.includes('SETTLED') ||
    upper.includes('RELEASED') ||
    upper.includes('PAID')
  ) {
    return 'success';
  }
  if (
    upper.includes('FAILED') ||
    upper.includes('CANCELLED') ||
    upper.includes('FRAUD') ||
    upper.includes('EXPIRED')
  ) {
    return 'destructive';
  }
  if (upper.includes('DISPUTE') || upper.includes('HALTED')) {
    return 'warning';
  }
  return 'neutral';
}

/**
 * The tone's glyph. Decorative — the event sentence carries the meaning.
 *
 * Both contract-room audits and conversation ledgers render these in a fixed
 * marker column. The shared glyph keeps success, warning, and failure semantics
 * consistent without turning each event into a separate card.
 */
export function ContractEventIcon({
  tone,
  className,
}: {
  tone: ContractEventTone;
  className?: string;
}) {
  const base = cn('size-4 shrink-0', className);
  switch (tone) {
    case 'success':
      // `text-trust`, not a raw Tailwind green. The palette has exactly one "settled /
      // confirmed" hue and this was the only place in the app reaching past it.
      return <HugeiconsIcon icon={CheckIcon} className={cn(base, 'text-trust')} aria-hidden />;
    case 'destructive':
      return <HugeiconsIcon icon={CancelCircleIcon} className={cn(base, 'text-destructive')} aria-hidden />;
    case 'warning':
      return <HugeiconsIcon icon={AlertCircleIcon} className={cn(base, 'text-iris-ink')} aria-hidden />;
    default:
      return <HugeiconsIcon icon={CircleDotIcon} className={cn(base, 'text-muted-foreground')} aria-hidden />;
  }
}
