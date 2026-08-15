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
  primaryAction,
  filters,
  center = false,
  flush = false,
  children,
}: {
  /**
   * Section title. The page <h1>: visible in the rail on desktop, and kept for
   * the document outline and assistive tech below `lg`, where the page's own
   * SectionHeader carries the visible heading.
   */
  title: string;
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
  /**
   * The page fills the viewport and must not scroll outside its own internal area.
   *
   * Removes bottom padding and adds `overflow-hidden` to the content section so the
   * shell cannot push its children past the viewport edge. Used by pages like the
   * message thread where only one internal region scrolls and a second scrollbar on
   * the document body is incorrect.
   */
  flush?: boolean;
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const showMobileNav = Boolean(user);

  // Staff capability for the rail's Staff group. Read through the cookie-bound client,
  // so RLS scopes it to the caller's own row and a member cannot ask about anyone else.
  //
  // TWO BOOLEANS, not the resolved links. `MarketplaceNav` is a Client Component and a
  // nav link carries a Lucide `icon` — a component, not data — so handing it the
  // resolved array threw "Only plain objects can be passed to Client Components from
  // Server Components" on every page mounting the shell. The nav resolves its own icons.
  //
  // One indexed primary-key lookup, and navigation only: `requireStaff` and
  // `requireAdmin` re-check on every staff surface and action, because hiding a link is
  // not authorization.
  let staff: { isStaff: boolean; isAdmin: boolean } | undefined;
  if (user) {
    const { data: capability } = await supabase
      .from('profiles')
      .select('is_admin, is_support')
      .eq('id', user.id)
      .maybeSingle();
    staff = {
      isAdmin: Boolean(capability?.is_admin),
      isStaff: Boolean(capability?.is_support),
    };
  }

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
              <h1 className="text-balance font-display text-head font-semibold tracking-[-0.03em]">
                {title}
              </h1>
              {primaryAction ? <div className="mt-4">{primaryAction}</div> : null}
            </div>

            {/* Filters sit under Marketplace on desktop; below `lg` they render
                in the content column instead (see MobileOnly below). */}
            <MarketplaceNav
              primaryExtras={<DesktopOnly>{filters}</DesktopOnly>}
              staff={staff}
            />

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
            // `min-h-0` IS THE WHOLE FIX for a full-viewport page, and its absence here
            // was the single break in an otherwise complete shrink chain. `body`,
            // `#main-content`, the PageShell `<main>`, the row, the inner wrapper and the
            // ChatThread all carry it; this section did not. A flex item defaults to
            // `min-height: auto` and refuses to shrink below its content, so no descendant
            // scroll container could ever be constrained — the section grew the document
            // instead, which is exactly the second scrollbar.
            //
            // Applied only when `flush`, because a normal long page must still grow and
            // let the body scroll.
            flush && 'min-h-0 overflow-hidden',
            // AND A DEFINITE CEILING, which `min-h-0` alone cannot supply. `<body>` is
            // `min-h-dvh` — a MINIMUM — so its own height is content-derived. In a column
            // flex container sized by its content there is no free space to distribute, so
            // every `flex-1` descendant resolves to its CONTENT height no matter how many
            // `min-h-0`s the chain carries: `min-h-0` grants permission to shrink, it does
            // not impose a size. A long thread therefore grew <body> past the viewport,
            // pushed the composer below this section's clip boundary, and scrolled the
            // document instead of the message list — the exact symptom.
            //
            // `max-h`, not `h`: `flex-1` is `flex: 1 1 0%`, and that basis overrides
            // `height` as the flex base size, whereas `max-height` clamps after flex
            // sizing. So a short thread still stretches to fill the column, and only a
            // long one stops at the viewport edge.
            //
            // The subtrahends are real chrome, not round numbers: the header is `h-16`
            // (4rem) + its 1px bottom border + the top safe-area inset, and the mobile hub
            // bar is `h-14` (3.5rem) + its 1px top border + the bottom inset. The rail
            // computes its own height from the same header terms, and for the same reason.
            flush &&
              (showMobileNav
                ? 'max-h-[calc(100dvh-4rem-1px-env(safe-area-inset-top)-3.5rem-1px-env(safe-area-inset-bottom))] lg:max-h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))]'
                : 'max-h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))]'),
            // Leave room for the fixed mobile hub bar when it is mounted.
            //
            // A flush page takes ORDINARY bottom padding, and this is a reversal worth
            // stating: it used to take `pb-0` because, with no ceiling on the section,
            // bottom padding was height added on top of a child already sized to fill the
            // viewport, so it pushed content out of view. The `max-h` above changed that.
            // Tailwind sets `box-sizing: border-box`, so padding now comes OUT of the
            // capped height rather than adding to it — it shortens the scroll area by
            // exactly itself and gives the composer breathing room instead of welding it
            // to the viewport edge. The mobile hub bar is already subtracted from the cap,
            // so this is clearance from the bar, not a substitute for it.
            flush
              ? 'pb-4 lg:pb-7'
              : showMobileNav
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
