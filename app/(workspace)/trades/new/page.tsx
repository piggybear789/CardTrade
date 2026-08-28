// app/trades/new/page.tsx
//
// Offer a 2-Way Trade on one specific listing.
//
// Discovery happens in the catalog. The listing page opens Propose Trade as a
// dialog; this route remains for shared links and inbox counter-offers
// (`?counterpartItemId=` / `?counter=`). Without a target listing the page
// sends you browsing rather than presenting every item on the platform.
//
// Trading has no verification gate (Req 2.4, revised): any authenticated user
// may offer a Trade. Verification only decides whether a Bond is required
// (`domain/bond/bondPolicy.ts`), enforced later when the offer is accepted.
// Loads the caller's own AVAILABLE items as candidates. Creating the Trade
// itself is deferred until the other Trader accepts (see
// lib/actions/tradeProposals.ts).

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { TradeOfferForm } from '@/components/trade/TradeOfferForm';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
import { createClient } from '@/lib/supabase/server';
import type { ItemRow } from '@/lib/actions/listings';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Offer a trade · NoDitto',
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
    <MarketplaceShell
      title="Offer a Trade"
      center={center}
      primaryAction={
        // No plus: browsing the marketplace creates nothing.
        <RailPrimaryAction href="/" glyph={null}>
          Browse Marketplace
        </RailPrimaryAction>
      }
    >
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
    const next = new URLSearchParams();
    if (counterpartItemId) next.set('counterpartItemId', counterpartItemId);
    if (counterOfProposalId) next.set('counter', counterOfProposalId);
    const query = next.toString();
    const redirectTo = query ? `/trades/new?${query}` : '/trades/new';
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
              <Link href={`/sign-in?redirectTo=${encodeURIComponent(redirectTo)}`}>
                Go to sign in
              </Link>
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
          variant="page"
          title="Pick Something to Trade For"
          description="Find a listing you want, then choose Propose Trade on it. You decide what to put up, and they decide whether it is fair."
          action={{ label: 'Browse Marketplace', href: '/' }}
        />
      </Shell>
    );
  }

  // The requested listing must be publicly listed, available, and not the
  // caller's own. A privately offered item cannot be the target of an offer.
  const { data: requestedRow } = await supabase
    .from('items')
    .select(
      'id, owner_id, title, fmv_cents, image_paths, status, hidden, listing_kind, closed_at',
    )
    .eq('id', counterpartItemId)
    .maybeSingle();
  const requested = requestedRow as
    | (Pick<ItemRow, 'id' | 'owner_id' | 'title' | 'fmv_cents' | 'image_paths' | 'status'> & {
        hidden: boolean | null;
        listing_kind: 'SINGLE' | 'SHOPFRONT';
        closed_at: string | null;
      })
    | null;

  // A binder is permanently AVAILABLE and is open for business until it is CLOSED,
  // so testing status alone would reject every one of them (0064, 0081).
  const requestedIsShopfront = requested?.listing_kind === 'SHOPFRONT';
  const requestedIsOpen = requestedIsShopfront
    ? requested?.closed_at === null
    : requested?.status === 'AVAILABLE';

  if (
    !requested ||
    !requestedIsOpen ||
    // A counter answers an existing offer, whose goods may be privately held.
    (requested.hidden && !counterOfProposalId) ||
    requested.owner_id === user.id
  ) {
    return (
      <Shell center>
        <EmptyState
          variant="page"
          title="This Item Is Not Open to Offers"
          description="It may have sold, been reserved, or belong to you. Browse the marketplace for something else to trade for."
          action={{ label: 'Browse Marketplace', href: '/' }}
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
    // A binder still cannot go INTO a trade. It can be traded FOR (0081), where it
    // is valued at whatever is offered against it — but as the OFFERING side there
    // would be no figure to derive that from, only an inventory's "from" price.
    .eq('listing_kind', 'SINGLE')
    .order('created_at', { ascending: false });

  // The form is a short, self-contained interstitial, so it sits centred rather
  // than filling the workspace column.
  return (
    <Shell center>
      <TradeOfferForm
        requested={{
          id: requested.id,
          title: requested.title,
          fmvCents: requested.fmv_cents,
          imagePath: (requested.image_paths ?? [])[0] ?? null,
          ownerName:
            (ownerRow?.display_name as string | undefined)?.trim() ||
            'The other trader',
          isShopfront: requestedIsShopfront,
        }}
        ownItems={(ownItemsData ?? []) as ItemRow[]}
        counterOfProposalId={counterOfProposalId ?? null}
      />
    </Shell>
  );
}
