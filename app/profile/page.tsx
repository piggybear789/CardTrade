// app/profile/page.tsx
//
// Account settings — three tabs: Profile, Verification, Payouts.
//
// Profile: edit your public-facing info (name, email, bio, avatar, socials, card)
// Verification: identity check (Stripe Identity) + payout setup (Stripe Connect)
// Payouts: payout history + balance

import { redirect } from 'next/navigation';
import { CreditCard } from 'lucide-react';

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
  const activeTab = tab === 'verification' ? 'verification' : tab === 'payouts' ? 'payouts' : 'profile';

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

      {/* ═══════════ PROFILE TAB ═══════════ */}
      {activeTab === 'profile' ? (
        <div className="space-y-10">
          {/* Avatar + Name + Email — the core identity fields */}
          <section className="grid gap-8 sm:grid-cols-[auto_1fr]">
            <AvatarUploadField
              avatarPath={profile.avatar_path}
              displayName={profile.display_name}
              hideHint
            />
            <div className="space-y-5">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Display Name</label>
                <div className="mt-1 flex items-center gap-3">
                  <p className="text-lg font-semibold">{profile.display_name}</p>
                  <EditProfileDialog
                    avatarPath={profile.avatar_path}
                    displayName={profile.display_name}
                    contactEmail={profile.contact_email}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</label>
                <p className="mt-1 text-sm text-muted-foreground">{profile.contact_email}</p>
              </div>
            </div>
          </section>

          <hr />

          {/* Bio */}
          <section>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">About</label>
            <div className="mt-2">
              <ProfileBioEditor initialBio={(profile.bio as string | null) ?? ''} />
            </div>
          </section>

          <hr />

          {/* Social Links */}
          <section>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Social Links</label>
            <p className="mt-1 text-xs text-muted-foreground">Visible on your seller profile and in contract rooms.</p>
            <div className="mt-3">
              <SocialLinksEditor initialLinks={(profile.social_links as Record<string, string> | null) ?? null} />
            </div>
          </section>

          <hr />

          {/* Payment Method */}
          <section>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payment Method</label>
            <p className="mt-1 text-xs text-muted-foreground">For purchases and trade collateral holds.</p>
            <div className="mt-3">
              {paymentMethod?.hasPaymentMethod ? (
                <div className="flex items-center gap-3">
                  <CreditCard className="size-5 text-muted-foreground" aria-hidden />
                  <span className="text-sm font-medium">{paymentMethod.label ?? 'Card saved'}</span>
                  <AddPaymentMethodDialog
                    trigger={<Button type="button" variant="ghost" size="sm">Replace</Button>}
                  />
                </div>
              ) : (
                <AddPaymentMethodDialog
                  trigger={
                    <Button type="button" variant="outline" size="sm">
                      <CreditCard className="size-4" aria-hidden />
                      Add card
                    </Button>
                  }
                />
              )}
            </div>
          </section>
        </div>
      ) : null}

      {/* ═══════════ VERIFICATION TAB ═══════════ */}
      {activeTab === 'verification' ? (
        <div className="space-y-10">
          {/* Identity */}
          <section>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Identity Verification</label>
            <p className="mt-1 text-xs text-muted-foreground">Photo ID + selfie via Stripe. Required to list, sell, or trade.</p>
            <div className="mt-4">
              {identity.ok ? (
                <IdentityCheckCard
                  status={identity.data.status}
                  verifiedName={identity.data.verifiedName}
                  returnPath="/profile?tab=verification"
                />
              ) : (
                <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  Verification status unavailable.
                </div>
              )}
              {paymentDemoEnabled && identity.ok && identity.data.status !== 'VERIFIED' ? (
                <div className="mt-4">
                  <IdentityDemoControls />
                </div>
              ) : null}
            </div>
          </section>

          <hr />

          {/* Stripe Connect (payout account setup) */}
          <section>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Payout Account</label>
            <p className="mt-1 text-xs text-muted-foreground">Connect your bank via Stripe to receive sale proceeds.</p>
            <div className="mt-4">
              {payoutContext.ok ? (
                <PayoutOnboarding context={payoutContext.data} />
              ) : (
                <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                  Payout setup unavailable.
                </div>
              )}
            </div>
          </section>

          <hr />

          {/* Trading Region */}
          <section>
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trading Region</label>
            <p className="mt-1 text-xs text-muted-foreground">The region your contracts are scoped to.</p>
            <div className="mt-3">
              {profile.region_code ? (
                <span className="inline-flex rounded-md border px-3 py-1.5 text-sm font-medium">
                  {profile.region_code}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">Not set — complete onboarding to configure.</span>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {/* ═══════════ PAYOUTS TAB ═══════════ */}
      {activeTab === 'payouts' ? (
        <div className="space-y-10">
          <section>
            {payoutDashboard.ok ? (
              <PayoutsDashboard
                model={payoutDashboard.data.model}
                destination={payoutDashboard.data.destination}
                scope={scope}
              />
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                No payout history yet. Complete a sale to see your first payout here.
              </div>
            )}
          </section>
        </div>
      ) : null}
    </MarketplaceShell>
  );
}
