// app/purchases/page.tsx
//
// Purchases: every Cash_Sale where the caller is the buyer (Req 4), plus unused
// private-deal invites you hosted as the buyer — waiting for the other person.

import { redirect } from 'next/navigation';

import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { getMyPurchases } from '@/lib/actions/account';
import { listMyDealInvites } from '@/lib/actions/dealInvites';
import { DealInviteList } from '@/components/deals/DealInviteList';
import { CashSalesSection } from '@/components/account/CashSalesSection';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
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
import { isCashSalePast } from '@/lib/lifecycle';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Purchases · NoDitto',
  description: 'Contracts where you are the buyer.',
};

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const scope = resolveContractScope(show);
  const [user, result, invitesResult] = await Promise.all([
    getCachedAuthUser(),
    getMyPurchases(),
    listMyDealInvites('CASH_SALE', 'BUYER'),
  ]);
  if (!user) {
    redirect('/sign-in?redirectTo=/purchases');
  }

  const groups = groupContracts(
    result.ok ? result.data : [],
    (sale) => isCashSalePast(sale.status),
    (sale) => needsViewer(sale.nextMove),
  );
  // Invites belong with what is still live, and only there: a pending invite is not a
  // contract, so it has no step plan and cannot be filed under whose move it is.
  const pendingInvites =
    scope === 'active' && invitesResult.ok ? invitesResult.data : [];
  const visibleSales = contractsForScope(groups, scope);
  const hasInvites = pendingInvites.length > 0;
  const hasRows = hasInvites || visibleSales.length > 0;

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  // No plus: browsing the marketplace creates nothing.
  const browseMarketplace = () => (
    <RailPrimaryAction href="/" glyph={null}>
      Browse Marketplace
    </RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="Purchases" primaryAction={browseMarketplace()}>
      <SectionHeader
        title="Purchases"
        description="Items you are buying. Open a contract to agree terms, pay through Stripe, and confirm handover."
        mobileAction={hasRows ? browseMarketplace() : undefined}
      />
      <ContractFilter
        scope={scope}
        basePath="/purchases"
        groups={groups}
        extraActive={invitesResult.ok ? invitesResult.data.length : 0}
      />
      {hasInvites ? (
        <section aria-labelledby="deal-invites-heading" className="mb-section">
          <h3 id="deal-invites-heading" className="mb-cozy text-subhead font-semibold">
            Waiting to join
          </h3>
          <DealInviteList invites={pendingInvites} />
        </section>
      ) : null}
      {result.ok ? (
        visibleSales.length > 0 || !hasInvites ? (
          <CashSalesSection
            sales={visibleSales}
            variant="purchases"
            empty={<ContractScopeEmptyState scope={scope} noun="purchases" />}
          />
        ) : null
      ) : (
        <SectionLoadError label="purchases" />
      )}
    </MarketplaceShell>
  );
}
