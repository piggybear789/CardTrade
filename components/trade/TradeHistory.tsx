'use client';

// components/trade/TradeHistory.tsx
//
// A trade's History tab as a timeline (UX review 2026-11-27, option H1): events
// grouped under their day, times lined up in a column, one plain sentence each
// saying what happened and who did it, then the live step ("Now") and what is
// still to come, faint. It replaced humanised enum names over raw state changes
// ("Holds confirmed (you)", "collateral pending → collateral locked").
//
// Times are absolute in the display zone, like every contract stamp, so the server
// and browser renders agree.

import type { ContractEvent } from '@/components/contract/types';
import type { ContractStep } from '@/domain/contract';
import { DISPLAY_TIME_ZONE, formatContractDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    timeZone: DISPLAY_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', {
    timeZone: DISPLAY_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Turn `COLLATERAL_LOCKED` into `Collateral locked`, for a code with no copy. */
function humanise(event: string): string {
  const lower = event.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

interface Copy {
  title: string;
  /** A two-sided event: "You and Bob both …". */
  both?: string;
  /** A fixed second line. */
  note?: string;
}

/** Member copy per `TradeEvent` (and the audit-only custody code). */
const COPY: Record<string, Copy> = {
  TERMS_AGREED: { title: 'Terms agreed', both: 'accepted' },
  OFFER_DECLINED: { title: 'Offer declined' },
  HOLDS_CONFIRMED: { title: 'Both holds placed' },
  HOLDS_FAILED: { title: 'A hold failed', note: 'Nothing was charged' },
  BOTH_SHIPPED: { title: 'Both items posted' },
  BOTH_RECEIVED: { title: 'Both items arrived' },
  BOTH_HANDOVER_CONFIRMED: { title: 'Met and swapped', both: 'confirmed' },
  HANDOVER_ASSUMED: { title: 'Meeting time passed', note: 'Inspection opened on its own' },
  HANDOVER_FAILED: { title: 'Handover reported as failed', note: 'Nothing was charged' },
  BOTH_ACCEPTED: { title: 'Both accepted', note: 'The trade is complete' },
  INSPECTION_EXPIRED: { title: 'Inspection window closed', note: 'The trade completed on its own' },
  CONDITION_DISPUTE: { title: 'Condition dispute raised' },
  FRAUD_CLAIMED: { title: 'Fraud reported' },
  DISPUTE_RESOLVED: { title: 'Support resolved the dispute' },
  FRAUD_CONFIRMED: { title: 'Support confirmed fraud' },
  COLLATERAL_ABANDONED: { title: 'Trade ended before the meeting', note: 'Holds released' },
  DISPUTE_UNWOUND: { title: 'Trade unwound by support', note: 'Holds released' },
  COLLATERAL_TAKEN_INTO_CUSTODY: { title: 'Holds taken into custody', note: 'While support decides' },
};

export interface TradeHistoryProps {
  events: ContractEvent[];
  myUserId: string;
  counterpartId: string;
  counterpartName: string;
  /** The trade's steps, for "Now" and what is still to come. */
  steps: readonly ContractStep[];
  /** The live window's end, shown on the "Now" row (inspection). */
  nowUntil?: string | null;
  /** One hold's amount, for "$60.00 AUD each, nothing charged". */
  holdAmountCents?: number | null;
  currency: string;
}

function Row({
  time,
  title,
  sub,
  kind = 'done',
  last = false,
}: {
  time: string;
  title: string;
  sub?: string | null;
  kind?: 'done' | 'now' | 'next';
  last?: boolean;
}) {
  return (
    <li className="grid grid-cols-[3.5rem_1rem_minmax(0,1fr)] gap-x-snug">
      <span className="pt-px text-right text-meta tabular-nums text-muted-foreground" suppressHydrationWarning>
        {time}
      </span>
      <span className="relative flex justify-center" aria-hidden>
        {!last ? <span className="absolute inset-y-0 top-2 w-px bg-border" /> : null}
        <span
          className={cn(
            'relative mt-1.5 size-2.5 rounded-full',
            kind === 'done' && 'bg-foreground/70',
            kind === 'now' && 'bg-card ring-2 ring-iris',
            kind === 'next' && 'bg-card ring-1 ring-border',
          )}
        />
      </span>
      <div className={cn('min-w-0', last ? 'pb-0' : 'pb-cozy')}>
        <p className={cn(kind === 'next' ? 'text-muted-foreground' : 'font-semibold')}>{title}</p>
        {sub ? (
          <p className="text-meta text-muted-foreground" suppressHydrationWarning>
            {sub}
          </p>
        ) : null}
      </div>
    </li>
  );
}

export function TradeHistory({
  events,
  myUserId,
  counterpartId,
  counterpartName,
  steps,
  nowUntil,
  holdAmountCents,
  currency,
}: TradeHistoryProps) {
  const liveIndex = steps.findIndex((s) => s.status === 'active');
  const live = liveIndex >= 0 ? steps[liveIndex] : null;
  const upcoming = liveIndex >= 0 ? steps.slice(liveIndex + 1) : [];

  function subFor(event: ContractEvent, copy: Copy | undefined): string | null {
    if (copy?.both) return `You and ${counterpartName} both ${copy.both}`;
    if (event.event === 'HOLDS_CONFIRMED' && holdAmountCents) {
      return `${formatMoney(holdAmountCents, currency)} each, nothing charged`;
    }
    if (copy?.note) return copy.note;
    if (event.actor_id === myUserId) return 'By you';
    if (event.actor_id === counterpartId) return `By ${counterpartName}`;
    return null;
  }

  // Group past events under their day, oldest first.
  const days: { day: string; items: ContractEvent[] }[] = [];
  for (const event of events) {
    const day = dayLabel(event.created_at);
    const group = days[days.length - 1];
    if (group && group.day === day) group.items.push(event);
    else days.push({ day, items: [event] });
  }

  const sectionLabel = 'mb-snug text-meta font-semibold text-muted-foreground';

  if (events.length === 0 && !live) {
    return <p className="text-muted-foreground">Nothing has happened yet.</p>;
  }

  return (
    <div className="space-y-cozy text-body" aria-label="Trade history">
      {days.map(({ day, items }) => (
        <section key={day}>
          <h4 className={sectionLabel} suppressHydrationWarning>
            {day}
          </h4>
          <ol>
            {items.map((event, index) => {
              const copy = COPY[event.event];
              return (
                <Row
                  key={event.id}
                  time={timeLabel(event.created_at)}
                  title={copy?.title ?? humanise(event.event)}
                  sub={subFor(event, copy)}
                  last={index === items.length - 1}
                />
              );
            })}
          </ol>
        </section>
      ))}

      {live ? (
        <section>
          <h4 className={sectionLabel}>Now</h4>
          <ol>
            <Row
              time=""
              kind="now"
              title={live.short ?? live.label}
              sub={nowUntil ? `Until ${formatContractDateTime(nowUntil)}` : live.label !== (live.short ?? live.label) ? live.label : null}
              last
            />
          </ol>
        </section>
      ) : null}

      {upcoming.length > 0 ? (
        <section>
          <h4 className={sectionLabel}>Coming up</h4>
          <ol>
            {upcoming.map((step, index) => (
              <Row
                key={step.id}
                time=""
                kind="next"
                title={step.label}
                last={index === upcoming.length - 1}
              />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
