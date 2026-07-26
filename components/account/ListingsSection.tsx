// components/account/ListingsSection.tsx
//
// The "My Listings" section of the Account hub: the caller's items across all
// statuses, shown as a responsive grid of cards with image, title, price,
// status badge, and View / Edit links.

import Link from 'next/link';
import { ImageOff, PackagePlus } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatAud, itemImageUrl } from '@/lib/format';
import type { Enums } from '@/lib/supabase/database.types';
import type { ItemRow } from '@/lib/actions/account';
import { EmptyState } from '@/components/account/EmptyState';

/** Visual treatment for each item status. */
const ITEM_STATUS_BADGE: Record<
  Enums<'item_status'>,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  AVAILABLE: { label: 'Available', variant: 'default' },
  RESERVED: { label: 'Under Contract', variant: 'secondary' },
  SOLD: { label: 'Sold', variant: 'outline' },
};

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
        description="List a collectible to start selling or trading on Poke-xchange."
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
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {sorted.map((item) => {
        const imageUrl = itemImageUrl(item.image_paths?.[0] ?? null);
        const status = ITEM_STATUS_BADGE[item.status];
        return (
          <li key={item.id}>
            <Card className="flex h-full flex-col overflow-hidden p-0">
              <div className="relative aspect-square w-full overflow-hidden bg-muted">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt={item.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-10" aria-hidden />
                    <span className="sr-only">No image available</span>
                  </div>
                )}
                <span className="absolute left-2 top-2">
                  <Badge variant={status.variant} className="bg-background/90 backdrop-blur">
                    {status.label}
                  </Badge>
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-3">
                <p className="text-lg font-bold tracking-tight">
                  {formatAud(item.fmv_cents)}
                </p>
                <h3 className="line-clamp-2 text-sm leading-snug">{item.title}</h3>
                <p className="text-xs text-muted-foreground">{item.category}</p>

                <div className="mt-auto flex items-center gap-2 pt-2">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link href={`/listings/${item.id}`}>View</Link>
                  </Button>
                  <Button asChild variant="secondary" size="sm" className="flex-1">
                    <Link href={`/listings/${item.id}/edit`}>Edit</Link>
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
