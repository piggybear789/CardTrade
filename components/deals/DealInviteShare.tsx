'use client';

// components/deals/DealInviteShare.tsx
//
// The host's view of an unused invite, and where the composer lands on Get link:
// the deal recapped, the link with copy, share and a QR code for meetups, the link's
// two facts, and what Stripe still needs from the host before the deal can go
// through. Opening the link again later shows exactly this screen.

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { CopyDealLink } from '@/components/deals/CopyDealLink';
import { DealLinkQrButton } from '@/components/deals/DealLinkQrButton';
import { HostVerificationNotice } from '@/components/deals/DealVerificationNotice';
import { ShareDealLinkButton } from '@/components/deals/ShareDealLinkButton';
import { formatMoney } from '@/lib/format';
import { revokeDealInvite, type DealInvitePreview } from '@/lib/actions/dealInvites';
import { dealInvitePath } from '@/lib/deals/paths';
import { navigateWithType } from '@/lib/motion/navigate';

function inboxPath(preview: DealInvitePreview): string {
  if (preview.kind === 'TRADE') return '/trades';
  if (preview.hostRole === 'BUYER') return '/purchases';
  return '/sales';
}

function roleLine(preview: DealInvitePreview): string {
  if (preview.kind === 'TRADE') return 'You are swapping';
  return preview.hostRole === 'BUYER' ? 'You are buying' : 'You are selling';
}

export function DealInviteShare({ preview }: { preview: DealInvitePreview }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const path = dealInvitePath(preview.token);
  const amountCents = preview.priceCents ?? preview.item?.fmvCents ?? null;
  const subject = preview.item?.title ?? preview.wantedDescription ?? null;
  const amount = amountCents != null ? formatMoney(amountCents, preview.currency ?? 'aud') : null;
  const shareText =
    preview.kind === 'TRADE'
      ? `Swap on NoDitto${subject ? `: ${subject}` : ''}`
      : `Deal on NoDitto${subject ? `: ${subject}` : ''}`;

  function cancelInvite() {
    if (!preview.id) return;
    startTransition(async () => {
      const result = await revokeDealInvite(preview.id!);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      navigateWithType(router, inboxPath(preview), 'nav-back');
    });
  }

  return (
    <Card className="mx-auto w-full max-w-md">
      <CardHeader>
        <CardTitle>Your link is ready</CardTitle>
        <CardDescription>
          Send it to the person you are dealing with. When they join, you both land in the deal
          room.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-group">
        <div className="rounded-md bg-muted p-cozy">
          <p className="text-body text-muted-foreground">{roleLine(preview)}</p>
          <p className="mt-0.5 truncate text-lead font-semibold">
            {amount ? <span className="tabular-nums">{amount}</span> : null}
            {amount && subject ? ' · ' : null}
            {subject}
          </p>
        </div>

        <div className="grid gap-snug">
          <CopyDealLink path={path} appearance="ticket">
            <ShareDealLinkButton path={path} text={shareText} />
          </CopyDealLink>
          <div className="grid grid-cols-2 gap-snug">
            <DealLinkQrButton path={path} />
          </div>
          <p className="text-meta text-muted-foreground">
            The link works for 14 days. The first person to open it joins.
          </p>
        </div>

        {preview.hostReadiness && preview.kind ? (
          <HostVerificationNotice kind={preview.kind} readiness={preview.hostReadiness} />
        ) : null}
      </CardContent>
      <CardFooter className="justify-between gap-snug">
        <Button
          type="button"
          variant="ghost"
          disabled={isPending || !preview.id}
          onClick={cancelInvite}
        >
          Cancel invite
        </Button>
        <Button type="button" onClick={() => navigateWithType(router, inboxPath(preview), 'nav-back')}>
          Done
        </Button>
      </CardFooter>
    </Card>
  );
}
