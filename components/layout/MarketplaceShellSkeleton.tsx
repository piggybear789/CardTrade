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

/**
 * Link-row counts per rail group, mirroring `MARKETPLACE_NAV_GROUPS`.
 *
 * Members only, deliberately. Staff additionally see a Staff group, but that depends on
 * a profile read this skeleton must not perform — a placeholder that queries the
 * database is no longer a placeholder. The result is a small one-group settle on the
 * rail for staff, and none for everyone else.
 */
const NAV_GROUPS = [2, 4, 2, 3];

function NavGroupSkeleton() {
  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {NAV_GROUPS.map((rows, groupIndex) => (
        <div key={groupIndex} className="space-y-tight">
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
  /**
   * Match whether the route passes `MarketplaceShell.primaryAction`. Sections
   * without one must not reserve the button's space in the rail, or the rail
   * jumps by a button's height when the real shell swaps in. Below `lg` the
   * action lives in the page's own section header, so its placeholder belongs
   * in the route's `loading.tsx`, not here.
   */
  hasPrimaryAction = false,
  children,
}: {
  filters?: ReactNode;
  hasPrimaryAction?: boolean;
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

      {/* No mobile header: the real shell prints none either — below `lg` the
          page's own section header is the top of the page. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch lg:flex-row">
        {/* Rail — same proportional width/min/max as the real aside, and like it
            desktop-only: below `lg` filters live in the content column. */}
        <aside className="hidden w-full min-w-0 px-4 sm:px-6 lg:block lg:w-1/5 lg:min-w-[13.5rem] lg:max-w-[19rem] lg:shrink-0 lg:self-stretch lg:border-r lg:border-border/80 lg:bg-card/90 lg:px-5">
          <div className="flex flex-col gap-6 py-7">
            <div className="hidden space-y-2 lg:block">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-40" />
              {hasPrimaryAction ? (
                <Skeleton className="mt-4 h-10 w-full rounded-md" />
              ) : null}
            </div>

            <div className="hidden lg:block">
              <NavGroupSkeleton />
            </div>

            <div className="hidden lg:block">{filters}</div>

            <div className="mt-auto hidden lg:block">
              <Skeleton className="h-[4.5rem] w-full rounded-lg" />
            </div>
          </div>
        </aside>

        <section className="flex w-full min-w-0 flex-1 flex-col items-center px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:w-auto lg:px-7 lg:pb-10 lg:py-7 xl:px-8">
          <div className="flex min-h-0 w-full flex-1 flex-col">
            {filters ? <div className="min-w-0 lg:hidden">{filters}</div> : null}
            {children}
          </div>
        </section>
      </div>

      {/* Fixed hub bar placeholder — matches MobileBottomNav geometry. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-card/95 pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-hidden="true"
      >
        <div className="mx-auto grid h-14 max-w-lg grid-cols-5 gap-1 px-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="mx-auto mt-2 size-9 rounded-md" />
          ))}
        </div>
      </div>
    </div>
  );
}
