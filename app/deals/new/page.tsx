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
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { formatAud } from '@/lib/format';
import { DEAL_DEFAULT_COLLATERAL_CENTS } from '@/lib/marketplace-constants';

// Reads the authenticated user's session, so render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Start a deal · NoDitto',
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
      <MarketplaceShell title="Start a Deal" center>
        {/* Same shape as the trade flow's gate states: one narrow centred card,
            a one-line consequence, and the choice in the footer. */}
        <Card className="mx-auto w-full max-w-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Use DittoShield, or post collateral</CardTitle>
            <CardDescription>
              Complete DittoShield (Anti-Impostor Verification) once and nothing is
              held. Skip, and each side is held for the deal&apos;s value (min{' '}
              {formatAud(DEAL_DEFAULT_COLLATERAL_CENTS)}) until you both mark it
              complete.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted/20 px-6 pb-4 pt-4 sm:flex-row sm:justify-end">
            <Button asChild variant="ghost" className="w-full sm:w-auto">
              <Link href="/deals/new?collateral=1">Post collateral</Link>
            </Button>
            <Button asChild className="w-full sm:w-auto">
              <Link href="/profile#payouts">Start DittoShield</Link>
            </Button>
          </CardFooter>
        </Card>
      </MarketplaceShell>
    );
  }

  // The form is a short, self-contained interstitial — like /trades/new — so it
  // sits centred in the workspace and carries its own heading.
  return (
    <MarketplaceShell title="Start a Deal" center>
      <NewDealForm collateralRequired={!verified} />
    </MarketplaceShell>
  );
}
