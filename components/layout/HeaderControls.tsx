// components/layout/HeaderControls.tsx
//
// The desktop header's signed-in controls, in the retail register (2026-11-22): a
// solid Sell button, then ink icons on round hover targets, then the avatar with a
// small caret. Read off Etsy and Depop rather than a SaaS toolbar:
//
//   - ICONS IN FULL INK, not muted grey. Grey icons in a row read as disabled chrome;
//     Etsy, Depop and Faire all draw theirs in the text colour.
//   - ROUND, TIGHT TARGETS. 40px circles 4px apart, so the icons read as one group
//     beside the search rather than a toolbar of square buttons. No labels; see
//     `HEADER_ICON_BUTTON` for why.
//   - SELL IN THE HEADER, filled, as Depop's "Sell now" is: on a peer-to-peer
//     marketplace it is the one action that applies on every page. Etsy keeps "Sell
//     on Etsy" in its account menu because its sellers are shops; ours are members.
//
// No `'use client'`: everything here is static markup, so it can be rendered from
// a server or a client module alike.

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * One icon control: a 40px ink circle. Shared by Messages and the bell.
 *
 * BARE, NOT LABELLED (2026-11-28). Labels were tried and taken out: stacked 12px
 * labels under icons read as a second, smaller nav beside the left side's 16px words,
 * and inline ones made Messages look like a section on a par with Marketplace. Words
 * on the left for places anyone can go, icons on the right for your own things, as
 * Etsy, eBay and StockX split it. Each icon names itself in a `HeaderTooltip`.
 *
 * Saved left the header at the same time: it is a browsing aid, the rail's Marketplace
 * group carries it on every workspace page, and the phone keeps it on the Account tab.
 *
 * Hover and open are the ghost button's ink tint, not the old lilac accent.
 */
export const HEADER_ICON_BUTTON = cn(
  'relative inline-flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full',
  'border border-transparent text-foreground transition-colors',
  'hover:bg-foreground/[0.06] active:bg-foreground/[0.1] focus:outline-none focus-visible:border-ring',
  'data-[state=open]:bg-foreground/[0.06]',
);

/**
 * The glyph inside {@link HEADER_ICON_BUTTON}: 22px, so `<Icon>` draws it in the
 * regular cut. Filled where you are, as the rail and the phone tab bar do.
 */
export const HEADER_ICON_GLYPH = 'size-[1.375rem]';

/** A count on the icon's shoulder, inside the round target, ringed in the page colour. */
export const HEADER_ICON_BADGE = 'absolute right-0.5 top-0.5 ring-2 ring-background';

/**
 * The Sell button. `lg` and up only: between `md` and `lg` the search is already at
 * its narrowest, and the workspace rail's Selling group carries "Sell an item" there.
 */
export function HeaderSellLink() {
  return (
    // Default size (36px from `md`): beside 40px icon circles, the 32px `sm` button
    // read as a tag rather than the header's one action.
    <Button asChild className="mr-snug hidden lg:inline-flex">
      <Link href="/listings/new">Sell</Link>
    </Button>
  );
}
