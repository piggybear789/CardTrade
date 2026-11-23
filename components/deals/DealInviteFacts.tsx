// components/deals/DealInviteFacts.tsx
//
// Labeled recap of an invite. Host copy is first-person ("Your card"); guest
// copy is about the other person. Empty fields are omitted so the remaining
// rows stay a real definition list, not a pile.
//
// No row for the kind of deal: every card that renders this already says it, in
// its heading ("Sam wants to trade") or in the labels below ("Their card is
// worth", "Price").

import type { ReactNode } from 'react';

import type { DealInvitePreview, HostReadiness } from '@/lib/actions/dealInvites';
import { InviteeVerificationStatus } from '@/components/deals/DealVerificationNotice';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { StorageImage } from '@/components/ui/storage-image';
import { formatMoney, itemImageUrl } from '@/lib/format';

function Fact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-tight">
      <dt className="text-body text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-pretty text-lead font-medium">{children}</dd>
    </div>
  );
}

/**
 * The fields of an invite this card and its headline read. Narrower than
 * `DealInvitePreview` so the composer can draw the SAME card from a draft that has no
 * token, status or host record yet; a full preview still satisfies it.
 */
export type DealInviteFactsInput = Pick<
  DealInvitePreview,
  'kind' | 'hostRole' | 'hostName' | 'priceCents' | 'wantedDescription' | 'offerMessage' | 'currency' | 'item'
>;

/** The invite card's title: "Sam is selling", "Sam wants to trade". */
export function dealInviteHeadline(preview: DealInviteFactsInput): string {
  const host = preview.hostName ?? 'A member';
  if (preview.kind === 'TRADE') return `${host} wants to trade`;
  return preview.hostRole === 'BUYER' ? `${host} wants to buy` : `${host} is selling`;
}

/**
 * The open invite as a signed-out visitor sees it on `/t/[token]`: headline, the
 * facts, where the host stands with Stripe, and the action. ONE COMPONENT for the
 * page and for the composer's live preview (`DealComposeForm`), so the preview is
 * the page rather than a drawing of it.
 */
export function DealInviteGuestCard({
  invite,
  readiness,
  action,
  imageSrc,
  placeholders,
}: {
  invite: DealInviteFactsInput;
  readiness: HostReadiness | null;
  /** The footer control: the page's Sign in link, or the preview's inert copy of it. */
  action: ReactNode;
  imageSrc?: string | null;
  placeholders?: { amount: string; title: string };
}) {
  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader>
        <CardTitle>{dealInviteHeadline(invite)}</CardTitle>
        <CardDescription>Nothing is paid or held when you join.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-group">
        <DealInviteFacts
          preview={invite}
          audience="guest"
          imageSrc={imageSrc}
          placeholders={placeholders}
        />
        {invite.kind ? (
          <InviteeVerificationStatus
            kind={invite.kind}
            readiness={readiness}
            // "This member", not "They": the status lines read "<name> hasn't
            // verified", and "They hasn't" is what a host with no display name got.
            hostName={invite.hostName ?? 'This member'}
          />
        ) : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch">{action}</CardFooter>
    </Card>
  );
}

export function DealInviteFacts({
  preview,
  audience,
  imageSrc,
  placeholders,
}: {
  preview: DealInviteFactsInput;
  audience: 'host' | 'guest';
  /**
   * The card photo as a ready URL, overriding `item.imagePath`. For the composer's
   * preview, whose photo is a local `blob:` URL that is not in Storage yet.
   */
  imageSrc?: string | null;
  /**
   * For the composer's live preview: muted stand-ins for an amount and a card title
   * not entered yet, so every row is drawn from the start and nothing shows a figure
   * nobody set ("$0.00"). A real invite never passes this and keeps omitting empty
   * rows.
   */
  placeholders?: { amount: string; title: string };
}) {
  const imageUrl = imageSrc !== undefined ? imageSrc : itemImageUrl(preview.item?.imagePath);
  const stated = preview.priceCents ?? preview.item?.fmvCents ?? null;
  // A draft's zero is "not entered yet", not a price of nothing.
  const amountCents = placeholders && stated != null && stated <= 0 ? null : stated;
  const itemLabel =
    audience === 'host'
      ? 'Your card'
      : preview.hostName
        ? `${preview.hostName}'s card`
        : 'Their card';
  const wantedLabel = audience === 'host' ? 'What you asked for' : 'What they want';
  const amountLabel =
    preview.kind === 'TRADE'
      ? audience === 'host'
        ? 'Your card is worth'
        : 'Their card is worth'
      : 'Price';

  return (
    <dl className="grid gap-group">
      {amountCents != null ? (
        <Fact label={amountLabel}>
          <span className="display-value text-head">
            {formatMoney(amountCents, preview.currency ?? 'aud')}
          </span>
        </Fact>
      ) : placeholders ? (
        <Fact label={amountLabel}>
          <span className="display-value text-head text-muted-foreground/60">
            {placeholders.amount}
          </span>
        </Fact>
      ) : null}

      {preview.item ? (
        <Fact label={itemLabel}>
          <div className="flex items-center gap-group">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
              {imageUrl ? (
                <StorageImage
                  src={imageUrl}
                  alt=""
                  sizes="64px"
                  className="object-cover"
                  loading="lazy"
                />
              ) : null}
            </div>
            <p className="min-w-0 text-pretty text-lead font-medium">
              {preview.item.title ||
                (placeholders ? (
                  <span className="text-muted-foreground/60">{placeholders.title}</span>
                ) : null)}
            </p>
          </div>
        </Fact>
      ) : null}

      {preview.wantedDescription ? (
        <Fact label={wantedLabel}>{preview.wantedDescription}</Fact>
      ) : null}

      {preview.offerMessage ? (
        <Fact label="Note">
          <span className="font-normal text-body">{preview.offerMessage}</span>
        </Fact>
      ) : null}
    </dl>
  );
}
