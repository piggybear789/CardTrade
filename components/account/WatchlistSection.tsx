// components/account/WatchlistSection.tsx
//
// The "Saved" section of the Account hub: the caller's watchlist (saved items),
// newest-saved first, rendered as the same compact catalog tiles as browse.

import { HugeiconsIcon } from '@hugeicons/react';
import { HeartIcon } from '@hugeicons/core-free-icons';

import { CATALOG_TILE_GRID } from '@/components/listings/catalogGrid';
import { CatalogItemCard } from '@/components/listings/ItemCard';
import { EmptyState } from '@/components/account/EmptyState';
import type { WatchlistEntry } from '@/lib/actions/watchlist';

/** Sort order so saved AVAILABLE items surface first, others sink down. */
const STATUS_ORDER: Record<string, number> = {
  AVAILABLE: 0,
  RESERVED: 1,
  SOLD: 2,
};

export function WatchlistSection({ items }: { items: WatchlistEntry[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<HugeiconsIcon icon={HeartIcon} className="size-6" aria-hidden />}
        title="No Saved Listings Yet"
        description="Tap the heart on any listing to save it here for later."
        ctaLabel="Browse the marketplace"
        ctaHref="/"
      />
    );
  }

  // Under-contract/sold saved items sink below still-available ones, mirroring
  // the catalog and My Listings ordering (Req 3.8 UX). Stable sort preserves
  // the newest-saved-first order within each status group.
  const sorted = [...items].sort(
    (a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3),
  );

  return (
    <div className={CATALOG_TILE_GRID}>
      {sorted.map((item) => (
        <CatalogItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
