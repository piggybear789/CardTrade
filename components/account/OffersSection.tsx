'use client';

// components/account/OffersSection.tsx
//
// The "Offers" list: price negotiations the caller is party to, as buyer or seller.
//
// GROUPED BY LISTING. Every negotiation used to be a free-standing card carrying its own
// copy of the item photo and title, so a seller with three offers on one card read the
// same title three times down the page with nothing saying the three were about the same
// thing — which is the single most important fact when deciding which to accept. The item
// is now stated once and its negotiations sit under it.
//
// THE CHAIN IS DRAWN. A row showed the latest amount alone, and that number cannot be
// read: whether $95 is a concession or a hardening depends on the $80 and the $110 before
// it. `MyOfferEntry.chain` walks `parent_offer_id`, and the sequence is rendered whenever
// there is more than one link.
//
// ACCEPTING STATES BOTH CONSEQUENCES. The confirm dialog said a contract opens at the
// agreed price. It did not say that accepting DECLINES every other pending offer on the
// listing, which for a seller choosing between three is the consequence that matters, nor
// that a single listing is reserved and leaves the catalog. Both are now named, with the
// rival count coming down with the data rather than being guessed at in the dialog.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { navigateWithType } from '@/lib/motion/navigate';
import { toast } from 'sonner';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { HandCoinsIcon, ImageOffIcon, LoaderCircleIcon } from '@hugeicons/core-free-icons';

import { Card } from '@/components/ui/card';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cashSaleRefusalMessage } from '@/lib/cashSaleErrors';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/account/EmptyState';
import { EmptyState as SharedEmptyState } from '@/components/ui/empty-state';
import { StorageImage } from '@/components/ui/storage-image';
import { formatAud, itemImageUrl } from '@/lib/format';
import {
  counterOffer,
  respondToOffer,
  type MyOfferEntry,
  type OfferChainEntry,
  type OfferStatus,
} from '@/lib/actions/offers';
import { OFFER_AMOUNT_MAX } from '@/lib/marketplace-constants';
import { cn } from '@/lib/utils';

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

/** Negotiations on one listing, in the order the list should show them. */
interface OfferGroup {
  itemId: string;
  itemTitle: string | null;
  itemImagePath: string | null;
  offers: MyOfferEntry[];
}

/**
 * Collapse the flat list into one group per listing, preserving the incoming order.
 *
 * The first negotiation seen for an item fixes the group's position, so a seller's most
 * recently active listing stays at the top rather than being reordered by how many
 * offers it happens to have.
 */
function groupByItem(offers: MyOfferEntry[]): OfferGroup[] {
  const groups = new Map<string, OfferGroup>();
  for (const offer of offers) {
    const existing = groups.get(offer.itemId);
    if (existing) {
      existing.offers.push(offer);
      continue;
    }
    groups.set(offer.itemId, {
      itemId: offer.itemId,
      itemTitle: offer.itemTitle,
      itemImagePath: offer.itemImagePath,
      offers: [offer],
    });
  }

  // HIGHEST FIRST WITHIN A LISTING. The incoming order is recency, which is right for
  // ordering the GROUPS — the listing someone just bid on belongs at the top — and
  // wrong inside one. Three live offers on one card is a comparison, and the question
  // is which is the best, not which arrived last: sorted by time, $760, $695 and $720
  // appeared in that order and a seller had to read all three to find the top bid.
  //
  // Live offers stay above decided ones whatever the amount, because a withdrawn $900
  // is not a better option than a pending $700 — it is not an option.
  for (const group of groups.values()) {
    group.offers.sort((a, b) => {
      const aLive = a.status === 'PENDING';
      const bLive = b.status === 'PENDING';
      if (aLive !== bLive) return aLive ? -1 : 1;
      return b.amountCents - a.amountCents;
    });
  }

  return Array.from(groups.values());
}

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
        icon={<HugeiconsIcon icon={HandCoinsIcon} className="size-6" aria-hidden />}
        title="No Past Offers"
        description="Decided or withdrawn offers will be kept here."
        compact
        fill
      />
    ) : (
      <EmptyState
        icon={<HugeiconsIcon icon={HandCoinsIcon} className="size-6" aria-hidden />}
        title="No Offers Yet"
        description="Make an offer on a listing, or wait for buyers to send you one."
        ctaLabel="Browse the marketplace"
        ctaHref="/"
      />
    );
  }

  return (
    <ul role="list" className="space-y-cozy">
      {groupByItem(offers).map((group) => (
        <li key={group.itemId}>
          <ListingOfferGroup group={group} />
        </li>
      ))}
    </ul>
  );
}

/** One listing, its photo and title stated once, then every negotiation on it. */
function ListingOfferGroup({ group }: { group: OfferGroup }) {
  const imageUrl = itemImageUrl(group.itemImagePath);
  const title = group.itemTitle ?? 'Item';
  const count = group.offers.length;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-cozy border-b border-border bg-muted/50 px-cozy py-snug">
        <span className="relative size-10 shrink-0 overflow-hidden rounded-md bg-muted">
          {imageUrl ? (
            <StorageImage
              src={imageUrl}
              alt=""
              sizes="40px"
              className="object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex size-full items-center justify-center text-muted-foreground">
              <HugeiconsIcon icon={ImageOffIcon} className="size-4" aria-hidden />
              <span className="sr-only">No image available</span>
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          {/* A link, because the whole point of grouping is that this is one thing and
              a member may want to look at it. `itemTitle` is null when RLS will not
              show the item — a sold or hidden listing — and a link to a page that
              404s is worse than plain text, so the link is conditional on the title. */}
          {group.itemTitle ? (
            <Link
              href={`/listings/${group.itemId}`}
              transitionTypes={['nav-forward']}
              className="block truncate text-body font-semibold underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
            >
              {title}
            </Link>
          ) : (
            <p className="truncate text-body font-semibold text-muted-foreground">
              Item no longer listed
            </p>
          )}
        </div>
        {/* Only when there is more than one, because "1 offer" over a single row is a
            label for something already obvious.

            THE TRADE-OFF IS STATED ONCE, HERE. It used to sit on every row that could
            be accepted, so a listing with three live offers carried "accepting this
            declines the other 2 offers" three times inside one card — the same sentence,
            three times, about the same three offers. It is a property of the GROUP. */}
        {count > 1 ? (
          <span className="shrink-0 text-meta tabular-nums text-muted-foreground">
            {count} offers · accepting one declines the rest
          </span>
        ) : null}
      </div>

      <ul role="list" className="divide-y divide-border">
        {group.offers.map((offer) => (
          <li key={offer.offerId} className="px-cozy py-group">
            <OfferNegotiation offer={offer} itemTitle={title} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * The counter chain, oldest to newest.
 *
 * Rendered only when there is something to compare — a single opening offer is already
 * the headline amount above it, and drawing a one-link chain would be a diagram of
 * nothing. Superseded amounts are struck through: they are what the negotiation moved
 * PAST, and reading them at equal weight makes a three-round haggle look like three
 * live offers.
 */
function OfferChain({ chain }: { chain: OfferChainEntry[] }) {
  if (chain.length < 2) return null;

  return (
    <ol className="mt-snug flex flex-wrap items-center gap-x-tight gap-y-tight">
      {chain.map((link, index) => {
        const live = index === chain.length - 1;
        return (
          <li key={link.id} className="flex items-center gap-x-tight">
            {index > 0 ? (
              <span className="text-meta text-muted-foreground" aria-hidden="true">
                →
              </span>
            ) : null}
            {/* ACTOR FIRST. Trailing it read "$700.00 them → $800.00 you", where each
                label sits between two amounts and belongs to neither by position.
                Leading it makes each link a sentence — "them $700.00" — and the arrows
                separate turns instead of floating between a number and a pronoun. */}
            <span className="text-meta text-muted-foreground">
              {link.byMe ? 'you' : 'them'}
            </span>
            <span
              className={cn(
                'text-meta tabular-nums',
                live ? 'font-semibold text-foreground' : 'text-muted-foreground line-through',
              )}
            >
              {formatAud(link.amountCents)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A single negotiation: the live amount, who it is with, and the caller's options. */
function OfferNegotiation({
  offer,
  itemTitle,
}: {
  offer: MyOfferEntry;
  /** Resolved once by the group so every row names the listing the same way. */
  itemTitle: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [counterOpen, setCounterOpen] = useState(false);
  const [confirming, setConfirming] = useState<'accept' | 'decline' | 'withdraw' | null>(
    null,
  );

  const status = OFFER_STATUS_BADGE[offer.status];
  const counterparty = offer.counterpartyName ?? 'Unknown user';
  const roleLabel = offer.role === 'buyer' ? 'You are buying' : 'You are selling';
  const latestNote = offer.chain[offer.chain.length - 1]?.message ?? null;

  // BOTH CONSEQUENCES, IN ONE SENTENCE EACH. The rival count is only ever non-zero for
  // a seller (RLS), which is also the only side for whom it means anything.
  const acceptConsequences = [
    `Accepting opens a purchase contract for "${itemTitle}" with ${counterparty} at ${formatAud(offer.amountCents)}.`,
    offer.role === 'seller'
      ? 'The card is reserved and leaves the catalog until the contract settles.'
      : 'You pay once handover details are set; NoDitto holds the money until you accept the card.',
    offer.otherPendingOnItem > 0
      ? offer.otherPendingOnItem === 1
        ? 'The other pending offer on this listing will be declined.'
        : `The other ${offer.otherPendingOnItem} pending offers on this listing will be declined.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');

  function respond(action: 'accept' | 'decline' | 'withdraw'): Promise<boolean> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await respondToOffer(offer.offerId, action);
        if (result.ok) {
          if (action === 'accept' && result.saleId) {
            navigateWithType(router, `/sales/${result.saleId}`, 'nav-forward');
            resolve(true);
            return;
          }
          router.refresh();
          resolve(true);
          return;
        }
        // SURFACE THE REASON THE SERVER SENT. This branch used to replace every
        // `sale-failed` with "the item may no longer be available", which threw away
        // the one thing that made the refusal actionable — `detail` carries the
        // underlying `initiateCashSale` code. For a buyer with no saved card, the
        // substituted copy was also simply untrue, so they abandoned a purchase that
        // needed one more click.
        const message =
          result.error === 'sale-failed'
            ? cashSaleRefusalMessage(result.detail, result.detail)
            : (result.detail ?? 'Could not update the offer. Please try again.');
        toast.error(message);
        resolve(false);
      });
    });
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-snug">
        <p className="text-lead font-bold tabular-nums tracking-tight">
          {formatAud(offer.amountCents)}
        </p>
        <Badge variant={status.variant} className="shrink-0">
          {status.label}
        </Badge>
      </div>

      <p className="mt-0.5 truncate text-body text-muted-foreground">
        {roleLabel} · with {counterparty}
        {offer.offeredByMe ? ' · your offer' : ''}
      </p>

      <OfferChain chain={offer.chain} />

      {latestNote ? (
        // The note belongs to the LIVE offer, so it is attributed rather than floating:
        // a message from the other side reads very differently from your own.
        <p className="mt-snug whitespace-pre-line break-words rounded-md border bg-muted p-snug text-body">
          <span className="text-muted-foreground">
            {offer.offeredByMe ? 'Your note: ' : `${counterparty}: `}
          </span>
          {latestNote}
        </p>
      ) : null}

      {/* NO per-row rival warning. The group header states it once — see the note
          there. The confirm dialog still names the exact count, because that is the
          moment it becomes a consequence rather than context. */}

      {/* Inline actions when it's the caller's turn. */}
      {(offer.isMyTurn || offer.canWithdraw) && (
        <div className="mt-cozy flex flex-wrap gap-snug">
          {offer.isMyTurn && (
            <>
              <Button
                size="sm"
                onClick={() => setConfirming('accept')}
                disabled={isPending}
                aria-busy={isPending}
                aria-haspopup="dialog"
              >
                {isPending ? (
                  <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
                ) : null}
                Accept
              </Button>
              <ConfirmDialog
                open={confirming === 'accept'}
                onOpenChange={(open) => {
                  if (isPending) return;
                  setConfirming(open ? 'accept' : null);
                }}
                title="Accept this offer?"
                description={acceptConsequences}
                confirmLabel="Accept offer"
                cancelLabel="Not now"
                pending={isPending}
                helpHref="/help#holds"
                onConfirm={async () => {
                  const ok = await respond('accept');
                  if (ok) setConfirming(null);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming('decline')}
                disabled={isPending}
                aria-haspopup="dialog"
              >
                Decline
              </Button>
              <ConfirmDialog
                open={confirming === 'decline'}
                onOpenChange={(open) => {
                  if (isPending) return;
                  setConfirming(open ? 'decline' : null);
                }}
                title="Decline this offer?"
                description={`This offer of ${formatAud(offer.amountCents)} for "${itemTitle}" will be declined. They can send a new one.`}
                confirmLabel="Decline offer"
                confirmVariant="destructive"
                pending={isPending}
                onConfirm={async () => {
                  const ok = await respond('decline');
                  if (ok) setConfirming(null);
                }}
              />
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
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirming('withdraw')}
                disabled={isPending}
                aria-busy={isPending}
                aria-haspopup="dialog"
              >
                {isPending ? (
                  <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
                ) : null}
                Withdraw
              </Button>
              <ConfirmDialog
                open={confirming === 'withdraw'}
                onOpenChange={(open) => {
                  if (isPending) return;
                  setConfirming(open ? 'withdraw' : null);
                }}
                title="Withdraw this offer?"
                description={`Your offer of ${formatAud(offer.amountCents)} for "${itemTitle}" will be withdrawn. You can make a new one later.`}
                confirmLabel="Withdraw offer"
                pending={isPending}
                onConfirm={async () => {
                  const ok = await respond('withdraw');
                  if (ok) setConfirming(null);
                }}
              />
            </>
          )}
        </div>
      )}

      {offer.isMyTurn && (
        <CounterOfferDialog
          open={counterOpen}
          onOpenChange={setCounterOpen}
          offerId={offer.offerId}
          currentAmountCents={offer.amountCents}
        />
      )}
    </div>
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

          <div className="space-y-group py-group">
            <div className="space-y-snug">
              <Label htmlFor={`counter-amount-${offerId}`}>Your counter</Label>
              <MoneyInput
                id={`counter-amount-${offerId}`}
                min="0.01"
                placeholder={placeholder}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div className="space-y-snug">
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
              <p role="alert" className="text-body text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Sending…' : 'Send counter'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
