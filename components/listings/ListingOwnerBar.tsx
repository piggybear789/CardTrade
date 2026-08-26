import Link from 'next/link';
import { Pencil } from 'lucide-react';

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
    <div className="fixed inset-x-0 z-30 grid grid-cols-[1fr_1fr_auto] gap-2 border-t border-border bg-card px-3 pb-2 pt-2 shadow-[0_-8px_24px_hsl(var(--obsidian)/0.06)] md:hidden bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))]">
      <Button asChild variant="outline" className="h-11 w-full">
        <Link href={`/listings/${itemId}/edit`} transitionTypes={['nav-forward']}>
          <Pencil aria-hidden />
          Edit
        </Link>
      </Button>
      <CopyTradeLink itemId={itemId} className="h-11 w-full" />
      <DeleteListingDialog
        itemId={itemId}
        itemTitle={itemTitle}
        className="h-11 px-3"
        compact
      />
    </div>
  );
}
