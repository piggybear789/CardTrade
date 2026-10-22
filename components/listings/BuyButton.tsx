'use client';

// components/listings/BuyButton.tsx
//
// Entry point to a purchase contract (Req 4.1). When the buyer clicks "Buy now":
//   1. Fetch their payment method status from the server.
//   2a. Saved card → show a compact card widget ("Visa •••• 4242"), priced at that
//       card's own tier (0159): a card issued outside the seller's card zone costs more.
//   2b. No card → say none is needed yet, with an optional "Add a card".
//
// Confirming reserves the item and opens the contract room. No money moves until
// the buyer pays after handover details are set, and HOW they pay (card, or their bank
// where offered, 0158) is chosen then. A card is no longer required to open the
// contract: that shut every bank-only buyer out of the listing.

import { useCallback, useEffect, useState, useTransition, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { CreditCardIcon, ShieldCheckIcon, ShoppingCart01Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { cashSaleFeeMinor } from '@/domain/fees/processingFee';
import { cardMethodFor, type PaymentMethodKind } from '@/domain/payments/paymentMethods';
import { displayLegalName, formatMoney, itemImageUrl } from '@/lib/format';
import { navigateWithType } from '@/lib/motion/navigate';
import { FieldError } from '@/components/motion/FieldError';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { ListingActionIcon } from '@/components/listings/ListingActionIcon';
import { PaymentFormSkeleton } from '@/components/payments/PaymentFormSkeleton';
import { CheckoutSummarySkeleton } from '@/components/payments/CheckoutSummarySkeleton';
import { PendingLabel } from '@/components/ui/pending-label';
import { CurrencyNotice } from '@/components/payments/CurrencyNotice';
import { PROCESSING_FEE_NAME, cardTierClause, processingFeeRateLabel } from '@/lib/fees/feeLabels';

const AddPaymentMethodForm = dynamic(
  () => import('@/components/payments/AddPaymentMethodForm').then((m) => m.AddPaymentMethodForm),
  {
    ssr: false,
    loading: () => <PaymentFormSkeleton />,
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

/** What the buyer is about to reserve, for the summary at the top of the dialog. */
export interface PurchaseSummary {
  title: string;
  imagePath: string | null;
  /** The seller's asking price; the fee and the total are derived from it. */
  priceCents: number;
  currency: string;
  /** The buyer's own region currency, so a foreign-currency purchase says so. */
  buyerCurrency?: string | null;
}

/**
 * Single-item listing: opening the contract reserves the object.
 */
export function BuyButton({
  itemId,
  sellerIdentity,
  summary,
  trigger,
}: {
  itemId: string;
  sellerIdentity: SellerIdentityDisclosure;
  /** The item and its price, shown above the card details. */
  summary?: PurchaseSummary;
  /** Replaces the default listing-action chip — used by the mobile buyer bar. */
  trigger?: ReactNode;
}) {
  return (
    <PurchaseDialog
      itemId={itemId}
      sellerIdentity={sellerIdentity}
      description="Reserving holds it for you and opens a contract with the seller. You do not pay yet."
      confirmLabel="Reserve item and agree terms"
      prepareSale={() => ({ ok: true })}
      header={summary ? (cardMethod) => <OrderSummary summary={summary} cardMethod={cardMethod} /> : undefined}
      currency={summary?.currency}
      trigger={trigger}
    />
  );
}

/**
 * The item and what it costs — above the card form and the saved card alike. "Buy
 * now" used to open on a bare "Add a payment method" with no item and no total, so
 * the first thing a buyer saw after committing was a form.
 *
 * Priced by card at `cardMethod`, the buyer's saved card's own tier (0159), so a card
 * issued abroad shows its dearer fee here rather than first at Pay.
 */
function OrderSummary({
  summary,
  cardMethod,
}: {
  summary: PurchaseSummary;
  cardMethod: PaymentMethodKind;
}) {
  const money = (cents: number) => formatMoney(cents, summary.currency);
  // Before postage, like the listing headline: postage is agreed later.
  const fee = cashSaleFeeMinor(summary.priceCents, 0, summary.currency, cardMethod);
  const thumb = itemImageUrl(summary.imagePath);
  return (
    <div className="space-y-cozy">
      <div className="flex items-center gap-cozy rounded-md border p-cozy">
        {thumb ? (
          // Supabase public URL at thumbnail size; next/image would add nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" width={48} height={48} className="size-12 shrink-0 rounded-sm object-cover" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium">{summary.title}</p>
          <p className="text-meta text-muted-foreground">
            {money(summary.priceCents)} + {money(fee)} {PROCESSING_FEE_NAME.toLowerCase()}
          </p>
        </div>
        <p className="shrink-0 text-lead font-semibold tabular-nums">
          {money(summary.priceCents + fee)}
        </p>
      </div>
      {/* No conversion fee on a cash sale: it is charged on behalf of the seller. */}
      <CurrencyNotice
        currency={summary.currency}
        fxFeeMinor={0}
        buyerCurrency={summary.buyerCurrency}
      />
    </div>
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

/** The buyer's saved card as the dialog last read it. */
interface SavedCard {
  label: string | null;
  /** Where it was issued (ISO alpha-2), which picks its card tier (0159). */
  country: string | null;
}

function PurchaseDialog({
  itemId,
  sellerIdentity,
  description,
  confirmLabel,
  prepareSale,
  onReset,
  header,
  currency,
  trigger,
  children,
}: {
  itemId: string;
  sellerIdentity: SellerIdentityDisclosure;
  description: string;
  confirmLabel: string;
  prepareSale: () => SalePrep;
  onReset?: () => void;
  /**
   * Shown first in every state of the dialog: the order summary for a single item,
   * priced at the saved card's tier (`cardMethod`).
   */
  header?: (cardMethod: PaymentMethodKind) => ReactNode;
  /** The listing's currency, which the saved card's tier is read against. */
  currency?: string;
  trigger?: ReactNode;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // undefined: not read yet; null: no card saved.
  const [card, setCard] = useState<SavedCard | null | undefined>(undefined);
  const [loadingStatus, setLoadingStatus] = useState(false);
  // The optional card form, opened by "Add a card" or "Change". A card is not needed
  // to open the contract, so the form is always one the buyer can back out of.
  const [addingCard, setAddingCard] = useState(false);

  const readCard = useCallback((isCancelled: () => boolean = () => false) => {
    setLoadingStatus(true);
    getPaymentMethodStatus()
      .then((result) => {
        if (isCancelled()) return;
        setLoadingStatus(false);
        setCard(
          result.ok && result.data.hasPaymentMethod
            ? { label: result.data.label, country: result.data.cardCountry ?? null }
            : null,
        );
      })
      .catch(() => {
        if (isCancelled()) return;
        setLoadingStatus(false);
        setCard(null);
      });
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    readCard(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [open, readCard]);

  const cardMethod: PaymentMethodKind = currency ? cardMethodFor(currency, card?.country) : 'CARD';
  const tierClause = currency ? cardTierClause(currency, cardMethod) : '';
  const headerNode = header?.(cardMethod) ?? null;

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

  const loading = loadingStatus || card === undefined;
  const showCardForm = !loading && addingCard;
  const showCheckout = !loading && !addingCard;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setAddingCard(false);
          onReset?.();
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <ListingActionIcon icon={ShoppingCart01Icon} label="Buy now" variant="default" />
        )}
      </DialogTrigger>
      <DialogContent>
        {loading ? (
          <>
            {/* THE CHECKOUT'S OWN HEADER, children and footer, with only the
                card-dependent block standing in. This used to be a different
                header ("Checking payment method" / "Please wait…") over the
                card-ENTRY placeholder, so every open resized the dialog twice. */}
            <DialogHeader>
              <DialogTitle>Start a purchase contract</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            <div className="space-y-group">
              {headerNode}
              {children}
              <CheckoutSummarySkeleton />
            </div>
            <DialogFooter>
              <Button type="button" disabled aria-hidden tabIndex={-1}>
                {confirmLabel}
              </Button>
            </DialogFooter>
          </>
        ) : showCardForm ? (
          <>
            <DialogHeader>
              <DialogTitle>Add a payment method</DialogTitle>
              <DialogDescription>
                Stripe stores the card. It is charged only when you pay, after you and
                the seller agree the terms.
              </DialogDescription>
            </DialogHeader>
            {headerNode}
            <AddPaymentMethodForm
              onAttached={() => {
                setAddingCard(false);
                readCard();
              }}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAddingCard(false)}>
                Back
              </Button>
            </DialogFooter>
          </>
        ) : showCheckout ? (
          <>
            <DialogHeader>
              <DialogTitle>Start a purchase contract</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>

            <div className="space-y-group">
              {headerNode}
              {children}

              <p className="flex items-start gap-tight text-meta text-muted-foreground">
                <HugeiconsIcon icon={ShieldCheckIcon} className="mt-px size-3.5 shrink-0 text-trust" aria-hidden />
                <span className="min-w-0 break-words">
                  Seller verified as {displayLegalName(sellerIdentity.legalEntityName)}
                  {sellerIdentity.tradingName ? `, trading as ${sellerIdentity.tradingName}` : ''}
                </span>
              </p>

              {/* ONE GEOMETRY WITH OR WITHOUT A CARD: two lines and a button, so the
                  footer does not move when the card read comes back. */}
              <div className="flex items-center gap-cozy rounded-lg border p-cozy">
                <HugeiconsIcon icon={CreditCardIcon} className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">
                    {card ? (card.label ?? 'Card on file') : 'No card needed yet'}
                  </p>
                  <p className="text-body text-muted-foreground">
                    {card
                      ? tierClause && currency
                        ? `Service fee ${processingFeeRateLabel(currency, cardMethod)}, ${tierClause}`
                        : 'Stripe method'
                      : 'You choose how to pay when you pay.'}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setAddingCard(true)}>
                  {card ? 'Change' : 'Add a card'}
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
                <PendingLabel pending={isPending} pendingLabel="Opening contract…">
                  {confirmLabel}
                </PendingLabel>
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
