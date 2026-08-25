// app/profile/page.tsx
//
// Account settings — three tabs: Profile, Verification, Payouts.
//
//   Profile       who you are to other members: picture, name, bio, socials, and the
//                 card you BUY with.
//   Verification  the two sequential gates, in order: Stripe Identity (unlocks
//                 listing/selling/trading) then Stripe Connect (unlocks being PAID),
//                 plus the trading region those contracts are scoped to.
//   Payouts       what you are owed and what has landed.
//
// WHY CONNECT LIVES UNDER VERIFICATION. `product.md` defines verification as TWO
// SEQUENTIAL STEPS — the Identity_Gate and then payout setup — so putting Connect
// beside the identity check is what makes the ordering legible. The Payouts tab is
// deliberately left as reporting only; it never hosts onboarding, which is what kept
// the old two-page split competing over the same card.
//
// Visual language comes from `components/account/SettingsPrimitives.tsx` — see the
// note there on why the reference's dark classes are translated rather than copied.

import { redirect } from 'next/navigation';
import {
  Clock,
  CreditCard,
  ScaleIcon,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { getPayoutSetupContext } from '@/lib/actions/merchant';
import { getPayoutsDashboard } from '@/lib/actions/payouts';
import { getIdentityCheckState } from '@/lib/actions/identity';
import { isPaymentDemoEnabled } from '@/domain/services';
import { formatAud } from '@/lib/format';
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
import {
  SectionLabel,
  SettingsPlaceholder,
  SettingsRow,
  SettingsSection,
  StatTile,
  StatusPill,
} from '@/components/account/SettingsPrimitives';
import { Button } from '@/components/ui/button';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { EmptyState } from '@/components/ui/empty-state';
import { resolveScope } from '@/components/layout/SectionFilter';

export const metadata = { title: 'Settings · NoDitto' };
export const dynamic = 'force-dynamic';

/** The tabs this page renders. Anything else falls back to Profile. */
type SettingsTab = 'profile' | 'verification' | 'payouts';

function resolveTab(raw: string | undefined): SettingsTab {
  if (raw === 'verification' || raw === 'payouts') return raw;
  return 'profile';
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[]; tab?: string }>;
}) {
  const { show, tab } = await searchParams;
  const scope = resolveScope(show);
  const activeTab = resolveTab(tab);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?redirectTo=/profile');

  const [profileResult, paymentMethodResult, identity, payoutContext, payoutDashboard] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('display_name, contact_email, avatar_path, social_links, bio')
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
          description="We could not load your account details. Reload to try again."
          action={{ label: 'Try again', href: '/profile' }}
          compact
        />
      </MarketplaceShell>
    );
  }

  const paymentMethod = paymentMethodResult.ok ? paymentMethodResult.data : null;
  const paymentDemoEnabled = isPaymentDemoEnabled();
  const hasCard = Boolean(paymentMethod?.hasPaymentMethod);

  const identityStatus = identity.ok ? identity.data.status : null;
  const identityVerified = identityStatus === 'VERIFIED';

  // Payout readiness reads BOTH columns, matching `canReceiveFunds`: an approved
  // account whose transfers are still inactive is an unfinished setup, not a
  // finished one. See the note in `PayoutOnboarding`.
  const merchantState = payoutContext.ok ? payoutContext.data.state : null;
  const payoutsActive = Boolean(
    merchantState?.merchantStatus === 'APPROVED' && merchantState?.settlementsEnabled,
  );

  const socialLinks = (profile.social_links as Record<string, string> | null) ?? null;

  return (
    <MarketplaceShell title="Settings">
      {/* Reconciles a return from Stripe's hosted identity flow. Renders nothing. */}
      <IdentityReturnRefresh />

      {/* ONE CENTRED COLUMN for the whole surface — heading, tabs and content.
          `mx-auto` centres the COLUMN; text inside it stays left-aligned. Capping
          the width matters on a settings form: measured across a full desktop
          viewport, a short label sits at one edge and its control at the other.
          The heading and tabs share the column so all three left edges line up. */}
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-snug md:mb-group">
          <h2 className="text-subhead font-semibold tracking-[-0.02em] md:text-head">Settings</h2>
        </header>

        <AccountTabs activeTab={activeTab} />

        {activeTab === 'profile' ? (
          <div className="space-y-5 md:space-y-8">
            {/* Picture + identity fields. The avatar saves on pick, so there is no
                form-submit step to coordinate here.
                `items-start` + a matching top offset on the avatar: the avatar and the
                first eyebrow label must share a top edge, which centring broke — a
                64px circle beside two stacked fields centres itself against their
                combined height and floats below the label it belongs to. */}
            <div className="rounded-xl border bg-card p-group">
              <div className="flex flex-col gap-group">
                <div className="flex items-start gap-group">
                  <AvatarUploadField
                    avatarPath={profile.avatar_path}
                    displayName={profile.display_name}
                    hideHint
                    compact
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div>
                      <SectionLabel>Display name</SectionLabel>
                      <p className="mt-1 truncate text-lead font-semibold">
                        {profile.display_name}
                      </p>
                    </div>
                    <div>
                      <SectionLabel>Email</SectionLabel>
                      <p className="mt-1 truncate text-body text-muted-foreground">
                        {profile.contact_email}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {identityVerified ? (
                    <StatusPill tone="verified" icon={ShieldCheck}>
                      Verified
                    </StatusPill>
                  ) : null}
                  <EditProfileDialog
                    avatarPath={profile.avatar_path}
                    displayName={profile.display_name}
                    contactEmail={profile.contact_email}
                  />
                </div>
              </div>
            </div>

            <SettingsSection
              label="About"
            >
              <ProfileBioEditor initialBio={(profile.bio as string | null) ?? ''} />
            </SettingsSection>

            <SettingsSection
              label="Links"
              description="Shown on your public profile. Usernames for socials; a full https link for your store."
            >
              <SocialLinksEditor initialLinks={socialLinks} />
            </SettingsSection>

            <SettingsSection
              label="Payment method"
            >
              {hasCard ? (
                <SettingsRow
                  icon={CreditCard}
                  inverse
                  title={paymentMethod?.label ?? 'Card saved with Stripe'}
                  subtitle={
                    paymentMethod?.expiry
                      ? `Expires ${paymentMethod.expiry}`
                      : null
                  }
                  trailing={
                    <AddPaymentMethodDialog
                      trigger={
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-body font-medium text-parchment no-underline hover:text-parchment hover:underline"
                        >
                          Replace
                        </Button>
                      }
                    />
                  }
                />
              ) : (
                <SettingsPlaceholder
                  action={
                    <AddPaymentMethodDialog
                      trigger={
                        <Button type="button" variant="outline" size="sm">
                          <CreditCard aria-hidden />
                          Add card
                        </Button>
                      }
                    />
                  }
                >
                  Required to buy or back a trade.
                </SettingsPlaceholder>
              )}
            </SettingsSection>
          </div>
        ) : null}

        {activeTab === 'verification' ? (
          <div className="space-y-6">
            {/* Identity and payout setup only. The member summary (avatar, name,
                ratings, region) already lives on the Profile tab — repeating it
                here made Verification look like a second profile page. */}
            {identityVerified && payoutsActive ? (
              <SettingsRow
                icon={ShieldCheck}
                title="You're set up"
                subtitle="Identity verified and payouts are active."
              />
            ) : null}

            {!identityVerified ? (
              <SettingsSection
                label="Identity"
              >
                {identity.ok ? (
                  <IdentityCheckCard
                    status={identity.data.status}
                    verifiedName={identity.data.verifiedName}
                    returnPath="/profile?tab=verification"
                  />
                ) : (
                  <SettingsPlaceholder>
                    Verification status is unavailable right now. Reload to try again.
                  </SettingsPlaceholder>
                )}
                {paymentDemoEnabled && identity.ok ? (
                  <IdentityDemoControls />
                ) : null}
              </SettingsSection>
            ) : null}

            {!payoutsActive ? (
              <SettingsSection
                label="Payout account"
              >
                {payoutContext.ok ? (
                  <PayoutOnboarding context={payoutContext.data} />
                ) : (
                  <SettingsPlaceholder>
                    Payout setup is unavailable right now. Reload to try again.
                  </SettingsPlaceholder>
                )}
              </SettingsSection>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'payouts' ? (
          <div className="space-y-5 md:space-y-8">
            {/* Real figures from the payout read model — the three buckets are a
                strict partition, so these never double-count a sale. */}
            {payoutDashboard.ok ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile
                  label="Owed to you"
                  value={formatAud(payoutDashboard.data.model.releasingNowCents)}
                  sub={
                    payoutDashboard.data.model.hasBlockedRelease
                      ? 'Part of this is held up'
                      : 'Released automatically'
                  }
                  icon={Wallet}
                  tone={
                    payoutDashboard.data.model.hasBlockedRelease ? 'pending' : 'verified'
                  }
                />
                <StatTile
                  label="Held for open sales"
                  value={formatAud(payoutDashboard.data.model.upcomingProceedsCents)}
                  sub="Collected, not yet complete"
                  icon={Clock}
                  tone="neutral"
                />
                <StatTile
                  label="Under dispute"
                  value={formatAud(payoutDashboard.data.model.atRiskProceedsCents)}
                  sub="Outcome not yet decided"
                  icon={ScaleIcon}
                  tone={
                    payoutDashboard.data.model.atRiskProceedsCents > 0
                      ? 'pending'
                      : 'neutral'
                  }
                />
              </div>
            ) : null}

            {payoutDashboard.ok ? (
              <PayoutsDashboard
                model={payoutDashboard.data.model}
                destination={payoutDashboard.data.destination}
                scope={scope}
              />
            ) : (
              <SettingsPlaceholder>
                Payout information is unavailable right now. Reload to try again.
              </SettingsPlaceholder>
            )}
          </div>
        ) : null}
      </div>
    </MarketplaceShell>
  );
}
