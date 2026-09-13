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
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';
import {
  ContractFilter,
  contractsForScope,
  groupContracts,
  resolveContractScope,
} from '@/components/layout/SectionFilter';
import {
  ContractScopeEmptyState,
  needsViewer,
} from '@/components/account/ContractRow';
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
  const scope = resolveContractScope(show);
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
  // A CANCELLED negotiation counts as finished (see `isTradePast`). Live trades split
  // again by whose move they are, which is the question a trader actually has.
  const groups = groupContracts(
    result.ok ? result.data : [],
    (trade) => isTradePast(trade.state),
    (trade) => needsViewer(trade.nextMove),
  );
  const visibleTrades = contractsForScope(groups, scope);
  const negotiatingCount = groups.active.filter(
    (trade) => trade.state === 'NEGOTIATING',
  ).length;

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  // Declared once so the two can never drift apart.
  const startDeal = () => <StartDealRailAction />;

  // Invites belong with what is still live, and only there: a pending invite is not a
  // contract, so it has no step plan and cannot be filed under whose move it is.
  const pendingInvites =
    scope === 'active' && invitesResult.ok ? invitesResult.data : [];
  const hasInvites = pendingInvites.length > 0;
  const hasTrades = visibleTrades.length > 0;

  // The group heading names the SLICE being shown, because the strip above it only
  // marks which tab is current and a heading reading "Open" over a list of trades
  // waiting on someone else would contradict it.
  const tradesHeading =
    scope === 'past'
      ? 'Finished'
      : scope === 'needs-you'
        ? 'Waiting on you'
        : scope === 'waiting'
          ? 'Waiting on the other trader'
          : negotiatingCount > 0
            ? 'Open'
            : 'Agreed';

  return (
    <MarketplaceShell title="Trades" primaryAction={startDeal()}>
      <SectionHeader
        title="Trades"
        description="Swap goods, with or without cash on top. Open an offer from a listing, or send a private deal link."
        mobileAction={hasInvites || hasTrades ? startDeal() : undefined}
      />

      <ContractFilter
        scope={scope}
        basePath="/trades"
        groups={groups}
        extraActive={invitesResult.ok ? invitesResult.data.length : 0}
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
                {tradesHeading}
              </h3>
              <TradesSection trades={visibleTrades} />
            </section>
          ) : null}
        </>
      ) : scope === 'active' ? (
        <StartDealEmptyState
          isAuthenticated
          icon={<HugeiconsIcon icon={HourglassIcon} className="size-6" aria-hidden="true" />}
          title="No Trades Yet"
          description="Find an item you would like, then offer whatever you think is fair for it. Or send a private deal link."
          help={{ label: 'How holds and disputes work', href: '/help#holds' }}
          compact
          fill
        />
      ) : (
        <ContractScopeEmptyState scope={scope} noun="trades" />
      )}
    </MarketplaceShell>
  );
}
