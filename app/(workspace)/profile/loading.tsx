// app/profile/loading.tsx
//
// The Account hub's loading state, built from the same parts as the hub.
//
// IT DOES NOT REDRAW THE LAYOUT. `AccountTabsSkeleton` and `SettingsRowSkeleton` come
// from the components they stand in for and share their shape constants, and the group
// containers here ARE `SettingsGroup`. The previous version hand-drew everything with
// its own values and had fallen a whole redesign behind: it still painted a "Settings"
// title that no longer exists, an underlined tab row that is now a segmented control,
// and `space-y-8` between blocks the page spaces at `space-y-group`. Every one of
// those was a visible jump on arrival.
//
// PROFILE'S SHAPE, because `loading.tsx` cannot read the query string and `/profile`
// resolves to that tab. The other two tabs open with a group of rows as well, so the
// header, strip and first group all land in place regardless.

import { Skeleton, TextLines } from '@/components/ui/skeleton';
import { MarketplaceShellSkeleton } from '@/components/layout/MarketplaceShellSkeleton';
import { AccountTabsSkeleton } from '@/components/account/AccountTabs';
import {
  SettingsGroup,
  SettingsRowSkeleton,
} from '@/components/account/SettingsPrimitives';

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
            <TextLines className="text-subhead md:text-head" widths={['w-40']} />
            <TextLines className="text-body" widths={['w-56']} />
          </div>
        </header>

        <AccountTabsSkeleton />

        <div className="space-y-group md:space-y-section">
          <SettingsGroup>
            <SettingsRowSkeleton labelClassName="w-32" valueClassName="w-36" />
            <SettingsRowSkeleton labelClassName="w-10" valueClassName="w-16" />
            <SettingsRowSkeleton labelClassName="w-14" valueClassName="w-14" />
          </SettingsGroup>

          <SettingsGroup>
            {/* The payment row has a `CreditCardIcon` medallion. */}
            <SettingsRowSkeleton icon labelClassName="w-32" valueClassName="w-24" />
          </SettingsGroup>

          {/* Sign out sits under a rule on this tab for every signed-in member, so
              reserving it keeps the page from growing by a row on arrival. The staff
              group above it is deliberately absent: it depends on a profile read a
              placeholder must not perform. */}
          <div className="border-t border-border pt-section">
            <Skeleton className="h-12 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </MarketplaceShellSkeleton>
  );
}
