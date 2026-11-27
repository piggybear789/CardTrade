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

import { Icon } from '@/components/ui/icon';
import { CheckIcon, ExclamationMarkIcon, XIcon } from '@/components/ui/icons';

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
 * The tone's mark. Decorative — the event sentence carries the meaning.
 *
 * Both contract-room audits and conversation ledgers render these in a fixed
 * marker column. The shared mark keeps success, warning, and failure semantics
 * consistent without turning each event into a separate card.
 *
 * A SOLID DISC, NOT A HAIRLINE (2026-11-28, design-system audit): the `StatusGlyph`
 * rule, and the same mark the chat's milestone cards wear (`MilestoneDisc`). A 1.5px
 * green check beside a sentence read as decoration; a filled disc in the outcome's
 * colour reads as the outcome. A dispute (`warning`) is red, as it is in the chat and on
 * the "Disputed" badge; it used to be a violet circle here and a red card there. A
 * neutral step is a small slate dot, so the eye can skip the routine rows.
 */
export function ContractEventIcon({
  tone,
  className,
}: {
  tone: ContractEventTone;
  className?: string;
}) {
  const disc = 'grid size-5 shrink-0 place-items-center rounded-full text-white';
  switch (tone) {
    case 'success':
      // `bg-trust`, not a raw Tailwind green. The palette has exactly one "settled /
      // confirmed" hue and this was the only place in the app reaching past it.
      return (
        <span aria-hidden className={cn(disc, 'bg-trust', className)}>
          <Icon icon={CheckIcon} className="size-3" />
        </span>
      );
    case 'destructive':
      return (
        <span aria-hidden className={cn(disc, 'bg-destructive', className)}>
          <Icon icon={XIcon} className="size-3" />
        </span>
      );
    case 'warning':
      return (
        <span aria-hidden className={cn(disc, 'bg-destructive', className)}>
          <Icon icon={ExclamationMarkIcon} className="size-3" />
        </span>
      );
    default:
      return (
        <span aria-hidden className={cn('grid size-5 shrink-0 place-items-center', className)}>
          <span className="size-2 rounded-full bg-foreground/25" />
        </span>
      );
  }
}
