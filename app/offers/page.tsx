// app/offers/page.tsx
//
// Offers the caller has made on other members' listings. Accepting an offer
// opens a Cash_Sale contract, so this belongs beside the other transaction
// sections rather than inside account settings.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { listMyOffers } from '@/lib/actions/offers';
import { OffersSection } from '@/components/account/OffersSection';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';
import {
  SectionFilter,
  partitionByScope,
  resolveScope,
} from '@/components/layout/SectionFilter';
import { isOfferPast } from '@/lib/lifecycle';

// Reads the caller's session and live offer state.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Offers · Poke-xchange',
  description: 'Offers you have made on listings.',
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

  return (
    <MarketplaceShell title="Offers" contentWidth="reading">
      <SectionHeader
        title="Offers"
        description="Prices you have proposed. An accepted offer opens a purchase contract."
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
