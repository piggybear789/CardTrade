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
  SectionFilter,
  partitionByScope,
  resolveScope,
} from '@/components/layout/SectionFilter';
import { isCashSalePast } from '@/lib/lifecycle';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Reads the caller's session and live contract state.
export const dynamic = 'force-dynamic';

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
  const scope = resolveScope(show);
  const [user, result, invitesResult] = await Promise.all([
    getCachedAuthUser(),
    getMyPurchases(),
    listMyDealInvites('CASH_SALE', 'BUYER'),
  ]);
  if (!user) {
    redirect('/sign-in?redirectTo=/purchases');
  }

  const { active, past } = partitionByScope(result.ok ? result.data : [], (sale) =>
    isCashSalePast(sale.status),
  );
  const pendingInvites =
    scope === 'past' || !invitesResult.ok ? [] : invitesResult.data;
  const visibleSales = scope === 'past' ? past : active;
  const hasInvites = pendingInvites.length > 0;

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  // No plus: browsing the marketplace creates nothing.
  const primaryAction = (
    <RailPrimaryAction href="/listings" glyph={null}>
      Browse Marketplace
    </RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="Purchases" primaryAction={primaryAction}>
      <SectionHeader
        title="Purchases"
        description="Items you are buying. Open a contract to agree terms, pay through Stripe, and confirm handover."
        mobileAction={primaryAction}
      />
      <SectionFilter
        scope={scope}
        basePath="/purchases"
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
          <CashSalesSection sales={visibleSales} variant="purchases" />
        ) : null
      ) : (
        <SectionLoadError label="purchases" />
      )}
    </MarketplaceShell>
  );
}
