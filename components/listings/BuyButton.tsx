'use client';

// components/listings/BuyButton.tsx
//
// Entry point to a purchase contract (Req 4.1). When the buyer clicks "Buy now":
//   1. Fetch their payment method status from the server.
//   2a. Saved card → show a compact card widget ("Visa •••• 4242"), priced at that
//       card's own tier (0159): a card issued outside the seller's card zone costs more.
//   2b. No card → the footer's button is "Add a card to continue", which opens the
//       card form; once a card is saved it becomes the reserve button.
//
// Confirming reserves the item and opens the contract room. A saved card is required
// to get here (`initiateCashSale`, 2026-11-23), because reserving takes the listing off
// the catalog. No money moves until the buyer pays after handover details are set, and
// HOW they pay (card, or their bank where offered, 0158) is still chosen then.

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/ui/icon';
import { CreditCardIcon, ShoppingCartIcon } from '@/components/ui/icons';
import { toast } from 'sonner';

import type { SellerIdentityDisclosure } from '@/domain/orchestrator/merchantOnboarding';
import { cashSaleFeeMinor } from '@/domain/fees/processingFee';
import { cardMethodFor, type PaymentMethodKind } from '@/domain/payments/paymentMethods';
import { platformForCurrency } from '@/domain/region';
import { displayLegalName, formatMoney, itemImageUrl } from '@/lib/format';
import { navigateWithType } from '@/lib/motion/navigate';
import { FieldError } from '@/components/motion/FieldError';
import { getPaymentMethodStatus } from '@/lib/actions/payments';
import { ListingActionIcon } from '@/components/listings/ListingActionIcon';
import { PendingLabel } from '@/components/ui/pending-label';
import { CurrencyNotice } from '@/components/payments/CurrencyNotice';
import { PROCESSING_FEE_NAME, cardTierClause, processingFeeRateLabel } from '@/lib/fees/feeLabels';

const AddPaymentMethodForm = dynamic(
  () => import('@/components/payments/AddPaymentMethodForm').then((m) => m.AddPaymentMethodForm),
  {
    ssr: false,
    loading: () => null,
  },
);

import { Button } from '@/components/ui/button';
import { StatusGlyph } from '@/components/ui/status-glyph';
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
  currency,
  trigger,
}: {
  itemId: string;
  sellerIdentity: SellerIdentityDisclosure;
  /** The listing's currency: which platform the buyer's card is read on (0179). */
  currency?: string;
  trigger?: ReactNode;
}) {
  const [request, setRequest] = useState(emptyRequest);

  return (
    <PurchaseDialog
      itemId={itemId}
      sellerIdentity={sellerIdentity}
      currency={currency}
      confirmLabel="Open contract and agree terms"
      onReset={() => setRequest(emptyRequest())}
      // "Request", as the phone buyer bar says. "Buy now" on a listing with multiple
      // items promised a purchase where the buyer is really asking for specific cards
      // at a price, with nothing held (UX review 2026-11-26).
      trigger={trigger ?? <ListingActionIcon icon={ShoppingCartIcon} label="Request" variant="default" />}
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
  /** Subtitle under the title. Omitted, the dialog has none (the binder form says enough). */
  description?: string;
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
  // The card form, opened by "Add a card to continue" or "Change". A saved card is
  // needed to open the contract (`initiateCashSale`, 2026-11-23): reserving takes a
  // listing off the catalog, and with nothing on file that cost the buyer nothing. It
  // is a commitment, not the rail; the way to pay is still chosen at Pay.
  const [addingCard, setAddingCard] = useState(false);
  // The platform this sale runs on: the seller's (0179). For a buyer on another
  // platform that is a separate saved card; the server falls back to the buyer's own
  // platform whenever it is the same one.
  const platform = currency ? platformForCurrency(currency) : null;

  // `silent`: refresh a card already on screen without putting the placeholder back.
  const readCard = useCallback((isCancelled: () => boolean = () => false, silent = false) => {
    if (!silent) setLoadingStatus(true);
    (platform ? getPaymentMethodStatus({ platform }) : getPaymentMethodStatus())
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
  }, [platform]);

  // READ THE CARD BEFORE THE DIALOG OPENS. The read goes to Stripe and takes a second or
  // two, and it used to start only once the dialog was open, so every open sat on a
  // placeholder for that long. It now starts on the first sign of intent (pointer over
  // the button, focus, a touch), which is usually enough of a head start for the dialog
  // to open already filled in. Once read, the card is kept: reopening shows it at once
  // and refreshes it quietly behind.
  const readStarted = useRef(false);
  const prefetchCard = useCallback(() => {
    if (readStarted.current) return;
    readStarted.current = true;
    readCard();
  }, [readCard]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    if (!readStarted.current) {
      readStarted.current = true;
      readCard(() => cancelled);
    } else if (card !== undefined && !loadingStatus) {
      readCard(() => cancelled, true);
    }
    return () => {
      cancelled = true;
    };
    // Only on open: `card` and `loadingStatus` are read to pick the path, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // A request failure is a toast, not a paragraph that grows the dialog
        // (lib/hooks/useErrorToast.ts). Only field-level validation above stays inline.
        toast.error(result.message ?? cashSaleRefusalMessage(result.error));
      } catch {
        toast.error('Failed to initiate purchase contract. Please try again.');
      }
    });
  }

  const loading = loadingStatus || card === undefined;
  const showCardForm = !loading && addingCard;

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
      <DialogTrigger
        asChild
        onPointerEnter={prefetchCard}
        onFocus={prefetchCard}
        onTouchStart={prefetchCard}
      >
        {trigger ?? (
          <ListingActionIcon icon={ShoppingCartIcon} label="Buy now" variant="default" />
        )}
      </DialogTrigger>
      {/* No subtitle (the binder form): tell Radix there is deliberately no
          description, which it otherwise warns about. The card form has its own. */}
      <DialogContent
        {...(description || showCardForm ? {} : { 'aria-describedby': undefined })}
      >
        {showCardForm ? (
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
              platform={platform}
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
        ) : (
          <>
            {/* ONE TREE WHILE THE CARD IS READ AND AFTER. The header, order summary,
                binder fields, seller line and footer do not depend on the card, so they
                render for real throughout and only the card row has a placeholder. The
                loading state used to be a second copy of this markup. */}
            <DialogHeader>
              <DialogTitle>Start a purchase contract</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </DialogHeader>

            <div className="space-y-group">
              {headerNode}
              {children}

              <p className="flex items-start gap-tight text-meta text-muted-foreground">
                <StatusGlyph kind="verified" className="mt-px size-3.5" />
                <span className="min-w-0 break-words">
                  Seller verified as {displayLegalName(sellerIdentity.legalEntityName)}
                  {sellerIdentity.tradingName ? `, trading as ${sellerIdentity.tradingName}` : ''}
                </span>
              </p>

              {/* ONE GEOMETRY WHILE THE CARD IS READ AND AFTER: the row is always drawn,
                  with the same two lines, so the dialog does not grow when the read comes
                  back (the saved card's fee line used to wrap onto a second line and push
                  the footer down). With no card the way forward is the footer's own
                  button, so this row only explains. */}
              <div className="flex items-center gap-cozy rounded-lg bg-muted/60 p-cozy">
                <Icon icon={CreditCardIcon} className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">
                    {loading ? 'Checking your card…' : card ? (card.label ?? 'Card on file') : 'Add a card to reserve'}
                  </p>
                  {/* ONE LINE, reserved and truncated. `min-h-[2lh]` held room for a
                      fee clause that wraps on an overseas card, so every other state
                      (loading, a domestic card, no card) showed a blank second line
                      and the row looked twice as tall as its text. The full clause
                      stays readable on hover and to screen readers via `title`. */}
                  <p
                    className="truncate text-body text-muted-foreground"
                    title={
                      !loading && card && tierClause && currency
                        ? `Buyer protection fee ${processingFeeRateLabel(currency, cardMethod)}, ${tierClause}`
                        : undefined
                    }
                  >
                    {loading
                      ? 'Stripe keeps it on file. Nothing is charged until you pay.'
                      : card
                        ? tierClause && currency
                          ? `Buyer protection fee ${processingFeeRateLabel(currency, cardMethod)}, ${tierClause}`
                          : 'Stripe method'
                        : 'Stripe keeps it on file. Nothing is charged until you pay.'}
                  </p>
                </div>
                {card ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAddingCard(true)}>
                    Change
                  </Button>
                ) : null}
              </div>

              <FieldError message={error ?? undefined} />
            </div>

            <DialogFooter>
              {/* The same button before the card read returns, disabled, so the
                  footer is drawn once and never swapped. */}
              <Button
                type="button"
                onClick={card === null ? () => setAddingCard(true) : handleBuy}
                disabled={loading || isPending}
                aria-busy={isPending}
              >
                <PendingLabel pending={isPending} pendingLabel="Opening contract…">
                  {card === null ? 'Add a card to continue' : confirmLabel}
                </PendingLabel>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
