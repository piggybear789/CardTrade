// app/listings/new/page.tsx
//
// Create-listing page (Req 3.1, 3.2, 3.3, 3.7).
//
// Listing has no verification gate (Req 3.1/3.1a): any authenticated user can
// list, regardless of Managed Merchant approval. That check applies later: it
// decides whether a Trade requires a Bond, and gates receiving cash in a
// Cash_Sale — never listing itself, and never whether a trade offer (including
// cash terms) can be sent.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { ItemForm } from '@/components/listings/ItemForm';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';

// Reads the authenticated user's session, so render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'List an item · NoDitto',
  description: 'Create a new collectible listing for sale or trade.',
};

export default async function NewListingPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?redirectTo=/listings/new');
  }

  return (
    <MarketplaceShell title="Sell an Item">
      <ItemForm mode="create" />
    </MarketplaceShell>
  );
}
