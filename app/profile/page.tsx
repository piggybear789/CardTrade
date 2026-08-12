// app/profile/page.tsx
//
// Unified account surface (Option B): header strip, readiness widget, stacked
// cards. Merges the former /profile and /profile/payouts into a single page so
// a member never has to hunt across tabs for their own settings.

import { redirect } from 'next/navigation';
import { CreditCard, ShieldCheck, Wallet } from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { getPayoutSetupContext } from '@/lib/actions/merchant';
import { getPayoutsDashboard } from '@/lib/actions/payouts';
import { getIdentityCheckState } from '@/lib/actions/identity';
import { isPaymentDemoEnabled } from '@/domain/services';
import { IdentityCheckCard } from '@/components/identity/IdentityCheckCard';
import { IdentityDemoControls } from '@/components/identity/IdentityDemoControls';
import { IdentityReturnRefresh } from '@/components/identity/IdentityReturnRefresh';
import { PayoutOnboarding } from '@/components/profile/PayoutOnboarding';
import { PayoutsDashboard } from '@/components/payouts/PayoutsDashboard';
import { EditProfileDialog } from '@/components/profile/EditProfileDialog';
import { AvatarUploadField } from '@/components/profile/AvatarUploadField';
import { AddPaymentMethodDialog } from '@/components/payments/AddPaymentMethodDialog';
import { SocialLinksDisplay } from '@/components/profile/SocialLinksDisplay';
import { SocialLinksEditor } from '@/components/profile/SocialLinksEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader } from '@/components/layout/SectionHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { resolveScope } from '@/components/layout/SectionFilter';

export const metadata = { title: 'Account · NoDitto' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { show } = await searchParams;
  const scope = resolveScope(show);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?redirectTo=/profile');

  const [profileResult, paymentMethodResult, identity, payoutContext, payoutDashboard] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, contact_email, avatar_path, region_code')
      .eq('id', user.id)
      .single(),
    getPaymentMethodStatus(),
    getIdentityCheckState(),
    getPayoutSetupContext(),
    getPayoutsDashboard(),
  ]);

  // social_links column may not exist until migration 0085 is applied.
  // Query separately so its absence doesn't break the entire page.
  const { data: socialRow } = await supabase
    .from('profiles')
    .select('social_links')
    .eq('id', user.id)
    .maybeSingle()
    .then((res) => res)
    .catch(() => ({ data: null }));

  const profile = profileResult.data;
  if (!profile) {
    return (
      <MarketplaceShell title="Account" center>
        <EmptyState
          title="Profile unavailable"
          description="Could not load your account."
          action={{ label: 'Try again', href: '/profile' }}
          compact
        />
      </MarketplaceShell>
    );
  }

  const paymentMethod = paymentMethodResult.ok ? paymentMethodResult.data : null;
  const paymentDemoEnabled = isPaymentDemoEnabled();

  const identityDone = identity.ok && identity.data.status === 'VERIFIED';
  const paymentDone = Boolean(paymentMethod?.hasPaymentMethod);
  const payoutDone = payoutContext.ok && payoutContext.data.state.merchantStatus === 'APPROVED';

  return (
    <MarketplaceShell title="Account">
      <IdentityReturnRefresh />
      <SectionHeader
        title="Account"
        description="Your profile, verification, and payment settings."
      />

      {/* HEADER STRIP */}
      <div className="mb-6 flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:gap-6">
        <AvatarUploadField
          avatarPath={profile.avatar_path}
          displayName={profile.display_name}
          hideHint
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold">{profile.display_name}</h2>
            <EditProfileDialog
              avatarPath={profile.avatar_path}
              displayName={profile.display_name}
              contactEmail={profile.contact_email}
            />
          </div>
          <p className="text-sm text-muted-foreground">{profile.contact_email}</p>
          {profile.region_code ? (
            <p className="text-xs text-muted-foreground">Region: {profile.region_code}</p>
          ) : null}
          <SocialLinksDisplay socialLinks={socialRow?.social_links as Record<string, string> | null} compact />
        </div>
      </div>

      {/* READINESS WIDGET */}
      <Card className="mb-6 border-gold/20 bg-gold/[0.03]">
        <CardContent className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Ready to trade?</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <ShieldCheck
                className={`size-5 ${identityDone ? 'text-trust' : 'text-muted-foreground'}`}
                aria-hidden
              />
              <div>
                <p className="text-sm font-medium">Identity</p>
                <p className="text-xs text-muted-foreground">
                  {identityDone ? 'Verified' : 'Not verified'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CreditCard
                className={`size-5 ${paymentDone ? 'text-trust' : 'text-muted-foreground'}`}
                aria-hidden
              />
              <div>
                <p className="text-sm font-medium">Payment</p>
                <p className="text-xs text-muted-foreground">
                  {paymentDone ? 'Card saved' : 'No card'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Wallet
                className={`size-5 ${payoutDone ? 'text-trust' : 'text-muted-foreground'}`}
                aria-hidden
              />
              <div>
                <p className="text-sm font-medium">Payouts</p>
                <p className="text-xs text-muted-foreground">
                  {payoutDone ? 'Connected' : 'Not set up'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* STACKED CARDS */}
      <div className="space-y-5">
        {/* Social Links */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Social Links</CardTitle>
          </CardHeader>
          <CardContent>
            <SocialLinksEditor initialLinks={socialRow?.social_links as Record<string, string> | null} />
          </CardContent>
        </Card>

        {/* Payment Method */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Payment Method</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {paymentMethod?.hasPaymentMethod ? (
              <p className="text-sm">
                <span className="font-medium">
                  {paymentMethod.label ?? 'Card saved'}
                </span>{' '}
                <span className="text-muted-foreground">
                  — for purchases and trade collateral
                </span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No card saved yet. Required for purchases and trade collateral.
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

        {/* Identity Verification */}
        {identity.ok ? (
          <IdentityCheckCard
            status={identity.data.status}
            verifiedName={identity.data.verifiedName}
            returnPath="/profile"
          />
        ) : null}

        {paymentDemoEnabled && identity.ok && identity.data.status !== 'VERIFIED' ? (
          <IdentityDemoControls />
        ) : null}

        {/* Payout Account */}
        {payoutContext.ok ? (
          <PayoutOnboarding context={payoutContext.data} />
        ) : null}

        {/* Payout History */}
        {payoutDashboard.ok ? (
          <PayoutsDashboard
            model={payoutDashboard.data.model}
            destination={payoutDashboard.data.destination}
            scope={scope}
          />
        ) : null}
      </div>
    </MarketplaceShell>
  );
}
