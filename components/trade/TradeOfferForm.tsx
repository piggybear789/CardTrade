'use client';

// components/trade/TradeOfferForm.tsx
//
// Offer a 2-Way Trade against one specific listing.
//
// The Item being requested is fixed context supplied by the listing you came
// from, so the only decision here is what you put up. Kept deliberately small:
// a narrow centred card, one list of everything you are putting up, and the
// optional terms (cash, your own valuation, a note) folded away behind a single
// disclosure so the common case — "these cards for that card" — is two clicks.
//
// Both side quests happen in dialogs rather than inline — Offer Terms, where an
// unlisted Item is described (`UnlistedItemDialog`), and Payment Terms, where the
// optional cash, valuation and note live (`PaymentTermsDialog`).
// Between them they were nine fields that pushed the running total off screen, and
// moving them out means the card's height no longer depends on which paths you
// took. The card keeps a one-line summary of each, so nothing is hidden.
//
// Selection order carries meaning: the first Item you tick is the primary one
// recorded on the proposal, the rest ride along as the bundle. An unlisted draft
// always takes the primary slot, so every ticked listing becomes bundle.
//
// Nothing is reserved and no collateral is requested here. The offer sits PENDING
// until the other Trader accepts.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowDown, Lock, Pencil, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { DialogRow } from '@/components/ui/dialog-row';
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
import { cn } from '@/lib/utils';
import {
  counterTradeProposal,
  createTradeProposal,
} from '@/lib/actions/tradeProposals';
import type { ItemRow } from '@/lib/actions/listings';

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
  'cash-not-accepted':
    'This trader cannot receive cash yet, so make this a goods-only offer.',
  'not-owner': 'You can only offer an item you own.',
  'self-trade': 'You cannot trade with yourself.',
  'item-unavailable': 'One of these items is no longer available.',
  'counterpart-item-private': 'That item is not open to offers.',
  'duplicate-pending': 'You already have an offer open on this item.',
  'item-create-failed': 'Your item could not be saved. Check the details and try again.',
  unauthenticated: 'Sign in to make an offer.',
};

export interface TradeOfferFormProps {
  /** The listing being requested, as fixed context. */
  requested: {
    id: string;
    title: string;
    fmvCents: number;
    imagePath: string | null;
    ownerName: string;
  };
  /** The caller's own AVAILABLE items. */
  ownItems: ItemRow[];
  /** Set when answering an existing offer, which supersedes it on submit. */
  counterOfProposalId?: string | null;
}

export function TradeOfferForm({
  requested,
  ownItems,
  counterOfProposalId,
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
  /** Cash, your valuation and a note, all set in their own dialog. */
  const [terms, setTerms] = useState<PaymentTerms>(EMPTY_PAYMENT_TERMS);
  const [termsDialogOpen, setTermsDialogOpen] = useState(false);

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

  function toggleItem(itemId: string) {
    setSelectedItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }

  /** Everything on your side of the table, for the count on the legend. */
  const offeredCount = selectedItemIds.length + (unlisted ? 1 : 0);
  const canSubmit = !isPending && offeredCount > 0;

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
    return parts.join(' · ');
  }, [cashAmountCents, cashDirection, declaredValueCents, message]);

  function handleSubmit() {
    setError(null);
    const [primaryItemId, ...extraItemIds] = selectedItemIds;

    startTransition(async () => {
      // Photos go browser → Storage first, and only their object paths travel in
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

      // Countering needs an item of your own to put up, so it does not support
      // describing an unlisted item inline.
      if (counterOfProposalId) {
        const countered = await counterTradeProposal({
          proposalId: counterOfProposalId,
          wantedItemId: requested.id,
          offeredItemId: primaryItemId,
          extraItemIds,
          cashAmountCents,
          cashDirection,
          declaredValueCents: declaredValueCents > 0 ? declaredValueCents : null,
          message,
        });
        if (countered.ok) {
          toast.success('Counter offer sent.');
          router.push('/trades');
          return;
        }
        const copy =
          countered.message ??
          ERROR_MESSAGES[countered.error] ??
          'Your counter could not be sent.';
        setError(copy);
        toast.error(copy);
        return;
      }

      const result = await createTradeProposal({
        counterpartItemId: requested.id,
        message,
        // An unlisted item takes the primary slot, so every ticked listing rides
        // along as part of the bundle.
        extraItemIds: unlisted ? selectedItemIds : extraItemIds,
        cashAmountCents,
        cashDirection,
        declaredValueCents: declaredValueCents > 0 ? declaredValueCents : null,
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
        toast.success('Offer sent. Nothing happens until they accept.');
        router.push('/trades');
        return;
      }
      const copy =
        result.message ?? ERROR_MESSAGES[result.error] ?? 'Your offer could not be sent.';
      setError(copy);
      toast.error(copy);
    });
  }

  const thumb = itemImageUrl(requested.imagePath);

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">
          {counterOfProposalId ? 'Counter their offer' : 'Offer a trade'}
        </CardTitle>
        <CardDescription>
          Nothing is reserved until {requested.ownerName} accepts.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
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

        <div className="flex items-center justify-center">
          <ArrowDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </div>

        {/* Your side: one list of everything you are putting up, listed or not. */}
        <fieldset className="space-y-2">
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

          {/* No "you have nothing listed" copy: the row below is the answer, and
              saying it twice reads as an error when it is a normal way to trade. */}
          {ownItems.length === 0 ? null : (
            // Setting overflow on one axis makes this a scroll container on both,
            // which clips the focus ring on the rows at its edges. The inset
            // padding/negative-margin pair gives the ring room to draw without
            // moving the rows — same treatment as the rail in MarketplaceShell.
            <ul className="-mx-1 -my-1 max-h-48 space-y-1 overflow-y-auto px-1 py-1">
              {ownItems.map((item) => {
                const checked = selectedItemIds.includes(item.id);
                return (
                  <li key={item.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm ring-offset-background transition-colors',
                        // The whole row takes the focus ring, not just the native
                        // checkbox: at this size the box's own ring is easy to miss.
                        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2',
                        checked && 'border-primary bg-primary/5',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleItem(item.id)}
                        className="size-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatAud(item.fmv_cents)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {counterOfProposalId || unlisted ? null : (
            <DialogRow
              label="Offer Terms"
              hint="Add an unlisted item"
              onClick={() => setUnlistedDialogOpen(true)}
            />
          )}
        </fieldset>

        {/* Payment Terms: one row summarising whatever the dialog holds. */}
        <DialogRow
          label="Payment Terms"
          hint={termsSummary || 'Optional'}
          filled={termsSummary !== ''}
          onClick={() => setTermsDialogOpen(true)}
        />

        {/* Running total. Sides do not have to match — this just shows where the
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
      </CardContent>

      <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted/20 px-6 pb-4 pt-4 sm:flex-row sm:justify-end">
        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <Link href={`/listings/${requested.id}`}>Cancel</Link>
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-busy={isPending}
          className="w-full sm:w-auto"
        >
          {isPending ? 'Sending Offer…' : 'Send Offer'}
        </Button>
      </CardFooter>

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
    </Card>
  );
}
