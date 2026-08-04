// app/profile/payouts/page.tsx
//
// The Payouts_Dashboard route (Req 1).
//
// Lives under `/profile` because it is a settings-level surface the Member
// manages, alongside their profile details — not a transactional section like
// sales or purchases, which live in the workspace rail. That placement also means
// middleware already protects it: `PROTECTED_PREFIXES` contains `/profile` and
// `config.matcher` contains `/profile/:path*`, both of which match this path, so
// Req 1.4 is satisfied by the parent prefix without a redundant second entry.
//
// A Server Component, never prerendered: every figure is the caller's own live
// money. The redirect below is belt-and-braces behind middleware, and carries
// `redirectTo` so signing in returns the Member here (Req 1.3).

import { redirect } from 'next/navigation';

import { getPayoutsDashboard } from '@/lib/actions/payouts';
import { AccountTabs } from '@/components/account/AccountTabs';
import { PayoutsDashboard } from '@/components/payouts/PayoutsDashboard';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader } from '@/components/layout/SectionHeader';
import { resolveScope } from '@/components/layout/SectionFilter';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = {
  title: 'Payouts · NoDitto',
  description: 'What you are owed, what has been sent, and any disputes affecting it.',
};

// Reads the caller's session and live money state.
export const dynamic = 'force-dynamic';

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const scope = resolveScope(show);
  const result = await getPayoutsDashboard();

  if (!result.ok && result.error === 'not-authenticated') {
    redirect('/sign-in?redirectTo=/profile/payouts');
  }

  return (
    <MarketplaceShell title="Payouts">
      <SectionHeader
        title="Payouts"
        description="What you are owed, what has already been sent, and anything holding money up."
      />
      <AccountTabs />

      {result.ok ? (
        <PayoutsDashboard
          model={result.data.model}
          destination={result.data.destination}
          scope={scope}
        />
      ) : (
        // Deliberately NOT a zero balance: "you are owed nothing" and "we could
        // not check" must never look the same (Req 10.8).
        <EmptyState
          title="Payouts Unavailable"
          titleAs="h3"
          description="We couldn't load your payout information right now. Reload the page to try again."
          action={{ label: 'Try again', href: '/profile/payouts' }}
          compact
        />
      )}
    </MarketplaceShell>
  );
}
