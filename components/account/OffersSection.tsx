'use client';

// components/account/OffersSection.tsx
//
// The "Offers" section of the Account hub (Phase 3). Lists the caller's
// negotiations (as buyer or seller) with the item thumbnail + title, the
// counterparty's name, the latest amount (formatAud), a status badge, and the
// caller's role. When it is the caller's turn, inline actions are shown:
//   * received the latest offer -> Accept / Decline / Counter
//   * made the latest PENDING offer -> Withdraw
// Actions call respondToOffer / counterOffer, toast the outcome, and refresh the
// server component so the list reflects the new state.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HandCoins, ImageOff, Loader2 } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/account/EmptyState';
import { EmptyState as SharedEmptyState } from '@/components/ui/empty-state';
import { formatAud, itemImageUrl } from '@/lib/format';
import {
  counterOffer,
  respondToOffer,
  type MyOfferEntry,
  type OfferStatus,
} from '@/lib/actions/offers';
import { OFFER_AMOUNT_MAX } from '@/lib/marketplace-constants';

/** Visual treatment for each offer status. */
const OFFER_STATUS_BADGE: Record<
  OfferStatus,
  { label: string; variant: NonNullable<BadgeProps['variant']> }
> = {
  PENDING: { label: 'Pending', variant: 'secondary' },
  ACCEPTED: { label: 'Accepted', variant: 'default' },
  DECLINED: { label: 'Declined', variant: 'destructive' },
  COUNTERED: { label: 'Countered', variant: 'outline' },
  WITHDRAWN: { label: 'Withdrawn', variant: 'outline' },
};

export function OffersSection({
  offers,
  scope = 'active',
}: {
  offers: MyOfferEntry[];
  /** Which slice is being shown, so the empty state names the right thing. */
  scope?: 'active' | 'past';
}) {
  if (offers.length === 0) {
    return scope === 'past' ? (
      <SharedEmptyState
        icon={<HandCoins className="size-6" aria-hidden />}
        title="No past offers"
        description="Decided or withdrawn offers will be kept here."
        compact
      />
    ) : (
      <EmptyState
        icon={<HandCoins className="size-6" aria-hidden />}
        title="No offers yet"
        description="Make an offer on a listing, or wait for buyers to send you one."
        ctaLabel="Browse the marketplace"
        ctaHref="/listings"
      />
    );
  }

  return (
    <ul role="list" className="space-y-3">
      {offers.map((offer) => (
        <li key={offer.offerId}>
          <OfferRow offer={offer} />
        </li>
      ))}
    </ul>
  );
}

/** A single negotiation row with its live status and inline actions. */
function OfferRow({ offer }: { offer: MyOfferEntry }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [counterOpen, setCounterOpen] = useState(false);

  const imageUrl = itemImageUrl(offer.itemImagePath);
  const title = offer.itemTitle ?? 'Item';
  const status = OFFER_STATUS_BADGE[offer.status];
  const counterparty = offer.counterpartyName ?? 'Unknown user';
  const roleLabel = offer.role === 'buyer' ? 'You are buying' : 'You are selling';

  function respond(action: 'accept' | 'decline' | 'withdraw') {
    startTransition(async () => {
      const result = await respondToOffer(offer.offerId, action);
      if (result.ok) {
        if (action === 'accept') {
          toast.success('Offer accepted — opening the sale…');
          // The escrow sale has been opened at the agreed price; take the user
          // straight to it.
          if (result.saleId) {
            router.push(`/sales/${result.saleId}`);
            return;
          }
        } else {
          toast.success(action === 'decline' ? 'Offer declined.' : 'Offer withdrawn.');
        }
        router.refresh();
        return;
      }
      const message =
        result.error === 'sale-failed'
          ? 'Could not open the sale — the item may no longer be available.'
          : (result.detail ?? 'Could not update the offer. Please try again.');
      toast.error(message);
    });
  }

  return (
    <Card className="p-3">
      <div className="flex items-start gap-4">
        {/* Thumbnail */}
        <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="size-6" aria-hidden />
              <span className="sr-only">No image available</span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-sm font-medium">{title}</p>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="mt-0.5 text-lg font-bold tracking-tight">
            {formatAud(offer.amountCents)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {roleLabel} · with {counterparty}
            {offer.offeredByMe ? ' · your offer' : ''}
          </p>

          {/* Inline actions when it's the caller's turn. */}
          {(offer.isMyTurn || offer.canWithdraw) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {offer.isMyTurn && (
                <>
                  <Button
                    size="sm"
                    onClick={() => respond('accept')}
                    disabled={isPending}
                    aria-busy={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : null}
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => respond('decline')}
                    disabled={isPending}
                  >
                    Decline
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setCounterOpen(true)}
                    disabled={isPending}
                  >
                    Counter
                  </Button>
                </>
              )}
              {offer.canWithdraw && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => respond('withdraw')}
                  disabled={isPending}
                  aria-busy={isPending}
                >
                  {isPending ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : null}
                  Withdraw
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {offer.isMyTurn && (
        <CounterOfferDialog
          open={counterOpen}
          onOpenChange={setCounterOpen}
          offerId={offer.offerId}
          currentAmountCents={offer.amountCents}
        />
      )}
    </Card>
  );
}

/** A small dialog reusing the offer amount form to counter the latest offer. */
function CounterOfferDialog({
  open,
  onOpenChange,
  offerId,
  currentAmountCents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  currentAmountCents: number;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const placeholder = (currentAmountCents / 100).toFixed(2);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setInlineError(null);

    const dollars = Number.parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setInlineError('Enter a counter amount greater than zero.');
      return;
    }
    const amountCents = Math.round(dollars * 100);
    if (amountCents < 1 || amountCents > OFFER_AMOUNT_MAX) {
      setInlineError('Enter a valid counter amount.');
      return;
    }

    startTransition(async () => {
      const result = await counterOffer(offerId, amountCents, message || undefined);
      if (result.ok) {
        toast.success(`Counter offer of ${formatAud(result.offer.amount_cents)} sent.`);
        onOpenChange(false);
        setAmount('');
        setMessage('');
        router.refresh();
        return;
      }
      const msg = result.detail ?? 'Could not send the counter offer. Please try again.';
      setInlineError(msg);
      toast.error(msg);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Counter offer</DialogTitle>
            <DialogDescription>
              Propose a different price. This replaces the current offer of{' '}
              {formatAud(currentAmountCents)}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor={`counter-amount-${offerId}`}>Your counter (AUD)</Label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                  aria-hidden
                >
                  $
                </span>
                <Input
                  id={`counter-amount-${offerId}`}
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  placeholder={placeholder}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-7"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`counter-message-${offerId}`}>Message (optional)</Label>
              <Textarea
                id={`counter-message-${offerId}`}
                placeholder="Add a note…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                rows={3}
              />
            </div>

            {inlineError ? (
              <p role="alert" className="text-sm text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Sending…' : 'Send counter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
