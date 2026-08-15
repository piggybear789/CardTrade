// components/account/TradesSection.tsx
//
// The "Trades" section of the Account hub: collateral-backed swaps where the caller
// is a participant. Each row shows the two items involved (yours vs. theirs by
// role), the live trade-state badge, and a link to the trade contract at
// /trades/[id].

import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { StateBadge } from '@/components/trade/StateBadge';
import type { TradeSummary } from '@/lib/actions/account';
import { EmptyState } from '@/components/account/EmptyState';

/**
 * A readable label for each side of a trade, relative to the caller. A side can
 * hold several items, so extras are summarised rather than listed in full.
 */
function tradePairLabel(trade: TradeSummary): { yours: string; theirs: string } {
  const summarise = (titles: string[], fallbackId: string) => {
    if (titles.length === 0) return `#${fallbackId.slice(0, 8)}`;
    const [first, ...rest] = titles;
    return rest.length > 0 ? `${first} + ${rest.length} more` : first;
  };

  const yourFallback =
    trade.role === 'initiator' ? trade.initiatorItemId : trade.counterpartItemId;
  const theirFallback =
    trade.role === 'initiator' ? trade.counterpartItemId : trade.initiatorItemId;

  return {
    yours: summarise(trade.yourItemTitles, yourFallback),
    theirs: summarise(trade.theirItemTitles, theirFallback),
  };
}

export function TradesSection({ trades }: { trades: TradeSummary[] }) {
  if (trades.length === 0) {
    return (
      <EmptyState
        icon={<ArrowLeftRight className="size-6" aria-hidden />}
        title="No Trades Yet"
        description="Find an item you'd like to swap for and propose a trade."
        ctaLabel="Browse the marketplace"
        ctaHref="/listings"
      />
    );
  }

  return (
    <ul role="list" className="space-y-cozy">
      {trades.map((trade) => {
        const { yours, theirs } = tradePairLabel(trade);
        return (
          <li key={trade.id}>
            <Card className="p-cozy">
              <Link
                href={`/trades/${trade.id}`}
                className="flex items-center gap-group rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
                  <ArrowLeftRight className="size-5" aria-hidden />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-body font-medium">
                    Your item {yours}
                    <span className="mx-1.5 text-muted-foreground">↔</span>
                    Their item {theirs}
                  </p>
                  <p className="mt-0.5 text-meta capitalize text-muted-foreground">
                    You are the {trade.role}
                  </p>
                </div>

                <StateBadge state={trade.state} className="shrink-0" />
              </Link>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
