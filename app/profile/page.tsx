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
  let socialLinks: Record<string, string> | null = null;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('social_links')
      .eq('id', user.id)
      .maybeSingle();
    socialLinks = (data?.social_links as Record<string, string> | null) ?? null;
  } catch {
    // Column doesn't exist yet — safe to ignore.
  }

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

      {/* HEADER — avatar + name + quick status */}
      <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <AvatarUploadField
          avatarPath={profile.avatar_path}
          displayName={profile.display_name}
          hideHint
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight">{profile.display_name}</h2>
            <EditProfileDialog
              avatarPath={profile.avatar_path}
              displayName={profile.display_name}
              contactEmail={profile.contact_email}
            />
          </div>
          <p className="text-sm text-muted-foreground">{profile.contact_email}</p>
          <SocialLinksDisplay socialLinks={socialLinks} compact />
          {/* Inline readiness badges */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${identityDone ? 'bg-trust/10 text-trust' : 'bg-muted text-muted-foreground'}`}>
              <ShieldCheck className="size-3" aria-hidden />
              {identityDone ? 'Verified' : 'Unverified'}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${paymentDone ? 'bg-trust/10 text-trust' : 'bg-muted text-muted-foreground'}`}>
              <CreditCard className="size-3" aria-hidden />
              {paymentDone ? 'Card saved' : 'No card'}
            </span>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${payoutDone ? 'bg-trust/10 text-trust' : 'bg-muted text-muted-foreground'}`}>
              <Wallet className="size-3" aria-hidden />
              {payoutDone ? 'Payouts active' : 'Payouts not set up'}
            </span>
          </div>
        </div>
      </div>

      {/* SETTINGS SECTIONS — each a bordered row, not a card */}
      <div className="divide-y rounded-xl border">
        {/* Social Links */}
        <details className="group" open>
          <summary className="flex cursor-pointer items-center justify-between px-5 py-4 text-sm font-semibold hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
            Social Links
            <span className="text-xs font-normal text-muted-foreground group-open:hidden">Edit</span>
          </summary>
          <div className="border-t px-5 pb-5 pt-3">
            <SocialLinksEditor initialLinks={socialLinks} />
          </div>
        </details>

        {/* Payment Method */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold">Payment Method</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {paymentMethod?.hasPaymentMethod
                ? `${paymentMethod.label ?? 'Card saved'} — purchases & collateral`
                : 'No card saved yet'}
            </p>
          </div>
          <AddPaymentMethodDialog
            trigger={
              <Button type="button" variant="outline" size="sm">
                {paymentMethod?.hasPaymentMethod ? 'Replace' : 'Add card'}
              </Button>
            }
          />
        </div>

        {/* Identity */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold">Identity Verification</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {identityDone
                ? `Verified as ${identity.ok ? identity.data.verifiedName ?? 'confirmed' : 'confirmed'}`
                : 'Required to list, sell, or trade'}
            </p>
          </div>
          {identity.ok && identity.data.status !== 'VERIFIED' ? (
            <Button type="button" variant="outline" size="sm" asChild>
              <a href="/profile#identity">Verify now</a>
            </Button>
          ) : (
            <span className="rounded-full bg-trust/10 px-2.5 py-0.5 text-xs font-medium text-trust">Verified</span>
          )}
        </div>

        {/* Payout Account */}
        <div className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold">Payout Account</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {payoutDone
                ? 'Connected via Stripe — ready to receive'
                : 'Set up to receive sale proceeds'}
            </p>
          </div>
          {!payoutDone && payoutContext.ok ? (
            <PayoutOnboarding context={payoutContext.data} compact />
          ) : payoutDone ? (
            <span className="rounded-full bg-trust/10 px-2.5 py-0.5 text-xs font-medium text-trust">Connected</span>
          ) : null}
        </div>
      </div>

      {paymentDemoEnabled && identity.ok && identity.data.status !== 'VERIFIED' ? (
        <div className="mt-4">
          <IdentityDemoControls />
        </div>
      ) : null}

      {/* Payout History */}
      {payoutDashboard.ok ? (
        <div className="mt-8">
          <PayoutsDashboard
            model={payoutDashboard.data.model}
            destination={payoutDashboard.data.destination}
            scope={scope}
          />
        </div>
      ) : null}
    </MarketplaceShell>
  );
}
