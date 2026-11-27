'use client';

// components/deals/DealInviteShare.tsx
//
// The host's view of an unused invite, and where the composer lands on Get link.
// Opening the link again later shows exactly this screen.
//
// THE "LINK READY" SCREEN, the shape Mercury, Fresha and Navan give theirs on Mobbin:
// a title that says the link exists, one card holding the deal (card, title, price)
// over the link (a field, Copy, Share, a QR code button), the to-do from Stripe under
// it only while there is one, and the ways out at the foot — Cancel at one edge,
// Edit and the inbox at the other. Cancelling still asks first.
//
// IT REPLACED A TICKET with notched edges, an accent-tinted face and a 96px QR code
// printed on its stub. The code arrived after its encoder loaded, and the expiry date
// arrived after hydration, so the screen settled in two steps; both are now drawn at
// their final size from the first paint.

import { useState, useSyncExternalStore, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { CheckCircleIcon } from '@/components/ui/icons';
import { toast } from 'sonner';

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
    // THE "LINK READY" SCREEN (Mercury, Fresha, Navan on Mobbin): a title saying the
    // link exists, one card holding the deal and then the link, the to-do from Stripe
    // under it while there is one, and the ways out as one quiet row at the foot.
    <div className="mx-auto grid w-full max-w-[30rem] gap-6">
      <header className="grid gap-snug text-center">
        <span
          aria-hidden
          className="mx-auto grid size-11 place-items-center rounded-full bg-trust/10 text-trust"
        >
          <Icon icon={CheckCircleIcon} className="size-6" />
        </span>
        <h2 className="text-head font-bold tracking-[-0.02em]">Your link is ready</h2>
        <p className="text-pretty text-body text-muted-foreground">
          Send it to the other person. Once they join, you agree the details in the deal
          room.
        </p>
      </header>

      <div className="surface overflow-hidden rounded-xl bg-card">
        <DealSummary preview={preview} />
        <div className="border-t border-border p-group">
          <DealLinkActions path={path} shareText={shareText} />
          <LinkStatus expires={expires} />
        </div>
      </div>

      {preview.kind && preview.hostReadiness && preview.hostReadiness !== 'ready' ? (
        <HostVerificationNotice kind={preview.kind} readiness={preview.hostReadiness} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-snug">
        {/* A trigger for a confirm, so a quiet red label; the filled red waits in
            the dialog. Apart from the other two, at the far edge. */}
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:bg-destructive/5 hover:text-destructive"
          disabled={!preview.id}
          onClick={() => setConfirmingCancel(true)}
        >
          Cancel link
        </Button>
        <div className="flex flex-wrap gap-snug">
          <Button type="button" variant="secondary" onClick={leave}>
            {inboxLabel(preview)}
          </Button>
        </div>
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

/**
 * Waiting, and until when, under the link. The first-to-join rule lives in the (i).
 *
 * THE LINE IS ALWAYS DRAWN. The date is formatted in the viewer's own time zone, so
 * the server has none to print; the line keeps its height with a blank date until
 * the browser fills it in, and nothing under it moves.
 */
function LinkStatus({ expires }: { expires: string | null }) {
  return (
    <p className="mt-cozy flex min-h-[1lh] flex-wrap items-center gap-x-cozy gap-y-tight text-meta text-muted-foreground">
      <span className="inline-flex items-center gap-snug font-medium text-foreground">
        <span className="size-1.5 rounded-full bg-iris" aria-hidden />
        Waiting for them to join
      </span>
      <span className="inline-flex items-center gap-tight">
        <span className={expires ? undefined : 'invisible'}>
          Expires {expires ?? 'on a date'}
        </span>
        <InfoPopover label="About this link">
          Anyone with the link can open it. The first person to join gets the deal.
        </InfoPopover>
      </span>
    </p>
  );
}

/** The deal the link carries: the card, its title and the price (Mercury's top half). */
function DealSummary({ preview }: { preview: DealInvitePreview }) {
  const imageUrl = itemImageUrl(preview.item?.imagePath);
  const title = preview.item?.title ?? preview.wantedDescription;
  const amountCents = preview.priceCents ?? preview.item?.fmvCents ?? null;

  return (
    <div className="flex items-center gap-group p-group">
        {preview.item ? (
          <div className="relative aspect-[5/7] w-16 shrink-0 overflow-hidden rounded-md border bg-muted">
            {imageUrl ? (
              <StorageImage src={imageUrl} alt="" sizes="96px" className="object-cover" />
            ) : null}
          </div>
        ) : null}
        <div className="grid min-w-0 flex-1 gap-tight">
          <p className="market-label text-muted-foreground">{ticketLabel(preview)}</p>
          {title ? (
            <p className="line-clamp-2 break-words text-pretty text-subhead font-semibold">{title}</p>
          ) : null}
          {preview.kind === 'TRADE' ? (
            preview.item && preview.wantedDescription ? (
              <p className="line-clamp-2 text-pretty text-body text-muted-foreground">
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
              <Icon icon={CheckCircleIcon} className="size-3.5 shrink-0 text-trust" aria-hidden />
              {hostReadyLine(preview.kind)}
            </p>
          ) : null}
        </div>
    </div>
  );
}
