'use client';

// components/sales/CashSaleItemPreview.tsx
//
// The item under contract, shown from the SNAPSHOT taken when the contract
// opened (`cash_sales.item_*`), not from the live listing. If the seller later
// edits or relists the item, both parties still see what they agreed on.

import { useState } from 'react';
import Link from 'next/link';
import { ImageOff } from 'lucide-react';

import { itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface CashSaleItemPreviewProps {
  itemId: string;
  title: string;
  condition: string | null;
  description: string | null;
  /** Storage object paths snapshotted onto the contract. */
  imagePaths: string[];
}

export function CashSaleItemPreview({
  itemId,
  title,
  condition,
  description,
  imagePaths,
}: CashSaleItemPreviewProps) {
  const images = imagePaths
    .map((path) => itemImageUrl(path))
    .filter((src): src is string => Boolean(src));
  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[Math.min(activeIndex, Math.max(images.length - 1, 0))];

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="flex gap-2">
        <div className="relative size-28 shrink-0 overflow-hidden rounded-lg border bg-muted">
          {active ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={active} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="size-6" aria-hidden />
              <span className="sr-only">No image for {title}</span>
            </div>
          )}
        </div>

        {images.length > 1 ? (
          <ul
            className="flex max-h-28 flex-col gap-2 overflow-y-auto"
            aria-label={`${title} images`}
          >
            {images.slice(0, 4).map((src, index) => {
              const isActive = index === activeIndex;
              return (
                <li key={src}>
                  <button
                    type="button"
                    onClick={() => setActiveIndex(index)}
                    aria-label={`Show image ${index + 1} of ${images.length}`}
                    aria-current={isActive}
                    className={cn(
                      'size-[3.25rem] overflow-hidden rounded-md border bg-muted transition',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      isActive ? 'ring-2 ring-ring' : 'opacity-80 hover:opacity-100',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <div className="min-w-0 space-y-1">
        {condition ? (
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {condition}
          </p>
        ) : null}
        {description ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">{description}</p>
        ) : null}
        <Link
          href={`/listings/${itemId}`}
          className="inline-block text-sm font-medium underline-offset-4 hover:underline"
        >
          View the listing
        </Link>
        <p className="text-xs text-muted-foreground">
          Images as they were when this contract opened.
        </p>
      </div>
    </div>
  );
}
