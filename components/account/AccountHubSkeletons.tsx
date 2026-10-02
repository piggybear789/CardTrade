// components/account/AccountHubSkeletons.tsx
//
// One placeholder per Account hub tab, shared by the route's `loading.tsx` and the
// page's own Suspense fallbacks so the two can never describe a tab differently.
//
// WHY THREE. `loading.tsx` used to draw the Profile tab whatever the URL said, so a deep
// link to `?tab=verification` (every return from Stripe) or `?tab=payouts` showed a
// stack of settings rows and then swapped in a completely different panel.
// `AccountTabSkeletonSwitch` now picks one of these from the query string.
//
// Server-safe: no `'use client'`, so the page can still render `PayoutsPanelSkeleton`
// as a Suspense fallback without shipping it as a client reference.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import {
  SettingsGroup,
  SettingsPanelRow,
  SettingsRowSkeleton,
} from '@/components/account/SettingsPrimitives';
import { OnboardingSpineSkeleton } from '@/components/onboarding/OnboardingSpineSkeleton';

/**
 * The Profile tab, row for row with `ProfilePanel`.
 *
 * What it cannot know is left at its commonest value: a bio drawn unset (a value, not a
 * description), the payment row with a saved card (no "Required to buy" line), and the
 * staff group absent — that depends on a profile read a placeholder must not perform.
 */
export function ProfilePanelSkeleton() {
  return (
    <div className="space-y-group md:space-y-section" aria-hidden>
      <SettingsGroup>
        {/* Name and email · Bio · Links · Addresses (which carries a description). */}
        <SettingsRowSkeleton labelClassName="w-32" valueClassName="w-36" />
        <SettingsRowSkeleton labelClassName="w-10" valueClassName="w-16" />
        <SettingsRowSkeleton labelClassName="w-14" valueClassName="w-14" />
        <SettingsRowSkeleton description labelClassName="w-24" valueClassName="w-14" />
      </SettingsGroup>

      {/* Browsing region: a `Location01Icon` medallion and a fixed description. */}
      <SettingsGroup>
        <SettingsRowSkeleton icon description labelClassName="w-32" valueClassName="w-28" />
      </SettingsGroup>

      <SettingsGroup>
        {/* The payment row has a `CreditCardIcon` medallion. */}
        <SettingsRowSkeleton icon description labelClassName="w-32" valueClassName="w-24" />
      </SettingsGroup>

      {/* Support (static heading, so the real label), then Sign out, under a rule. */}
      <div className="space-y-group border-t border-border pt-section">
        <SettingsGroup label="Support">
          <SettingsRowSkeleton icon description labelClassName="w-28" valueClassName="hidden" />
          <SettingsRowSkeleton icon description labelClassName="w-28" valueClassName="hidden" />
          <SettingsRowSkeleton icon description labelClassName="w-12" valueClassName="hidden" />
        </SettingsGroup>
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    </div>
  );
}

/**
 * The Verification tab while setup is unfinished: `VerificationSequence` inside one
 * panel row. That is the state a member is in whenever they have a reason to open this
 * tab — every Stripe return lands here — so it is the shape to reserve. A member with
 * both checks done sees a heading and two rows instead, which is about the same height.
 */
export function VerificationPanelSkeleton() {
  return (
    <div className="space-y-group md:space-y-section" aria-hidden>
      <SettingsGroup>
        <SettingsPanelRow>
          <OnboardingSpineSkeleton />
        </SettingsPanelRow>
      </SettingsGroup>
    </div>
  );
}

/**
 * The Payouts tab, shaped like `PayoutSummary` — the part that always renders and the
 * part on screen when it resolves: ONE group led by a panel row (label, `text-head`
 * figure, caption), three figure rows, and a panel row of fine print.
 *
 * The dashboard below it differs per member — one empty state for a new seller, up to
 * four sections for an active one — so it gets one card-sized block rather than a guess
 * at its interior.
 */
export function PayoutsPanelSkeleton() {
  return (
    <div className="space-y-group md:space-y-section" aria-hidden>
      <SettingsGroup>
        <SettingsPanelRow>
          <TextLines className="text-body" widths={['w-24']} />
          <TextLines className="mt-tight text-head" widths={['w-28']} />
          <TextLines className="mt-tight text-body" widths={['w-40']} />
        </SettingsPanelRow>
        <SettingsRowSkeleton labelClassName="w-32" valueClassName="w-16" />
        <SettingsRowSkeleton labelClassName="w-24" valueClassName="w-16" />
        <SettingsRowSkeleton labelClassName="w-16" valueClassName="w-16" />
        <SettingsPanelRow>
          {/* ~220 characters of `text-meta`: about four lines in the phone column,
              two in the 672px desktop one. */}
          <TextLines
            className="text-meta md:hidden"
            widths={['w-full', 'w-full', 'w-full', 'w-1/3']}
          />
          <TextLines className="hidden text-meta md:block" widths={['w-full', 'w-11/12']} />
        </SettingsPanelRow>
      </SettingsGroup>
      <Skeleton className="h-36 w-full rounded-xl" />
    </div>
  );
}
