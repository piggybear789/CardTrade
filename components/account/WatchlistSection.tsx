// components/account/WatchlistSection.tsx
//
// The "Saved" section of the Account hub: the caller's watchlist (saved items),
// newest-saved first, rendered as a responsive grid using the same ItemCard
// used across the marketplace. An empty state links back to browse.

import { Heart } from 'lucide-react';

import { ItemCard } from '@/components/listings/ItemCard';
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
        icon={<Heart className="size-6" aria-hidden />}
        title="You haven't saved anything yet"
        description="Tap the heart on any listing to save it here for later."
        ctaLabel="Browse the marketplace"
        ctaHref="/listings"
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
    <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
      {sorted.map((item) => (
        <ItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}
