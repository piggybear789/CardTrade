// app/listings/mine/page.tsx
//
// The caller's own listings, in every status (Req 3). A static segment, so it
// takes precedence over /listings/[id] and never resolves as an item id.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { getMyListings } from '@/lib/actions/account';
import { ListingsSection } from '@/components/account/ListingsSection';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'My Listings · NoDitto',
  description: 'Items you have listed for sale or trade.',
};

export default async function MyListingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?redirectTo=/listings/mine');
  }

  const result = await getMyListings();
  const hasItems = result.ok && result.data.length > 0;

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  const createListing = () => (
    <RailPrimaryAction href="/listings/new">Create New Listing</RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="My Listings" primaryAction={createListing()}>
      <SectionHeader
        title="My Listings"
        description="Everything you have listed, including reserved and sold items."
        mobileAction={hasItems ? createListing() : undefined}
      />
      {result.ok ? (
        <ListingsSection items={result.data} />
      ) : (
        <SectionLoadError label="listings" />
      )}
    </MarketplaceShell>
  );
}
