// app/saved/page.tsx
//
// The caller's watchlist: listings they are tracking but have not acted on.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { listMyWatchlist } from '@/lib/actions/watchlist';
import { WatchlistSection } from '@/components/account/WatchlistSection';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';

// Reads the caller's session and live watchlist state.
export const dynamic = 'force-dynamic';

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

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  // No plus: browsing the marketplace creates nothing.
  const primaryAction = (
    <RailPrimaryAction href="/listings" glyph={null}>
      Browse Marketplace
    </RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="Saved" primaryAction={primaryAction}>
      <SectionHeader
        title="Saved"
        description="Listings you are watching. Saving does not reserve an item."
        mobileAction={primaryAction}
      />
      {result.ok ? (
        <WatchlistSection items={result.items} />
      ) : (
        <SectionLoadError label="saved listings" />
      )}
    </MarketplaceShell>
  );
}
