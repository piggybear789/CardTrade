// app/listings/new/page.tsx
//
// Create-listing page (Req 3.1, 3.2, 3.3, 3.7, 14.1, 14.7).
//
// GATED ON THE IDENTITY_GATE. Publishing a listing is an offer to sell for cash and
// the Seller receives the proceeds, so Connect onboarding must exist first.
//
// The gate is checked HERE as well as in `createItem`, and the reason is the whole
// point of Req 14.7: `createItem` refuses on submit, which means a blocked member
// otherwise photographs an item, writes a description, picks a price, and only then
// learns they cannot list. Checking on render turns that into a single sentence and
// a link, before any work is wasted. The action-level guard stays because it is the
// one that is actually authoritative — this is presentation.

import { redirect } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { identityGateMessage, readIdentityGate } from '@/lib/identityGate';
import { ItemForm } from '@/components/listings/ItemForm';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { EmptyState } from '@/components/ui/empty-state';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

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

  const gate = await readIdentityGate(user.id);
  if (!gate.satisfied) {
    return (
      <MarketplaceShell title="New Listing" center>
        {/* SENDS THEM TO THE IDENTITY CHECK, NOT PAYOUTS. This used to read "Set Up
            Payouts First" and link to payout setup, which after 0069 does not open
            this gate at all — a blocked seller would have handed over their bank
            details and still been unable to list. */}
        <EmptyState
          variant="page"
          icon={<ShieldAlert className="size-6" aria-hidden />}
          title="Verify Your Identity First"
          titleAs="h3"
          description={identityGateMessage('list', gate.state)}
          action={{ label: 'Verify identity', href: '/profile?tab=verification' }}
        />
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell title="New Listing">
      <ItemForm mode="create" />
    </MarketplaceShell>
  );
}
