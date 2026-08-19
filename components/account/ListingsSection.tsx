// components/account/ListingsSection.tsx
//
// The "My Listings" section: the caller's items across all statuses, rendered
// with the same compact catalog tiles as the marketplace grid.

import { PackagePlus } from 'lucide-react';

import { CatalogItemCard } from '@/components/listings/ItemCard';
import { EmptyState } from '@/components/account/EmptyState';
import type { Enums } from '@/lib/supabase/database.types';
import type { ItemRow } from '@/lib/actions/account';

/** Sort order so live listings surface first, contracted/sold items sink down. */
const STATUS_ORDER: Record<Enums<'item_status'>, number> = {
  AVAILABLE: 0,
  RESERVED: 1,
  SOLD: 2,
};

export function ListingsSection({ items }: { items: ItemRow[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<PackagePlus className="size-6" aria-hidden />}
        title="You haven't listed anything yet"
        description="List a collectible to start selling or trading on NoDitto."
        ctaLabel="List an item"
        ctaHref="/listings/new"
      />
    );
  }

  // Under-contract/sold items sink below still-available ones (Req 3.8 UX);
  // `items` arrives newest-first, and the sort is stable, so recency ordering
  // is preserved within each status group.
  const sorted = [...items].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );

  return (
    <ul
      role="list"
      className="grid grid-cols-2 gap-x-3 gap-y-5 sm:gap-x-4 sm:gap-y-6 md:grid-cols-3 lg:[grid-template-columns:repeat(auto-fill,minmax(13rem,1fr))]">
    >
      {sorted.map((item) => (
        <li key={item.id} className="min-w-0">
          <CatalogItemCard item={{ ...item, seller: null }} />
        </li>
      ))}
    </ul>
  );
}
