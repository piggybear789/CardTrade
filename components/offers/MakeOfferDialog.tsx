'use client';

// components/offers/MakeOfferDialog.tsx
//
// Client entry point for opening a price Negotiation on a listing (Phase 3).
// Renders a shadcn Dialog containing an amount input (entered in dollars and
// converted to integer cents via Math.round(dollars * 100)) plus an optional
// message, and calls the `makeOffer` server action. On success it shows a toast
// and optionally routes the buyer to the account "Offers" tab.
//
// Visibility (authenticated + VERIFIED + non-owner + AVAILABLE) is decided by
// the server component that renders this button; `makeOffer` re-enforces every
// gate, so this component only drives the interaction.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { navigateWithType } from '@/lib/motion/navigate';
import { toast } from 'sonner';
import { HugeiconsIcon } from '@hugeicons/react';
import { HandCoinsIcon, LoaderCircleIcon, ShieldCheckIcon } from '@hugeicons/core-free-icons';

import { FieldError } from '@/components/motion/FieldError';
import { ListingActionIcon } from '@/components/listings/ListingActionIcon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Textarea } from '@/components/ui/textarea';
import { platformFeeCentsFor } from '@/domain/orchestrator/cashSaleOrchestrator';
import { displayLegalName, formatMoney } from '@/lib/format';
import { buyerPaysCents } from '@/lib/listings/buyerPrice';
import { makeOffer, type MakeOfferResult } from '@/lib/actions/offers';
import { OFFER_AMOUNT_MAX } from '@/lib/marketplace-constants';
import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';

/** Friendly, inline-safe messages for each typed offer error. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in to make an offer.',
  'seller-identity-unverified': 'This seller is not currently verified.',
  'seller-identity-changed': 'The seller identity changed. Refresh and review it again.',
  'confirmation-required': 'Confirm the verified seller identity before making an offer.',
  'item-not-found': 'This item is no longer available.',
  'item-not-available': 'This item is no longer available for offers.',
  'self-offer': 'You cannot make an offer on your own listing.',
  'invalid-amount': 'Enter a valid offer amount.',
  'persistence-error': 'Could not submit your offer. Please try again.',
};

/** Resolve a user-facing message for a failed offer result. */
function messageForError(result: Extract<MakeOfferResult, { ok: false }>): string {
  return ERROR_MESSAGES[result.error] ?? result.detail ?? 'Could not submit your offer.';
}

export interface MakeOfferDialogProps {
  /** The item being negotiated on. */
  itemId: string;
  /** The seller's asking price in minor units: what offers are measured against. */
  fmvCents?: number;
  /** `items.currency`, which decides the fee folded into what the buyer pays. */
  currency?: string;
  /** Current provider-approved seller identity the buyer must acknowledge. */
  sellerIdentity: SellerIdentityDisclosure;
  /** Replaces the default listing-action chip — used by the mobile buyer bar. */
  trigger?: ReactNode;
}

/** Quick amounts, as a discount off the asking price. */
const QUICK_DISCOUNTS = [5, 10, 15] as const;

/**
 * A "Make an offer" button that opens a dialog to submit a PENDING offer for
 * {@link itemId}. On success it toasts and routes to `/offers`.
 */
export function MakeOfferDialog({
  itemId,
  fmvCents,
  currency = 'aud',
  sellerIdentity,
  trigger,
}: MakeOfferDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // EMPTY, NOT PRE-FILLED. Seeding the field with the asking price ("400000.00")
  // asked the buyer to edit a raw number rather than to name their own.
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const asking = fmvCents && fmvCents > 0 ? fmvCents : null;
  const money = (cents: number) => formatMoney(cents, currency);
  const typedCents = Math.round(Number.parseFloat(amount) * 100);
  const offerCents = Number.isFinite(typedCents) && typedCents > 0 ? typedCents : null;
  // Whole dollars, rounded down: "5% off" should land on a number a person would say.
  const quickAmount = (discount: number) =>
    asking ? Math.floor((asking * (100 - discount)) / 100 / 100) * 100 : 0;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setInlineError(null);

    const dollars = Number.parseFloat(amount);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      setInlineError('Enter an offer amount greater than zero.');
      return;
    }

    const amountCents = Math.round(dollars * 100);
    if (amountCents < 1 || amountCents > OFFER_AMOUNT_MAX) {
      setInlineError('Enter a valid offer amount.');
      return;
    }

    startTransition(async () => {
      const result = await makeOffer(
        itemId,
        amountCents,
        message || undefined,
        sellerIdentity.version,
        true,
      );
      if (result.ok) {
        
        setOpen(false);
        setAmount('');
        setMessage('');
        navigateWithType(router, '/offers', 'nav-forward');
        return;
      }
      const msg = messageForError(result);
      setInlineError(msg);
      toast.error(msg);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <ListingActionIcon
            icon={HandCoinsIcon}
            label="Make an offer"
            iconClassName="size-7"
          />
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Make an offer</DialogTitle>
            {/* What happens next, stated once. Offers do not expire on a timer: one
                stays open until the seller answers or the item sells. */}
            <DialogDescription>
              The seller can accept, counter or decline. Your offer stays open until
              they answer or the item sells, and nothing is charged until you pay in
              the contract.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-group py-group">
            {/* THE PAGE'S NUMBER FIRST. The page leads with what a buyer pays; this
                used to say "Listed at" the seller's pre-fee price, a different figure
                for the same card. Both now appear, and the sum is labelled. */}
            {asking ? (
              <div className="rounded-md border p-cozy text-body">
                <p className="flex items-baseline justify-between gap-cozy">
                  <span className="text-muted-foreground">Listed at</span>
                  <span className="font-semibold tabular-nums">{money(buyerPaysCents(asking, currency))}</span>
                </p>
                <p className="mt-tight text-meta text-muted-foreground">
                  Seller&apos;s price {money(asking)} + {money(platformFeeCentsFor(asking, currency))} NoDitto fee
                </p>
              </div>
            ) : null}

            <div className="space-y-snug">
              <Label htmlFor="offer-amount">Your offer to the seller</Label>
              <MoneyInput
                id="offer-amount"
                min="0.01"
                placeholder={asking ? String(quickAmount(10) / 100) : '0.00'}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              {asking ? (
                <div className="flex flex-wrap gap-snug" role="group" aria-label="Quick offer amounts">
                  {QUICK_DISCOUNTS.map((discount) => {
                    const cents = quickAmount(discount);
                    return (
                      <Button
                        key={discount}
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-pressed={offerCents === cents}
                        className="aria-[pressed=true]:border-foreground aria-[pressed=true]:bg-accent aria-[pressed=true]:text-accent-foreground"
                        onClick={() => setAmount(String(cents / 100))}
                      >
                        {discount}% off
                      </Button>
                    );
                  })}
                </div>
              ) : null}
              {/* LIVE, so the buyer sees the figure they would actually be charged
                  while they type, not after the seller accepts. */}
              <p className="min-h-[1lh] text-body text-muted-foreground" aria-live="polite">
                {offerCents ? (
                  <>
                    You&apos;d pay{' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {money(buyerPaysCents(offerCents, currency))}
                    </span>{' '}
                    including the {money(platformFeeCentsFor(offerCents, currency))} fee.
                  </>
                ) : null}
              </p>
            </div>

            <p className="flex items-start gap-tight text-meta text-muted-foreground">
              <HugeiconsIcon icon={ShieldCheckIcon} className="mt-px size-3.5 shrink-0 text-trust" aria-hidden />
              <span className="min-w-0 break-words">
                Seller verified as {displayLegalName(sellerIdentity.legalEntityName)}
                {sellerIdentity.tradingName ? `, trading as ${sellerIdentity.tradingName}` : ''}
              </span>
            </p>

            <div className="space-y-snug">
              <Label htmlFor="offer-message">Message (optional)</Label>
              <Textarea
                id="offer-message"
                placeholder="Add a note for the seller…"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={2000}
                rows={3}
              />
            </div>

            {inlineError ? <FieldError message={inlineError} /> : null}
          </div>

          <DialogFooter>
            {/* The spinner REPLACES a glyph rather than appearing beside the label, and
                the label does not change. Prepending a spinner and swapping "Send offer"
                for "Sending…" resized the button twice in one click, and on a phone the
                footer stacks full-width so it also pushed the dialog's height around.
                `aria-busy` carries the state for assistive tech. */}
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              <HugeiconsIcon
                icon={isPending ? LoaderCircleIcon : HandCoinsIcon}
                className={isPending ? 'animate-spin' : undefined}
                aria-hidden
              />
              Send offer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
