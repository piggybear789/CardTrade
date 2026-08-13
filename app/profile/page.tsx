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
  AlertCircle,
  Banknote,
  CheckCircle2,
  Clock,
  CreditCard,
  Globe,
  ScaleIcon,
  ShieldCheck,
  Wallet,
  Zap,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/server';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { getPayoutSetupContext } from '@/lib/actions/merchant';
import { getPayoutsDashboard } from '@/lib/actions/payouts';
import { getIdentityCheckState } from '@/lib/actions/identity';
import { isPaymentDemoEnabled } from '@/domain/services';
import { regionLabel } from '@/domain/region';
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
  const regionCode = profile.region_code as string | null;

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
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your account settings and preferences.
          </p>
        </header>

        <AccountTabs activeTab={activeTab} />

        {activeTab === 'profile' ? (
          <div className="space-y-8">
            {/* Picture + identity fields. The avatar saves on pick, so there is no
                form-submit step to coordinate here. */}
            <div className="rounded-xl border bg-card p-5">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
                <AvatarUploadField
                  avatarPath={profile.avatar_path}
                  displayName={profile.display_name}
                  hideHint
                />
                <div className="min-w-0 flex-1 space-y-4">
                  <div>
                    <SectionLabel>Display name</SectionLabel>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{profile.display_name}</p>
                      {identityVerified ? (
                        <StatusPill tone="verified" icon={ShieldCheck}>
                          Verified
                        </StatusPill>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <SectionLabel>Email</SectionLabel>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {profile.contact_email}
                    </p>
                  </div>
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
              description="Shown on your public seller profile."
            >
              <ProfileBioEditor initialBio={(profile.bio as string | null) ?? ''} />
            </SettingsSection>

            <SettingsSection
              label="Social links"
              description="Visible on your seller profile and to the other party in a contract room."
            >
              <SocialLinksEditor initialLinks={socialLinks} />
            </SettingsSection>

            <SettingsSection
              label="Payment method"
              description="Used for purchases and for trade collateral holds. Card details stay with Stripe."
            >
              {hasCard ? (
                <SettingsRow
                  icon={CreditCard}
                  title={paymentMethod?.label ?? 'Card saved with Stripe'}
                  subtitle="Charged for purchases; authorised (not charged) for trade collateral."
                  trailing={
                    <AddPaymentMethodDialog
                      trigger={
                        <Button type="button" variant="outline" size="sm">
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
                  No card saved yet. One is required to buy or to enter trade escrow.
                </SettingsPlaceholder>
              )}
            </SettingsSection>
          </div>
        ) : null}

        {activeTab === 'verification' ? (
          <div className="space-y-8">
            {/* STEP ONE. Unlocks listing, selling and trade access on its own — it
                needs no bank details, which is why it comes first. */}
            <SettingsSection
              label="Step 1 · Identity"
              description="A photo ID and selfie check on Stripe's pages. Unlocks listing, selling, and entering trade escrow."
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
              {paymentDemoEnabled && identity.ok && !identityVerified ? (
                <IdentityDemoControls />
              ) : null}
            </SettingsSection>

            {/* STEP TWO. Gates being PAID and nothing else. Independent of step one
                in both directions — a verified member with no payout account is a
                normal, valid state (product.md), so this never blocks the page. */}
            <SettingsSection
              label="Step 2 · Payout account"
              description="Connect a bank through Stripe so sale proceeds can reach you. Not needed to buy, list, or trade."
            >
              {payoutContext.ok ? (
                <PayoutOnboarding context={payoutContext.data} />
              ) : (
                <SettingsPlaceholder>
                  Payout setup is unavailable right now. Reload to try again.
                </SettingsPlaceholder>
              )}
            </SettingsSection>

            <SettingsSection
              label="Trading region"
              description="Every contract you open is scoped to this region. It is fixed once a payout account exists, because Stripe fixes an account's country at creation."
            >
              {regionCode ? (
                <SettingsRow
                  icon={Globe}
                  title={regionLabel(regionCode)}
                  subtitle="Buyers and sellers must share a region to open a contract."
                  trailing={<StatusPill tone="neutral">{regionCode}</StatusPill>}
                />
              ) : (
                <SettingsPlaceholder>
                  No trading region set. Contracts are refused until one is recorded.
                </SettingsPlaceholder>
              )}
            </SettingsSection>
          </div>
        ) : null}

        {activeTab === 'payouts' ? (
          <div className="space-y-8">
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
                  label="Still in escrow"
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

            {/* Where the money lands. Reporting only — setup lives on the
                Verification tab so the two surfaces cannot compete. */}
            <SettingsSection
              label="Destination"
              description="Where releases are sent."
            >
              {payoutsActive ? (
                <SettingsRow
                  icon={Banknote}
                  tone="verified"
                  title="Connected through Stripe"
                  subtitle="Releases are sent automatically once a sale completes."
                  trailing={
                    <StatusPill tone="verified" icon={CheckCircle2}>
                      Active
                    </StatusPill>
                  }
                />
              ) : (
                <SettingsRow
                  icon={Zap}
                  tone="required"
                  title="No payout account yet"
                  subtitle="Proceeds are held for you until this is set up — nothing is lost in the meantime."
                  trailing={
                    <Button asChild variant="outline" size="sm">
                      <a href="/profile?tab=verification">Set up</a>
                    </Button>
                  }
                >
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    A payout attempt is refused until Stripe reports your account can
                    receive transfers. Your money stays held rather than being returned.
                  </p>
                </SettingsRow>
              )}
            </SettingsSection>

            <SettingsSection
              label="History"
              description="Every release, and the sales still working toward one."
            >
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
            </SettingsSection>
          </div>
        ) : null}
      </div>
    </MarketplaceShell>
  );
}
