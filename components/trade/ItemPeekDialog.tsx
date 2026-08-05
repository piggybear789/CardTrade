'use client';

// components/trade/ItemPeekDialog.tsx
//
// Inspect one Item from inside a trade offer without leaving the offer.
//
// WHY IT EXISTS. A trade offer is a decision about two specific collectibles, and
// the inbox row could only show a 48px thumbnail and a title. Deciding whether a
// slab is the one you want needs the photos at a readable size and the condition
// in words, and for a privately offered Item there is no listing page to fall
// back on — it is deliberately absent from the catalog, so this dialog is the
// ONLY place it can be seen at all.
//
// The gallery is the same `ImageGallery` the listing page uses, so click-to-zoom
// behaves identically on both surfaces rather than being re-implemented smaller.

import { ImageOff } from 'lucide-react';
import Link from 'next/link';

import { ImageGallery, type GalleryImage } from '@/components/listings/ImageGallery';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatAud, itemImageUrl } from '@/lib/format';

/** The Item facts this dialog needs. Structurally a `TradeProposalItem`. */
export interface PeekableItem {
  id: string;
  title: string;
  fmvCents: number;
  imagePaths: string[];
  condition: string | null;
  description: string | null;
  category: string | null;
  /** A privately offered Item: no catalog page exists, so no link is offered. */
  hidden: boolean;
}

/**
 * Wrap `children` in a button that opens a full inspection of `item`.
 *
 * The trigger renders as the caller's own markup (`asChild`), so a thumbnail
 * stays a thumbnail — it just becomes activatable, with a real accessible name
 * instead of a decorative image nobody can reach by keyboard.
 */
export function ItemPeekDialog({
  item,
  children,
}: {
  item: PeekableItem;
  children: React.ReactNode;
}) {
  const images: GalleryImage[] = item.imagePaths
    .map((path) => itemImageUrl(path))
    .filter((src): src is string => Boolean(src))
    .map((src, index) => ({
      src,
      alt: `${item.title} — image ${index + 1}`,
    }));

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent mobile="center" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">{item.title}</DialogTitle>
          <DialogDescription>
            Valued at {formatAud(item.fmvCents)}
          </DialogDescription>
        </DialogHeader>

        {images.length > 0 ? (
          // Override the listing page's viewport-tuned frame: inside a dialog the
          // available height is the dialog's, not the window's.
          <ImageGallery
            images={images}
            title={item.title}
            frameClassName="h-[min(55dvh,26rem)] w-full"
          />
        ) : (
          <p className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            <ImageOff className="size-4 shrink-0" aria-hidden />
            No photos were attached to this item.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {item.condition ? (
            <Badge variant="secondary">Condition: {item.condition}</Badge>
          ) : null}
          {item.category ? <Badge variant="outline">{item.category}</Badge> : null}
          {item.hidden ? (
            <Badge variant="outline" className="text-gold">
              Offered privately — not listed publicly
            </Badge>
          ) : null}
        </div>

        {item.description ? (
          <p className="whitespace-pre-line break-words text-sm leading-6 text-muted-foreground">
            {item.description}
          </p>
        ) : null}

        {/* A hidden Item has no catalog page; linking to one would 404. */}
        {item.hidden ? null : (
          <Button asChild variant="outline" className="sm:self-start">
            <Link href={`/listings/${item.id}`}>Open full listing</Link>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
