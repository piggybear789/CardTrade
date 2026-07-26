// app/deals/new/page.tsx
//
// Start a private 1:1 deal. A Server Component that authenticates the caller and
// then puts identity verification in front of the form as a CHOICE rather than a
// wall (identity or money):
//   - Unauthenticated visitors are redirected to sign-in.
//   - Unverified members see a choice screen with a skip that carries straight
//     on to the form (`?collateral=1`) and states what skipping costs:
//     collateral held on both sides once the deal is confirmed. Verifying is
//     provider-approved Managed Merchant onboarding on the profile page, not a
//     standalone flow.
//   - Verified members (or anyone who skipped) get the form itself.
//
// The gate is presentation only — `createDeal` requires no verification, and
// `confirmDeal` sizes the collateral from both parties' status server-side.

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import { NewDealForm } from '@/components/deals/NewDealForm';
import { Button } from '@/components/ui/button';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { formatAud } from '@/lib/format';
import { DEAL_DEFAULT_COLLATERAL_CENTS } from '@/lib/marketplace-constants';

// Reads the authenticated user's session, so render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Start a deal · CardTrade',
  description: 'Start a private 1:1 binding deal with one other member.',
};

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // Set by the choice step's skip control: "I'll post collateral instead."
  const acceptedCollateral = params.collateral === '1';

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/sign-in?redirectTo=/deals/new');
  }

  const { data } = await supabase
    .from('public_profiles')
    .select('is_verified')
    .eq('id', user.id)
    .maybeSingle();
  const verified = Boolean(data?.is_verified);

  // The choice step: offered once, skippable, and never a dead end.
  if (!verified && !acceptedCollateral) {
    return (
      <MarketplaceShell title="Start a Deal" contentWidth="form" center>
        <header className="mb-6 border-b border-border/70 pb-5">
          <p className="market-label text-gold">Private deal</p>
          <h2 className="mt-2 text-balance text-2xl font-bold tracking-[-0.035em]">
            Verify your identity, or post collateral
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
            A private deal is binding, so it has to be backed by something. Verify
            once and neither of you puts up a cent — or skip, and each side is held
            for the deal&apos;s value until the handover is done.
          </p>
        </header>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/profile#payouts">Verify my identity</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/deals/new?collateral=1">Skip — post collateral instead</Link>
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Skipping doesn&apos;t block the deal. When you both confirm, each side is
          held for the deal&apos;s value (at least{' '}
          {formatAud(DEAL_DEFAULT_COLLATERAL_CENTS)}), released as soon as you both
          mark it complete. Verify instead and nothing is held.
        </p>
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell title="Start a Deal" contentWidth="form">
      <header className="mb-6 border-b border-border/70 pb-5">
        <p className="market-label text-gold">Private deal</p>
        <h2 className="mt-2 text-balance text-2xl font-bold tracking-[-0.035em]">
          Start a private deal
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
          Set the terms once, then share a private link with the other person.
          Nothing becomes binding until you both confirm.
        </p>
      </header>
      <NewDealForm collateralRequired={!verified} />
    </MarketplaceShell>
  );
}
