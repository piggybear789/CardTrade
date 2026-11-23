'use client';

// components/listings/NewListingPill.tsx
//
// The "New" badge on a catalog cover: a listing published in the last 24 hours. The
// retail grids measured (Courtyard's "just now", StockX and Alt's status chips) mark
// freshness on the photo, and it is a fact that genuinely varies from tile to tile,
// unlike "ID verified", which every seller is by construction (see `SellerReputation`).
//
// A CLIENT ISLAND because the answer depends on the clock. `CatalogItemCard` also
// renders from Server Components (a seller's shop, My Listings, Saved), and a tile
// that decided "new" during the server render and again during hydration would
// disagree with itself whenever a listing crossed the 24-hour line in between. So the
// server renders nothing here and the badge appears once the page hydrates. It is
// absolutely positioned on the cover, so its arrival moves nothing.

import { useSyncExternalStore } from 'react';

import { cn } from '@/lib/utils';

/** How long a listing counts as new. */
export const NEW_LISTING_MS = 24 * 60 * 60 * 1000;

const MINUTE_MS = 60_000;

function subscribeToNothing(): () => void {
  return () => {};
}

// Minute precision, so the repeated snapshot reads React makes within one render
// return the same value. A number, so equal reads compare equal.
const readMinute = () => Math.floor(Date.now() / MINUTE_MS);
const readOnServer = () => null;

/** Whether `listedAt` falls inside the new window at `nowMs`. */
export function isNewListing(listedAt: string | null | undefined, nowMs: number): boolean {
  if (!listedAt) return false;
  const listed = Date.parse(listedAt);
  if (!Number.isFinite(listed)) return false;
  // No lower bound: `nowMs` is floored to the minute, and a viewer's clock may run
  // behind the server's, so a listing made seconds ago can read as slightly in the
  // future. That is still new.
  return nowMs - listed < NEW_LISTING_MS;
}

export function NewListingPill({
  listedAt,
  className,
}: {
  /** `items.created_at`, or null to never show the badge (a sold or reserved tile). */
  listedAt: string | null | undefined;
  className?: string;
}) {
  const minute = useSyncExternalStore(subscribeToNothing, readMinute, readOnServer);
  if (minute === null || !isNewListing(listedAt, minute * MINUTE_MS)) return null;

  return (
    <span
      className={cn(
        // The heart chip's family: opaque card, `foreground/10` edge, ink label. On a
        // photo it has to hold its own edge, which a tint would not.
        'inline-flex items-center rounded-sm border border-foreground/10 bg-card px-1.5 py-0.5 text-meta font-semibold text-foreground',
        className,
      )}
    >
      New<span className="sr-only"> listing</span>
    </span>
  );
}
