// app/profile/page.tsx
//
// The Account hub — three tabs: Profile, Verification, Payouts.
//
//   Profile       who you are to other members: picture, name, bio, socials, and the
//                 card you BUY with.
//   Verification  the two sequential gates, in order: Stripe Identity (unlocks
//                 listing/selling/trading) then Stripe Connect (unlocks being PAID).
//   Payouts       what you are owed and what has landed.
//
// WHY CONNECT LIVES UNDER VERIFICATION. `product.md` defines verification as TWO
// SEQUENTIAL STEPS — the Identity_Gate and then payout setup — so putting Connect
// beside the identity check is what makes the ordering legible. The Payouts tab is
// deliberately left as reporting only; it never hosts onboarding, which is what kept
// the old two-page split competing over the same card.
//
// THE TAB DOES NOT DRAW THOSE STEPS ITSELF. It mounts `VerificationSequence`, the same
// spine the signup wizard uses, so the ordering is expressed by the sequence rather
// than restated by this page. Rendering its own identity and payout cards here is what
// let the two drift: the pair showed both "Verify with Stripe" buttons at once, on a
// flow where the second step is not reachable until the first has passed.
//
// Visual language comes from `components/account/SettingsPrimitives.tsx` — see the
// note there on why the reference's dark classes are translated rather than copied.

import { ViewTransition } from 'react';
import { redirect } from 'next/navigation';
import { CreditCardIcon, ShieldCheckIcon, Wallet01Icon } from '@hugeicons/core-free-icons';

import { createClient } from '@/lib/supabase/server';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { getPayoutSetupContext } from '@/lib/actions/merchant';
import { getPayoutsDashboard } from '@/lib/actions/payouts';
import { getIdentityCheckState } from '@/lib/actions/identity';
import { isPaymentDemoEnabled } from '@/domain/services';
import { IdentityDemoControls } from '@/components/identity/IdentityDemoControls';
import { IdentityReturnRefresh } from '@/components/identity/IdentityReturnRefresh';
import { PayoutReturnRefresh } from '@/components/payouts/PayoutReturnRefresh';
import { VerificationSequence } from '@/components/profile/VerificationSequence';
import { PayoutsDashboard } from '@/components/payouts/PayoutsDashboard';
import { PayoutSummary } from '@/components/payouts/PayoutSummary';
import { EditProfileDialog } from '@/components/profile/EditProfileDialog';
import { AvatarUploadField } from '@/components/profile/AvatarUploadField';
import { AddPaymentMethodDialog } from '@/components/payments/AddPaymentMethodDialog';
import {
  BioSettingRow,
  LinksSettingRow,
} from '@/components/profile/ProfileSettingRows';
import { AccountTabs } from '@/components/account/AccountTabs';
import {
  SettingsGroup,
  SettingsListRow,
  SettingsPanelRow,
  SettingsPlaceholder,
  TrustLine,
} from '@/components/account/SettingsPrimitives';
import { MarketplaceShell } from '@/components/layout/MarketplaceShell';
import { SignOutButton } from '@/components/layout/SignOutButton';
import {
  STAFF_NAV_GROUP,
  staffNavLinksFor,
} from '@/components/layout/marketplace-nav-config';
import { EmptyState } from '@/components/ui/empty-state';
import { resolveScope } from '@/components/layout/SectionFilter';

// ACCOUNT, NOT SETTINGS. One destination was called three things depending on where
// you stood: the bottom nav said "Account", the desktop rail and the document title
// said "Settings", and the phone screen — since the identity block became the visible
// heading — said the member's own name. The nav label is the one a member sees most
// and the one they navigate by, so the rest now agrees with it.
export const metadata = { title: 'Account · NoDitto' };

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

  // ONLY WHAT THIS TAB RENDERS. All five of these used to run on every view of
  // every tab, and two of them are expensive: `getPaymentMethodStatus` makes a
  // live Stripe call, and `getPayoutsDashboard` is a seven-query chain. A member
  // opening Profile — the landing tab — paid for both before seeing anything.
  //
  // The first three stay unconditional because the identity header above the tab
  // strip reads them: the profile row for the name and avatar, and identity plus
  // payout context for the trust line.
  const [profileResult, identity, payoutContext, paymentMethodResult, payoutDashboard] =
    await Promise.all([
      supabase
        .from('profiles')
        .select('display_name, contact_email, avatar_path, social_links, bio, is_admin, is_support')
        .eq('id', user.id)
        .single(),
      getIdentityCheckState(),
      getPayoutSetupContext(),
      activeTab === 'profile' ? getPaymentMethodStatus() : null,
      activeTab === 'payouts' ? getPayoutsDashboard() : null,
    ]);

  const profile = profileResult.data;
  if (!profile) {
    return (
      <MarketplaceShell title="Account" center>
        <EmptyState
          variant="page"
          title="Profile unavailable"
          description="We could not load your account details. Reload to try again."
          action={{ label: 'Try again', href: '/profile' }}
          compact
        />
      </MarketplaceShell>
    );
  }

  const paymentMethod =
    paymentMethodResult?.ok ? paymentMethodResult.data : null;
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
  const staffLinks = staffNavLinksFor({
    isAdmin: Boolean(profile.is_admin),
    isStaff: Boolean(profile.is_admin) || Boolean(profile.is_support),
  });

  return (
    <MarketplaceShell title="Account">
      {/* Reconcile a return from either hosted Stripe flow. Both render nothing, and
          each ignores a marker that is not its own. The payout half used to live in an
          effect inside `PayoutOnboarding`; with that card gone the page needs the
          standalone reconciler, or a member coming back from Connect would land on
          whatever the database last heard — still PENDING until the webhook arrives,
          and in local development without `stripe listen` that is never. */}
      <IdentityReturnRefresh />
      <PayoutReturnRefresh />

      {/* ONE CENTRED COLUMN for the whole surface — heading, tabs and content.
          `mx-auto` centres the COLUMN; text inside it stays left-aligned. Capping
          the width matters on a settings form: measured across a full desktop
          viewport, a short label sits at one edge and its control at the other.
          The heading and tabs share the column so all three left edges line up. */}
      <div className="mx-auto w-full max-w-2xl">
        {/* IDENTITY ABOVE THE TABS, because it is true of all three of them. It also
            gives the tab strip something to belong to: under a bare "Account" heading
            it read as a second navigation bar bolted to the page.

            THE NAME IS THE VISIBLE HEADING, and that is the whole heading on a phone.
            `MarketplaceShell` keeps "Account" as the page `<h1>` — visible in the rail
            on desktop, screen-reader-only below `md` — so the outline still starts
            correctly while the phone shows what every other app shows on this screen:
            who you are. Printing "Account" here as well would be the page named twice,
            one line apart, before any content. */}
        <header className="mb-group flex items-center gap-group px-tight md:mb-section">
          <AvatarUploadField
            avatarPath={profile.avatar_path}
            displayName={profile.display_name}
            hideHint
            compact
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <h2 className="truncate text-subhead font-semibold tracking-[-0.02em] md:text-head">
              {profile.display_name}
            </h2>
            <TrustLine
              identityVerified={identityVerified}
              payoutsActive={payoutsActive}
            />
          </div>
        </header>

        <AccountTabs activeTab={activeTab} />

        {/* TAB SWITCHING IS A NAVIGATION, so without this it is a hard cut: the panel
            blanks and repaints, which is the single loudest "this is a web page" tell
            on the surface. `key` + `name` + `share` is the codebase's established
            shape for a same-route content swap — `CatalogResults` uses it for filter
            changes — and it is the right one here because the route never changes, so
            enter/exit would never fire on their own. `default="none"` keeps every
            other trigger off, so this animates on tab changes and nothing else.

            Lateral, so it crossfades rather than sliding: a directional slide between
            Profile and Payouts would imply a depth relationship that does not exist. */}
        <ViewTransition key={activeTab} name="account-tab-panel" share="auto" default="none">
          <div>
        {activeTab === 'profile' ? (
          // NO GROUP HEADINGS ON THIS TAB. It carried four ("Public profile",
          // "Payment", and two more on the sibling tabs) — tracked uppercase labels
          // introducing rows that already say what they are, each one visually louder
          // than the setting beneath it. A run of rows separated by space needs no
          // heading; the tab name is the heading.
          <div className="space-y-group md:space-y-section">
            <SettingsGroup>
              <EditProfileDialog
                avatarPath={profile.avatar_path}
                displayName={profile.display_name}
                contactEmail={profile.contact_email}
                trigger={
                  <SettingsListRow label="Name and email" value={profile.contact_email} />
                }
              />
              <BioSettingRow bio={(profile.bio as string | null) ?? ''} />
              <LinksSettingRow links={socialLinks} />
            </SettingsGroup>

            <SettingsGroup>
              <AddPaymentMethodDialog
                trigger={
                  <SettingsListRow
                    icon={CreditCardIcon}
                    label="Payment method"
                    // ONE LINE. The card used to be the value beside a two-line label
                    // carrying the expiry, so it floated against the middle of a block
                    // it was supposed to be reading out. The expiry belongs in the
                    // editor, not in a list whose job is "what is set".
                    value={hasCard ? (paymentMethod?.label ?? 'Card saved') : 'Add a card'}
                    description={
                      hasCard ? undefined : 'Required to buy or back a trade.'
                    }
                  />
                }
              />
            </SettingsGroup>

            {/* ACCOUNT-LEVEL ACTIONS, AND ONLY ON THIS TAB. Signed-in phones no longer
                have the header burger, so sign-out and staff destinations live on the
                Account hub — but they belong to the account, not to any one section of
                it, and repeating them under Verification and Payouts put a destructive
                control at the foot of every tab. Profile is the hub's landing tab, so
                they sit here once.

                SAME ROWS AS EVERYTHING ABOVE. These were outline buttons in a stack — a
                third control vocabulary on a page that had settled on two. Staff
                destinations are ordinary navigation, so they are ordinary rows; the
                label stays because "Staff" is the one heading here that is not obvious
                from its contents.

                Sign out keeps a container of its own rather than joining them: it ends
                the session, and a destructive action sharing a group with navigation is
                the kind of adjacency that gets mis-tapped. */}
            <div className="space-y-group border-t border-border pt-section">
              {staffLinks.length > 0 ? (
                <SettingsGroup label={STAFF_NAV_GROUP.label}>
                  {staffLinks.map((link) => (
                    <SettingsListRow
                      key={link.href}
                      href={link.href}
                      icon={link.icon}
                      label={link.label}
                    />
                  ))}
                </SettingsGroup>
              ) : null}
              {/* `!h-12`: the button's `sm` size sets 24px from `md` inside a
                  media query, which a plain `h-12` cannot override. */}
              <SignOutButton className="!h-12 w-full justify-start rounded-xl border border-border bg-card px-group text-body font-medium text-destructive hover:bg-destructive/5 hover:text-destructive" />
            </div>
          </div>
        ) : null}

        {activeTab === 'verification' ? (
          <div className="space-y-group md:space-y-section">
            {/* Identity and payout setup only. The member summary (avatar, name,
                ratings, region) already lives on the Profile tab — repeating it
                here made Verification look like a second profile page. */}
            {identityVerified && payoutsActive ? (
              // A RESULT, THEN ITS EVIDENCE. Two equal grey rows made the finished
              // state read as an inventory; the member came here to learn one thing,
              // so say it, then show the two facts that back it up.
              <>
                <div className="px-tight">
                  <h3 className="text-lead font-semibold">You&apos;re set up to sell</h3>
                  <p className="mt-0.5 text-body text-muted-foreground">
                    Both checks are complete. There is nothing else to do here.
                  </p>
                </div>
                <SettingsGroup>
                  <SettingsListRow
                    icon={ShieldCheckIcon}
                    tone="verified"
                    label="Identity"
                    value={
                      identity.ok && identity.data.verifiedName
                        ? identity.data.verifiedName
                        : 'Checked by Stripe'
                    }
                  />
                  <SettingsListRow
                    icon={Wallet01Icon}
                    tone="verified"
                    label="Payouts"
                    value="Active"
                  />
                </SettingsGroup>
              </>
            ) : identity.ok || payoutContext.ok ? (
              // ONE SEQUENCE, ONE BUTTON. Both gates are rendered by the surface the
              // signup wizard uses, which shows a control for the ACTIVE step only —
              // so an ordered pair of steps presents as a single call to action that
              // advances. This tab previously drew its own identity and payout cards
              // side by side, each with a "Verify with Stripe" button, which put two
              // competing entry points on a strictly sequential flow.
              <SettingsGroup>
                <SettingsPanelRow>
                  <VerificationSequence
                    identityDone={identityVerified}
                    payoutDone={payoutsActive}
                    verifiedName={identity.ok ? identity.data.verifiedName : null}
                  />
                </SettingsPanelRow>
              </SettingsGroup>
            ) : (
              // Only when BOTH reads failed. Either one alone still leaves a usable
              // step, and the surface re-reads on mount regardless.
              <SettingsPlaceholder>
                Verification is unavailable right now. Reload to try again.
              </SettingsPlaceholder>
            )}

            {/* The crank that drives a mock check forward, since `MockService` lands
                every check PENDING on purpose. Dropped once verified — there is
                nothing left for it to simulate. */}
            {paymentDemoEnabled && identity.ok && !identityVerified ? (
              <IdentityDemoControls />
            ) : null}
          </div>
        ) : null}

        {activeTab === 'payouts' ? (
          <div className="space-y-group md:space-y-section">
            {/* Real figures from the payout read model — the three buckets are a
                strict partition, so these never double-count a sale. */}
            {payoutDashboard?.ok ? (
              <PayoutSummary model={payoutDashboard.data.model} />
            ) : null}

            {payoutDashboard?.ok ? (
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
        </ViewTransition>
      </div>
    </MarketplaceShell>
  );
}
