// components/layout/MarketplaceShellSkeleton.tsx
//
// Static loading chrome for every route.tsx that renders <MarketplaceShell>.
// Mirrors its rail geometry exactly (widths, breakpoints, sticky offsets) so
// swapping in the real shell on data arrival causes no layout shift, but
// never fetches anything itself — the rail's nav groups are drawn as plain
// placeholder bars instead of the live `MarketplaceNav` Server Component.

import { ViewTransition, type ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Link-row counts per rail group, mirroring `MARKETPLACE_NAV_GROUPS`
 * (Marketplace 2, Contracts 3, Selling 3, You 3).
 *
 * Members only, deliberately. Staff additionally see a Staff group, but that depends on
 * a profile read this skeleton must not perform — a placeholder that queries the
 * database is no longer a placeholder. The result is a small one-group settle on the
 * rail for staff, and none for everyone else.
 */
const NAV_GROUPS = [2, 3, 3, 3];

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
  /** Match `MarketplaceShell.flush` — thread/room pages that fill the viewport. */
  flush = false,
  /** Match `MarketplaceShell.center` — short interstitials like the trade offer form. */
  center = false,
  children,
}: {
  filters?: ReactNode;
  hasPrimaryAction?: boolean;
  flush?: boolean;
  center?: boolean;
  children: ReactNode;
}) {
  return (
    <ViewTransition exit="slide-down">
    <div
      className="flex min-h-0 w-full flex-1 flex-col"
      role="status"
      aria-busy="true"
      aria-label="Loading"
    >
      <span className="sr-only">Loading…</span>

      {/* No mobile header: the real shell prints none either — below `lg` the
          page's own section header is the top of the page. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch md:flex-row">
        {/* Rail — same proportional width/min/max as the real aside, and like it
            desktop-only: below `lg` filters live in the content column. */}
        <aside
          style={{ viewTransitionName: 'persistent-nav' }}
          className="hidden w-full min-w-0 px-4 sm:px-6 md:block md:w-1/5 md:min-w-[13.5rem] md:max-w-[19rem] md:shrink-0 md:self-stretch md:border-r md:border-border md:bg-card/90 md:px-5"
        >
          <div className="flex flex-col gap-6 py-7">
            <div className="hidden space-y-2 md:block">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-9 w-40" />
              {hasPrimaryAction ? (
                <Skeleton className="mt-4 h-10 w-full rounded-md" />
              ) : null}
            </div>

            <div className="hidden md:block">
              <NavGroupSkeleton />
            </div>

            <div className="hidden md:block">{filters}</div>
          </div>
        </aside>

        <section
          className={cn(
            'flex w-full min-w-0 flex-1 flex-col items-center px-4 pt-5 sm:px-6 md:w-auto md:px-7 md:py-7 xl:px-8',
            flush && 'min-h-0 overflow-hidden',
            flush &&
              'max-h-[calc(100dvh-env(safe-area-inset-top)-3.5rem-1px-env(safe-area-inset-bottom))] md:max-h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))]',
            flush
              ? 'pb-4 md:pb-7'
              : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10',
            center && 'justify-center',
          )}
        >
          <div
            className={cn(
              'mx-auto flex min-h-0 w-full max-w-workspace flex-col',
              center ? 'my-auto' : 'flex-1',
            )}
          >
            {filters ? <div className="min-w-0 md:hidden">{filters}</div> : null}
            {children}
          </div>
        </section>
      </div>

      {/* Fixed hub bar placeholder — matches MobileBottomNav geometry. */}
      <div
        style={{ viewTransitionName: 'persistent-mobile-nav' }}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-hidden="true"
      >
        <div className="mx-auto grid h-14 max-w-lg grid-cols-5 gap-1 px-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="mx-auto mt-2 size-9 rounded-md" />
          ))}
        </div>
      </div>
    </div>
    </ViewTransition>
  );
}
