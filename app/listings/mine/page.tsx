// app/listings/mine/page.tsx
//
// The caller's own listings, in every status (Req 3). A static segment, so it
// takes precedence over /listings/[id] and never resolves as an item id.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { getMyListings } from '@/lib/actions/account';
import { ListingsSection } from '@/components/account/ListingsSection';
import { Button } from '@/components/ui/button';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader, SectionLoadError } from '@/components/layout/SectionHeader';

// Reads the caller's session and live listing state.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'My Listings · CardTrade',
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

  return (
    <MarketplaceShell
      title="My Listings"
      contentWidth="reading"
      primaryAction={
        <Button
          asChild
          variant="outline"
          className="w-full border-gold/45 bg-gold/12 text-foreground hover:border-gold/60 hover:bg-gold/20"
        >
          <Link href="/listings/new">
            <Plus aria-hidden="true" className="text-gold" />
            Create New Listing
          </Link>
        </Button>
      }
    >
      <SectionHeader
        title="My Listings"
        description="Everything you have listed, including reserved and sold items."
      />
      {result.ok ? (
        <ListingsSection items={result.data} />
      ) : (
        <SectionLoadError label="listings" />
      )}
    </MarketplaceShell>
  );
}
