'use client';

// components/deals/DealInviteShare.tsx
//
// Host view of an unused invite: one small card. Title, a two-line recap of
// the deal, the link with its copy action, and a quiet cancel. Nothing else.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CopyDealLink } from '@/components/deals/CopyDealLink';
import { formatAud } from '@/lib/format';
import { revokeDealInvite, type DealInvitePreview } from '@/lib/actions/dealInvites';
import { navigateWithType } from '@/lib/motion/navigate';

function inboxPath(preview: DealInvitePreview): string {
  if (preview.kind === 'TRADE') return '/trades';
  if (preview.hostRole === 'BUYER') return '/purchases';
  return '/sales';
}

function roleLine(preview: DealInvitePreview): string {
  if (preview.kind === 'TRADE') return 'Trade';
  return preview.hostRole === 'BUYER' ? 'You are buying' : 'You are selling';
}

export function DealInviteShare({ preview }: { preview: DealInvitePreview }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const amountCents = preview.priceCents ?? preview.item?.fmvCents ?? null;
  const subject = preview.item?.title ?? preview.wantedDescription ?? null;

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader>
        <CardTitle>Waiting for them to join</CardTitle>
        <CardDescription>
          Share this link. When they join, you both land in the contract room.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-group">
        <div className="rounded-md bg-muted p-cozy">
          <p className="text-body text-muted-foreground">{roleLine(preview)}</p>
          <p className="mt-0.5 truncate text-lead font-semibold">
            {amountCents != null ? (
              <span className="tabular-nums">{formatAud(amountCents)}</span>
            ) : null}
            {amountCents != null && subject ? ' · ' : null}
            {subject}
          </p>
        </div>

        <CopyDealLink path={`/t/${preview.token}`} appearance="ticket">
          <Button
            type="button"
            variant="outline"
            disabled={isPending || !preview.id}
            onClick={() => {
              if (!preview.id) return;
              startTransition(async () => {
                const result = await revokeDealInvite(preview.id!);
                if (!result.ok) {
                  toast.error(result.message);
                  return;
                }
                
                navigateWithType(router, inboxPath(preview), 'nav-back');
              });
            }}
          >
            Cancel invite
          </Button>
        </CopyDealLink>
      </CardContent>
    </Card>
  );
}
