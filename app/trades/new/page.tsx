// app/trades/new/page.tsx
//
// Offer a 2-Way Trade on one specific listing.
//
// Discovery happens in the catalog, not here: this page is reached from a
// listing's "Propose Trade" action, which supplies `?counterpartItemId=`.
// Without it there is nothing to offer against, so the page says so and sends
// you browsing rather than presenting a dropdown of every item on the platform.
//
// Enforces the VERIFIED gate (Req 2.4) before an offer can be made, and loads
// the caller's own AVAILABLE items as candidates. Creating the Trade itself is
// deferred until the other Trader accepts (see lib/actions/tradeProposals.ts).

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { TradeOfferForm } from '@/components/trade/TradeOfferForm';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { createClient } from '@/lib/supabase/server';
import type { ItemRow } from '@/lib/actions/listings';

export const metadata = {
  title: 'Offer a trade · Poke-xchange',
  description: 'Offer goods, cash, or both in exchange for a listing.',
};

// Reads the authenticated user's session, so it must render dynamically.
export const dynamic = 'force-dynamic';

/** The shell used by every state of this page. */
function Shell({
  children,
  center = false,
}: {
  children: React.ReactNode;
  /** Gate states are short, so they sit centred in the section. */
  center?: boolean;
}) {
  return (
    <MarketplaceShell title="Offer a Trade" contentWidth="form" center={center}>
      {children}
    </MarketplaceShell>
  );
}

export default async function NewTradePage({
  searchParams,
}: {
  searchParams: Promise<{
    counterpartItemId?: string | string[];
    /** Set when answering an existing offer rather than starting a fresh one. */
    counter?: string | string[];
  }>;
}) {
  const { counterpartItemId: raw, counter: rawCounter } = await searchParams;
  const counterpartItemId = Array.isArray(raw) ? raw[0] : raw;
  const counterOfProposalId = Array.isArray(rawCounter) ? rawCounter[0] : rawCounter;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Req 1.7: unauthenticated visitors cannot access this protected resource.
  if (!user) {
    return (
      <Shell center>
        <Card>
          <CardHeader>
            <CardTitle>Offer a trade</CardTitle>
            <CardDescription>
              You need to be signed in to offer a trade.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link href="/sign-in?redirectTo=/trades/new">Go to sign in</Link>
            </Button>
          </CardFooter>
        </Card>
      </Shell>
    );
  }

  const { data: profile } = await supabase
    .from('public_profiles')
    .select('id, is_verified')
    .eq('id', user.id)
    .maybeSingle();

  // Req 2.4: only verified users may initiate a Trade from this page.
  // "Verified" is provider-approved Managed Merchant onboarding
  // (`merchant_status = APPROVED` with settlements enabled), not a standalone
  // check — see `domain/bond/bondPolicy.ts`.
  if (!profile || !profile.is_verified) {
    return (
      <Shell center>
        <Card>
          <CardHeader>
            <CardTitle>Identity verification required</CardTitle>
            <CardDescription>
              Verify your identity before offering a trade.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Verifying lets us size the collateral that keeps both traders safe —
            and a verified trader posts none at all.
          </CardContent>
          <CardFooter>
            <Button asChild>
              <Link href="/profile#payouts">Verify your identity</Link>
            </Button>
          </CardFooter>
        </Card>
      </Shell>
    );
  }

  // No target listing: send them to browse instead of guessing.
  if (!counterpartItemId) {
    return (
      <Shell center>
        <EmptyState
          title="Pick Something to Trade For"
          description="Find a listing you want, then choose Propose Trade on it. You decide what to put up, and they decide whether it is fair."
          action={{ label: 'Browse Marketplace', href: '/listings' }}
        />
      </Shell>
    );
  }

  // The requested listing must be publicly listed, available, and not the
  // caller's own. A privately offered item cannot be the target of an offer.
  const { data: requestedRow } = await supabase
    .from('items')
    .select('id, owner_id, title, fmv_cents, image_paths, status, hidden')
    .eq('id', counterpartItemId)
    .maybeSingle();
  const requested = requestedRow as
    | (Pick<ItemRow, 'id' | 'owner_id' | 'title' | 'fmv_cents' | 'image_paths' | 'status'> & {
        hidden: boolean | null;
      })
    | null;

  if (
    !requested ||
    requested.status !== 'AVAILABLE' ||
    // A counter answers an existing offer, whose goods may be privately held.
    (requested.hidden && !counterOfProposalId) ||
    requested.owner_id === user.id
  ) {
    return (
      <Shell center>
        <EmptyState
          title="This Item Is Not Open to Offers"
          description="It may have sold, been reserved, or belong to you. Browse the marketplace for something else to trade for."
          action={{ label: 'Browse Marketplace', href: '/listings' }}
        />
      </Shell>
    );
  }

  const { data: ownerRow } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('id', requested.owner_id)
    .maybeSingle();

  // The caller's own AVAILABLE items, including ones held privately from a
  // previous offer, as candidates to put up.
  const { data: ownItemsData } = await supabase
    .from('items')
    .select('*')
    .eq('owner_id', user.id)
    .eq('status', 'AVAILABLE')
    .order('created_at', { ascending: false });

  return (
    <Shell>
      <TradeOfferForm
        requested={{
          id: requested.id,
          title: requested.title,
          fmvCents: requested.fmv_cents,
          imagePath: (requested.image_paths ?? [])[0] ?? null,
          ownerName:
            (ownerRow?.display_name as string | undefined)?.trim() ||
            'The other trader',
        }}
        ownItems={(ownItemsData ?? []) as ItemRow[]}
        counterOfProposalId={counterOfProposalId ?? null}
      />
    </Shell>
  );
}
