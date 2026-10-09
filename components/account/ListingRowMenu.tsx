'use client';

// components/account/ListingRowMenu.tsx
//
// The "⋯" on a My listings row: the rarer actions, so the row keeps one visible verb.

import Link from 'next/link';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { LinkIcon, MoreHorizontalIcon, PencilIcon, ViewIcon } from '@hugeicons/core-free-icons';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ListingRowMenu({
  itemId,
  itemTitle,
  editable,
}: {
  itemId: string;
  itemTitle: string;
  /** False for a sold or closed listing, which is a record rather than a thing to edit. */
  editable: boolean;
}) {
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/listings/${itemId}`);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`More actions for ${itemTitle}`}
          className="text-muted-foreground hover:text-foreground"
        >
          <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <Link href={`/listings/${itemId}`}>
            <HugeiconsIcon icon={ViewIcon} aria-hidden />
            View listing
          </Link>
        </DropdownMenuItem>
        {editable ? (
          <DropdownMenuItem asChild>
            <Link href={`/listings/${itemId}/edit`}>
              <HugeiconsIcon icon={PencilIcon} aria-hidden />
              Edit listing
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void copyLink()}>
          <HugeiconsIcon icon={LinkIcon} aria-hidden />
          Copy link
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
