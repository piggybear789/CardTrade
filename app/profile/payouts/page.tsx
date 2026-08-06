// app/profile/payouts/page.tsx
//
// Selling and payout surface. This is the only route that renders Stripe Connect
// setup, preventing the Profile page and Payouts page from competing or duplicating
// the same onboarding card.

import { redirect } from 'next/navigation';

import { getPayoutSetupContext } from '@/lib/actions/merchant';
import { getPayoutsDashboard } from '@/lib/actions/payouts';
import { getIdentityCheckState } from '@/lib/actions/identity';
import { isPaymentDemoEnabled } from '@/domain/services';
import { AccountTabs } from '@/components/account/AccountTabs';
import { IdentityCheckCard } from '@/components/identity/IdentityCheckCard';
import { IdentityDemoControls } from '@/components/identity/IdentityDemoControls';
import { IdentityReturnRefresh } from '@/components/identity/IdentityReturnRefresh';
import { PayoutOnboarding } from '@/components/profile/PayoutOnboarding';
import { PayoutsDashboard } from '@/components/payouts/PayoutsDashboard';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader } from '@/components/layout/SectionHeader';
import { resolveScope } from '@/components/layout/SectionFilter';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata = {
  title: 'Selling & Payouts · NoDitto',
  description: 'Stripe Connect setup, payout readiness, and money release history.',
};

export const dynamic = 'force-dynamic';

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const scope = resolveScope(show);
  const [payoutContext, result, identity] = await Promise.all([
    getPayoutSetupContext(),
    getPayoutsDashboard(),
    getIdentityCheckState(),
  ]);

  // Read server-side: the flag depends on provider credentials that must never reach
  // the browser. The action re-checks it regardless — a render condition is not a
  // control.
  const paymentDemoEnabled = isPaymentDemoEnabled();

  if (!result.ok && result.error === 'not-authenticated') {
    redirect('/sign-in?redirectTo=/profile/payouts');
  }

  return (
    <MarketplaceShell title="Selling & Payouts">
      <SectionHeader
        title="Selling & Payouts"
        description="Stripe Connect status, where releases go, and what has been paid."
      />
      <AccountTabs />

      {/* Reconciles the return from Stripe's hosted check. Renders nothing. */}
      <IdentityReturnRefresh />

      <div className="space-y-6">
        {/* STEP ONE, ABOVE PAYOUT SETUP. Order is the explanation: identity unlocks
            listing, selling and trading on its own, and payout setup only unlocks
            receiving money. A member who reads top to bottom is never asked for bank
            details before they have been asked who they are. */}
        {identity.ok ? (
          <IdentityCheckCard
            status={identity.data.status}
            verifiedName={identity.data.verifiedName}
            returnPath="/profile/payouts"
          />
        ) : null}

        {/* Mock-only: drive the identity decision by hand, because MockService never
            lands VERIFIED on its own. Hidden when Stripe is live, and hidden once the
            member is through the gate — the only reason it exists is to unstick them. */}
        {paymentDemoEnabled && identity.ok && identity.data.status !== 'VERIFIED' ? (
          <IdentityDemoControls />
        ) : null}

        {result.ok ? (
          <PayoutsDashboard
            model={result.data.model}
            destination={result.data.destination}
            connectSetup={
              payoutContext.ok ? (
                <PayoutOnboarding context={payoutContext.data} compact />
              ) : undefined
            }
            scope={scope}
          />
        ) : (
          <EmptyState
            title="Payout information unavailable"
            titleAs="h3"
            description="We could not load your payout information. Reload to try again."
            action={{ label: 'Try again', href: '/profile/payouts' }}
            compact
          />
        )}
      </div>
    </MarketplaceShell>
  );
}
