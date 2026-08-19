// app/offers/page.tsx
//
// Offers the caller has sent and received. Accepting an offer opens a
// Cash_Sale contract, so this belongs beside the other transaction sections
// rather than inside account settings.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { listMyOffers } from '@/lib/actions/offers';
import { OffersSection } from '@/components/account/OffersSection';
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
import { isOfferPast } from '@/lib/lifecycle';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

// Reads the caller's session and live offer state.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Offers · NoDitto',
  description: 'Offers you have sent and received.',
};

export default async function OffersPage({
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
    redirect('/sign-in?redirectTo=/offers');
  }

  const result = await listMyOffers();
  const { active, past } = partitionByScope(
    result.ok ? result.offers : [],
    (offer) => isOfferPast(offer.status),
  );
  const visibleOffers = scope === 'past' ? past : active;

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  // No plus: browsing the marketplace creates nothing.
  const primaryAction = (
    <RailPrimaryAction href="/listings" glyph={null}>
      Browse Marketplace
    </RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="Offers" primaryAction={primaryAction}>
      <SectionHeader
        title="Offers"
        description="Prices you have sent and received. An accepted offer opens a purchase contract."
        mobileAction={primaryAction}
      />

      <SectionFilter
        scope={scope}
        basePath="/offers"
        activeCount={active.length}
        pastCount={past.length}
      />

      {result.ok ? (
        <OffersSection offers={visibleOffers} scope={scope} />
      ) : (
        <SectionLoadError label="offers" />
      )}
    </MarketplaceShell>
  );
}
