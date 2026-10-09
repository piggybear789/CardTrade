// app/saved/page.tsx
//
// The caller's watchlist: listings they are tracking but have not acted on.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { listMyWatchlist } from '@/lib/actions/watchlist';
import { searchCatalog } from '@/lib/actions/listings';
import { resolveBrowseRegion } from '@/lib/location/resolveRegion';
import { WatchlistSection } from '@/components/account/WatchlistSection';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Saved · NoDitto',
  description: 'Listings you are watching.',
};

export default async function SavedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?redirectTo=/saved');
  }

  const result = await listMyWatchlist();
  const hasItems = result.ok && result.items.length > 0;
  // Something to save, under an empty list: the newest listings in the member's region.
  const suggestions =
    result.ok && !hasItems
      ? await resolveBrowseRegion(undefined)
          .then((region) => searchCatalog({ sort: 'newest', pageSize: 4, regionCode: region.code }))
          .then((page) => (page.ok ? page.items.slice(0, 4) : []))
          .catch(() => [])
      : [];

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  // No plus: browsing the marketplace creates nothing.
  const browseMarketplace = () => (
    <RailPrimaryAction href="/" glyph={null}>
      Browse marketplace
    </RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="Saved" primaryAction={browseMarketplace()}>
      <SectionHeader
        title="Saved"
        description="Listings you are watching. Saving does not reserve an item."
        mobileAction={hasItems ? browseMarketplace() : undefined}
      />
      {result.ok ? (
        <WatchlistSection items={result.items} suggestions={suggestions} />
      ) : (
        <SectionLoadError label="saved listings" />
      )}
    </MarketplaceShell>
  );
}
