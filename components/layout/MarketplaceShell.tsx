// components/layout/MarketplaceShell.tsx
//
// Shared fluid workspace layout for every signed-in marketplace surface:
// browse, deals, messages, notifications, account, sales, trades, profile,
// and admin. The rail and content divide the available viewport proportionally
// so wide screens remain useful without introducing fixed layout caps.
//
// The landing page and the public join-by-token invite deliberately opt out -
// they are entry points, not workspace sections.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { KycRailStatus } from '@/components/layout/KycRailStatus';
import { MarketplaceNav } from '@/components/layout/MarketplaceNav';
import { PageShell } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Fluid, centered proportions for each kind of marketplace content. */
const CONTENT_WIDTHS = {
  full: 'w-full',
  detail: 'w-full xl:w-11/12',
  reading: 'w-full lg:w-5/6 xl:w-3/4',
  form: 'w-full lg:w-2/3 xl:w-1/2',
} as const;

/** The rail's default action: list an item, available from every section. */
function CreateListingAction() {
  return (
    <Button
      asChild
      variant="outline"
      className="w-full border-gold/45 bg-gold/12 text-foreground hover:border-gold/60 hover:bg-gold/20"
    >
      <Link href="/listings/new">
        <Plus aria-hidden="true" className="text-gold" />
        Create New Listing
      </Link>
    </Button>
  );
}

export function MarketplaceShell({
  title,
  eyebrow = 'Poke-xchange Market',
  primaryAction,
  filters,
  contentWidth = 'full',
  center = false,
  children,
}: {
  /** Section title, shown in the rail on desktop and above content on mobile. */
  title: string;
  eyebrow?: string;
  /** Overrides the rail's default "Create New Listing" action. */
  primaryAction?: ReactNode;
  /** Optional filter controls rendered below the rail navigation. */
  filters?: ReactNode;
  /** Selects the centered, viewport-relative content proportion. */
  contentWidth?: keyof typeof CONTENT_WIDTHS;
  /**
   * Centre the content in the section both ways, for a short interstitial that
   * is the whole page: verification prompts, payout setup, "not available".
   * Long-form content should stay top-aligned so it reads from the top.
   */
  center?: boolean;
  children: ReactNode;
}) {
  const action = primaryAction ?? <CreateListingAction />;

  return (
    <PageShell
      width="catalog"
      className="min-h-0 flex-1 self-stretch px-0 py-0 sm:px-0 sm:py-0 lg:px-0 lg:py-0"
    >
      <div className="flex w-full items-start justify-between gap-4 px-4 pt-5 sm:px-6 lg:hidden">
        <div className="min-w-0">
          <p className="market-label text-gold">{eyebrow}</p>
          <h1 className="mt-1 text-balance font-display text-3xl font-semibold tracking-[-0.04em]">
            {title}
          </h1>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch lg:flex-row">
        {/* Rail width is proportional (20% of the workspace) so it scales with
            the viewport. The min/max keep it usable at the extremes: a floor so
            the nav labels never crush on smaller laptops, and a cap so it does
            not sprawl on ultrawide displays. */}
        <aside className="w-full min-w-0 px-4 sm:px-6 lg:w-1/5 lg:min-w-[13.5rem] lg:max-w-[19rem] lg:shrink-0 lg:self-stretch lg:border-r lg:border-border/80 lg:bg-card/90 lg:px-5 lg:shadow-[8px_0_28px_hsl(var(--foreground)/0.045)]">
          {/* The rail background stretches the full column; its contents stay in
              view, with identity status held at the bottom of the rail.
              The inset px-1/-mx-1 pair gives focus rings room to draw: setting
              overflow on one axis makes this a scroll container on both, which
              otherwise clips the ring-offset on controls at the rail's edges.
              The rail still scrolls by wheel, drag, and keyboard when its
              contents outgrow the viewport, but the bar itself is hidden: it
              rendered as a full-width gutter down the middle of the workspace.
              Same treatment as the horizontal nav strips on mobile. */}
          <div className="flex flex-col gap-5 lg:sticky lg:top-16 lg:-mx-1 lg:h-[calc(100dvh-4rem)] lg:gap-6 lg:overflow-y-auto lg:overscroll-contain lg:px-1 lg:py-7 lg:[-ms-overflow-style:none] lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
            <div className="hidden lg:block">
              <p className="market-label text-gold">{eyebrow}</p>
              <h1 className="mt-1 text-balance font-display text-[2rem] font-semibold tracking-[-0.045em]">
                {title}
              </h1>
              <div className="mt-4">{action}</div>
            </div>

            {/* Filters ride with the Marketplace group they narrow. */}
            <MarketplaceNav primaryExtras={filters} />

            <div className="lg:mt-auto">
              <KycRailStatus />
            </div>
          </div>
        </aside>

        <section
          className={cn(
            'flex w-full min-w-0 flex-1 flex-col items-center px-4 pb-10 pt-5 sm:px-6 lg:w-auto lg:px-7 lg:py-7 xl:px-8',
            center && 'justify-center',
          )}
        >
          <div
            className={cn(
              'flex min-h-0 w-full flex-col',
              // `my-auto` rather than `flex-1` so a centred interstitial keeps
              // its natural height instead of stretching to fill the section.
              center ? 'my-auto' : 'flex-1',
              CONTENT_WIDTHS[contentWidth],
            )}
          >
            {children}
          </div>
        </section>
      </div>
    </PageShell>
  );
}
