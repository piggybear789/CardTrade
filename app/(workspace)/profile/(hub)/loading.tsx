// app/profile/loading.tsx
//
// The Account hub's loading state, built from the same parts as the hub.
//
// IT DOES NOT REDRAW THE LAYOUT. `AccountTabsSkeleton` and `SettingsRowSkeleton` come
// from the components they stand in for and share their shape constants, and the group
// containers here ARE `SettingsGroup`. The previous version hand-drew everything with
// its own values and had fallen a whole redesign behind: it still painted a "Settings"
// title that no longer exists, an underlined tab row that is now a segmented control,
// and `space-y-section` between blocks the page spaces at `space-y-group`. Every one of
// those was a visible jump on arrival.
//
// PROFILE'S SHAPE, because `loading.tsx` cannot read the query string and `/profile`
// resolves to that tab. The other two tabs open with a group of rows as well, so the
// header, strip and first group all land in place regardless.
//
// ROW FOR ROW WITH `ProfilePanel`. This drew three plain rows and the payment group,
// then jumped to Sign out — while the real tab has FOUR rows in its first group (the
// Addresses row carries a description line, so it is the tallest of them), a whole
// Browsing region group, and a Support group of three described rows above Sign out.
// About 330px of page arrived on swap, all of it pushing the lower groups and the Sign
// out row down. Each row below names the real row it stands for, and reserves a
// description line exactly where the real row always has one.
//
// What it still cannot know is left at its commonest value: a bio is drawn unset (a
// value, not a description), the payment row with a saved card (no "Required to buy"
// line), and the staff group absent — that depends on a profile read a placeholder
// must not perform.

// The tab panel follows `?tab=`. `loading.tsx` gets no `searchParams`, so this used to
// draw the Profile tab for every URL — including every return from Stripe, which lands
// on `?tab=verification` — and then swap in a different panel. The panels are the
// shared ones in `AccountHubSkeletons` (the page's own Suspense fallback is one of
// them), and `AccountTabSkeletonSwitch` reads the committed URL to choose.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { AccountTabsSkeleton } from '@/components/account/AccountTabs';
import {
  PayoutsPanelSkeleton,
  ProfilePanelSkeleton,
  VerificationPanelSkeleton,
} from '@/components/account/AccountHubSkeletons';
import { AccountTabSkeletonSwitch } from '@/components/account/AccountTabSkeletonSwitch';
import { SettingsGroup, SettingsRowSkeleton } from '@/components/account/SettingsPrimitives';

export default function ProfileLoading() {
  return (
    <MarketplaceShellSkeleton title="Account">
      <div className="mx-auto w-full max-w-2xl">
        {/* Mirrors the identity header: a 40px avatar (`Avatar size="md"`, what
            `AvatarUploadField compact` renders) beside the name and the trust line. */}
        <header className="mb-group flex items-center gap-group px-tight md:mb-section">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          {/* THE BARS SIT IN REAL LINE BOXES. Sized with `h-6`/`h-5` the block came out
              4px shorter than the resolved header, so the tabs and every group below
              them started 4px high and dropped on arrival. `TextLines` puts each bar
              in a line box of the same type token as the text it replaces, so the
              header's height is computed from the scale rather than guessed. */}
          <div className="min-w-0 flex-1 space-y-0.5">
            {/* Name and trust line are texture at their type scales, drawn canonical. */}
            <TextLines className="text-subhead md:text-head" widths={['w-1/2']} />
            <TextLines className="text-body" widths={['w-2/3']} />
          </div>
        </header>

        {/* The phone Activity group: four icon rows (Notifications, Saved, Offers,
            My listings), phone only like the real one. */}
        <SettingsGroup className="mb-group md:hidden">
          <SettingsRowSkeleton icon labelClassName="w-1/3" valueClassName="hidden" />
          <SettingsRowSkeleton icon labelClassName="w-1/4" valueClassName="hidden" />
          <SettingsRowSkeleton icon labelClassName="w-1/4" valueClassName="hidden" />
          <SettingsRowSkeleton icon labelClassName="w-1/3" valueClassName="hidden" />
        </SettingsGroup>

        {/* The strip is inside the switch too, so its chip sits on the tab the URL
            names. It used to stay on Profile while the Verification or Payouts panel
            loaded beneath it, then slide across on arrival. */}
        <AccountTabSkeletonSwitch
          panels={{
            profile: (
              <>
                <AccountTabsSkeleton active="profile" />
                <ProfilePanelSkeleton />
              </>
            ),
            verification: (
              <>
                <AccountTabsSkeleton active="verification" />
                <VerificationPanelSkeleton />
              </>
            ),
            payouts: (
              <>
                <AccountTabsSkeleton active="payouts" />
                <PayoutsPanelSkeleton />
              </>
            ),
          }}
        />
      </div>
    </MarketplaceShellSkeleton>
  );
}
