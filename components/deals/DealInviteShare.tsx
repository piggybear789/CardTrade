'use client';

// components/deals/DealInviteShare.tsx
//
// The host's view of an unused invite, and where the composer lands on Get link.
// Opening the link again later shows exactly this screen.
//
// THE DEAL IS A TICKET YOU HAND OVER. One object carries the whole job: its face is
// the deal as the other person will see it, and its stub is how it reaches them —
// the code to scan, the link, Copy and Share. A to-do from Stripe sits under the
// ticket only while there is one, and the ways out — editing, the inbox, cancelling —
// share one quiet row beneath it all. Cancelling still asks first.

import { useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { DealEditDialog } from '@/components/deals/DealEditDialog';
import { DealLinkActions } from '@/components/deals/DealLinkActions';
import { HostVerificationNotice, hostReadyLine } from '@/components/deals/DealVerificationNotice';
import { Button } from '@/components/ui/button';
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

function ticketLabel(preview: DealInvitePreview): string {
  if (preview.kind === 'TRADE') return 'Private trade';
  return preview.hostRole === 'BUYER' ? 'Private purchase' : 'Private sale';
}

function subscribeNever() {
  return () => {};
}

/**
 * The ways out of the screen share one look: quiet, and plainly actions. The few
 * pixels of padding are for the focus ring, which focus lands on whenever a dialog
 * opened from this row closes.
 */
const QUIET_ACTION = 'h-auto px-1 py-0.5 text-muted-foreground hover:text-foreground';

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
    <div className="mx-auto grid w-full max-w-[33rem] gap-section">
      <div className="grid gap-snug">
        <h2 className="text-head font-semibold">Your deal link</h2>
        <LinkStatus expires={expires} />
      </div>

      <DealTicket preview={preview} path={path} shareText={shareText} />

      {preview.kind && preview.hostReadiness && preview.hostReadiness !== 'ready' ? (
        <HostVerificationNotice kind={preview.kind} readiness={preview.hostReadiness} />
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-x-section gap-y-snug">
        {preview.editable && preview.id && preview.kind ? (
          <DealEditDialog
            inviteId={preview.id}
            kind={preview.kind}
            editable={preview.editable}
            currency={preview.currency ?? 'aud'}
          >
            <Button type="button" variant="link" className={QUIET_ACTION}>
              Edit deal
            </Button>
          </DealEditDialog>
        ) : null}
        <Button type="button" variant="link" className={QUIET_ACTION} onClick={leave}>
          {inboxLabel(preview)}
        </Button>
        <Button
          type="button"
          variant="link"
          className={QUIET_ACTION}
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
    </div>
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

/**
 * The deal as one object: the face says what it is, the stub sends it.
 *
 * THE NOTCHES ARE CUT-OUTS IN THE PAGE COLOUR, so the ticket must sit directly on the
 * page — set on a card, they would show as page-coloured bites. Each is a circle
 * centred on the ticket's outer edge with its outer half clipped away, which is why
 * the ticket itself cannot clip its children: the face rounds its own top corners
 * instead of relying on `overflow-hidden`.
 */
function DealTicket({
  preview,
  path,
  shareText,
}: {
  preview: DealInvitePreview;
  path: string;
  shareText: string;
}) {
  const imageUrl = itemImageUrl(preview.item?.imagePath);
  const title = preview.item?.title ?? preview.wantedDescription;
  const amountCents = preview.priceCents ?? preview.item?.fmvCents ?? null;

  return (
    <div className="relative rounded-xl border border-border bg-card">
      <div className="flex items-center gap-group rounded-t-[calc(var(--radius-xl)-1px)] bg-accent p-5">
        {preview.item ? (
          <div className="relative aspect-[5/7] w-20 shrink-0 overflow-hidden rounded-md border bg-card md:w-24">
            {imageUrl ? (
              <StorageImage src={imageUrl} alt="" sizes="96px" className="object-cover" />
            ) : null}
          </div>
        ) : null}
        <div className="grid min-w-0 flex-1 gap-tight">
          <p className="market-label text-accent-foreground">{ticketLabel(preview)}</p>
          {title ? (
            <p className="line-clamp-2 break-words text-pretty text-subhead font-semibold">{title}</p>
          ) : null}
          {preview.kind === 'TRADE' ? (
            preview.item && preview.wantedDescription ? (
              <p className="line-clamp-2 text-pretty text-body text-accent-foreground">
                for {preview.wantedDescription}
              </p>
            ) : null
          ) : amountCents != null ? (
            <p className="display-value text-head tabular-nums">
              {formatMoney(amountCents, preview.currency ?? 'aud')}
            </p>
          ) : null}
          {preview.kind && preview.hostReadiness === 'ready' ? (
            <p className="mt-snug flex items-center gap-1.5 text-meta font-medium text-foreground/85">
              <HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5 shrink-0 text-trust" aria-hidden />
              {hostReadyLine(preview.kind)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="relative border-t border-border" aria-hidden="true">
        <span className="pointer-events-none absolute -left-[11px] -top-[10.5px] size-5 rounded-full border border-border bg-background [clip-path:inset(0_0_0_50%)]" />
        <span className="pointer-events-none absolute -right-[11px] -top-[10.5px] size-5 rounded-full border border-border bg-background [clip-path:inset(0_50%_0_0)]" />
      </div>

      <DealLinkActions path={path} shareText={shareText} className="p-5" />
    </div>
  );
}
