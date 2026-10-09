// app/listings/mine/page.tsx
//
// The caller's own listings, in every status (Req 3). A static segment, so it
// takes precedence over /listings/[id] and never resolves as an item id.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { getMyListings } from '@/lib/actions/account';
import { ListingsSection, resolveListingScope } from '@/components/account/ListingsSection';
import { listMyListingDrafts } from '@/lib/actions/listingDrafts';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'My listings · NoDitto',
  description: 'Items you have listed for sale or trade.',
};

export default async function MyListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const scope = resolveListingScope(show);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?redirectTo=/listings/mine');
  }

  // The best live offer per listing, for the table's "Top offer" column. RLS scopes
  // `offers` to the caller's own negotiations; `seller_id` narrows it to offers on
  // the caller's listings.
  const [result, offersResult, draftsResult] = await Promise.all([
    getMyListings(),
    supabase
      .from('offers')
      .select('item_id, amount_cents')
      .eq('seller_id', user.id)
      .eq('status', 'PENDING'),
    listMyListingDrafts(),
  ]);
  const topOfferByItem: Record<string, number> = {};
  for (const offer of offersResult.data ?? []) {
    const itemId = offer.item_id as string;
    const amount = offer.amount_cents as number;
    if ((topOfferByItem[itemId] ?? 0) < amount) topOfferByItem[itemId] = amount;
  }
  const hasItems = result.ok && result.data.length > 0;

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  const createListing = () => (
    <RailPrimaryAction href="/listings/new">Sell an item</RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="My listings" primaryAction={createListing()}>
      <SectionHeader
        title="My listings"
        description="Everything you have listed, including reserved and sold items."
        mobileAction={hasItems ? createListing() : undefined}
      />
      {result.ok ? (
        <ListingsSection
        items={result.data}
        scope={scope}
        topOfferByItem={topOfferByItem}
        drafts={draftsResult.ok ? draftsResult.data : []}
      />
      ) : (
        <SectionLoadError label="listings" />
      )}
    </MarketplaceShell>
  );
}
