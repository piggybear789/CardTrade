// components/layout/MarketplaceShell.tsx
//
// Shared fluid workspace layout for every signed-in marketplace surface:
// browse, deals, messages, notifications, account, sales, trades, profile,
// and admin. Desktop keeps a sticky proportional rail; below `lg`, navigation
// moves to MobileBottomNav (hubs + sheets) so content is not buried under chips.
//
// The rail owns the page title and its primary action. Below `lg` the rail is
// gone and the shell renders no visible chrome of its own: the page's own
// SectionHeader already titles the section, so a mobile header here would name
// every page twice. Sections that need their action on small screens hand the
// same node to SectionHeader's `mobileAction`.
//
// The landing page and the public join-by-token invite deliberately opt out —
// they are entry points, not workspace sections.

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import {
  DesktopOnly,
  MobileOnly,
} from '@/components/layout/Breakpoint';
import { KycRailStatus } from '@/components/layout/KycRailStatus';
import { MarketplaceNav } from '@/components/layout/MarketplaceNav';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { PageShell } from '@/components/layout/PageShell';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

/** Default glyph, hoisted so the element is not rebuilt on every render. */
const CREATE_GLYPH = <Plus aria-hidden="true" className="text-gold" />;

/**
 * A section's primary CTA, shared by every marketplace section: obsidian fill,
 * parchment label. Sized by its container — full width in the rail, and in
 * SectionHeader's `mobileAction` slot below `lg`.
 */
export function RailPrimaryAction({
  href,
  glyph = CREATE_GLYPH,
  children,
}: {
  href: string;
  /**
   * Leading glyph, a plus by default because most sections' one action is to
   * create something. Pass `null` where the action only goes somewhere: a plus
   * on a link that opens a browse page promises a new record that never
   * appears.
   */
  glyph?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Button
      asChild
      className="w-full border border-white/15 bg-obsidian text-parchment font-semibold shadow-sm hover:bg-obsidian/80 hover:border-white/25"
    >
      <Link href={href}>
        {glyph}
        {children}
      </Link>
    </Button>
  );
}

export async function MarketplaceShell({
  title,
  eyebrow = 'NoDitto Market',
  primaryAction,
  filters,
  center = false,
  children,
}: {
  /**
   * Section title. The page <h1>: visible in the rail on desktop, and kept for
   * the document outline and assistive tech below `lg`, where the page's own
   * SectionHeader carries the visible heading.
   */
  title: string;
  eyebrow?: string;
  /**
   * The section's one next action, shown in the rail. Opt-in per section: a
   * room you are already inside — a contract, a thread, an item form — has no
   * "create" to offer, and a rail CTA that does not belong to the section is
   * just a misplaced button. The rail is desktop-only, so a section that needs
   * this on small screens passes the same node to SectionHeader's
   * `mobileAction`.
   */
  primaryAction?: ReactNode;
  /**
   * Optional filter controls. They mount exactly once: under Marketplace in
   * the rail on desktop, and at the top of the content column below `lg` —
   * one mount either way, so field ids stay stable.
   */
  filters?: ReactNode;
  /**
   * Centre the content in the section both ways, for a short interstitial that
   * is the whole page: verification prompts, payout setup, "not available".
   * Long-form content should stay top-aligned so it reads from the top.
   */
  center?: boolean;
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const showMobileNav = Boolean(user);

  return (
    <PageShell className="min-h-0 flex-1 self-stretch px-0 py-0 sm:px-0 sm:py-0 lg:px-0 lg:py-0">
      {/* Below `lg` the rail is gone, so the <h1> has no visible home — and it
          does not need one. The page's SectionHeader already names the section
          on screen; printing the title here as well is the same page titled
          twice, one line apart. Kept off-screen so the outline still starts at
          an h1 and screen-reader users get the section name. */}
      <h1 className="sr-only lg:hidden">{title}</h1>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch lg:flex-row">
        {/* Rail width is proportional (20% of the workspace) so it scales with
            the viewport. The min/max keep it usable at the extremes: a floor so
            the nav labels never crush on smaller laptops, and a cap so it does
            not sprawl on ultrawide displays. */}
        {/* The rail is desktop-only in full: below `lg` its section links live
            in MobileBottomNav and its filters render in the content column, so
            nothing is left to mount. */}
        <aside className="hidden w-full min-w-0 px-4 sm:px-6 lg:block lg:w-1/5 lg:min-w-[13.5rem] lg:max-w-[19rem] lg:shrink-0 lg:self-stretch lg:border-r lg:border-border/80 lg:bg-card/90 lg:px-5 lg:shadow-[8px_0_28px_hsl(var(--foreground)/0.045)]">
          {/* The rail background stretches the full column; its contents stay in
              view, with identity status held at the bottom of the rail.
              The inset px-1/-mx-1 pair gives focus rings room to draw: setting
              overflow on one axis makes this a scroll container on both, which
              otherwise clips the ring-offset on controls at the rail's edges.
              The rail still scrolls by wheel, drag, and keyboard when its
              contents outgrow the viewport, but the bar itself is hidden: it
              rendered as a full-width gutter down the middle of the workspace. */}
          {/* Header chrome is 4rem content + 1px bottom border: both terms
              must appear here, or the rail runs 1px taller than the space
              under the header and stretches the whole workspace row 1px past
              the viewport — a permanent hairline page scroll. */}
          <div className="flex flex-col lg:sticky lg:top-[calc(4rem+1px+env(safe-area-inset-top))] lg:-mx-1 lg:h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))] lg:gap-6 lg:overflow-y-auto lg:overscroll-contain lg:px-1 lg:py-7 lg:[-ms-overflow-style:none] lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
            <div className="hidden lg:block">
              <p className="market-label text-gold">{eyebrow}</p>
              <h1 className="mt-1 text-balance font-display text-3xl font-semibold tracking-[-0.03em]">
                {title}
              </h1>
              {primaryAction ? <div className="mt-4">{primaryAction}</div> : null}
            </div>

            {/* Filters sit under Marketplace on desktop; below `lg` they render
                in the content column instead (see MobileOnly below). */}
            <MarketplaceNav primaryExtras={<DesktopOnly>{filters}</DesktopOnly>} />

            <div className="hidden lg:mt-auto lg:block">
              <KycRailStatus />
            </div>
          </div>
        </aside>

        <section
          className={cn(
            // Below `lg` the content column is the top of the page now that the
            // shell prints no header, so it carries the inset the old mobile
            // title block used to provide.
            'flex w-full min-w-0 flex-1 flex-col items-center px-4 pt-5 sm:px-6 lg:w-auto lg:px-7 lg:py-7 xl:px-8',
            // Leave room for the fixed mobile hub bar when it is mounted.
            showMobileNav
              ? 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-10'
              : 'pb-10',
            center && 'justify-center',
          )}
        >
          <div
            className={cn(
              'flex min-h-0 w-full flex-col',
              // `my-auto` rather than `flex-1` so a centred interstitial keeps
              // its natural height instead of stretching to fill the section.
              center ? 'my-auto' : 'flex-1',
            )}
          >
            {filters ? (
              <MobileOnly>
                <div className="min-w-0">{filters}</div>
              </MobileOnly>
            ) : null}
            {children}
          </div>
        </section>
      </div>

      {showMobileNav ? <MobileBottomNav /> : null}
    </PageShell>
  );
}
