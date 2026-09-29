'use client';

// components/deals/DealInviteShare.tsx
//
// The host's view of an unused invite, and where the composer lands on Get link.
// Opening the link again later shows exactly this screen.
//
// FOUR ZONES, ONE JOB EACH: the deal as they will see it, sending the link, what
// Stripe still needs from the host, and leaving. From `lg` the deal and the to-do
// share the left column and sending takes the right; below it they stack, with
// sending straight under the deal it sends. Cancelling sits last and asks first.

import { useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { DealLinkActions } from '@/components/deals/DealLinkActions';
import { HostVerificationNotice } from '@/components/deals/DealVerificationNotice';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { InfoPopover } from '@/components/ui/info-popover';
import { StorageImage } from '@/components/ui/storage-image';
import { revokeDealInvite, type DealInvitePreview } from '@/lib/actions/dealInvites';
import { dealInvitePath } from '@/lib/deals/paths';
import { formatMoney, formatShortDate, itemImageUrl } from '@/lib/format';
import { navigateWithType } from '@/lib/motion/navigate';

function inboxPath(preview: DealInvitePreview): string {
  if (preview.kind === 'TRADE') return '/trades';
  if (preview.hostRole === 'BUYER') return '/purchases';
  return '/sales';
}

function inboxLabel(preview: DealInvitePreview): string {
  if (preview.kind === 'TRADE') return 'Go to my trades';
  if (preview.hostRole === 'BUYER') return 'Go to my purchases';
  return 'Go to my sales';
}

function roleLine(preview: DealInvitePreview): string {
  if (preview.kind === 'TRADE') return "You're trading";
  return preview.hostRole === 'BUYER' ? "You're buying" : "You're selling";
}

function subscribeNever() {
  return () => {};
}

export function DealInviteShare({ preview }: { preview: DealInvitePreview }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // The expiry in the viewer's own calendar. Server HTML has no viewer, so the date
  // waits for the browser rather than guess a time zone a day either side.
  const expires = useSyncExternalStore(
    subscribeNever,
    () => formatShortDate(preview.expiresAt),
    () => null,
  );

  const path = dealInvitePath(preview.token);
  const subject = preview.item?.title ?? preview.wantedDescription ?? null;
  const shareText =
    preview.kind === 'TRADE'
      ? `Trade on NoDitto${subject ? `: ${subject}` : ''}`
      : `Deal on NoDitto${subject ? `: ${subject}` : ''}`;

  function leave() {
    navigateWithType(router, inboxPath(preview), 'nav-back');
  }

  function cancelInvite() {
    if (!preview.id) return;
    startTransition(async () => {
      const result = await revokeDealInvite(preview.id!);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setConfirmingCancel(false);
      leave();
    });
  }

  return (
    <Card className="mx-auto grid w-full max-w-md gap-section p-6 lg:max-w-3xl max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
      <div className="flex items-start justify-between gap-group">
        <div className="grid gap-snug">
          <h2 className="text-head font-semibold">Your deal link</h2>
          <LinkStatus expires={expires} />
        </div>
        <Button type="button" variant="outline" className="shrink-0 max-md:hidden" onClick={leave}>
          {inboxLabel(preview)}
        </Button>
      </div>

      {/* Two columns from `lg`, not `md`: from `md` the workspace rail takes ~13.5rem,
          and beside a 300px sending panel the deal would get about 120px. */}
      <div className="grid gap-section lg:grid-cols-[minmax(0,1fr)_18.75rem] lg:items-start lg:gap-x-section lg:gap-y-group">
        <DealRecap preview={preview} />
        <DealLinkActions
          path={path}
          shareText={shareText}
          className="lg:col-start-2 lg:row-span-2 lg:row-start-1"
        />
        {preview.hostReadiness && preview.kind ? (
          <HostVerificationNotice kind={preview.kind} readiness={preview.hostReadiness} />
        ) : null}
      </div>

      <div className="grid gap-tight max-md:border-t max-md:pt-group md:justify-items-start">
        <Button type="button" variant="outline" size="lg" className="md:hidden" onClick={leave}>
          {inboxLabel(preview)}
        </Button>
        <Button
          type="button"
          variant="link"
          className="justify-self-center text-muted-foreground md:justify-self-start"
          disabled={!preview.id}
          onClick={() => setConfirmingCancel(true)}
        >
          Cancel this link
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingCancel}
        onOpenChange={setConfirmingCancel}
        title="Cancel this link?"
        description="It stops working straight away."
        confirmLabel="Cancel link"
        confirmVariant="destructive"
        cancelLabel="Keep link"
        pending={isPending}
        onConfirm={cancelInvite}
      />
    </Card>
  );
}

/** Waiting, and until when. The first-to-join rule lives in the (i). */
function LinkStatus({ expires }: { expires: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-cozy gap-y-tight text-body text-muted-foreground">
      <span className="inline-flex items-center gap-snug rounded-full bg-muted px-snug py-0.5 text-meta font-medium text-foreground">
        <span className="size-1.5 rounded-full bg-iris" aria-hidden />
        Waiting for them to join
      </span>
      {expires ? (
        <span className="inline-flex items-center gap-tight">
          Expires {expires}
          <InfoPopover label="About this link">
            Anyone with the link can open it. The first person to join gets the deal.
          </InfoPopover>
        </span>
      ) : null}
    </div>
  );
}

/** The deal as the other person will see it: photo, title, and the price or the ask. */
function DealRecap({ preview }: { preview: DealInvitePreview }) {
  const imageUrl = itemImageUrl(preview.item?.imagePath);
  const title = preview.item?.title ?? preview.wantedDescription;
  const amountCents = preview.priceCents ?? preview.item?.fmvCents ?? null;

  return (
    <div className="flex items-center gap-group rounded-lg bg-muted p-cozy">
      {preview.item ? (
        <div className="relative aspect-[5/7] w-16 shrink-0 overflow-hidden rounded-md border bg-card md:w-20">
          {imageUrl ? (
            <StorageImage src={imageUrl} alt="" sizes="80px" className="object-cover" />
          ) : null}
        </div>
      ) : null}
      <div className="grid min-w-0 gap-tight">
        <p className="market-label text-muted-foreground">{roleLine(preview)}</p>
        {title ? <p className="line-clamp-2 text-pretty text-lead font-semibold">{title}</p> : null}
        {preview.kind === 'TRADE' ? (
          preview.item && preview.wantedDescription ? (
            <p className="line-clamp-2 text-pretty text-body text-muted-foreground">
              For {preview.wantedDescription}
            </p>
          ) : null
        ) : amountCents != null ? (
          <p className="display-value text-head tabular-nums">
            {formatMoney(amountCents, preview.currency ?? 'aud')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
