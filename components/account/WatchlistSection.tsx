// components/account/WatchlistSection.tsx
//
// The "Saved" section of the Account hub: the caller's watchlist (saved items),
// newest-saved first, rendered as the same compact catalog tiles as browse.

import { HugeiconsIcon } from '@hugeicons/react';
import { HeartIcon } from '@hugeicons/core-free-icons';

import { CATALOG_TILE_GRID } from '@/components/listings/catalogGrid';
import { CatalogItemCard } from '@/components/listings/ItemCard';
import { EmptyState } from '@/components/account/EmptyState';
import { EmptyState as SharedEmptyState } from '@/components/ui/empty-state';
import type { CatalogItem } from '@/lib/actions/listings';
import type { WatchlistEntry } from '@/lib/actions/watchlist';

/** Sort order so saved AVAILABLE items surface first, others sink down. */
const STATUS_ORDER: Record<string, number> = {
  AVAILABLE: 0,
  RESERVED: 1,
  SOLD: 2,
};

export function WatchlistSection({
  items,
  suggestions = [],
}: {
  items: WatchlistEntry[];
  /**
   * Recently listed cards, shown under an empty list. An empty Saved page used to be
   * a sentence and a button over a blank screen — a dead end at exactly the moment
   * someone has nothing to look at. A few real listings give the heart something to
   * be tapped on.
   */
  suggestions?: CatalogItem[];
}) {
  if (items.length === 0) {
    if (suggestions.length === 0) {
      return (
        <EmptyState
          icon={<HugeiconsIcon icon={HeartIcon} className="size-6" aria-hidden />}
          title="No saved listings yet"
          description="Tap the heart on any listing to save it here for later."
          ctaLabel="Browse the marketplace"
          ctaHref="/"
        />
      );
    }
    return (
      <div className="space-y-section">
        <SharedEmptyState
          icon={<HugeiconsIcon icon={HeartIcon} className="size-6" aria-hidden />}
          title="No saved listings yet"
          description="Tap the heart on any listing to save it here for later."
          compact
        />
        <section aria-labelledby="saved-suggestions-heading" className="space-y-cozy">
          <h3 id="saved-suggestions-heading" className="text-subhead font-semibold">
            Recently listed
          </h3>
          <div className={CATALOG_TILE_GRID}>
            {suggestions.map((item) => (
              <CatalogItemCard key={item.id} item={item} initialWatching={false} />
            ))}
          </div>
        </section>
      </div>
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
