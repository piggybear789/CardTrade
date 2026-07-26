// app/listings/new/page.tsx
//
// Create-listing page (Req 3.1, 3.2, 3.3, 3.7).
//
// Verification is provider-approved Managed Merchant onboarding
// (`merchant_status = APPROVED` with settlements enabled) and now HARD-BLOCKS
// listing entirely (revised Req 3.1): an unverified user cannot reach the
// listing form at all. This is stricter than buying and trading, which never
// gate on verification (unverified traders bond collateral instead of being
// blocked, per Req 5.4) - listing is the one path verification fully closes.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { ItemForm } from '@/components/listings/ItemForm';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';

// Reads the authenticated user's session, so render dynamically.
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'List an item · Poke-xchange',
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

  const { data: profile } = await supabase
    .from('public_profiles')
    .select('is_verified')
    .eq('id', user.id)
    .maybeSingle();
  const verified = Boolean(profile?.is_verified);

  if (!verified) {
    return (
      <MarketplaceShell title="Sell an Item" contentWidth="form" center>
        <Card className="mx-auto w-full max-w-sm">
          <CardHeader className="space-y-3 pb-4">
            <ShieldCheck className="size-6 shrink-0 text-gold" aria-hidden="true" />
            <div className="space-y-1.5">
              <CardTitle className="text-lg">Verify your identity to list</CardTitle>
              <CardDescription>
                Listing requires an approved payout account, so buyers always
                know who they are dealing with and can pay you directly. You
                can still buy and trade without verifying.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">
            Verifying is provider-approved payout onboarding on your profile -
            once approved, come back here to list.
          </CardContent>
          <CardFooter className="pt-2">
            <Button asChild className="w-full">
              <Link href="/profile#payouts">Verify identity</Link>
            </Button>
          </CardFooter>
        </Card>
      </MarketplaceShell>
    );
  }

  return (
    <MarketplaceShell title="Sell an Item" contentWidth="full">
      <ItemForm mode="create" />
    </MarketplaceShell>
  );
}
