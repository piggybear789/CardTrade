// app/trades/page.tsx
//
// Trades: every 2-way collateral-backed Trade the caller participates in (Req 5, 11, 12).
// The index for the contract rooms at /trades/[id].
//
// There is no longer a separate offer inbox. An offer IS a Trade in NEGOTIATING,
// so it appears in this list from the moment it is opened and is answered inside
// its own room rather than on a card here.

import { redirect } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { HourglassIcon } from '@hugeicons/core-free-icons';

import { createClient } from '@/lib/supabase/server';
import { getMyTrades } from '@/lib/actions/account';
import { listMyDealInvites } from '@/lib/actions/dealInvites';
import { DealInviteList } from '@/components/deals/DealInviteList';
import { StartDealEmptyState, StartDealRailAction } from '@/components/deals/StartDealButton';
import { TradesSection } from '@/components/account/TradesSection';
import { EmptyState } from '@/components/ui/empty-state';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';
import {
  SectionFilter,
  partitionByScope,
  resolveScope,
} from '@/components/layout/SectionFilter';
import { isTradePast } from '@/lib/lifecycle';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

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

  const [result, invitesResult] = await Promise.all([
    getMyTrades(),
    listMyDealInvites('TRADE'),
  ]);

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
  const startDeal = () => <StartDealRailAction />;

  const pendingInvites =
    scope === 'past' || !invitesResult.ok ? [] : invitesResult.data;
  const hasInvites = pendingInvites.length > 0;
  const hasTrades = visibleTrades.length > 0;

  return (
    <MarketplaceShell title="Trades" primaryAction={startDeal()}>
      <SectionHeader
        title="Trades"
        description="Swap goods, with or without cash on top. Open an offer from a listing, or send a private deal link."
        mobileAction={hasInvites || hasTrades ? startDeal() : undefined}
      />

      <SectionFilter
        scope={scope}
        basePath="/trades"
        activeCount={activeTrades.length + (scope === 'past' ? 0 : pendingInvites.length)}
        pastCount={pastTrades.length}
      />

      {!result.ok ? (
        <SectionLoadError label="trades" />
      ) : hasInvites || hasTrades ? (
        <>
          {hasInvites ? (
            <section aria-labelledby="deal-invites-heading" className="mb-8">
              <h3 id="deal-invites-heading" className="mb-3 text-subhead font-semibold">
                Waiting to join
              </h3>
              <DealInviteList invites={pendingInvites} />
            </section>
          ) : null}
          {hasTrades ? (
            <section aria-labelledby="trades-heading">
              <h3 id="trades-heading" className="mb-3 text-subhead font-semibold">
                {scope === 'past'
                  ? 'Finished'
                  : negotiatingCount > 0
                    ? 'Open'
                    : 'Agreed'}
              </h3>
              <TradesSection trades={visibleTrades} />
            </section>
          ) : null}
        </>
      ) : scope === 'past' ? (
        <EmptyState
          icon={<HugeiconsIcon icon={HourglassIcon} className="size-6" aria-hidden="true" />}
          title="No Finished Trades"
          description="Completed trades, resolved disputes and closed offers will be kept here."
          compact
        />
      ) : (
        <StartDealEmptyState
          isAuthenticated
          icon={<HugeiconsIcon icon={HourglassIcon} className="size-6" aria-hidden="true" />}
          title="No Trades Yet"
          description="Find an item you would like, then offer whatever you think is fair for it. Or send a private deal link."
          help={{ label: 'How holds and disputes work', href: '/help#holds' }}
          compact
        />
      )}
    </MarketplaceShell>
  );
}
