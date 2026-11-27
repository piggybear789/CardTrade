'use client';

// components/trade/HoldStatus.tsx
//
// The top of a trade's Collateral tab (Req 11.1, UX review 2026-11-27): one plain
// statement of what is on the VIEWER's card, then both holds as rows named for
// their owner ("Your hold", "Bob's hold"). It replaced an explainer sentence over a
// list labelled "Your collateral" and "Counterpart's collateral".
//
// Member copy says trade collateral is a temporary card hold, never a payment and
// never escrow. Purely presentational; hold updates arrive via Realtime upstream.

import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { HoldRow } from '@/lib/realtime/useTradeRealtime';
import type { TradeViewerRole } from '@/domain/state-machine/types';
import type { ContractHoldStatus } from '@/components/contract/types';

export interface HoldStatusProps {
  /** The holds for the trade (one live one per trader). */
  holds: HoldRow[];
  initiatorId: string;
  counterpartId: string;
  /** The viewer's own role, so their hold leads and reads "Your hold". */
  viewerRole: TradeViewerRole;
  /** The other trader's display name, for "Bob's hold". */
  counterpartName: string;
  /** The trade's currency (`trades.currency`). */
  currency: string;
}

/**
 * Label and tone per `hold_status`. `aria-label="Hold status: …"` on each row's pill
 * is read by the e2e helpers (`shownHoldStatuses`), so keep the two in step.
 */
const STATUS: Record<ContractHoldStatus, { label: string; tone: 'ok' | 'muted' | 'bad' }> = {
  ACTIVE: { label: 'Held', tone: 'ok' },
  VOIDED: { label: 'Released', tone: 'muted' },
  PARTIALLY_CAPTURED: { label: 'Partially captured', tone: 'bad' },
  FULLY_CAPTURED: { label: 'Fully captured', tone: 'bad' },
  FAILED: { label: 'Failed', tone: 'bad' },
  // The authorisation window ran out and the collateral is gone: not a good outcome.
  EXPIRED: { label: 'Collateral period has expired', tone: 'bad' },
};

const PILL = {
  ok: 'bg-[hsl(var(--trust)/0.1)] text-trust',
  muted: 'bg-muted text-muted-foreground',
  bad: 'bg-destructive/10 text-destructive',
} as const;

/** Possessive for the other trader's row: "Bob's hold", "Chris' hold". */
function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}’` : `${name}’s`;
}

/** The viewer's hold, in one statement. */
function Hero({ hold, currency }: { hold: HoldRow | undefined; currency: string }) {
  let eyebrow: string;
  let amount: number | null;
  let line: string;
  let bad = false;
  if (!hold) {
    eyebrow = 'Nothing on hold yet';
    amount = null;
    line = 'Your hold is placed before the meeting. Nothing is charged.';
  } else if (hold.status === 'ACTIVE') {
    eyebrow = 'On hold on your card';
    amount = hold.amount_cents;
    line = 'Nothing is charged. Released when the trade completes.';
  } else if (hold.status === 'VOIDED') {
    eyebrow = 'Released from your card';
    amount = hold.amount_cents;
    line = 'The hold has been released. Nothing was charged.';
  } else if (hold.status === 'PARTIALLY_CAPTURED' || hold.status === 'FULLY_CAPTURED') {
    eyebrow = 'Taken from your hold';
    amount = hold.captured_cents ?? hold.amount_cents;
    line = 'Support decided this when it resolved the dispute.';
    bad = true;
  } else {
    eyebrow = STATUS[hold.status]?.label ?? 'Your hold';
    amount = hold.amount_cents;
    line =
      hold.status === 'FAILED'
        ? 'Your card declined the hold. Replace it, then retry from the chat.'
        : 'The hold lapsed before the trade finished.';
    bad = true;
  }
  return (
    <div className={cn('rounded-lg px-cozy py-2.5', bad ? 'bg-destructive/[0.06]' : 'bg-accent/70')}>
      <p className={cn('text-meta font-semibold', bad ? 'text-destructive' : 'text-iris-ink')}>
        {eyebrow}
      </p>
      {amount != null ? (
        <p className="display-value mt-0.5 text-head">{formatMoney(amount, currency)}</p>
      ) : null}
      <p className="mt-0.5 text-meta text-muted-foreground">{line}</p>
    </div>
  );
}

export function HoldStatus({
  holds,
  initiatorId,
  counterpartId,
  viewerRole,
  counterpartName,
  currency,
}: HoldStatusProps) {
  const myId = viewerRole === 'INITIATOR' ? initiatorId : counterpartId;
  const mine = holds.find((hold) => hold.trader_id === myId);
  const ordered = [...holds].sort((a, b) => {
    const aMine = a.trader_id === myId;
    const bMine = b.trader_id === myId;
    return aMine === bMine ? 0 : aMine ? -1 : 1;
  });

  return (
    <div className="space-y-snug">
      <Hero hold={mine} currency={currency} />
      {ordered.length > 0 ? (
        <ul className="divide-y divide-border/60" aria-label="What each trader has on the line">
          {ordered.map((hold) => {
            const status = STATUS[hold.status] ?? {
              label: hold.status.toLowerCase().replace(/_/g, ' '),
              tone: 'muted' as const,
            };
            const isMine = hold.trader_id === myId;
            return (
              <li key={hold.id} className="flex items-center gap-cozy py-snug">
                <p className="min-w-0 flex-1 truncate font-medium">
                  {isMine ? 'Your hold' : `${possessive(counterpartName)} hold`}
                </p>
                <span className="display-value shrink-0">
                  {formatMoney(hold.amount_cents, currency)}
                </span>
                <span
                  className={cn('shrink-0 rounded-md px-1.5 text-meta font-semibold leading-5', PILL[status.tone])}
                  aria-label={`Hold status: ${status.label}`}
                >
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
