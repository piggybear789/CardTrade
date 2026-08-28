// components/layout/MarketplaceShellSkeleton.tsx
//
// Loading chrome for every route that renders <MarketplaceShell>.
//
// THE RAIL IS REAL, NOT A PLACEHOLDER. This file used to draw the nav as a
// column of grey bars, because it had no way to learn the viewer's staff
// capability without a profile read — and a placeholder that queries the
// database is no longer a placeholder. The consequence was that every single
// navigation tore the rail down to rectangles and rebuilt it, animating the
// teardown on the way out. The rail does not change between two workspace
// routes, so none of that motion carried information.
//
// `MarketplaceNav` now reads capability from `WorkspaceChromeProvider`, mounted
// in `app/(workspace)/layout.tsx`. A layout is not replaced by a child segment's
// `loading.tsx`, so the provider is already there when this renders: the nav
// draws exactly what the real shell draws, and the rail holds still.
//
// The title and primary action are per-page, so routes pass their real values
// here too — they are static strings and links, known without fetching. What is
// left to skeleton is the content column, which is the only part actually
// waiting on data.
//
// The mobile hub bar is gone from this file on purpose: `MobileBottomNav` is
// mounted by the workspace layout now, so it is never unmounted and needs no
// stand-in.

import type { ReactNode } from 'react';

import { DesktopOnly } from '@/components/layout/Breakpoint';
import { MarketplaceNav } from '@/components/layout/MarketplaceNav';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function MarketplaceShellSkeleton({
  /**
   * Same section title the route hands `MarketplaceShell`. Omit it only where
   * the title genuinely depends on the data being loaded — `/sales/[id]` reads
   * "Purchase" or "Sale" depending on which side of the contract you are on —
   * and a bar of the same height stands in instead.
   */
  title,
  /** Same rail CTA the route hands `MarketplaceShell`, when it has one. */
  primaryAction,
  /** Extra rail content rendered under the Marketplace group (catalog filters). */
  filters,
  /** Match `MarketplaceShell.flush` — thread/room pages that fill the viewport. */
  flush = false,
  /** Match `MarketplaceShell.center` — short interstitials like the trade offer form. */
  center = false,
  children,
}: {
  title?: string;
  primaryAction?: ReactNode;
  filters?: ReactNode;
  flush?: boolean;
  center?: boolean;
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch md:flex-row">
        {/* Geometry below is copied from MarketplaceShell's aside and its sticky
            inner column, term for term. Any drift here is a layout shift on
            every workspace navigation, so the two must be edited together. */}
        <aside
          style={{ viewTransitionName: 'persistent-nav' }}
          className="hidden w-full min-w-0 px-4 sm:px-6 md:block md:w-1/5 md:min-w-[13.5rem] md:max-w-[19rem] md:shrink-0 md:self-stretch md:border-r md:border-border md:bg-sidebar md:px-5"
        >
          <div className="flex flex-col md:sticky md:top-[calc(4rem+1px+env(safe-area-inset-top))] md:-mx-1 md:h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))] md:gap-6 md:overflow-y-auto md:overscroll-contain md:px-1 md:py-5 md:[-ms-overflow-style:none] md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden">
            <div className="hidden md:block">
              {title ? (
                <h1 className="text-balance font-display text-subhead font-semibold tracking-[-0.02em] text-foreground/80">
                  {title}
                </h1>
              ) : (
                // Matches the h1's line box so the CTA below it does not move.
                <div className="flex h-[calc(theme(fontSize.subhead)*1.2)] items-center">
                  <Skeleton className="h-4 w-24" />
                </div>
              )}
              {primaryAction ? (
                <div className="mt-4 md:[&>a]:!h-11 md:[&>a]:text-nav md:[&>a>svg]:size-4 md:[&>button]:!h-11 md:[&>button]:text-nav md:[&>button>svg]:size-4">
                  {primaryAction}
                </div>
              ) : null}
            </div>

            <MarketplaceNav primaryExtras={<DesktopOnly>{filters}</DesktopOnly>} />
          </div>
        </aside>

        <section
          className={cn(
            'flex w-full min-w-0 flex-1 flex-col items-center bg-background md:w-auto md:bg-transparent',
            flush ? 'px-0 pt-0' : 'px-4 pt-3 sm:px-6 md:px-7 md:py-7 xl:px-8',
            flush && 'min-h-0 overflow-hidden',
            flush &&
              'max-h-[calc(100dvh-env(safe-area-inset-top)-3.5rem-1px-env(safe-area-inset-bottom))] md:max-h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))]',
            flush
              ? 'pb-4'
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
            {filters ? (
              <div className="min-w-0 md:hidden">{filters}</div>
            ) : null}
            {children}
          </div>
        </section>
      </div>
    </div>
  );
}
