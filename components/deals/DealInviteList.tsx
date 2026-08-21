'use client';

// components/deals/DealInviteList.tsx
//
// Unused invites waiting for the other person. Same card language as TradesSection
// / CashSalesSection, with a waiting badge instead of a contract state.

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Handshake } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CopyDealLink } from '@/components/deals/CopyDealLink';
import { formatAud } from '@/lib/format';
import { revokeDealInvite, type DealInviteSummary } from '@/lib/actions/dealInvites';

function inviteTitle(invite: DealInviteSummary): string {
  if (invite.hostItemTitle) return invite.hostItemTitle;
  if (invite.wantedDescription?.trim()) return invite.wantedDescription.trim();
  return invite.kind === 'TRADE' ? 'Private trade' : 'Private sale';
}

export function DealInviteList({ invites }: { invites: DealInviteSummary[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  function revoke(id: string) {
    startTransition(async () => {
      const result = await revokeDealInvite(id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Invite cancelled');
      setPendingId(null);
      router.refresh();
    });
  }

  return (
    <ul role="list" className="space-y-cozy">
      {invites.map((invite) => (
        <li key={invite.id}>
          <Card className="p-cozy">
            <div className="flex flex-col gap-cozy sm:flex-row sm:items-center sm:gap-group">
              <Link
                href={invite.path}
                transitionTypes={['nav-forward']}
                className="flex min-w-0 flex-1 items-start gap-group rounded-md border border-transparent focus:outline-none focus-visible:border-gold/40 sm:items-center"
              >
                <div className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                  <Handshake className="size-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-lead font-medium">
                    {inviteTitle(invite)}
                  </p>
                  <p className="mt-0.5 text-body text-muted-foreground">
                    {invite.priceCents != null
                      ? formatAud(invite.priceCents)
                      : 'Waiting for them to join'}
                  </p>
                  <Badge variant="secondary" className="mt-2 max-w-full sm:hidden">
                    Waiting for them to join
                  </Badge>
                </div>
                <Badge variant="secondary" className="hidden shrink-0 sm:inline-flex">
                  Waiting for them to join
                </Badge>
              </Link>
              <div className="flex shrink-0 items-center justify-end gap-1">
                <CopyDealLink path={invite.path} appearance="icon" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isPending}
                  onClick={() => setPendingId(invite.id)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        </li>
      ))}
      <Dialog open={pendingId != null} onOpenChange={(open) => !open && setPendingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel invite</DialogTitle>
            <DialogDescription>
              The link stops working. Anyone who has it will not be able to join.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingId(null)}>
              Keep invite
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending || pendingId == null}
              onClick={() => pendingId && revoke(pendingId)}
            >
              Cancel invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ul>
  );
}
