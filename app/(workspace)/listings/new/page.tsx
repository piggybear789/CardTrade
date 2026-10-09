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
import type { PlaceValue } from '@/lib/location/types';
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

  // In parallel: the default place is wanted only if the gate passes, but it is one
  // indexed row and costs nothing to fetch alongside rather than after.
  const [gate, defaultLocation] = await Promise.all([
    readListingGate(user.id),
    lastListingLocation(supabase, user.id),
  ]);
  if (!gate.satisfied) {
    return (
      <MarketplaceShell title="New listing" center>
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
    <MarketplaceShell title="New listing">
      <ItemForm mode="create" defaultLocation={defaultLocation} />
    </MarketplaceShell>
  );
}

/**
 * Where this seller's most recent listing is based, to prefill "Based near".
 *
 * STORED ON THE LISTINGS THEMSELVES, so there is nothing new to keep in sync: the
 * default is simply the last place they chose, on any device. Any status — a sold or
 * closed listing still says where the seller trades from.
 *
 * SUBURB PRECISION ONLY. An `exact` place would be a street or landmark, and carrying
 * it into a new listing would publish a precise point the seller chose for a different
 * context. A row with no precision predates the column and was always a suburb.
 *
 * Never throws: a failed read is just an empty field, which is what the form had before.
 */
async function lastListingLocation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<PlaceValue | null> {
  const { data } = await supabase
    .from('items')
    .select(
      'location_label, location_place_id, location_lat, location_lng, location_country_code',
    )
    .eq('owner_id', userId)
    .not('location_label', 'is', null)
    .not('location_lat', 'is', null)
    .not('location_lng', 'is', null)
    .or('location_precision.is.null,location_precision.eq.suburb')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data?.location_label || data.location_lat == null || data.location_lng == null) {
    return null;
  }
  return {
    label: data.location_label,
    placeId: data.location_place_id ?? `text:${data.location_label}`,
    lat: data.location_lat,
    lng: data.location_lng,
    countryCode: data.location_country_code,
    precision: 'suburb',
  };
}
