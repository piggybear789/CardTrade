// app/profile/page.tsx
//
// Account settings — two tabs (Profile / Payments).
// Layout: section title + description on the left, content on the right.
// Reference: Ofspace-style settings with clear section dividers.

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

/** A settings section: fixed-width label left, content right, all left-aligned. */
function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b py-7 last:border-b-0 sm:flex-row sm:gap-0">
      <div className="w-full shrink-0 sm:w-56">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="min-w-0 max-w-lg">{children}</div>
    </div>
  );
}

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
        <div>
          {/* Profile Details */}
          <SettingsRow
            title="Profile Details"
            description="Your public identity on NoDitto. Other traders see your name and avatar."
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
              <AvatarUploadField
                avatarPath={profile.avatar_path}
                displayName={profile.display_name}
                hideHint
              />
              <div className="min-w-0 flex-1 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Display Name</label>
                    <p className="mt-1 rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                      {profile.display_name}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Email</label>
                    <p className="mt-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                      {profile.contact_email}
                    </p>
                  </div>
                </div>
                <EditProfileDialog
                  avatarPath={profile.avatar_path}
                  displayName={profile.display_name}
                  contactEmail={profile.contact_email}
                />
              </div>
            </div>
          </SettingsRow>

          {/* Bio */}
          <SettingsRow
            title="About"
            description="A short bio shown on your public seller profile."
          >
            <ProfileBioEditor initialBio={(profile.bio as string | null) ?? ''} />
          </SettingsRow>

          {/* Social Links */}
          <SettingsRow
            title="Social Links"
            description="Link your socials so other traders can find you."
          >
            <SocialLinksEditor initialLinks={(profile.social_links as Record<string, string> | null) ?? null} />
          </SettingsRow>

          {/* Identity */}
          <SettingsRow
            title="Identity Verification"
            description="Photo ID + selfie via Stripe. Required to list, sell, or trade."
          >
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
          </SettingsRow>

          {/* Region */}
          <SettingsRow
            title="Trading Region"
            description="The region your contracts are scoped to."
          >
            {profile.region_code ? (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                {profile.region_code}
              </p>
            ) : (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No region set. Complete onboarding to set your trading region.
              </p>
            )}
          </SettingsRow>
        </div>
      ) : (
        /* PAYMENTS TAB */
        <div>
          {/* Payment Method */}
          <SettingsRow
            title="Payment Method"
            description="Card on file for purchases and trade collateral holds. Details stay with Stripe."
          >
            {paymentMethod?.hasPaymentMethod ? (
              <div className="space-y-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Card</label>
                    <p className="mt-1 rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium">
                      {paymentMethod.label ?? 'Card saved'}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Used for</label>
                    <p className="mt-1 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                      Purchases & collateral
                    </p>
                  </div>
                </div>
                <AddPaymentMethodDialog
                  trigger={
                    <Button type="button" variant="outline" size="sm">
                      <CreditCard className="size-4" aria-hidden />
                      Replace card
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="space-y-3">
                <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  No card saved yet. Add one to make purchases or enter trade escrow.
                </p>
                <AddPaymentMethodDialog
                  trigger={
                    <Button type="button" variant="outline" size="sm">
                      <CreditCard className="size-4" aria-hidden />
                      Add card
                    </Button>
                  }
                />
              </div>
            )}
          </SettingsRow>

          {/* Payout Account */}
          <SettingsRow
            title="Payout Account"
            description="Where your sale proceeds are sent. Connected via Stripe."
          >
            {payoutContext.ok ? (
              <PayoutOnboarding context={payoutContext.data} />
            ) : (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                Payout setup unavailable.
              </p>
            )}
          </SettingsRow>

          {/* Payout History */}
          <SettingsRow
            title="Payout History"
            description="Your settled and pending payouts."
          >
            {payoutDashboard.ok ? (
              <PayoutsDashboard
                model={payoutDashboard.data.model}
                destination={payoutDashboard.data.destination}
                scope={scope}
              />
            ) : (
              <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                No payout history yet. Complete a sale to see your first payout here.
              </p>
            )}
          </SettingsRow>
        </div>
      )}
    </MarketplaceShell>
  );
}
