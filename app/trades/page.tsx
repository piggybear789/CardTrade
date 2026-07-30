// app/trades/page.tsx
//
// Trades: every 2-way escrow Trade the caller participates in (Req 5, 11). The
// index for the contract rooms at /trades/[id].

import { redirect } from 'next/navigation';
import { Hourglass } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { getMyTrades } from '@/lib/actions/account';
import { listMyTradeProposals } from '@/lib/actions/tradeProposals';
import { TradesSection } from '@/components/account/TradesSection';
import { TradeProposalInbox } from '@/components/trade/TradeProposalInbox';
import { EmptyState } from '@/components/ui/empty-state';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';
import {
  SectionFilter,
  partitionByScope,
  resolveScope,
} from '@/components/layout/SectionFilter';
import { isTradePast } from '@/lib/lifecycle';

// Reads the caller's session and live trade state.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Trades · NoDitto',
  description: 'Your 2-way escrow trades.',
};

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const scope = resolveScope(show);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?redirectTo=/trades');
  }

  const [result, proposals, ownItems] = await Promise.all([
    getMyTrades(),
    listMyTradeProposals(),
    // The caller's own goods, so a sent offer can be revised without leaving.
    supabase
      .from('items')
      .select('id, title, fmv_cents')
      .eq('owner_id', user.id)
      .eq('status', 'AVAILABLE')
      .order('created_at', { ascending: false }),
  ]);

  const pendingCount = proposals.ok ? proposals.proposals.length : 0;

  // Finished trades are history: they should not sit among the ones still moving.
  const { active: activeTrades, past: pastTrades } = partitionByScope(
    result.ok ? result.data : [],
    (trade) => isTradePast(trade.state),
  );
  const visibleTrades = scope === 'past' ? pastTrades : activeTrades;

  const offerableItems = (ownItems.data ?? []).map((row) => ({
    id: row.id as string,
    title: (row.title as string) ?? 'Item',
    fmvCents: (row.fmv_cents as number) ?? 0,
  }));

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  // Declared once so the two can never drift apart.
  // No plus: this opens the marketplace to look through, it does not start a
  // trade. The trade begins later, from a listing.
  const primaryAction = (
    <RailPrimaryAction href="/listings" glyph={null}>
      Find a Trade
    </RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="Trades" primaryAction={primaryAction}>
      <SectionHeader
        title="Trades"
        description="Swap goods, with or without cash on top. An offer becomes a trade only once the other trader accepts it."
        mobileAction={primaryAction}
      />

      <SectionFilter
        scope={scope}
        basePath="/trades"
        activeCount={activeTrades.length + pendingCount}
        pastCount={pastTrades.length}
      />

      {/* Pending offers first: an incoming one is waiting on the reader. They are
          only ever "active", so Past never shows them. */}
      {proposals.ok && scope === 'active' ? (
        <TradeProposalInbox
          proposals={proposals.proposals}
          offerableItems={offerableItems}
        />
      ) : null}

      {/* One timeline, two stages. An offer and a trade are the same thing before
          and after agreement, so the page shows agreed swaps under their own
          heading and only falls back to an empty state when there is nothing at
          all — never alongside a live offer. */}
      {!result.ok ? (
        <SectionLoadError label="trades" />
      ) : visibleTrades.length > 0 ? (
        <section aria-labelledby="agreed-trades-heading">
          <h3 id="agreed-trades-heading" className="mb-3 text-lg font-semibold">
            {scope === 'past' ? 'Finished' : 'Agreed'}
          </h3>
          <TradesSection trades={visibleTrades} />
        </section>
      ) : scope === 'past' ? (
        <EmptyState
          icon={<Hourglass className="size-6" aria-hidden="true" />}
          title="No Finished Trades"
          description="Completed trades and resolved disputes will be kept here."
          compact
        />
      ) : pendingCount === 0 ? (
        <EmptyState
          icon={<Hourglass className="size-6" aria-hidden="true" />}
          title="No Trades Yet"
          description="Find an item you would like, then offer whatever you think is fair for it."
          action={{ label: 'Browse the marketplace', href: '/listings' }}
          compact
        />
      ) : null}
    </MarketplaceShell>
  );
}
