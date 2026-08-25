'use client';

// components/listings/BuyButton.tsx
//
// Entry point to a purchase contract (Req 4.1). When the buyer clicks "Buy now":
//   1. Fetch their payment method status from the server.
//   2a. Saved method exists → show a compact card widget ("Visa •••• 4242").
//   2b. No method → show the inline card entry form. Once saved, advance to 2a.
//
// Confirming reserves the item and opens the contract room. No money moves until
// the buyer pays after handover details are set.

import { useEffect, useState, useTransition, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { CreditCard, Loader2, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';

import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { navigateWithType } from '@/lib/motion/navigate';
import { FieldError } from '@/components/motion/FieldError';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { ListingActionIcon } from '@/components/listings/ListingActionIcon';

const AddPaymentMethodForm = dynamic(
  () => import('@/components/payments/AddPaymentMethodForm').then((m) => m.AddPaymentMethodForm),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-40 items-center justify-center" role="status">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="sr-only">Loading payment form…</span>
      </div>
    ),
  },
);

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
} from '@/components/sales/ContractLineItems';

// Refusal copy lives in `lib/cashSaleErrors.ts` because accepting an Offer opens
// the same contract and has to explain the same refusals. Keeping a second map
// here is what let the two drift — see the note in that file.
import { cashSaleRefusalMessage } from '@/lib/cashSaleErrors';

type SalePrep =
  | { ok: true; lineItems?: ReturnType<typeof toRequestLineItems> }
  | { ok: false; error: string };

/**
 * Single-item listing: opening the contract reserves the object.
 */
export function BuyButton({
  itemId,
  sellerIdentity,
  trigger,
}: {
  itemId: string;
  sellerIdentity: SellerIdentityDisclosure;
  /** Replaces the default listing-action chip — used by the mobile buyer bar. */
  trigger?: ReactNode;
}) {
  return (
    <PurchaseDialog
      itemId={itemId}
      sellerIdentity={sellerIdentity}
      description="This reserves the item and opens a contract with the seller. You do not pay yet."
      confirmLabel="Reserve item and agree terms"
      prepareSale={() => ({ ok: true })}
      trigger={trigger}
    />
  );
}

/**
 * Shopfront / binder listing: the buyer names what they want and a price.
 * Nothing is reserved when the contract opens (0064).
 */
export function ShopfrontBuyButton({
  itemId,
  sellerIdentity,
  trigger,
}: {
  itemId: string;
  sellerIdentity: SellerIdentityDisclosure;
  trigger?: ReactNode;
}) {
  const [request, setRequest] = useState(emptyRequest);

  return (
    <PurchaseDialog
      itemId={itemId}
      sellerIdentity={sellerIdentity}
      description="Describe your desired items. You do not pay yet."
      confirmLabel="Open contract and agree terms"
      onReset={() => setRequest(emptyRequest())}
      trigger={trigger}
      prepareSale={() => {
        if (toRequestLineItems(request).length === 0) {
          return { ok: false, error: 'Describe what you want from this listing.' };
        }
        if (requestTotalCents(request) <= 0) {
          return { ok: false, error: 'Put a price on what you are asking for.' };
        }
        return { ok: true, lineItems: toRequestLineItems(request) };
      }}
    >
      <ContractRequestFields value={request} onChange={setRequest} />
    </PurchaseDialog>
  );
}

function PurchaseDialog({
  itemId,
  sellerIdentity,
  description,
  confirmLabel,
  prepareSale,
  onReset,
  trigger,
  children,
}: {
  itemId: string;
  sellerIdentity: SellerIdentityDisclosure;
  description: string;
  confirmLabel: string;
  prepareSale: () => SalePrep;
  onReset?: () => void;
  trigger?: ReactNode;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [paymentLabel, setPaymentLabel] = useState<string | null>(null);
  const [hasPaymentMethod, setHasPaymentMethod] = useState<boolean | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

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
        if (cancelled) return;
        setLoadingStatus(false);
        setHasPaymentMethod(false);
        setPaymentLabel(null);
      });
    return () => { cancelled = true; };
  }, [open]);

  function handleBuy() {
    const prepared = prepareSale();
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const result = await initiateCashSale({
          itemId,
          sellerIdentityVersion: sellerIdentity.version,
          buyerConfirmedSellerIdentity: true,
          lineItems: prepared.lineItems,
        });
        if (result.ok) {
          navigateWithType(router, `/sales/${result.sale.id}`, 'nav-forward');
          return;
        }
        if (result.error === 'no-payment-method') {
          setHasPaymentMethod(false);
          setPaymentLabel(null);
          return;
        }
        const errorMsg = result.message ?? cashSaleRefusalMessage(result.error);
        setError(errorMsg);
        toast.error(errorMsg);
      } catch {
        const fallback = 'Failed to initiate purchase contract. Please try again.';
        setError(fallback);
        toast.error(fallback);
      }
    });
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
          setError(null);
          onReset?.();
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <ListingActionIcon icon={ShoppingCart} label="Buy now" variant="default" />
        )}
      </DialogTrigger>
      <DialogContent>
        {loading ? (
          <>
            <DialogHeader>
              <DialogTitle>Start a purchase contract</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center py-8" role="status">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
              <span className="sr-only">Checking your payment details…</span>
            </div>
          </>
        ) : showCardForm ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a payment method</DialogTitle>
              <DialogDescription>
                Stripe stores the card. Nothing is charged until you agree to terms
                with the seller.
              </DialogDescription>
            </DialogHeader>
            <AddPaymentMethodForm
              onAttached={() => {
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
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-group">
              {children}

              <div className="min-w-0 rounded-md border bg-muted p-cozy text-body">
                <p className="font-medium">Verified seller</p>
                {sellerIdentity.tradingName ? (
                  <p className="break-words">{sellerIdentity.tradingName}</p>
                ) : null}
                <p className="break-words text-muted-foreground">
                  {sellerIdentity.legalEntityName}
                </p>
              </div>

              <div className="flex items-center gap-cozy rounded-lg border p-cozy">
                <CreditCard className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">
                    {paymentLabel ?? 'Card on file'}
                  </p>
                  <p className="text-body text-muted-foreground">Stripe method</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHasPaymentMethod(false);
                    setPaymentLabel(null);
                  }}
                >
                  Change
                </Button>
              </div>

              <FieldError message={error ?? undefined} />
            </div>

            <DialogFooter>
              <Button
                type="button"
                onClick={handleBuy}
                disabled={isPending}
                aria-busy={isPending}
              >
                {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
                {isPending ? 'Opening contract…' : confirmLabel}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
