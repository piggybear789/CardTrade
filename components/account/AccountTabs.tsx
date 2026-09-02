'use client';

// components/account/AccountTabs.tsx
//
// TWO PRESENTATIONS OF ONE NAV. On phones this is a segmented control; from `md` it
// is the underlined tab strip it has always been.
//
// WHY THEY DIFFER. A signed-in phone already carries a bottom tab bar with "Account"
// in it, so a second underlined tab row directly beneath the page title read as two
// competing navigations stacked on top of each other — and underline tabs are a
// pointer-era affordance anyway: the target is the word, and the rule under it is the
// only thing saying they are a set. A segmented control makes the set explicit,
// gives each option a full-height touch target instead of a text-sized one, and is
// what a member coming from any other phone app already knows.
//
// Desktop keeps the underline: there is no bottom bar to compete with, the pointer
// makes small targets fine, and the strip lines up with the tabbed surfaces
// elsewhere in the app.
//
// SWITCHING IS NO LONGER A NAVIGATION. Each tab used to be a `<Link>` to
// `/profile?tab=…`, so changing tab refetched the whole server tree: an `auth.getUser`,
// the profile row, the identity and payout reads, and then whichever of the live Stripe
// payment-method call or the seven-query payouts chain that tab needed. That is the lag.
//
// The page now renders all three panels once and hands them here, so a tab change is
// local state and nothing crosses the network. The panels are held in `<Activity>`
// rather than conditionally rendered, which buys two things: a panel keeps its DOM and
// state while hidden, and a HIDDEN panel's effects are torn down — so the identity
// read-back and its Stripe poll inside `VerificationSequence` do not run for a member
// who only ever opens Profile.
//
// THE TABS ARE STILL LINKS. Real hrefs keep deep links, middle-click, copy-link and the
// no-JS path working; the click handler intercepts only a plain left click. History is
// kept in step with `pushState`, which the App Router supports and which — unlike
// `router.push` — does not refetch the server tree, so Back still moves between tabs
// without reintroducing the round trip.

import {
  Activity,
  startTransition,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { m } from 'motion/react';
import {
  ACCOUNT_TABS as TABS,
  accountTabHref as tabHref,
  resolveAccountTab,
  type AccountTabId,
} from '@/components/account/account-tabs-config';
import { TabIndicator } from '@/components/motion/TabIndicator';
import { Skeleton } from '@/components/ui/skeleton';
import { MOTION_TRANSITION } from '@/lib/motion/tokens';
import { cn } from '@/lib/utils';

// The tab list, the id type and the two pure helpers live in `account-tabs-config`,
// which carries no `'use client'`. They are imported rather than re-exported: a
// re-export from this file would still be a client reference, so the Server Component
// page would keep getting a proxy it cannot call. See the note in that file.

// GEOMETRY LIVES HERE ONCE, so `AccountTabsSkeleton` cannot drift away from the real
// strip. The loading state used to draw its own underlined nav with its own gaps and
// heights; when this became a segmented control the placeholder silently kept the old
// shape, and the page jumped as it resolved.
const NAV_SHAPE = 'mb-group md:mb-section md:border-b';
const TRACK_SHAPE = [
  // Phone: one segmented track, thirds, no scroll — three short labels fit at 320px.
  'grid grid-cols-3 gap-tight rounded-lg bg-muted p-1',
  // Desktop: back to an inline underlined strip.
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
  'relative flex min-h-9 items-center justify-center rounded-md px-tight',
  'text-body font-medium',
  'md:min-h-0 md:justify-start md:rounded-none md:px-tight md:pb-cozy',
].join(' ');

export interface AccountTabsProps {
  /** Resolved on the server from `?tab=`, so a deep link opens on the right panel. */
  initialTab: AccountTabId;
  /** All three panels, server-rendered once. Hidden ones cost no effects. */
  panels: Record<AccountTabId, ReactNode>;
}

export function AccountTabs({ initialTab, panels }: AccountTabsProps) {
  const [activeTab, setActiveTab] = useState<AccountTabId>(initialTab);

  // `pushState` leaves a history entry but fires no navigation, so Back has to be
  // answered here or it would silently leave the URL and the panel disagreeing.
  useEffect(() => {
    function onPopState() {
      const raw = new URLSearchParams(window.location.search).get('tab');
      startTransition(() => setActiveTab(resolveAccountTab(raw)));
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  function selectTab(id: AccountTabId) {
    if (id === activeTab) return;
    window.history.pushState(null, '', tabHref(id));
    // A Transition rather than a bare `setState`: `<Activity>` pre-renders the hidden
    // panels at offscreen priority, and a switch that arrives before one of them has
    // finished would otherwise block the strip's own feedback on completing it. It is
    // no longer here to arm a view transition — Motion animates the chip on commit at
    // any priority.
    startTransition(() => setActiveTab(id));
  }

  return (
    <>
      <nav aria-label="Account sections" className={NAV_SHAPE}>
        <ul className={TRACK_SHAPE}>
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <li key={tab.id} className="min-w-0">
                <Link
                  href={tabHref(tab.id)}
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
                    selectTab(tab.id);
                  }}
                  className={cn(
                    ITEM_SHAPE,
                    'touch-manipulation transition-colors',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:border-iris',
                    active ? 'text-foreground' : 'text-muted-foreground md:hover:text-foreground',
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
                      layoutId="account-tab-chip"
                      aria-hidden
                      transition={MOTION_TRANSITION}
                      className="absolute inset-0 rounded-md bg-card shadow-sm md:hidden"
                    />
                  ) : null}
                  {/* Above the chip, which is painted into the same box. */}
                  <span className="relative truncate">{tab.label}</span>
                  {/* Underline only exists in the desktop presentation; on the phone
                      the chip carries selection. */}
                  {active ? (
                    <TabIndicator layoutId="account-tabs" className="hidden md:block" />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* The panel crossfade that used to wrap this is gone with the navigation it was
          masking. It existed because a tab change blanked the panel and repainted it
          from a fresh server render; a local state swap has no blank to hide, and fading
          a panel that is already there just delays it. The chip morph above stays —
          that one animates the SELECTION, which is still a real change. */}
      {TABS.map((tab) => (
        <Activity key={tab.id} mode={tab.id === activeTab ? 'visible' : 'hidden'}>
          {panels[tab.id]}
        </Activity>
      ))}
    </>
  );
}

/**
 * The strip's loading placeholder, drawn from the same shape constants as the strip
 * itself so it occupies an identical box.
 *
 * The first segment carries the chip because Profile is where `/profile` lands, which
 * keeps the resolved state from appearing to move. Nothing here is interactive:
 * `loading.tsx` cannot read the query string, so it must not render links that claim
 * to know which tab is current.
 */
export function AccountTabsSkeleton() {
  return (
    <div className={NAV_SHAPE} aria-hidden>
      <div className={TRACK_SHAPE}>
        {TABS.map((tab, index) => (
          <div
            key={tab.id}
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
