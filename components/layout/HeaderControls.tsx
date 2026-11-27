// components/layout/HeaderControls.tsx
//
// The desktop header's signed-in controls, in the retail register (2026-11-22): a
// solid Sell button, then ink icons on round hover targets, then the avatar with a
// small caret. Read off Etsy and Depop rather than a SaaS toolbar:
//
//   - ICONS IN FULL INK, not muted grey. Grey icons in a row read as disabled chrome;
//     Etsy, Depop and Faire all draw theirs in the text colour.
//   - ROUND, TIGHT TARGETS. 40px circles 4px apart, so the icons read as one group
//     beside the search rather than a toolbar of square buttons.
//   - SELL IN THE HEADER, filled, as Depop's "Sell now" is: on a peer-to-peer
//     marketplace it is the one action that applies on every page. Etsy keeps "Sell
//     on Etsy" in its account menu because its sellers are shops; ours are members.
//
// No `'use client'`: everything here is static markup, so it can be rendered from
// a server or a client module alike.

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** One icon control: a 40px ink circle. Shared by Saved, Messages and the bell. */
export const HEADER_ICON_BUTTON = cn(
  'relative inline-flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full',
  'border border-transparent text-foreground transition-colors',
  'hover:bg-accent focus:outline-none focus-visible:border-ring',
  'data-[state=open]:bg-accent',
);

/**
 * The icon glyph inside {@link HEADER_ICON_BUTTON}: 22px, so `<Icon>` draws it in the
 * regular cut, a 1.4px line (the old `HEADER_ICON_STROKE` 1.75 nudge is not needed).
 */
export const HEADER_ICON_GLYPH = 'size-[1.375rem]';

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
