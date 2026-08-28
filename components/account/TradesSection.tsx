// components/account/TradesSection.tsx
//
// The "Trades" section of the Account hub: collateral-backed swaps where the caller
// is a participant. Each row shows the two items involved (yours vs. theirs by
// role), the live trade-state badge, and a link to the trade contract at
// /trades/[id].

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeftRightIcon } from '@hugeicons/core-free-icons';

import { MobileList, MobileListItem } from '@/components/ui/mobile-list';
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
        icon={<HugeiconsIcon icon={ArrowLeftRightIcon} className="size-6" aria-hidden />}
        title="No Trades Yet"
        description="Find an item you'd like to swap for and propose a trade."
        ctaLabel="Browse the marketplace"
        ctaHref="/"
      />
    );
  }

  return (
    <MobileList variant="cards">
      {trades.map((trade) => {
        const { yours, theirs } = tradePairLabel(trade);
        return (
          <MobileListItem key={trade.id}>
            <Link
              href={`/trades/${trade.id}`}
              transitionTypes={['nav-forward']}
              className="flex min-h-11 items-center gap-group py-3.5 md:py-0 rounded-md border border-transparent focus:outline-none focus-visible:border-iris"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <HugeiconsIcon icon={ArrowLeftRightIcon} className="size-5" aria-hidden />
              </div>

              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-lead font-medium">
                  Your item {yours}
                  <span className="mx-1.5 text-muted-foreground">↔</span>
                  Their item {theirs}
                </p>
                <p className="mt-0.5 text-body capitalize text-muted-foreground">
                  You are the {trade.role}
                </p>
              </div>

              <StateBadge state={trade.state} className="shrink-0" />
            </Link>
          </MobileListItem>
        );
      })}
    </MobileList>
  );
}
