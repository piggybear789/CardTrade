// app/offers/page.tsx
//
// Offers the caller has sent and received. Accepting an offer opens a
// Cash_Sale contract, so this belongs beside the other transaction sections
// rather than inside account settings.

import { redirect } from 'next/navigation';

import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
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
import { platformForCurrency } from '@/domain/region';
import { hasSavedCardFor } from '@/lib/payments/cardPlatform';
import { AddPaymentMethodDialog } from '@/components/payments/AddPaymentMethodDialog';
import { Button } from '@/components/ui/button';
import { StatusNotice } from '@/components/ui/status-notice';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

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
  // Together: the list resolves the caller through the same request-cached read.
  const [user, result] = await Promise.all([getCachedAuthUser(), listMyOffers()]);
  if (!user) {
    redirect('/sign-in?redirectTo=/offers');
  }
  const { active, past } = partitionByScope(
    result.ok ? result.offers : [],
    (offer) => isOfferPast(offer.status),
  );
  const visibleOffers = scope === 'past' ? past : active;
  // A seller cannot accept an offer from a buyer with no card (`initiateCashSale`), and
  // the card that counts is the one on the platform the SALE runs on (0179), which for
  // a seller abroad is not the buyer's own. Read from the database only, per platform,
  // so the notice is in the first paint.
  const buyerPlatforms = Array.from(
    new Set(
      active
        .filter((offer) => offer.role === 'buyer' && offer.status === 'PENDING')
        .map((offer) => platformForCurrency(offer.currency))
        .filter((platform): platform is string => Boolean(platform)),
    ),
  );
  const cardsNeeded = (
    await Promise.all(
      buyerPlatforms.map(async (platform) =>
        (await hasSavedCardFor(user.id, platform)) ? null : platform,
      ),
    )
  ).filter((platform): platform is string => Boolean(platform));

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  // No plus: browsing the marketplace creates nothing.
  const browseMarketplace = () => (
    <RailPrimaryAction href="/" glyph={null}>
      Browse marketplace
    </RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="Offers" primaryAction={browseMarketplace()}>
      <SectionHeader
        title="Offers"
        description="Prices you have sent and received. An accepted offer opens a purchase contract."
        mobileAction={visibleOffers.length > 0 ? browseMarketplace() : undefined}
      />

      <SectionFilter
        scope={scope}
        basePath="/offers"
        activeCount={active.length}
        pastCount={past.length}
      />

      {cardsNeeded.map((platform) => (
        <StatusNotice
          key={platform}
          className="mb-group"
          title="Add a card so the seller can accept"
          description="A seller can only accept your offer once you have a card on file. Nothing is charged until you pay."
        >
          <AddPaymentMethodDialog
            platform={platform}
            trigger={
              <Button type="button" variant="secondary" className="w-full sm:w-auto">
                Add a card
              </Button>
            }
          />
        </StatusNotice>
      ))}
      {result.ok ? (
        <OffersSection offers={visibleOffers} scope={scope} />
      ) : (
        <SectionLoadError label="offers" />
      )}
    </MarketplaceShell>
  );
}
