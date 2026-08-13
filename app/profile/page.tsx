// app/profile/page.tsx
//
// Account settings — Option C: two tabs.
//   Tab 1 (Profile): avatar, name, bio, socials, identity verification, region
//   Tab 2 (Payments): payment method (card), payout account (Connect), payout history
//
// Discord-style: clean rows, generous spacing, grouped by purpose.

import { redirect } from 'next/navigation';

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
import { SocialLinksEditor } from '@/components/profile/SocialLinksEditor';
import { ProfileBioEditor } from '@/components/profile/ProfileBioEditor';
import { AccountTabs } from '@/components/account/AccountTabs';
import { Button } from '@/components/ui/button';
import { CreditCard } from 'lucide-react';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SectionHeader } from '@/components/layout/SectionHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { resolveScope } from '@/components/layout/SectionFilter';

export const metadata = { title: 'Account · NoDitto' };
export const dynamic = 'force-dynamic';

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[]; tab?: string }>;
}) {
  const { show, tab } = await searchParams;
  const scope = resolveScope(show);
  const activeTab = tab === 'payments' ? 'payments' : 'profile';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?redirectTo=/profile');

  const [profileResult, paymentMethodResult, identity, payoutContext, payoutDashboard] = await Promise.all([
    supabase
      .from('profiles')
      .select('display_name, contact_email, avatar_path, region_code, social_links, bio')
      .eq('id', user.id)
      .single(),
    getPaymentMethodStatus(),
    getIdentityCheckState(),
    getPayoutSetupContext(),
    getPayoutsDashboard(),
  ]);

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

  return (
    <MarketplaceShell title="Account">
      <IdentityReturnRefresh />
      <SectionHeader title="Account" />
      <AccountTabs activeTab={activeTab} />

      {activeTab === 'profile' ? (
        <div className="space-y-8">
          {/* PROFILE SECTION — Discord style: avatar + fields side by side */}
          <section className="rounded-xl border bg-card p-6">
            <div className="flex flex-col gap-6 sm:flex-row">
              {/* Avatar column */}
              <div className="flex flex-col items-center gap-2">
                <AvatarUploadField
                  avatarPath={profile.avatar_path}
                  displayName={profile.display_name}
                  hideHint
                />
              </div>

              {/* Fields column */}
              <div className="min-w-0 flex-1 space-y-5">
                {/* Display name + email */}
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Display Name</label>
                    <p className="text-lg font-semibold">{profile.display_name}</p>
                  </div>
                  <div className="space-y-1 text-right sm:text-left">
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</label>
                    <p className="text-sm">{profile.contact_email}</p>
                  </div>
                  <EditProfileDialog
                    avatarPath={profile.avatar_path}
                    displayName={profile.display_name}
                    contactEmail={profile.contact_email}
                  />
                </div>

                {/* Bio */}
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">About</label>
                  <div className="mt-1">
                    <ProfileBioEditor initialBio={(profile.bio as string | null) ?? ''} />
                  </div>
                </div>

                {/* Region */}
                {profile.region_code ? (
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trading Region</label>
                    <p className="mt-1 text-sm">{profile.region_code}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          {/* SOCIAL LINKS */}
          <section className="rounded-xl border bg-card p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Social Links</h3>
            <SocialLinksEditor initialLinks={(profile.social_links as Record<string, string> | null) ?? null} />
          </section>

          {/* IDENTITY VERIFICATION */}
          <section>
            {identity.ok ? (
              <IdentityCheckCard
                status={identity.data.status}
                verifiedName={identity.data.verifiedName}
                returnPath="/profile"
              />
            ) : null}
            {paymentDemoEnabled && identity.ok && identity.data.status !== 'VERIFIED' ? (
              <div className="mt-3">
                <IdentityDemoControls />
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        /* PAYMENTS TAB */
        <div className="space-y-8">
          {/* PAYMENT METHOD */}
          <section className="rounded-xl border bg-card p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Payment Method</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Card on file for purchases and trade collateral holds. Card details stay with Stripe.
            </p>
            {paymentMethod?.hasPaymentMethod ? (
              <p className="mb-4 text-base font-medium">
                {paymentMethod.label ?? 'Card saved with Stripe'}
              </p>
            ) : (
              <p className="mb-4 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No card saved yet.
              </p>
            )}
            <AddPaymentMethodDialog
              trigger={
                <Button type="button" variant="outline" size="sm">
                  <CreditCard className="size-4" aria-hidden />
                  {paymentMethod?.hasPaymentMethod ? 'Replace card' : 'Add card'}
                </Button>
              }
            />
          </section>

          {/* PAYOUT ACCOUNT */}
          <section className="rounded-xl border bg-card p-6">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Payout Account</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Where your sale proceeds are sent. Set up via Stripe Connect.
            </p>
            {payoutContext.ok ? (
              <PayoutOnboarding context={payoutContext.data} />
            ) : null}
          </section>

          {/* PAYOUT HISTORY */}
          {payoutDashboard.ok ? (
            <PayoutsDashboard
              model={payoutDashboard.data.model}
              destination={payoutDashboard.data.destination}
              scope={scope}
            />
          ) : null}
        </div>
      )}
    </MarketplaceShell>
  );
}
