// components/layout/MarketplaceShellSkeleton.tsx
//
// Static loading chrome for every route.tsx that renders <MarketplaceShell>.
// Mirrors its rail geometry exactly (widths, breakpoints, sticky offsets) so
// swapping in the real shell on data arrival causes no layout shift, but
// never fetches anything itself — the rail's nav groups and identity status
// are drawn as plain placeholder bars instead of the live `MarketplaceNav` /
// `KycRailStatus` Server Components.

import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';

/** Link-row counts per rail group, mirroring `MarketplaceNav`'s `GROUPS`. */
const NAV_GROUPS = [2, 4, 2, 3];

function NavGroupSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {NAV_GROUPS.map((rows, groupIndex) => (
        <div key={groupIndex} className="space-y-0.5">
          <Skeleton className="mb-1.5 hidden h-3 w-16 lg:block" />
          {Array.from({ length: rows }, (_, rowIndex) => (
            <Skeleton key={rowIndex} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function MarketplaceShellSkeleton({
  /** Extra rail content rendered directly below the nav skeleton (e.g. catalog filters). */
  filters,
  children,
}: {
  filters?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="flex min-h-0 w-full flex-1 flex-col"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      {/* Mobile header — matches MarketplaceShell's title block. */}
      <div className="flex w-full flex-wrap items-end justify-between gap-x-4 gap-y-3 px-4 pt-5 sm:px-6 lg:hidden">
        <div className="min-w-0 space-y-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-44" />
        </div>
        <Skeleton className="h-10 w-36 shrink-0 rounded-md" />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch lg:flex-row">
        {/* Rail — same proportional width/min/max as the real aside. */}
        <aside className="hidden w-full min-w-0 px-4 sm:px-6 lg:block lg:w-1/5 lg:min-w-[13.5rem] lg:max-w-[19rem] lg:shrink-0 lg:self-stretch lg:border-r lg:border-border/80 lg:bg-card/90 lg:px-5">
          <div className="flex flex-col gap-6 py-7">
            <div className="space-y-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-40" />
              <Skeleton className="mt-4 h-10 w-full rounded-md" />
            </div>

            <NavGroupSkeleton />

            {filters}

            <div className="mt-auto">
              <Skeleton className="h-[4.5rem] w-full rounded-lg" />
            </div>
          </div>
        </aside>

        <section className="flex w-full min-w-0 flex-1 flex-col items-center px-4 pb-10 pt-5 sm:px-6 lg:w-auto lg:px-7 lg:py-7 xl:px-8">
          <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>
        </section>
      </div>
    </div>
  );
}
