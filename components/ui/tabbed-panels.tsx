'use client';

// components/ui/tabbed-panels.tsx
//
// ONE tab strip for every tabbed surface. Lifted out of `AccountTabs` when the
// seller profile needed the same thing, because that file already carried a comment
// explaining that its geometry had to live in constants so the skeleton could not
// drift from the real strip — and a second hand-rolled copy on another route is the
// same drift one level up.
//
// TWO PRESENTATIONS OF ONE NAV. On phones this is a segmented control; from `md` it
// is an underlined tab strip.
//
// WHY THEY DIFFER. A signed-in phone already carries a bottom tab bar, so a second
// underlined tab row directly beneath the page title read as two competing
// navigations stacked on top of each other — and underline tabs are a pointer-era
// affordance anyway: the target is the word, and the rule under it is the only thing
// saying they are a set. A segmented control makes the set explicit, gives each
// option a full-height touch target instead of a text-sized one, and is what a member
// coming from any other phone app already knows.
//
// Desktop keeps the underline: there is no bottom bar to compete with, the pointer
// makes small targets fine, and the strip lines up with the tabbed surfaces
// elsewhere in the app.
//
// SWITCHING IS NOT A NAVIGATION. Each tab used to be a `<Link>` to `?tab=…`, so
// changing tab refetched the whole server tree — on the Account hub that meant an
// `auth.getUser`, the profile row, the identity and payout reads, and then whichever
// of the live Stripe payment-method call or the seven-query payouts chain that tab
// needed. That is the lag.
//
// A surface renders all its panels once and hands them here, so a tab change is local
// state and nothing crosses the network. The panels are held in `<Activity>` rather
// than conditionally rendered, which buys two things: a panel keeps its DOM and state
// while hidden, and a HIDDEN panel's effects are torn down — so a read-back or a poll
// inside a panel does not run for a member who never opens it.
//
// THE TABS ARE STILL LINKS. Real hrefs keep deep links, middle-click, copy-link and
// the no-JS path working; the click handler intercepts only a plain left click.
// History is kept in step with `pushState`, which the App Router supports and which —
// unlike `router.push` — does not refetch the server tree, so Back still moves
// between tabs without reintroducing the round trip.

import {
  Activity,
  startTransition,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { m } from 'motion/react';

import { TabIndicator } from '@/components/motion/TabIndicator';
import { Skeleton } from '@/components/ui/skeleton';
import { MOTION_TRANSITION } from '@/lib/motion/tokens';
import { cn } from '@/lib/utils';

// GEOMETRY LIVES HERE ONCE, so `TabbedPanelsSkeleton` cannot drift away from the real
// strip. A loading state that draws its own underlined nav with its own gaps and
// heights silently keeps the old shape when the strip changes, and the page jumps as
// it resolves.
const NAV_SHAPE = 'mb-group md:mb-section md:border-b';
const TRACK_SHAPE = [
  // Phone: one segmented track, equal columns, no scroll.
  //
  // `auto-cols-fr grid-flow-col` rather than `grid-cols-N`: the count varies by
  // surface — and on the seller profile by whether that seller has sold anything —
  // so a static column class would need a lookup table keyed on length. Implicit
  // columns give equal thirds for three tabs and equal halves for two, with the same
  // `minmax(0, 1fr)` that keeps `truncate` working on the labels.
  'grid auto-cols-fr grid-flow-col gap-tight rounded-lg bg-muted p-1',
  // Desktop: `flex` wins over `grid`, so the auto-flow above stops applying.
  'md:-mb-px md:flex md:gap-section md:rounded-none md:bg-transparent md:p-0',
].join(' ');
// NO `truncate` ON THE ITEM. Truncation belongs to the label span, which is the
// box the text actually overflows; putting it here as well bought nothing and
// cost `overflow: hidden`, which clipped the desktop underline. `TabIndicator`
// sits at `-bottom-px` so 1px of its 2px hangs outside the item's box to
// straddle the strip's rule — with the clip it painted at half height, its
// `rounded-t-full` ends reduced to the narrowest slice of the radius, so the
// active marker read as a thin tapered hairline sitting ON the rule rather than
// a bar under it.
const ITEM_SHAPE = [
  'relative flex min-h-9 items-center justify-center gap-tight rounded-md px-tight',
  'text-body font-medium',
  'md:min-h-0 md:justify-start md:rounded-none md:px-tight md:pb-cozy',
].join(' ');

/**
 * One tab in a strip.
 *
 * `href` is PRECOMPUTED rather than derived from a function prop: a Server Component
 * cannot hand a client component a function, so an `hrefFor` callback would only work
 * for strips whose owner is itself a client component. Plain strings work everywhere.
 */
export interface TabDescriptor<Id extends string = string> {
  id: Id;
  label: string;
  /** Where this tab lives, for deep links, middle-click and the no-JS path. */
  href: string;
  /**
   * Optional figure after the label — a listing or review count.
   *
   * Pass `undefined`, not `0`, to hide it. A count is a reason to open a tab, and
   * "Reviews 0" is a reason not to bother rendering one.
   */
  count?: number;
}

export interface TabbedPanelsProps<Id extends string> {
  /**
   * The tabs to draw, in order. May vary by request — the first entry is the
   * fallback when the URL names a tab that is not in this list.
   */
  tabs: readonly TabDescriptor<Id>[];
  /** Resolved on the server from the query string, so a deep link opens correctly. */
  initialTab: Id;
  /**
   * Every panel, server-rendered once. Hidden ones cost no effects.
   *
   * Keyed by every id the surface knows about, which may be more than `tabs`
   * contains: a panel with no tab is simply never rendered.
   */
  panels: Record<Id, ReactNode>;
  /** `aria-label` for the nav, e.g. "Account sections". */
  label: string;
  /**
   * Distinct per surface. Two strips sharing a Motion `layoutId` would each try to
   * own the one marker and tween it between pages.
   */
  layoutId: string;
  /** Query parameter the strip reads when answering Back. Defaults to `tab`. */
  param?: string;
}

export function TabbedPanels<Id extends string>({
  tabs,
  initialTab,
  panels,
  label,
  layoutId,
  param = 'tab',
}: TabbedPanelsProps<Id>) {
  const [activeTab, setActiveTab] = useState<Id>(initialTab);

  // `pushState` leaves a history entry but fires no navigation, so Back has to be
  // answered here or it would silently leave the URL and the panel disagreeing.
  useEffect(() => {
    function onPopState() {
      const raw = new URLSearchParams(window.location.search).get(param);
      const match = tabs.find((tab) => tab.id === raw);
      startTransition(() => setActiveTab(match ? match.id : tabs[0].id));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [param, tabs]);

  function selectTab(id: Id, href: string) {
    if (id === activeTab) return;
    window.history.pushState(null, '', href);
    // A Transition rather than a bare `setState`: `<Activity>` pre-renders the hidden
    // panels at offscreen priority, and a switch that arrives before one of them has
    // finished would otherwise block the strip's own feedback on completing it.
    startTransition(() => setActiveTab(id));
  }

  return (
    <>
      <nav aria-label={label} className={NAV_SHAPE}>
        <ul className={TRACK_SHAPE}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <li key={tab.id} className="min-w-0">
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  onClick={(event) => {
                    // Anything but a plain left click is the member asking the BROWSER
                    // for something — a new tab, a copied address — so it is left alone.
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return;
                    }
                    event.preventDefault();
                    selectTab(tab.id, tab.href);
                  }}
                  className={cn(
                    ITEM_SHAPE,
                    'touch-manipulation transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:border-iris',
                    active
                      ? 'text-foreground'
                      : 'text-muted-foreground md:hover:text-foreground',
                  )}
                >
                  {/* THE CHIP IS ITS OWN ELEMENT SO IT CAN TRAVEL. As a background on
                      the link it could only cut from one segment to the next; sharing a
                      `layoutId` means exactly one is mounted at a time and Motion tweens
                      the rectangle from the outgoing segment to the incoming one, so the
                      selection slides the way a native segmented control does. Same
                      mechanism as the desktop underline below.

                      IT USED TO BE A `<ViewTransition>`, and that is what made switching
                      tabs feel like it hung. The only way to start one is
                      `document.startViewTransition`, which suspends rendering of the
                      WHOLE document while it rasterises a full-viewport snapshot plus one
                      per named element — `site-header` and its backdrop-blur included —
                      runs the mutation, forces layout and snapshots again. Nothing paints
                      for that entire window, and it lands BEFORE the swap is visible,
                      which is the pause. React then cancels the root cross-fade after the
                      fact, so the page-sized snapshot bought nothing; and the chip is
                      `md:hidden`, so on desktop the freeze was animating an element that
                      was not rendered. Motion touches this one element instead. */}
                  {active ? (
                    <m.span
                      layoutId={`${layoutId}-chip`}
                      aria-hidden
                      transition={MOTION_TRANSITION}
                      className="absolute inset-0 rounded-md bg-card shadow-sm md:hidden"
                    />
                  ) : null}
                  {/* Above the chip, which is painted into the same box. */}
                  <span className="relative truncate">{tab.label}</span>
                  {tab.count !== undefined ? (
                    // `tabular-nums` so a count changing from 9 to 10 does not shift the
                    // label beside it. Not announced separately: it is part of the tab's
                    // accessible name by virtue of being inside the link.
                    <span className="relative text-meta tabular-nums text-muted-foreground">
                      {tab.count}
                    </span>
                  ) : null}
                  {/* Underline only exists in the desktop presentation; on the phone
                      the chip carries selection. */}
                  {active ? (
                    <TabIndicator
                      layoutId={`${layoutId}-underline`}
                      className="hidden md:block"
                    />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* No panel crossfade. It existed when a tab change blanked the panel and
          repainted it from a fresh server render; a local state swap has no blank to
          hide, and fading a panel that is already there just delays it. The chip morph
          above stays — that one animates the SELECTION, which is still a real change. */}
      {tabs.map((tab) => (
        <Activity key={tab.id} mode={tab.id === activeTab ? 'visible' : 'hidden'}>
          {panels[tab.id]}
        </Activity>
      ))}
    </>
  );
}

/**
 * A strip's loading placeholder, drawn from the same shape constants as the strip
 * itself so it occupies an identical box.
 *
 * The first segment carries the chip because that is where a bare URL lands, which
 * keeps the resolved state from appearing to move. Nothing here is interactive: a
 * `loading.tsx` cannot read the query string, so it must not render links that claim
 * to know which tab is current.
 */
export function TabbedPanelsSkeleton({
  labels,
}: {
  /** The real labels, so each segment reserves the width its text will need. */
  labels: readonly string[];
}) {
  return (
    <div className={NAV_SHAPE} aria-hidden>
      <div className={TRACK_SHAPE}>
        {labels.map((text, index) => (
          <div
            key={text}
            className={cn(
              ITEM_SHAPE,
              index === 0 ? 'bg-card shadow-sm md:bg-transparent md:shadow-none' : null,
            )}
          >
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
