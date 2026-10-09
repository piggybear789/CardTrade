'use client';

// components/listings/ListingOverflowMenu.tsx
//
// The listing's "⋯": Share, and Report for a signed-in non-owner. Report used to be
// a flag icon beside the heart on desktop and a third icon in the phone header —
// a rare action given the same weight as saving, and on a phone it squeezed the
// search pill. One menu holds both, in both layouts.

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Flag01Icon, Forward01Icon, MoreHorizontalIcon } from '@hugeicons/core-free-icons';

import { ReportDialog } from '@/components/reports/ReportDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { shareListingUrl } from '@/lib/listings/shareListingUrl';
import { cn } from '@/lib/utils';

export function ListingOverflowMenu({
  itemId,
  canReport,
  triggerClassName,
}: {
  itemId: string;
  /** Signed in and not the owner. `reportItem` enforces it again on the server. */
  canReport: boolean;
  triggerClassName?: string;
}) {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      {/* `modal={false}`: the menu hands off to a dialog, and a modal menu's
          pointer-events lock races the dialog's own and can leave the page inert. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="More listing actions"
            className={cn('text-muted-foreground hover:text-foreground [&_svg]:size-5', triggerClassName)}
          >
            <HugeiconsIcon icon={MoreHorizontalIcon} aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => void shareListingUrl()}>
            <HugeiconsIcon icon={Forward01Icon} aria-hidden />
            Share listing
          </DropdownMenuItem>
          {canReport ? (
            <DropdownMenuItem onSelect={() => setReportOpen(true)}>
              <HugeiconsIcon icon={Flag01Icon} aria-hidden />
              Report listing
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canReport ? (
        <ReportDialog
          targetType="item"
          targetId={itemId}
          triggerLabel="Report listing"
          appearance="none"
          open={reportOpen}
          onOpenChange={setReportOpen}
        />
      ) : null}
    </>
  );
}
