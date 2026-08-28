// app/sales/page.tsx
//
// Sales: every Cash_Sale where the caller is the seller (Req 4), plus unused
// private-deal invites you hosted as the seller — waiting for the other person.

import { redirect } from 'next/navigation';

import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { getMySales } from '@/lib/actions/account';
import { listMyDealInvites } from '@/lib/actions/dealInvites';
import { DealInviteList } from '@/components/deals/DealInviteList';
import { CashSalesSection } from '@/components/account/CashSalesSection';
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
import { isCashSalePast } from '@/lib/lifecycle';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Sales · NoDitto',
  description: 'Contracts where you are the seller.',
};

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const scope = resolveScope(show);
  const [user, result, invitesResult] = await Promise.all([
    getCachedAuthUser(),
    getMySales(),
    listMyDealInvites('CASH_SALE', 'SELLER'),
  ]);
  if (!user) {
    redirect('/sign-in?redirectTo=/sales');
  }

  const { active, past } = partitionByScope(result.ok ? result.data : [], (sale) =>
    isCashSalePast(sale.status),
  );
  const pendingInvites =
    scope === 'past' || !invitesResult.ok ? [] : invitesResult.data;
  const visibleSales = scope === 'past' ? past : active;
  const hasInvites = pendingInvites.length > 0;
  const hasRows = hasInvites || visibleSales.length > 0;

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  const createListing = () => (
    <RailPrimaryAction href="/listings/new">Create New Listing</RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="Sales" primaryAction={createListing()}>
      <SectionHeader
        title="Sales"
        description="Items you are selling. Open a contract to set terms, ship, and get paid."
        mobileAction={hasRows ? createListing() : undefined}
      />
      <SectionFilter
        scope={scope}
        basePath="/sales"
        activeCount={active.length + (scope === 'past' ? 0 : pendingInvites.length)}
        pastCount={past.length}
      />
      {hasInvites ? (
        <section aria-labelledby="deal-invites-heading" className="mb-8">
          <h3 id="deal-invites-heading" className="mb-3 text-subhead font-semibold">
            Waiting to join
          </h3>
          <DealInviteList invites={pendingInvites} />
        </section>
      ) : null}
      {result.ok ? (
        visibleSales.length > 0 || !hasInvites ? (
          <CashSalesSection sales={visibleSales} variant="sales" />
        ) : null
      ) : (
        <SectionLoadError label="sales" />
      )}
    </MarketplaceShell>
  );
}
