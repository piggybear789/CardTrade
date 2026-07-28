// app/listings/new/page.tsx
//
// Create-listing page (Req 3.1, 3.2, 3.3, 3.7).
//
// Listing has no verification gate (Req 3.1/3.1a): any authenticated user can
// list, regardless of KYC_Status or Managed Merchant approval. Those checks
// apply later, at the point a contract is actually entered — payer KYC
// (`kyc_status`) decides whether a Trade requires a Bond, and Managed Merchant
// approval (`merchant_status`) gates receiving cash in a Cash_Sale — never
// listing itself.

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { ItemForm } from '@/components/listings/ItemForm';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';

// Reads the authenticated user's session, so render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'List an item · Poke-xchange',
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
