// app/profile/page.tsx
//
// Compact personal-account surface. Stripe Connect setup and money movement live
// exclusively on /profile/payouts so this page does not duplicate payout UI.

import { redirect } from 'next/navigation';
import { CreditCard } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { AccountTabs } from '@/components/account/AccountTabs';
import { EditProfileDialog } from '@/components/profile/EditProfileDialog';
import { AddPaymentMethodDialog } from '@/components/payments/AddPaymentMethodDialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader } from '@/components/layout/SectionHeader';
import { EmptyState } from '@/components/ui/empty-state';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/sign-in?redirectTo=/profile');
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('display_name, contact_email')
    .eq('id', user.id)
    .single();

  if (error || !profile) {
    return (
      <MarketplaceShell title="Profile" center>
        <EmptyState
          title="Profile unavailable"
          description="We could not load your account details. Reload to try again."
          action={{ label: 'Try again', href: '/profile' }}
          compact
        />
      </MarketplaceShell>
    );
  }

  const paymentMethodResult = await getPaymentMethodStatus();
  const paymentMethod = paymentMethodResult.ok ? paymentMethodResult.data : null;

  return (
    <MarketplaceShell title="Profile">
      <SectionHeader
        title="Profile"
        description="Your public name, contact details, and payment method."
      />
      <AccountTabs />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Your details</CardTitle>
            <CardDescription>What other members see when they trade with you.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Display name
                </dt>
                <dd className="mt-1 truncate text-sm font-semibold">{profile.display_name}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Contact email
                </dt>
                <dd className="mt-1 truncate text-sm font-semibold">{profile.contact_email}</dd>
              </div>
            </dl>
            <EditProfileDialog
              displayName={profile.display_name}
              contactEmail={profile.contact_email}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Card for Buying & Trade Holds</CardTitle>
            <CardDescription>
              Used for purchases and temporary trade collateral holds. Card details stay with Stripe.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {paymentMethod?.hasPaymentMethod ? (
              <div className="aspect-[1.586/1] w-full max-w-xs rounded-2xl bg-foreground p-5 text-background shadow-sm">
                <div className="flex items-start justify-between">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-70">NoDitto</p>
                  <CreditCard className="size-5 opacity-80" aria-hidden />
                </div>
                <div className="mt-8 h-7 w-10 rounded-md bg-background/20" aria-hidden />
                <div className="mt-6">
                  <p className="text-xs uppercase tracking-wide opacity-60">Purchases & collateral</p>
                  <p className="mt-1 truncate text-base font-semibold tracking-wide">
                    {paymentMethod.label ?? 'Card saved with Stripe'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="rounded-md border border-dashed bg-card p-3 text-sm text-muted-foreground">
                No purchase or collateral card saved yet.
              </p>
            )}

            <AddPaymentMethodDialog
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <CreditCard aria-hidden />
                  {paymentMethod?.hasPaymentMethod ? 'Replace card' : 'Add card'}
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    </MarketplaceShell>
  );
}
