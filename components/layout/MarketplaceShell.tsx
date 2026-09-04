// components/layout/MarketplaceShell.tsx
//
// Shared workspace layout for every signed-in marketplace surface:
// browse, deals, messages, notifications, account, sales, trades, profile,
// and admin. The rail stays docked to the left edge. Only the content column
// is capped at `max-w-workspace` and centred in the remaining space, so
// ultrawide viewports do not stretch lists, grids, or 50/50 splits. Desktop keeps a
// sticky proportional rail; below `lg`, navigation moves to MobileBottomNav
// (hubs + sheets) so content is not buried under chips.
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

import {
  DesktopOnly,
  MobileOnly,
} from '@/components/layout/Breakpoint';
import { MarketplaceNav } from '@/components/layout/MarketplaceNav';
import { PageShell } from '@/components/layout/PageShell';
import { DirectionalTransition } from '@/components/motion/DirectionalTransition';
import { cn } from '@/lib/utils';

export { RailPrimaryAction } from '@/components/layout/RailPrimaryAction';

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
  // The auth read that used to live here is gone. It existed only to decide whether
  // to reserve room for the hub bar, and the bar is now mounted below `md` for every
  // visitor — so the answer is unconditionally yes and there is nothing to ask.
  //
  // That also settles a real layout shift: `MarketplaceShellSkeleton` always reserved
  // the space (it renders inside `loading.tsx` and has no session to read), so a guest
  // saw 5.5rem of padding collapse to 2.5rem the moment the page resolved.

  return (
    <DirectionalTransition>
    <PageShell className="min-h-0 flex-1 self-stretch px-0 py-0 sm:px-0 sm:py-0 lg:px-0 lg:py-0">
      {/* Below `lg` the rail is gone, so the <h1> has no visible home — and it
          does not need one. The page's SectionHeader already names the section
          on screen; printing the title here as well is the same page titled
          twice, one line apart. Kept off-screen so the outline still starts at
          an h1 and screen-reader users get the section name. */}
      <h1 className="sr-only md:hidden">{title}</h1>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-stretch md:flex-row">
        {/* Rail width is proportional (20% of the workspace) so it scales with
            the viewport. The min/max keep it usable at the extremes: a floor so
            the nav labels never crush on smaller laptops, and a cap so it does
            not sprawl on ultrawide displays. */}
        {/* The rail is desktop-only in full: below `lg` its section links live
            in MobileBottomNav and its filters render in the content column, so
            nothing is left to mount. */}
        <aside
          style={{ viewTransitionName: 'persistent-nav' }}
          // `bg-sidebar`, not `bg-card`: the rail is the layer BELOW the page
          // (96% against the page's 98%), where a card sits above it at 100%.
          // The old 28px/4.5% shadow is gone — it was below the perceptual
          // floor, so the border and the surface step do the separating on
          // their own.
          className="hidden w-full min-w-0 px-4 sm:px-6 md:block md:w-1/5 md:min-w-[13.5rem] md:max-w-[19rem] md:shrink-0 md:self-stretch md:border-r md:border-border md:bg-sidebar md:px-5"
        >
          {/* The rail background stretches the full column; its contents stay in
              view. The inset px-1/-mx-1 pair gives focus rings room to draw: setting
              overflow on one axis makes this a scroll container on both, which
              otherwise clips the ring-offset on controls at the rail's edges.
              The rail still scrolls by wheel, drag, and keyboard when its
              contents outgrow the viewport, but the bar itself is hidden: it
              rendered as a full-width gutter down the middle of the workspace. */}
          {/* Header chrome is 4rem content + 1px bottom border: both terms
              must appear here, or the rail runs 1px taller than the space
              under the header and stretches the whole workspace row 1px past
              the viewport — a permanent hairline page scroll. */}
          {/* `py-5`, down from `py-7`. The rail has a hard ceiling — the
              viewport minus the header — and its contents are a fixed height
              that does not respond to it, so every 8px of padding is 8px the
              nav does not get. See MarketplaceNav for the rest of that trim. */}
          <div className="flex flex-col md:sticky md:top-[calc(4rem+1px+env(safe-area-inset-top))] md:-mx-1 md:h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))] md:gap-6 md:overflow-y-auto md:overscroll-contain md:px-1 md:py-5 md:[-ms-overflow-style:none] md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden">
            <div className="hidden md:block">
              {/* SUBORDINATE TO THE CONTENT HEADING, ON PURPOSE. This and the
                  page's own heading were both `text-head` semibold, so two
                  titles sat 200px apart at identical weight and neither led.
                  The rail names the SECTION ("Marketplace"); the content names
                  the VIEW ("All Listings"). That is a real hierarchy — it just
                  needed a size difference to read as one. Semantics are
                  unchanged: this is still the h1 for every shell route. */}
              <h1 className="text-balance font-display text-subhead font-semibold tracking-[-0.02em] text-foreground/80">
                {title}
              </h1>
              {/* The rail CTA is sized HERE, not on RailPrimaryAction: the same
                  node is also handed to SectionHeader's `mobileAction` by half a
                  dozen sections, so raising the component's own size would grow
                  a phone header button nobody asked to grow. Scoping it to the
                  rail slot keeps every other button in the app untouched. */}
              {primaryAction ? (
                <div className="mt-4 md:[&>a]:!h-11 md:[&>a]:text-nav md:[&>a>svg]:size-4 md:[&>button]:!h-11 md:[&>button]:text-nav md:[&>button>svg]:size-4">
                  {primaryAction}
                </div>
              ) : null}
            </div>

            {/* Filters sit under Marketplace on desktop; below `lg` they render
                in the content column instead (see MobileOnly below). */}
            <MarketplaceNav primaryExtras={<DesktopOnly>{filters}</DesktopOnly>} />
          </div>
        </aside>

        <section
          className={cn(
            'flex w-full min-w-0 flex-1 flex-col items-center bg-background md:w-auto md:bg-transparent',
            // Flush routes (thread, live contract) take no inset of their own on
            // three sides, because the two consumers want different frames and
            // only one of them wants none. The thread's own chrome — the thread
            // bar, the muted item bar — IS the top of the page and docks against
            // the chrome above it, edge to edge; an outer inset there is a band
            // of page background between two bars, which reads as the room
            // hanging below the header rather than filling the viewport. A
            // contract room is bordered cards and needs a gutter, so it paints
            // its own `md:px-4 md:pt-4` (see CashSaleView). Bottom is the
            // exception and is set below: the composer needs clearance from the
            // viewport edge, and a room that frames itself matches it.
            //
            // A flush room that declares a `100dvh - chrome` height must subtract
            // THIS branch's padding — 4rem header + 1px + the `pb-4` below — not
            // the non-flush figures on the next line.
            //
            // Below `lg` the non-flush column is the top of the page now that the
            // shell prints no header, so it carries the inset the old mobile title
            // block used to provide.
            //
            // Do not pair this with a later `px-0` override: competing
            // `md:px-7` / `xl:px-8` in one `cn()` is how the 28px columns come back.
            flush ? 'px-0 pt-0' : 'px-4 pt-3 sm:px-6 md:px-7 md:py-7 xl:px-8',
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
            // The subtrahends are real chrome. Phone flush routes use compact cream
            // chrome (safe-area only). Desktop still subtracts the dark header:
            // `h-16` (4rem) + 1px border + the top inset. The mobile hub bar is
            // `h-14` (3.5rem) + 1px top border + the bottom inset.
            flush &&
              'max-h-[calc(100dvh-env(safe-area-inset-top)-3.5rem-1px-env(safe-area-inset-bottom))] md:max-h-[calc(100dvh-4rem-1px-env(safe-area-inset-top))]',
            // Leave room for the fixed mobile hub bar.
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
            //
            // Kept at a single 16px at every width so a docked composer can sit
            // optically centred in the band below its own rule: the composer
            // supplies the space above the field, this supplies the space below,
            // and the two have to match. At `md:pb-7` there was 28px under the
            // field against 12px over it, which read as the field riding high.
            flush ? 'pb-4' : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-10',
            center && 'justify-center',
          )}
        >
          <div
            className={cn(
              'mx-auto flex min-h-0 w-full max-w-workspace flex-col',
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
    </PageShell>
    </DirectionalTransition>
  );
}
