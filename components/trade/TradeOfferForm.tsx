'use client';

// components/trade/TradeOfferForm.tsx
//
// Offer a 2-Way Trade against one specific listing.
//
// The Item being requested is fixed context supplied by the listing you came
// from, so the only decision here is what you put up. Kept deliberately small:
// selected goods on the card, inventory browse/search in OwnItemsPickerDialog,
// and optional terms folded into Offer Terms / Payment Terms dialogs.
//
// Selection order carries meaning: the first listed Item confirmed in the
// picker is the primary one on the proposal; the rest ride along as the bundle.
// An unlisted draft always takes the primary slot, so every listed pick becomes
// bundle.
//
// Nothing is reserved and no collateral is requested here. The offer sits PENDING
// until the other Trader accepts.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Lock, MapPin, Pencil, Truck, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ChoiceTile } from '@/components/ui/choice-tile';
import { DialogFooter } from '@/components/ui/dialog';
import { DialogRow } from '@/components/ui/dialog-row';
import { OwnItemsPickerDialog } from '@/components/trade/OwnItemsPickerDialog';
import {
  EMPTY_PAYMENT_TERMS,
  PaymentTermsDialog,
  type PaymentTerms,
} from '@/components/trade/PaymentTermsDialog';
import {
  UnlistedItemDialog,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemDialog';
import { formatAud, itemImageUrl } from '@/lib/format';
import { uploadItemImages } from '@/lib/storage/uploadItemImages';
import { openTradeNegotiation } from '@/lib/actions/tradeNegotiation';
import type { ItemRow } from '@/lib/actions/listings';
import type { HandoverMethod } from '@/lib/handover/terms';

/** How the goods change hands â€” details are agreed later in the trade room. */
const HANDOVER_OPTIONS: {
  value: HandoverMethod;
  label: string;
  hint: string;
  icon: typeof MapPin;
}[] = [
  {
    value: 'IN_PERSON',
    label: 'Face to face',
    hint: 'Meet and swap',
    icon: MapPin,
  },
  {
    value: 'DELIVERY',
    label: 'Delivery',
    hint: 'Post it',
    icon: Truck,
  },
];

/** Parse a dollars string into integer AUD cents; 0 when blank or invalid. */
function dollarsToCents(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

/** Friendly copy for each typed proposal failure. */
const ERROR_MESSAGES: Record<string, string> = {
  'item-not-found': 'That item could not be found.',
  'invalid-cash': 'Enter a valid cash amount.',
  'invalid-declared-value': 'Enter a valid value for your side.',
  'not-owner': 'You can only offer an item you own.',
  'self-trade': 'You cannot trade with yourself.',
  'item-unavailable': 'One of these items is no longer available.',
  'counterpart-item-private': 'That item is not open to offers.',
  'duplicate-pending': 'You already have an offer open on this item.',
  'item-create-failed': 'Your item could not be saved. Check the details and try again.',
  'invalid-handover': 'Choose face to face or delivery.',
  unauthenticated: 'Sign in to make an offer.',
};

export type TradeOfferRequested = {
  id: string;
  title: string;
  fmvCents: number;
  imagePath: string | null;
  ownerName: string;
};

export interface TradeOfferFormProps {
  /** The listing being requested, as fixed context. */
  requested: TradeOfferRequested;
  /** The caller's own AVAILABLE items. */
  ownItems: ItemRow[];
  /** Set when answering an existing offer, which supersedes it on submit. */
  counterOfProposalId?: string | null;
  /**
   * `page` â€” centred Card on `/trades/new`.
   * `dialog` â€” chrome-less body for ProposeTradeDialog.
   */
  layout?: 'page' | 'dialog';
  /** Called after a successful send when embedded (close dialog + refresh). */
  onSuccess?: () => void;
  /** Cancel in dialog layout; page layout links back to the listing. */
  onCancel?: () => void;
}

export function TradeOfferForm({
  requested,
  ownItems,
  counterOfProposalId,
  layout = 'page',
  onSuccess,
  onCancel,
}: TradeOfferFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /** Ticked items, in the order they were ticked: the first is the primary. */
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  /**
   * An unlisted Item described for this offer. A counter answers with goods you
   * already hold, so it is unavailable there.
   */
  const [unlisted, setUnlisted] = useState<UnlistedItemDraft | null>(null);
  const [unlistedDialogOpen, setUnlistedDialogOpen] = useState(false);
  const [listingsPickerOpen, setListingsPickerOpen] = useState(false);
  /** Cash, your valuation and a note, all set in their own dialog. */
  const [terms, setTerms] = useState<PaymentTerms>(EMPTY_PAYMENT_TERMS);
  const [termsDialogOpen, setTermsDialogOpen] = useState(false);

  /** Face to face or postage â€” details (place, cost, tracking) are set in the room. */
  const [handover, setHandover] = useState<HandoverMethod | null>(null);

  const { cashDirection, message } = terms;
  const cashAmountCents = dollarsToCents(terms.cashDollars);
  const declaredValueCents = dollarsToCents(terms.valueDollars);

  /** Listed value of the goods ticked, plus the assumed value of an unlisted one. */
  const goodsValueCents = useMemo(() => {
    const listed = selectedItemIds
      .map((id) => ownItems.find((item) => item.id === id)?.fmv_cents ?? 0)
      .reduce((sum, value) => sum + value, 0);
    return unlisted ? listed + requested.fmvCents : listed;
  }, [selectedItemIds, ownItems, unlisted, requested.fmvCents]);

  const offeredGoodsValueCents =
    declaredValueCents > 0 ? declaredValueCents : goodsValueCents;
  const youGiveTotalCents =
    offeredGoodsValueCents +
    (cashDirection === 'PROPOSER_PAYS' ? cashAmountCents : 0);
  const theyGiveTotalCents =
    requested.fmvCents +
    (cashDirection === 'COUNTERPART_PAYS' ? cashAmountCents : 0);
  const differenceCents = youGiveTotalCents - theyGiveTotalCents;

  function removeSelectedItem(itemId: string) {
    setSelectedItemIds((current) => current.filter((id) => id !== itemId));
  }

  /** Everything on your side of the table, for the count on the legend. */
  const offeredCount = selectedItemIds.length + (unlisted ? 1 : 0);
  const canSubmit = !isPending && offeredCount > 0 && handover !== null;

  /** One-line summary of the optional terms, shown on the collapsed disclosure. */
  const termsSummary = useMemo(() => {
    const parts: string[] = [];
    if (cashAmountCents > 0) {
      parts.push(
        cashDirection === 'PROPOSER_PAYS'
          ? `+ ${formatAud(cashAmountCents)} from you`
          : `+ ${formatAud(cashAmountCents)} from them`,
      );
    }
    if (declaredValueCents > 0) parts.push(`valued ${formatAud(declaredValueCents)}`);
    if (message.trim() !== '') parts.push('note added');
    return parts.join(' Â· ');
  }, [cashAmountCents, cashDirection, declaredValueCents, message]);

  function handleSubmit() {
    setError(null);
    if (handover === null) {
      setError(ERROR_MESSAGES['invalid-handover']);
      return;
    }
    const [primaryItemId, ...extraItemIds] = selectedItemIds;

    startTransition(async () => {
      // Photos go browser â†’ Storage first, and only their object paths travel in
      // the action call. Sending the files themselves would put them in the
      // Server Action body, which Next caps, and re-encoding them to fit would
      // strip the EXIF that makes a photo worth having in a dispute.
      let imagePaths: string[] = [];
      if (unlisted && !counterOfProposalId) {
        const uploaded = await uploadItemImages(unlisted.images);
        if (!uploaded.ok) {
          setError(uploaded.message);
          toast.error(uploaded.message);
          return;
        }
        imagePaths = uploaded.paths;
      }

      // Countering is no longer a separate submission from here: a counter is a
      // terms revision inside the trade room (`TradeNegotiationPanel`), against a
      // Trade that already exists. This form only ever OPENS a negotiation.

      // Opens the Trade at NEGOTIATING and drops the trader straight into its
      // room, which is where the rest of the negotiation now happens. The old
      // path created a `trade_proposal` and sent them to a list.
      const result = await openTradeNegotiation({
        counterpartItemId: requested.id,
        // An unlisted item takes the primary slot, so every ticked listing rides
        // along as part of the bundle.
        initiatorExtraItemIds: unlisted ? selectedItemIds : extraItemIds,
        // The opening offer names the handover METHOD only. Where and when to
        // meet, and what postage costs, are settled in the room â€” which is the
        // point of opening one.
        terms: {
          cashAmountCents,
          cashDirection,
          declaredValueCents: declaredValueCents > 0 ? declaredValueCents : null,
          handoverMethod: handover,
          message,
        },
        offer: unlisted
          ? {
              kind: 'private',
              title: unlisted.title,
              description: unlisted.description,
              category: unlisted.category,
              condition: unlisted.condition,
              // Your own valuation when you gave one, otherwise assume you are
              // matching what you are asking for.
              fmvCents: declaredValueCents > 0 ? declaredValueCents : requested.fmvCents,
              images: imagePaths,
            }
          : { kind: 'existing', itemId: primaryItemId },
      });

      if (result.ok) {
        toast.success('Offer opened. Discuss and agree the terms in the trade room.');
        onSuccess?.();
        router.push(`/trades/${result.tradeId}`);
        return;
      }
      const copy =
        result.message ?? ERROR_MESSAGES[result.error] ?? 'Your offer could not be sent.';
      setError(copy);
      toast.error(copy);
    });
  }

  const thumb = itemImageUrl(requested.imagePath);
  const isDialog = layout === 'dialog';
  const title = counterOfProposalId ? 'Counter their offer' : 'Offer a trade';

  const body = (
    <>
      {/* What is on the table. */}
      <section
        aria-label="Item you are requesting"
        className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
      >
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumb}
            alt=""
            width={96}
            height={96}
            className="size-12 shrink-0 rounded-md object-cover"
          />
        ) : null}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {requested.ownerName} is offering up
          </p>
          <p className="truncate font-semibold">{requested.title}</p>
        </div>
        <span className="ml-auto shrink-0 text-sm font-semibold tabular-nums">
          {formatAud(requested.fmvCents)}
        </span>
      </section>

      {/* Your side: one list of everything you are putting up, listed or not.
          min-w-0: fieldsets default to min-width:min-content, which refuses to
          shrink inside the sheet and lets prices get clipped by the scrollbar. */}
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium">
          You offer
          {offeredCount > 0 ? (
            <span className="ml-1 font-normal text-muted-foreground">
              ({offeredCount} selected)
            </span>
          ) : null}
        </legend>

        {/* The unlisted draft sits at the top: it is the primary item. */}
        {unlisted ? (
          <div className="flex items-center gap-3 rounded-md border border-primary bg-primary/5 p-2.5 text-sm">
            <Lock className="size-4 shrink-0 text-gold" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-medium">
              {unlisted.title}
              <span className="ml-1.5 font-normal text-muted-foreground">
                not listed
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-8 shrink-0 p-0"
              onClick={() => setUnlistedDialogOpen(true)}
            >
              <Pencil aria-hidden="true" />
              <span className="sr-only">Edit {unlisted.title}</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-8 shrink-0 p-0"
              onClick={() => setUnlisted(null)}
            >
              <X aria-hidden="true" />
              <span className="sr-only">Remove {unlisted.title}</span>
            </Button>
          </div>
        ) : null}

        {/* Selected listings only â€” full inventory is searched in the picker. */}
        {selectedItemIds.length > 0 ? (
          <ul className="min-w-0 space-y-1">
            {selectedItemIds.map((id) => {
              const item = ownItems.find((row) => row.id === id);
              if (!item) return null;
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-md border border-primary bg-primary/5 p-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {item.title}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatAud(item.fmv_cents)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="size-8 shrink-0 p-0"
                    onClick={() => removeSelectedItem(item.id)}
                  >
                    <X aria-hidden="true" />
                    <span className="sr-only">Remove {item.title}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {ownItems.length === 0 ? null : (
          <DialogRow
            label="Your listings"
            hint={
              selectedItemIds.length > 0
                ? `${selectedItemIds.length} selected`
                : 'Add from your listings'
            }
            filled={selectedItemIds.length > 0}
            onClick={() => setListingsPickerOpen(true)}
          />
        )}

        {counterOfProposalId || unlisted ? null : (
          <DialogRow
            label="Offer Terms"
            hint="Add an unlisted item"
            onClick={() => setUnlistedDialogOpen(true)}
          />
        )}
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-medium">
          Handover
          <span className="ml-1 text-destructive" aria-hidden>
            *
          </span>
        </legend>
        <div className="grid grid-cols-2 gap-1.5">
          {HANDOVER_OPTIONS.map((option) => (
            <ChoiceTile
              key={option.value}
              id={`trade-handover-${option.value}`}
              name="trade-handover"
              type="radio"
              icon={option.icon}
              label={option.label}
              hint={option.hint}
              checked={handover === option.value}
              onChange={() => setHandover(option.value)}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Meeting place, postage and tracking are agreed in the trade room.
        </p>
      </fieldset>

      {/* Payment Terms: one row summarising whatever the dialog holds. */}
      <DialogRow
        label="Payment Terms"
        hint={termsSummary || 'Optional'}
        filled={termsSummary !== ''}
        onClick={() => setTermsDialogOpen(true)}
      />

      {/* Running total. Sides do not have to match â€” this just shows where the
          offer stands so nobody has to do the arithmetic themselves. */}
      <div
        className="rounded-lg border bg-muted/20 p-3 text-sm"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">You give</span>
          <span className="font-semibold tabular-nums">
            {formatAud(youGiveTotalCents)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">They give</span>
          <span className="font-semibold tabular-nums">
            {formatAud(theyGiveTotalCents)}
          </span>
        </div>
        <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
          {differenceCents === 0
            ? 'Even on the stated terms.'
            : differenceCents > 0
              ? `You give ${formatAud(differenceCents)} more.`
              : `You give ${formatAud(Math.abs(differenceCents))} less. ${requested.ownerName} may still accept.`}
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );

  const actions = (
    <>
      {isDialog ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full sm:w-auto"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
      ) : (
        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <Link href={`/listings/${requested.id}`}>Cancel</Link>
        </Button>
      )}
      <Button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        aria-busy={isPending}
        className="w-full sm:w-auto"
      >
        {isPending ? 'Sending Offerâ€¦' : 'Send Offer'}
      </Button>
    </>
  );

  const nestedDialogs = (
    <>
      <OwnItemsPickerDialog
        open={listingsPickerOpen}
        onOpenChange={setListingsPickerOpen}
        items={ownItems}
        selectedIds={selectedItemIds}
        onConfirm={setSelectedItemIds}
      />

      <UnlistedItemDialog
        open={unlistedDialogOpen}
        onOpenChange={setUnlistedDialogOpen}
        initial={unlisted}
        counterpartName={requested.ownerName}
        onSave={setUnlisted}
      />

      <PaymentTermsDialog
        open={termsDialogOpen}
        onOpenChange={setTermsDialogOpen}
        terms={terms}
        counterpartName={requested.ownerName}
        valuePlaceholder={(
          (goodsValueCents > 0 ? goodsValueCents : requested.fmvCents) / 100
        ).toFixed(2)}
        onSave={setTerms}
      />
    </>
  );

  if (isDialog) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-gutter:stable] sm:px-6">
          {body}
        </div>
        <DialogFooter className="static z-auto mt-0 shrink-0 border-t border-border/70 bg-card px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-none supports-[backdrop-filter]:bg-card sm:border-t sm:bg-card sm:px-6 sm:pb-4 sm:pt-3">
          {actions}
        </DialogFooter>
        {nestedDialogs}
      </div>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">{title}</CardTitle>
        <CardDescription>
          Nothing is reserved until {requested.ownerName} accepts.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">{body}</CardContent>

      <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted/20 px-6 pb-4 pt-4 sm:flex-row sm:justify-end">
        {actions}
      </CardFooter>

      {nestedDialogs}
    </Card>
  );
}
