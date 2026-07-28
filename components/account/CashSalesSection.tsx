// components/account/CashSalesSection.tsx
//
// Shared list UI for the "Purchases" and "Sales" sections. Each row shows the
// item image + title, the amount (formatAud), a status badge, and links to the
// cash-sale detail page at /sales/[id]. The `variant` prop only changes the
// empty-state copy/CTA between buying and selling.

import Link from 'next/link';
import { ImageOff, ShoppingBag, Tag } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { formatAud, itemImageUrl } from '@/lib/format';
import type { CashSaleSummary } from '@/lib/actions/account';
import { EmptyState } from '@/components/account/EmptyState';
// One status vocabulary for cash sales, shared with the contract room.
import { CashSaleStatusBadge } from '@/components/sales/CashSaleStatusBadge';

export function CashSalesSection({
  sales,
  variant,
}: {
  sales: CashSaleSummary[];
  variant: 'purchases' | 'sales';
}) {
  if (sales.length === 0) {
    return variant === 'purchases' ? (
      <EmptyState
        icon={<ShoppingBag className="size-6" aria-hidden />}
        title="No purchases yet"
        description="Browse the marketplace and buy your first collectible."
        ctaLabel="Browse the marketplace"
        ctaHref="/listings"
      />
    ) : (
      <EmptyState
        icon={<Tag className="size-6" aria-hidden />}
        title="No sales yet"
        description="List an item so buyers can purchase it outright."
        ctaLabel="List an item"
        ctaHref="/listings/new"
      />
    );
  }

  return (
    <ul role="list" className="space-y-3">
      {sales.map((sale) => {
        const imageUrl = itemImageUrl(sale.itemImagePath);
        const title = sale.itemTitle ?? 'Item';
        return (
          <li key={sale.id}>
            <Card className="p-3">
              <Link
                href={`/sales/${sale.id}`}
                className="flex items-center gap-4 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
                  {imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={title}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageOff className="size-6" aria-hidden />
                      <span className="sr-only">No image available</span>
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{title}</p>
                  <p className="mt-0.5 text-lg font-bold tabular-nums tracking-tight">
                    {formatAud(sale.amountCents)}
                  </p>
                </div>

                <CashSaleStatusBadge status={sale.status} className="shrink-0" />
              </Link>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
