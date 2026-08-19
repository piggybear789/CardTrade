// components/deals/DealInviteFacts.tsx
//
// Labeled recap of an invite. Host copy is first-person ("You are buying");
// guest copy is about the other person. Empty fields are omitted so the
// remaining rows stay a real definition list, not a pile.

import type { ReactNode } from 'react';

import type { DealInvitePreview } from '@/lib/actions/dealInvites';
import { formatAud, itemImageUrl } from '@/lib/format';

function dealLabel(preview: DealInvitePreview, audience: 'host' | 'guest'): string {
  if (preview.kind === 'TRADE') return 'Trade';
  if (preview.hostRole === 'BUYER') {
    return audience === 'host' ? 'You are buying' : 'They want to buy';
  }
  return audience === 'host' ? 'You are selling' : 'They want to sell';
}

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

export function DealInviteFacts({
  preview,
  audience,
}: {
  preview: DealInvitePreview;
  audience: 'host' | 'guest';
}) {
  const imageUrl = itemImageUrl(preview.item?.imagePath);
  const amountCents = preview.priceCents ?? preview.item?.fmvCents ?? null;
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
      <Fact label="Deal">{dealLabel(preview, audience)}</Fact>

      {amountCents != null ? (
        <Fact label={amountLabel}>
          <span className="display-value text-head">{formatAud(amountCents)}</span>
        </Fact>
      ) : null}

      {preview.item ? (
        <Fact label={itemLabel}>
          <div className="flex items-center gap-group">
            <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <p className="min-w-0 text-pretty text-lead font-medium">
              {preview.item.title}
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
