// app/profile/page.tsx
//
// Account settings — two tabs.
//   Profile tab: looks like YOUR profile page (preview of what others see + edit controls)
//   Payments tab: clean settings rows for card + payouts
//
// Profile = visual, Payments = functional.

import { redirect } from 'next/navigation';
import { CreditCard, MapPin, ShieldCheck } from 'lucide-react';

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
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { EmptyState } from '@/components/ui/empty-state';
import { resolveScope } from '@/components/layout/SectionFilter';

export const metadata = { title: 'Settings · NoDitto' };
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
      <MarketplaceShell title="Settings" center>
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

  return (
    <MarketplaceShell title="Settings">
      <IdentityReturnRefresh />

      <div className="mb-2">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account settings and preferences.
        </p>
      </div>

      <AccountTabs activeTab={activeTab} />

      {activeTab === 'profile' ? (
        <div className="max-w-2xl space-y-8">
          {/* PROFILE CARD — preview of what others see */}
          <section className="overflow-hidden rounded-xl border">
            {/* Banner area */}
            <div className="h-20 bg-gradient-to-r from-gold/20 via-gold/10 to-transparent" />

            {/* Avatar + info */}
            <div className="px-6 pb-6">
              <div className="-mt-10 flex items-end gap-4">
                <div className="rounded-full border-4 border-card bg-card">
                  <AvatarUploadField
                    avatarPath={profile.avatar_path}
                    displayName={profile.display_name}
                    hideHint
                  />
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-3 pb-1">
                  <h2 className="truncate text-xl font-semibold">{profile.display_name}</h2>
                  {identityDone ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-trust/10 px-2 py-0.5 text-xs font-medium text-trust">
                      <ShieldCheck className="size-3" aria-hidden />
                      Verified
                    </span>
                  ) : null}
                </div>
                <EditProfileDialog
                  avatarPath={profile.avatar_path}
                  displayName={profile.display_name}
                  contactEmail={profile.contact_email}
                />
              </div>

              {/* Bio */}
              <div className="mt-4">
                <ProfileBioEditor initialBio={(profile.bio as string | null) ?? ''} />
              </div>

              {/* Meta row: email, region */}
              <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span>{profile.contact_email}</span>
                {profile.region_code ? (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5" aria-hidden />
                    {profile.region_code}
                  </span>
                ) : null}
              </div>
            </div>
          </section>

          {/* SOCIAL LINKS */}
          <section>
            <h3 className="mb-3 text-sm font-semibold">Social Links</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Visible on your seller profile and in contract rooms.
            </p>
            <SocialLinksEditor initialLinks={(profile.social_links as Record<string, string> | null) ?? null} />
          </section>

          {/* IDENTITY VERIFICATION */}
          <section>
            <h3 className="mb-3 text-sm font-semibold">Identity Verification</h3>
            {identity.ok ? (
              <IdentityCheckCard
                status={identity.data.status}
                verifiedName={identity.data.verifiedName}
                returnPath="/profile"
              />
            ) : (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                Verification status unavailable.
              </p>
            )}
            {paymentDemoEnabled && identity.ok && identity.data.status !== 'VERIFIED' ? (
              <div className="mt-3">
                <IdentityDemoControls />
              </div>
            ) : null}
          </section>
        </div>
      ) : (
        /* PAYMENTS TAB — clean settings rows */
        <div className="max-w-2xl">
          {/* Payment Method */}
          <div className="border-b py-7">
            <h3 className="text-sm font-semibold">Payment Method</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Card on file for purchases and trade collateral holds.
            </p>
            <div className="mt-4">
              {paymentMethod?.hasPaymentMethod ? (
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div className="flex items-center gap-3">
                    <CreditCard className="size-5 text-muted-foreground" aria-hidden />
                    <span className="text-sm font-medium">{paymentMethod.label ?? 'Card saved'}</span>
                  </div>
                  <AddPaymentMethodDialog
                    trigger={
                      <Button type="button" variant="ghost" size="sm">
                        Replace
                      </Button>
                    }
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-dashed px-4 py-4">
                  <span className="text-sm text-muted-foreground">No card saved yet</span>
                  <AddPaymentMethodDialog
                    trigger={
                      <Button type="button" variant="outline" size="sm">
                        Add card
                      </Button>
                    }
                  />
                </div>
              )}
            </div>
          </div>

          {/* Payout Account */}
          <div className="border-b py-7">
            <h3 className="text-sm font-semibold">Payout Account</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Where your sale proceeds are sent. Connected via Stripe.
            </p>
            <div className="mt-4">
              {payoutContext.ok ? (
                <PayoutOnboarding context={payoutContext.data} />
              ) : (
                <p className="rounded-lg border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
                  Payout setup unavailable.
                </p>
              )}
            </div>
          </div>

          {/* Payout History */}
          <div className="py-7">
            <h3 className="text-sm font-semibold">Payout History</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Your settled and pending payouts.
            </p>
            <div className="mt-4">
              {payoutDashboard.ok ? (
                <PayoutsDashboard
                  model={payoutDashboard.data.model}
                  destination={payoutDashboard.data.destination}
                  scope={scope}
                />
              ) : (
                <p className="rounded-lg border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">
                  No payout history yet. Complete a sale to see your first payout here.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </MarketplaceShell>
  );
}
