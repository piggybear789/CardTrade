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

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { HandCoins, Loader2 } from 'lucide-react';

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
import { formatAud } from '@/lib/format';
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
  /** The item's Fair Market Value in cents, used for a sensible placeholder. */
  fmvCents?: number;
  /** Current provider-approved seller identity the buyer must acknowledge. */
  sellerIdentity: SellerIdentityDisclosure;
  /** Trigger button size when `appearance` is `button`. */
  size?: 'default' | 'sm' | 'lg';
  /** `icon` = round chip + label below (item detail). */
  appearance?: 'button' | 'icon';
}

/**
 * A "Make an offer" button that opens a dialog to submit a PENDING offer for
 * {@link itemId}. On success it toasts and routes to `/offers`.
 */
export function MakeOfferDialog({
  itemId,
  fmvCents,
  sellerIdentity,
  size = 'lg',
  appearance = 'button',
}: MakeOfferDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [confirmedSeller, setConfirmedSeller] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Placeholder suggests the FMV in dollars (e.g. "123.45").
  const placeholder =
    fmvCents && fmvCents > 0 ? (fmvCents / 100).toFixed(2) : '0.00';

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setInlineError(null);

    if (!confirmedSeller) {
      setInlineError('Confirm the verified seller identity before making an offer.');
      return;
    }

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
        toast.success(
          `Offer of ${formatAud(result.offer.amount_cents)} sent to the seller.`,
        );
        setOpen(false);
        setAmount('');
        setMessage('');
        setConfirmedSeller(false);
        router.push('/offers');
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
        {appearance === 'icon' ? (
          <ListingActionIcon icon={HandCoins} label="Make an offer" />
        ) : (
          <Button type="button" variant="outline" size={size} className="w-full sm:w-auto">
            <HandCoins aria-hidden />
            Make an offer
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Make an offer</DialogTitle>
            <DialogDescription>
              Propose a price for this item. The seller can accept, decline, or
              counter your offer. Accepted offers are paid through Stripe.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="min-w-0 rounded-md border bg-muted/30 p-cozy text-body">
              <p className="font-medium">DittoShield verified seller</p>
              {sellerIdentity.tradingName ? (
                <p className="break-words">{sellerIdentity.tradingName}</p>
              ) : null}
              <p className="break-words text-muted-foreground">
                {sellerIdentity.legalEntityName}
              </p>
            </div>

            <label className="flex items-start gap-3 text-body">
              <input
                type="checkbox"
                checked={confirmedSeller}
                onChange={(event) => setConfirmedSeller(event.target.checked)}
                className="mt-0.5 h-4 w-4"
                disabled={isPending}
              />
              <span>
                I confirm this is the seller I intend to pay through Stripe
                if the offer is accepted.
              </span>
            </label>

            <div className="space-y-2">
              <Label htmlFor="offer-amount">Your offer</Label>
              <MoneyInput
                id="offer-amount"
                min="0.01"
                placeholder={placeholder}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
              {fmvCents && fmvCents > 0 ? (
                <p className="text-meta text-muted-foreground">
                  Listed at {formatAud(fmvCents)}.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
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

            {inlineError ? (
              <p role="alert" className="text-body text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            {/* Stays enabled until the request starts; submitting without the
                confirmation surfaces an inline error instead of a dead button. */}
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Sending…' : 'Send offer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
