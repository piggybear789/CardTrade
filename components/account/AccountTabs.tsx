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

import { ViewTransition } from 'react';
import Link from 'next/link';
import { TabIndicator } from '@/components/motion/TabIndicator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'verification', label: 'Verification' },
  { id: 'payouts', label: 'Payouts' },
] as const;

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

export function AccountTabs({ activeTab }: { activeTab: string }) {
  return (
    <nav aria-label="Account sections" className={NAV_SHAPE}>
      <ul className={TRACK_SHAPE}>
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <li key={tab.id} className="min-w-0">
              <Link
                href={tab.id === 'profile' ? '/profile' : `/profile?tab=${tab.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  ITEM_SHAPE,
                  'touch-manipulation transition-colors',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:border-iris',
                  active ? 'text-foreground' : 'text-muted-foreground md:hover:text-foreground',
                )}
              >
                {/* THE CHIP IS ITS OWN ELEMENT SO IT CAN TRAVEL. As a background on
                    the link it could only cut from one segment to the next; named and
                    shared, exactly one is mounted at a time and the pair that forms
                    across a tab change morphs its rectangle, so the selection slides
                    the way a native segmented control does. */}
                {active ? (
                  <ViewTransition name="account-tab-chip" share="morph">
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-md bg-card shadow-sm md:hidden"
                    />
                  </ViewTransition>
                ) : null}
                {/* Above the chip, which is painted into the same box. */}
                <span className="relative truncate">{tab.label}</span>
                {/* Underline only exists in the desktop presentation; on the phone
                    the chip carries selection. */}
                {active ? <TabIndicator layoutId="account-tabs" className="hidden md:block" /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
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
