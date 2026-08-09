// app/trades/page.tsx
//
// Trades: every 2-way collateral-backed Trade the caller participates in (Req 5, 11, 12).
// The index for the contract rooms at /trades/[id].
//
// There is no longer a separate offer inbox. An offer IS a Trade in NEGOTIATING,
// so it appears in this list from the moment it is opened and is answered inside
// its own room rather than on a card here.

import { redirect } from 'next/navigation';
import { Hourglass } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { getMyTrades } from '@/lib/actions/account';
import { TradesSection } from '@/components/account/TradesSection';
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
  description: 'Your collateral-backed 2-way trades.',
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

  const result = await getMyTrades();

  // Finished trades are history: they should not sit among the ones still moving.
  // A CANCELLED negotiation counts as finished (see `isTradePast`).
  const { active: activeTrades, past: pastTrades } = partitionByScope(
    result.ok ? result.data : [],
    (trade) => isTradePast(trade.state),
  );
  const visibleTrades = scope === 'past' ? pastTrades : activeTrades;
  const negotiatingCount = activeTrades.filter(
    (trade) => trade.state === 'NEGOTIATING',
  ).length;

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
        description="Swap goods, with or without cash on top. Open an offer from a listing, then agree the terms together in its trade room."
        mobileAction={primaryAction}
      />

      <SectionFilter
        scope={scope}
        basePath="/trades"
        activeCount={activeTrades.length}
        pastCount={pastTrades.length}
      />

      {!result.ok ? (
        <SectionLoadError label="trades" />
      ) : visibleTrades.length > 0 ? (
        <section aria-labelledby="trades-heading">
          <h3 id="trades-heading" className="mb-3 text-lg font-semibold">
            {scope === 'past'
              ? 'Finished'
              : negotiatingCount > 0
                ? 'Open'
                : 'Agreed'}
          </h3>
          <TradesSection trades={visibleTrades} />
        </section>
      ) : scope === 'past' ? (
        <EmptyState
          icon={<Hourglass className="size-6" aria-hidden="true" />}
          title="No Finished Trades"
          description="Completed trades, resolved disputes and closed offers will be kept here."
          compact
        />
      ) : (
        <EmptyState
          icon={<Hourglass className="size-6" aria-hidden="true" />}
          title="No Trades Yet"
          description="Find an item you would like, then offer whatever you think is fair for it."
          action={{ label: 'Browse the marketplace', href: '/listings' }}
          compact
        />
      )}
    </MarketplaceShell>
  );
}
