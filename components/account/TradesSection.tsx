// components/account/TradesSection.tsx
//
// The Trades list: collateral-backed swaps where the caller is a participant. One row
// per trade — the two sides, WHAT THE TRADE IS WAITING ON, and the live state badge —
// laid out on the same grid as Purchases and Sales so the three lists line up with each
// other as well as with themselves. See `ContractRow.tsx`.
//
// A trade has no single cover photo, because its subject is an exchange rather than an
// object, so the thumbnail slot carries the swap glyph instead.

import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeftRightIcon } from '@hugeicons/core-free-icons';

import { StateBadge } from '@/components/trade/StateBadge';
import type { TradeSummary } from '@/lib/actions/account';
import { EmptyState } from '@/components/account/EmptyState';
import {
  CONTRACT_ROW_GRID,
  ContractRowTable,
  ContractRowThumb,
  NextMoveCell,
} from '@/components/account/ContractRow';
import { formatAud } from '@/lib/format';
import { cn } from '@/lib/utils';

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
    <ContractRowTable subject="Trade" label="Your trades">
      {trades.map((trade) => {
        const { yours, theirs } = tradePairLabel(trade);

        return (
          <li key={trade.id} className={cn(CONTRACT_ROW_GRID, 'px-group py-cozy')}>
            <ContractRowThumb>
              <HugeiconsIcon icon={ArrowLeftRightIcon} className="size-5" aria-hidden />
            </ContractRowThumb>

            <div className="min-w-0">
              <Link
                href={`/trades/${trade.id}`}
                transitionTypes={['nav-forward']}
                className="block rounded-sm border border-transparent text-body font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:border-iris"
              >
                <span className="line-clamp-2 break-words">
                  {yours}
                  {/* The arrow is the whole subject of the row, so it is not decorative:
                      without a text alternative the two sides run together into one
                      title when read aloud. */}
                  <span className="mx-1.5 text-muted-foreground" aria-hidden="true">
                    ↔
                  </span>
                  <span className="sr-only">in exchange for</span>
                  {theirs}
                </span>
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-cozy gap-y-tight text-meta text-muted-foreground">
                <span>with {trade.counterpartyName}</span>
                {/* Cash to even out a swap. Shown only when there is some: "+ $0" on a
                    straight trade is noise, and the sign says which way it moves. */}
                {trade.cashAmountCents > 0 ? (
                  <span className="tabular-nums">
                    plus {formatAud(trade.cashAmountCents)} cash
                  </span>
                ) : null}
                {/* Its own column from `md`; here below it, beside the counterparty. */}
                <StateBadge state={trade.state} className="md:hidden" />
              </div>
              <NextMoveCell move={trade.nextMove} className="mt-tight md:hidden" />
            </div>

            <NextMoveCell move={trade.nextMove} className="hidden md:flex" />

            <span className="hidden justify-end md:flex">
              <StateBadge state={trade.state} className="shrink-0" />
            </span>
          </li>
        );
      })}
    </ContractRowTable>
  );
}
