// app/deals/page.tsx
//
// "Deals" — every private 1:1 deal the signed-in member is part of, newest
// activity first. A Server Component: it requires auth, then reads the list via
// the `listMyDeals` server action (RLS scopes it to the caller's own deals).
//
// The list lives inside the shared marketplace workspace so browsing and deals
// read as one surface; an individual deal room keeps its own focused page.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Handshake, Plus } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { listMyDeals } from '@/lib/actions/deals';
import { DealStateBadge } from '@/components/deals/DealStateBadge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/format';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { EmptyState } from '@/components/ui/empty-state';
import {
  SectionHeader,
  SectionLoadError,
} from '@/components/layout/SectionHeader';
import {
  SectionFilter,
  partitionByScope,
  resolveScope,
} from '@/components/layout/SectionFilter';
import { isDealPast } from '@/lib/lifecycle';

// Reads the signed-in user's session and live deal state.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Deals · Poke-xchange',
  description: 'Your private 1:1 binding deals.',
};

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const scope = resolveScope(show);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?redirectTo=/deals');
  }

  const result = await listMyDeals();
  const { active, past } = partitionByScope(result.ok ? result.deals : [], (deal) =>
    isDealPast(deal.state),
  );
  const deals = scope === 'past' ? past : active;

  return (
    <MarketplaceShell
      title="Deals"
      primaryAction={
        <Button
          asChild
          variant="outline"
          className="w-full border-gold/45 bg-gold/12 text-foreground hover:border-gold/60 hover:bg-gold/20"
        >
          <Link href="/deals/new">
            <Plus aria-hidden="true" className="text-gold" />
            Start a Deal
          </Link>
        </Button>
      }
    >
      <SectionHeader
        title="Private Deals"
        description="Escrow-backed handover between two members."
      />

      <SectionFilter
        scope={scope}
        basePath="/deals"
        activeCount={active.length}
        pastCount={past.length}
      />

      {!result.ok ? (
        <div className="mb-5">
          <SectionLoadError label="deals" />
        </div>
      ) : null}

      {deals.length === 0 ? (
        <EmptyState
          icon={<Handshake className="size-6" aria-hidden="true" />}
          title="No Deals Yet"
          description="Start a private deal with one other member, agree the handover, and confirm before it becomes binding."
          action={{ label: 'Start a Private Deal', href: '/deals/new' }}
          compact
        />
      ) : (
        <ul
          className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card shadow-market"
          aria-label="Deals"
        >
          {deals.map((deal) => (
            <li key={deal.id}>
              <Link
                href={`/deals/${deal.id}`}
                className="flex items-center gap-3 p-4 transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-full border border-gold/35 bg-gold/10"
                  aria-hidden="true"
                >
                  <Handshake className="size-4 text-gold" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{deal.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {deal.otherPartyId === null
                      ? 'Awaiting counterparty'
                      : `With ${deal.otherPartyName?.trim() || 'Poke-xchange member'}`}
                    {deal.myConfirmed && !deal.theirConfirmed
                      ? ' · you confirmed'
                      : !deal.myConfirmed && deal.theirConfirmed
                        ? ' · they confirmed'
                        : ''}
                  </p>
                </div>
                {/* Cap the badge column so long state labels wrap instead of
                    pushing the row past the viewport on narrow screens. */}
                <div className="flex max-w-[45%] shrink-0 flex-col items-end gap-1 text-right sm:max-w-none">
                  <DealStateBadge state={deal.state} className="whitespace-normal text-right" />
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(deal.updatedAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MarketplaceShell>
  );
}
