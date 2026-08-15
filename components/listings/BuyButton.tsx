'use client';

// components/listings/BuyButton.tsx
//
// Entry point to a purchase contract (Req 4.1). When the buyer clicks "Buy now":
//   1. Fetch their payment method status from the server.
//   2a. Saved method exists → show a compact card widget ("Visa •••• 4242") plus
//       the seller identity confirmation, all in one view.
//   2b. No method → show the inline card entry form. Once saved, advance to 2a.
//
// Confirming reserves the item and opens the contract room. No money moves until
// both parties accept the same fulfillment terms.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2, ShieldCheck, ShoppingCart } from 'lucide-react';

import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { ListingActionIcon } from '@/components/listings/ListingActionIcon';
import { AddPaymentMethodForm } from '@/components/payments/AddPaymentMethodForm';
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
import { initiateCashSale } from '@/lib/actions/cashSale';
import {
  ContractRequestFields,
  emptyRequest,
  requestTotalCents,
  toRequestLineItems,
  type RequestDraft,
} from '@/components/sales/ContractLineItems';

// Refusal copy lives in `lib/cashSaleErrors.ts` because accepting an Offer opens
// the same contract and has to explain the same refusals. Keeping a second map
// here is what let the two drift — see the note in that file.
import { cashSaleRefusalMessage } from '@/lib/cashSaleErrors';

export function BuyButton({
  itemId,
  sellerIdentity,
  appearance = 'button',
  isShopfront = false,
}: {
  itemId: string;
  sellerIdentity: SellerIdentityDisclosure;
  /** `icon` = round chip + label below (item detail). */
  appearance?: 'button' | 'icon';
  /**
   * The listing is a browsable inventory rather than one object (0064).
   *
   * The control stays "Buy now" — it opens a contract on this listing either way,
   * and a second verb for the same act only made members wonder what the other one
   * did. What changes is what the contract has to state, because the listing
   * cannot: the buyer writes what they want out of the binder and names a price,
   * and that becomes the contract's single line item. The one thing that must not
   * be glossed is that nothing is reserved by opening it.
   */
  isShopfront?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<RequestDraft>(emptyRequest);

  // Payment method status, fetched on dialog open.
  const [paymentLabel, setPaymentLabel] = useState<string | null>(null);
  const [hasPaymentMethod, setHasPaymentMethod] = useState<boolean | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Fetch payment method status every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingStatus(true);
    getPaymentMethodStatus()
      .then((result) => {
        if (cancelled) return;
        setLoadingStatus(false);
        if (result.ok) {
          setHasPaymentMethod(result.data.hasPaymentMethod);
          setPaymentLabel(result.data.label);
        } else {
          setHasPaymentMethod(false);
          setPaymentLabel(null);
        }
      })
      .catch(() => {
        // Never leave the dialog stuck on the spinner if the lookup rejects;
        // fall back to the card-entry path.
        if (cancelled) return;
        setLoadingStatus(false);
        setHasPaymentMethod(false);
        setPaymentLabel(null);
      });
    return () => { cancelled = true; };
  }, [open]);

  function openContract() {
    setError(null);
    startTransition(async () => {
      const result = await initiateCashSale({
        itemId,
        sellerIdentityVersion: sellerIdentity.version,
        buyerConfirmedSellerIdentity: true,
        lineItems: isShopfront ? toRequestLineItems(request) : undefined,
      });
      if (result.ok) {
        router.push(`/sales/${result.sale.id}`);
        return;
      }
      if (result.error === 'no-payment-method') {
        setHasPaymentMethod(false);
        setPaymentLabel(null);
        return;
      }
      setError(
        result.message ?? cashSaleRefusalMessage(result.error),
      );
    });
  }

  function handleBuy() {
    if (isShopfront) {
      if (toRequestLineItems(request).length === 0) {
        setError('Describe what you want from this listing.');
        return;
      }
      if (requestTotalCents(request) <= 0) {
        setError('Put a price on what you are asking for.');
        return;
      }
    }
    if (!confirmed) {
      setError('Confirm that this is the seller you intend to buy from.');
      return;
    }
    openContract();
  }

  const showCardForm = hasPaymentMethod === false;
  const showCheckout = hasPaymentMethod === true;
  const loading = loadingStatus || hasPaymentMethod === null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setConfirmed(false);
          setError(null);
          setRequest(emptyRequest());
        }
      }}
    >
      <DialogTrigger asChild>
        {appearance === 'icon' ? (
          <ListingActionIcon icon={ShoppingCart} label="Buy now" variant="default" />
        ) : (
          <Button type="button" size="lg" className="flex-1 sm:flex-none">
            <ShoppingCart aria-hidden />
            Buy now
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        {loading ? (
          <div className="flex items-center justify-center py-8" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden />
            <span className="sr-only">Loading payment details…</span>
          </div>
        ) : showCardForm ? (
          <>
            {/* Negative margin cancels DialogContent's flex gap: with the
                description gone there is nothing to separate the title from
                Stripe's own bordered card. */}
            <DialogHeader className="-mb-3 sm:-mb-4">
              <DialogTitle>Add a payment method</DialogTitle>
            </DialogHeader>
            <AddPaymentMethodForm
              onAttached={() => {
                // Re-fetch to pick up the new label.
                setLoadingStatus(true);
                getPaymentMethodStatus()
                  .then((result) => {
                    setLoadingStatus(false);
                    if (result.ok) {
                      setHasPaymentMethod(result.data.hasPaymentMethod);
                      setPaymentLabel(result.data.label);
                    }
                  })
                  .catch(() => setLoadingStatus(false));
              }}
            />
          </>
        ) : showCheckout ? (
          <>
            <DialogHeader>
              <DialogTitle>Start a purchase contract</DialogTitle>
              <DialogDescription>
                {isShopfront
                  ? 'Say what you want from this listing and what you would pay. The seller can change both with you before either of you accepts, and you pay through Stripe only once you agree.'
                  : 'This reserves the item and opens a private contract with the seller. You pay through Stripe only after you both agree how the item changes hands.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* The one thing a buyer could reasonably get wrong. Every other
                  listing on the site is held the moment a contract opens; this
                  one is not, and being vague about that would be the difference
                  between a disappointed buyer and a misled one. */}
              {isShopfront ? (
                <>
                  <div className="rounded-lg border border-dashed bg-muted/30 p-3 text-body">
                    <p className="font-medium">Nothing is held for you yet</p>
                    <p className="mt-1 text-muted-foreground">
                      Other buyers can ask for the same cards. Your place is
                      settled when you both accept the terms and your payment is
                      confirmed.
                    </p>
                  </div>
                  <ContractRequestFields
                    value={request}
                    onChange={setRequest}
                    disabled={isPending}
                  />
                </>
              ) : null}

              {/* Seller identity */}
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="text-trust mb-3 flex items-center gap-2 text-body font-medium">
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  DittoShield verified via Stripe
                </div>
                <dl className="grid gap-2 text-body">
                  {sellerIdentity.tradingName ? (
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Store</dt>
                      <dd className="break-words font-medium">
                        {sellerIdentity.tradingName}
                      </dd>
                    </div>
                  ) : null}
                  {/* THIS ROW USED TO READ "Verified name" UNCONDITIONALLY, and that
                      was the overclaim worth fixing first: this is the screen where a
                      Buyer commits money against the disclosure. `legalEntityName`
                      falls back to the seller's own `display_name` for members
                      grandfathered by 0069, so for those rows the old label promised a
                      government document check that had not happened. */}
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">
                      {sellerIdentity.nameIsDocumentVerified
                        ? 'Real name'
                        : 'Stated name'}
                    </dt>
                    <dd className="break-words font-medium">
                      {sellerIdentity.legalEntityName}
                    </dd>
                  </div>
                  {sellerIdentity.nameIsDocumentVerified ? null : (
                    <p className="text-body text-muted-foreground">
                      This seller verified their identity before we began recording
                      names from photo ID, so the name above is the one they gave us
                      rather than one checked against a document.
                    </p>
                  )}
                  <div>
                    <dt className="text-muted-foreground">Verified</dt>
                    <dd>{new Date(sellerIdentity.verifiedAt).toLocaleDateString('en-AU')}</dd>
                  </div>
                </dl>
              </div>

              {/* Saved payment method widget — just above the confirmation */}
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <CreditCard className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">
                    {paymentLabel ?? 'Card on file'}
                  </p>
                  <p className="text-meta text-muted-foreground">
                    Stripe method
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-meta"
                  onClick={() => {
                    setHasPaymentMethod(false);
                    setPaymentLabel(null);
                  }}
                >
                  Change
                </Button>
              </div>

              <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-body">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  className="h-4 w-4 shrink-0"
                  disabled={isPending}
                />
                <span>
                  I confirm that these are the seller details I expect and I want
                  to open a contract with them.
                </span>
              </label>

              {error ? (
                <p role="alert" className="text-body text-destructive">
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              {/* Enabled until the request starts: clicking without ticking the
                  box surfaces an inline error via handleBuy, which is clearer
                  than a mysteriously disabled button. */}
              <Button
                type="button"
                onClick={handleBuy}
                disabled={isPending}
                aria-busy={isPending}
              >
                {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {isPending
                  ? 'Opening contract…'
                  : isShopfront
                    ? 'Open contract and agree terms'
                    : 'Reserve item and agree terms'}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
