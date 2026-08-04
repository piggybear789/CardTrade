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
import { Handshake } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { listMyDeals } from '@/lib/actions/deals';
import { DealStateBadge } from '@/components/deals/DealStateBadge';
import { formatRelativeTime } from '@/lib/format';
import {
  MarketplaceShell,
  RailPrimaryAction,
} from '@/components/layout/MarketplaceShell';
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
  title: 'Deals · NoDitto',
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

  // One node, two homes: the rail on desktop, the section heading below `lg`.
  const primaryAction = (
    <RailPrimaryAction href="/deals/new">Start a Deal</RailPrimaryAction>
  );

  return (
    <MarketplaceShell title="Deals" primaryAction={primaryAction}>
      <SectionHeader
        title="Private Deals"
        description="Collateral-backed handover between two members."
        mobileAction={primaryAction}
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
                className="flex flex-col gap-3 p-4 transition-colors hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
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
                        : `With ${deal.otherPartyName?.trim() || 'NoDitto member'}`}
                      {deal.myConfirmed && !deal.theirConfirmed
                        ? ' · you confirmed'
                        : !deal.myConfirmed && deal.theirConfirmed
                          ? ' · they confirmed'
                          : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pl-12 sm:max-w-none sm:shrink-0 sm:flex-col sm:items-end sm:gap-1 sm:pl-0 sm:text-right">
                  <DealStateBadge state={deal.state} className="whitespace-normal" />
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
