'use client';

// components/profile/SellerProfileActions.tsx
//
// The seller header's controls: Message, and a ⋯ menu holding Report.
//
// The header led with a red "Report user" and had no way to contact the seller —
// the rare, adversarial action was the most prominent thing on the page, and the
// common one was missing. Message is now the visible control; Report keeps its
// reach but moves into the menu, the same arrangement as the listing page.

import { useState } from 'react';
import { Icon } from '@/components/ui/icon';
import { DotsThreeIcon, FlagIcon } from '@/components/ui/icons';

import { MessageSellerButton } from '@/components/messages/MessageSellerButton';
import { ReportDialog } from '@/components/reports/ReportDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function SellerProfileActions({ sellerId }: { sellerId: string }) {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <div className="flex shrink-0 items-center gap-snug">
      {/* No listing in scope, so the thread is the two members' general one. */}
      <MessageSellerButton
        itemId={null}
        sellerId={sellerId}
        size="sm"
        emphasis="primary"
        className="flex-1 sm:flex-none"
      />
      {/* `modal={false}`: the menu hands off to a dialog, and a modal menu's
          pointer-events lock races the dialog's own and can leave the page inert. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="More actions"
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <Icon icon={DotsThreeIcon} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Icon icon={FlagIcon} aria-hidden />
            Report user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportDialog
        targetType="user"
        targetId={sellerId}
        triggerLabel="Report user"
        appearance="none"
        open={reportOpen}
        onOpenChange={setReportOpen}
      />
    </div>
  );
}
