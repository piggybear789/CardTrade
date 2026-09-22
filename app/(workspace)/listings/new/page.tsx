// app/listings/new/page.tsx
//
// Create-listing page (Req 3.1, 3.2, 3.3, 3.7, 14.1, 14.7).
//
// GATED ON `readListingGate`, WHICH IS BOTH GATES. Publishing a listing is an offer to
// sell for cash, so the member must satisfy the Identity_Gate AND have a buyer-safe seller
// disclosure — otherwise the listing would be visible to buyers who could never act on it.
//
// THE GATE IS CHECKED HERE AS WELL AS IN `createItem`, and Req 14.7 is the whole reason:
// the action refuses on submit, which means a blocked member otherwise photographs an item,
// writes a description, picks a price, and only then learns they cannot list. Checking on
// render turns that into a single sentence and a link, before any work is wasted. The
// action-level guard stays because it is the one that is actually authoritative — this is
// presentation.
//
// IT MUST CHECK THE SAME CONDITIONS THE ACTION DOES. It previously called
// `readIdentityGate` directly and so checked only the FIRST of the action's two, which
// defeated Req 14.7 for exactly the members it was written for: identity verified, payout
// setup never started, form rendered in full, refused on submit. That is what
// `lib/sellerListingGate.ts` was extracted to prevent — read the gate from there rather
// than re-deriving any part of it here.

import { redirect } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ShieldAlertIcon } from '@hugeicons/core-free-icons';

import { createClient } from '@/lib/supabase/server';
import { readListingGate } from '@/lib/sellerListingGate';
import { ItemForm } from '@/components/listings/ItemForm';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { EmptyState } from '@/components/ui/empty-state';
import { GateBlockedTracker } from '@/components/analytics/GateBlockedTracker';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

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

  const gate = await readListingGate(user.id);
  if (!gate.satisfied) {
    return (
      <MarketplaceShell title="New Listing" center>
        {/* SENDS THEM WHERE THE REQUIREMENT IS ACTUALLY RESOLVED, and says which of the
            two steps is outstanding. This used to read "Set Up Payouts First" and link to
            payout setup for an IDENTITY failure, which after 0069 does not open that gate
            at all — a blocked seller would have handed over their bank details and still
            been unable to list. The copy now comes from the gate, so the identity case and
            the disclosure case cannot be given each other's instructions. */}
        <EmptyState
          variant="page"
          icon={<HugeiconsIcon icon={ShieldAlertIcon} className="size-6" aria-hidden />}
          title={gate.title}
          titleAs="h3"
          description={gate.message}
          action={gate.action}
        />
        {/* Records WHICH gate refused, so the console can tell an unverified member from a
            verified one with no payout account. In aggregate those two need different
            product responses, and before 0121 they were indistinguishable. */}
        <GateBlockedTracker gate={gate.gateName} />
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell title="New Listing">
      <ItemForm mode="create" />
    </MarketplaceShell>
  );
}
