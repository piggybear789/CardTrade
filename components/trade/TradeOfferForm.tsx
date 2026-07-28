'use client';

// components/trade/TradeOfferForm.tsx
//
// Offer a 2-Way Trade against one specific listing. Replaces the old
// two-dropdown pairing form: the Item being requested is fixed context supplied
// by the listing you came from, and the only decision is what you put up.
//
// Two ways to answer that:
//   * an Item you already have listed, filtered to those that match the
//     requested Fair_Market_Value to the cent (Req 5.2), or
//   * an Item described here and now, created privately — owned and valued, but
//     never published to the catalog.
//
// The Fair_Market_Value of a private Item is fixed to the requested Item's value
// rather than typed, because an unequal pairing is rejected outright and there is
// no reason to let someone discover that after filling in a form.
//
// Nothing is reserved and no collateral is requested here. The offer sits PENDING
// until the other Trader accepts.

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeftRight, Lock } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatAud, itemImageUrl } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  counterTradeProposal,
  createTradeProposal,
} from '@/lib/actions/tradeProposals';
import { TRADE_PROPOSAL_MESSAGE_MAX } from '@/lib/marketplace-constants';
import type { TradeCashDirection } from '@/domain/orchestrator/tradeProposalRequest';
import type { ItemRow } from '@/lib/actions/listings';

/** Collectible categories, mirroring the listing form. */
const CATEGORIES = [
  'Trading Cards',
  'Coins',
  'Stamps',
  'Comics',
  'Memorabilia',
] as const;

/** Condition grades, mirroring the listing form (TCGplayer's standard scale). */
const CONDITIONS = [
  'Unopened',
  'Near Mint',
  'Mint',
  'Lightly Played',
  'Heavily Played',
  'Damaged',
] as const;

const IMAGES_MIN = 1;
const IMAGES_MAX = 10;

/** Friendly copy for each typed proposal failure. */
/** Parse a dollars string into integer AUD cents; 0 when blank or invalid. */
function dollarsToCents(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

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

  // A counter answers with goods you already hold, so the inline "create a
  // private item" path is not offered there.
  const [mode, setMode] = useState<'existing' | 'private'>('existing');
  const [existingItemId, setExistingItemId] = useState('');
  const [message, setMessage] = useState('');
  /** Further items thrown in alongside the primary one. */
  const [extraItemIds, setExtraItemIds] = useState<string[]>([]);
  const [cashDollars, setCashDollars] = useState('');
  const [cashDirection, setCashDirection] = useState<TradeCashDirection>('PROPOSER_PAYS');
  const [valueDollars, setValueDollars] = useState('');

  // Private item fields. FMV is not editable: it must match to the cent.
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [condition, setCondition] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  // Any item can be offered now: a bundle plus cash rarely matches a single
  // listing price, and it is the other trader's acceptance that agrees the value.
  const matchingItems = ownItems;

  /** Items still available to add, once the primary one is chosen. */
  const addableItems = useMemo(
    () => ownItems.filter((item) => item.id !== existingItemId),
    [ownItems, existingItemId],
  );

  const cashAmountCents = dollarsToCents(cashDollars);
  const declaredValueCents = dollarsToCents(valueDollars);

  /** Sum of the listed values of the goods being offered, for the live total. */
  const goodsValueCents = useMemo(() => {
    const ids = mode === 'existing' ? [existingItemId, ...extraItemIds] : extraItemIds;
    const listed = ids
      .map((id) => ownItems.find((item) => item.id === id)?.fmv_cents ?? 0)
      .reduce((sum, value) => sum + value, 0);
    return mode === 'private' ? listed + requested.fmvCents : listed;
  }, [mode, existingItemId, extraItemIds, ownItems, requested.fmvCents]);

  /** Value of goods on the proposer side, using their stated value when given. */
  const offeredGoodsValueCents =
    declaredValueCents > 0 ? declaredValueCents : goodsValueCents;
  const youGiveTotalCents =
    offeredGoodsValueCents +
    (cashDirection === 'PROPOSER_PAYS' ? cashAmountCents : 0);
  const theyGiveTotalCents =
    requested.fmvCents +
    (cashDirection === 'COUNTERPART_PAYS' ? cashAmountCents : 0);
  const differenceCents = youGiveTotalCents - theyGiveTotalCents;

  function toggleExtraItem(itemId: string) {
    setExtraItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }

  const privateComplete =
    title.trim() !== '' &&
    description.trim() !== '' &&
    category !== '' &&
    condition !== '' &&
    files.length >= IMAGES_MIN &&
    files.length <= IMAGES_MAX;

  const canSubmit =
    !isPending &&
    (mode === 'existing' ? existingItemId !== '' : privateComplete);

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      // Countering needs an item of your own to put up, so it does not support
      // creating a private item inline.
      if (counterOfProposalId && mode === 'existing') {
        const countered = await counterTradeProposal({
          proposalId: counterOfProposalId,
          wantedItemId: requested.id,
          offeredItemId: existingItemId,
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
        extraItemIds,
        cashAmountCents,
        cashDirection,
        declaredValueCents: declaredValueCents > 0 ? declaredValueCents : null,
        offer:
          mode === 'existing'
            ? { kind: 'existing', itemId: existingItemId }
            : {
                kind: 'private',
                title,
                description,
                category,
                condition,
                // Your own valuation when you gave one, otherwise assume you are
                // matching what you are asking for.
                fmvCents: declaredValueCents > 0 ? declaredValueCents : requested.fmvCents,
                images: files,
              },
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
    <Card>
      <CardHeader>
        <CardTitle>{counterOfProposalId ? 'Counter their offer' : 'Offer a trade'}</CardTitle>
        <CardDescription>
          {counterOfProposalId
            ? `Answer with your own terms. This replaces their offer, and ${requested.ownerName} then decides.`
            : `Put up whatever you think is fair — items, cash, or both. ${requested.ownerName} decides whether to accept, and until then nothing is reserved and no card is on the line.`}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* What you are asking for. */}
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
              className="size-14 shrink-0 rounded-md object-cover"
            />
          ) : null}
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              You want
            </p>
            <p className="truncate font-semibold">{requested.title}</p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {formatAud(requested.fmvCents)}
            </p>
          </div>
        </section>

        {/* What you put up. */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">What you offer</legend>

          <div
            className={cn('grid gap-2 sm:grid-cols-2', counterOfProposalId && 'hidden')}
          >
            <label
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                mode === 'existing' ? 'border-primary bg-primary/5' : ''
              }`}
            >
              <input
                type="radio"
                name="offer-mode"
                value="existing"
                checked={mode === 'existing'}
                onChange={() => setMode('existing')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">An item I&apos;ve listed</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {matchingItems.length === 1
                    ? '1 item available'
                    : `${matchingItems.length} items available`}
                </span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                mode === 'private' ? 'border-primary bg-primary/5' : ''
              }`}
            >
              <input
                type="radio"
                name="offer-mode"
                value="private"
                checked={mode === 'private'}
                onChange={() => setMode('private')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">Something not listed</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Stays private to this trade
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        {mode === 'existing' ? (
          <div className="space-y-2">
            <Label htmlFor="existing-item">Your item</Label>
            <Select value={existingItemId} onValueChange={setExistingItemId}>
              <SelectTrigger id="existing-item">
                <SelectValue placeholder="Select an item" />
              </SelectTrigger>
              <SelectContent>
                {matchingItems.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    Nothing you own matches this value
                  </SelectItem>
                ) : (
                  matchingItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {matchingItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You have nothing listed. Offer something unlisted instead.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Lock className="size-4 shrink-0 text-gold" aria-hidden="true" />
              Only {requested.ownerName} sees this item, and only inside this
              trade. It is never added to the marketplace.
            </p>

            <div className="space-y-2">
              <Label htmlFor="private-title">Title</Label>
              <Input
                id="private-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                autoComplete="off"
                placeholder="1999 Charizard, holo…"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="private-description">Description</Label>
              <Textarea
                id="private-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Condition details, grading, anything they should know…"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="private-category">Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger id="private-category">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="private-condition">Condition</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger id="private-condition">
                    <SelectValue placeholder="Select a condition" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="private-images">
                Photos ({IMAGES_MIN}–{IMAGES_MAX})
              </Label>
              <Input
                id="private-images"
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              />
              <p className="text-xs text-muted-foreground">
                {files.length === 0
                  ? 'Photos are the evidence base if this trade is ever disputed.'
                  : `${files.length} selected`}
              </p>
            </div>

            <p className="text-xs text-muted-foreground">
              Set what it is worth under “Your trade value” below. If you leave that
              blank we assume you are matching {requested.title}.
            </p>
          </div>
        )}

        {/* Throw in more goods. Nothing here has to match the listing price —
            the other trader decides whether the whole bundle is fair. */}
        {addableItems.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Add more items (optional)</legend>
            <ul className="space-y-1">
              {addableItems.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={extraItemIds.includes(item.id)}
                      onChange={() => toggleExtraItem(item.id)}
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatAud(item.fmv_cents)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Cash adjustment (optional)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm transition-colors',
                cashDirection === 'PROPOSER_PAYS' && 'border-primary bg-primary/5',
              )}
            >
              <input
                type="radio"
                name="cash-direction"
                value="PROPOSER_PAYS"
                checked={cashDirection === 'PROPOSER_PAYS'}
                onChange={() => setCashDirection('PROPOSER_PAYS')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">I add cash</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  You pay {requested.ownerName}.
                </span>
              </span>
            </label>
            <label
              className={cn(
                'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm transition-colors',
                cashDirection === 'COUNTERPART_PAYS' && 'border-primary bg-primary/5',
              )}
            >
              <input
                type="radio"
                name="cash-direction"
                value="COUNTERPART_PAYS"
                checked={cashDirection === 'COUNTERPART_PAYS'}
                onChange={() => setCashDirection('COUNTERPART_PAYS')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">I request cash</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {requested.ownerName} pays you.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="offer-cash">
              {cashDirection === 'PROPOSER_PAYS' ? 'Cash you add (AUD)' : 'Cash you request (AUD)'}
            </Label>
            <Input
              id="offer-cash"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              autoComplete="off"
              placeholder="0.00"
              value={cashDollars}
              onChange={(e) => setCashDollars(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {cashDirection === 'PROPOSER_PAYS'
                ? `Paid to ${requested.ownerName} on top of your goods.`
                : `${requested.ownerName} pays you on top of their item.`}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="offer-value">Your trade value (optional)</Label>
            <Input
              id="offer-value"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              autoComplete="off"
              placeholder={
                goodsValueCents > 0
                  ? (goodsValueCents / 100).toFixed(2)
                  : requested.fmvCents
                    ? (requested.fmvCents / 100).toFixed(2)
                    : '0.00'
              }
              value={valueDollars}
              onChange={(e) => setValueDollars(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              What you reckon your side is worth. They see it and decide.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="offer-message">Note (optional)</Label>
          <Textarea
            id="offer-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={TRADE_PROPOSAL_MESSAGE_MAX}
            rows={2}
            placeholder="Anything you want them to know…"
          />
        </div>

        {/* Running total. Sides do not have to match — this just shows where the
            offer stands so nobody has to do the arithmetic themselves. */}
        <div className="rounded-lg border p-3 text-sm" role="status" aria-live="polite">
          <dl className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">You give</dt>
              <dd className="font-semibold tabular-nums">
                {formatAud(youGiveTotalCents)}
                {cashAmountCents > 0 && cashDirection === 'PROPOSER_PAYS' ? (
                  <span className="ml-1 font-normal text-muted-foreground">
                    incl. {formatAud(cashAmountCents)} cash
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">They give</dt>
              <dd className="font-semibold tabular-nums">
                {formatAud(theyGiveTotalCents)}
                {cashAmountCents > 0 && cashDirection === 'COUNTERPART_PAYS' ? (
                  <span className="ml-1 font-normal text-muted-foreground">
                    incl. {formatAud(cashAmountCents)} cash
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
          <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
            {differenceCents === 0
              ? 'Even on the stated terms.'
              : differenceCents > 0
                ? `You give ${formatAud(differenceCents)} more than they give.`
                : `You give ${formatAud(Math.abs(differenceCents))} less than they give. ${requested.ownerName} may still accept.`}
          </p>
        </div>

        {/* The pairing, stated plainly. */}
        <div className="flex items-center justify-center gap-3 rounded-md bg-muted/40 p-3 text-sm">
          <span className="min-w-0 truncate font-medium">
            {(() => {
              const primaryTitle =
                mode === 'existing'
                  ? matchingItems.find((i) => i.id === existingItemId)?.title ??
                    'Your item'
                  : title.trim() || 'Your item';
              const extras = extraItemIds.length;
              const parts = [primaryTitle];
              if (extras > 0) parts.push(`+ ${extras} more`);
              if (cashAmountCents > 0 && cashDirection === 'PROPOSER_PAYS') {
                parts.push(`+ ${formatAud(cashAmountCents)}`);
              }
              return parts.join(' ');
            })()}
          </span>
          <ArrowLeftRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 truncate font-medium">
            {requested.title}
            {cashAmountCents > 0 && cashDirection === 'COUNTERPART_PAYS'
              ? ` + ${formatAud(cashAmountCents)}`
              : null}
          </span>
          <Badge variant="secondary" className="shrink-0 tabular-nums">
            {formatAud(requested.fmvCents)}
          </Badge>
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
    </Card>
  );
}
