import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { PencilIcon } from '@hugeicons/core-free-icons';

import { CopyTradeLink } from '@/components/listings/CopyTradeLink';
import { DeleteListingDialog } from '@/components/listings/DeleteListingDialog';
import { Button } from '@/components/ui/button';

/**
 * Owner tools parked above the mobile hub. Desktop keeps the in-flow row
 * in ItemActions.
 */
export function ListingOwnerBar({
  itemId,
  itemTitle,
}: {
  itemId: string;
  itemTitle: string;
}) {
  return (
    <div data-hide-for-keyboard className="fixed inset-x-0 z-30 grid grid-cols-[1fr_1fr_auto] gap-snug border-t border-border bg-card pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-snug pt-snug shadow-[0_-8px_24px_hsl(var(--obsidian)/0.06)] md:hidden bottom-[var(--mobile-hub-offset)]">
      {/* `size="lg"` rather than `className="h-10"`. Same 40px on a phone, but it
          names the token, so this bar and the in-flow owner row in
          `listings/[id]/page.tsx` can no longer drift apart the way they had —
          40px here against the default 28px there. */}
      <Button asChild variant="outline" size="lg" className="w-full">
        <Link href={`/listings/${itemId}/edit`} transitionTypes={['nav-forward']}>
          <HugeiconsIcon icon={PencilIcon} aria-hidden />
          Edit
        </Link>
      </Button>
      <CopyTradeLink itemId={itemId} size="lg" className="w-full" />
      <DeleteListingDialog
        itemId={itemId}
        itemTitle={itemTitle}
        size="lg"
        className="px-cozy"
        compact
      />
    </div>
  );
}
