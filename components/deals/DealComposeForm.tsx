'use client';

// components/deals/DealComposeForm.tsx
//
// Start a private deal: sell a card for cash, or trade cards. Every card is
// unlisted (createPrivateTradeItem). Rendered inside StartDealProvider. Success
// navigates to /t/… so the host can copy the link.
//
// TWO STEPS, ESSENTIALS ONLY. The previous version was three forms sharing one
// modal — cash-as-seller, cash-as-buyer, trade — plus two nested dialogs, with a
// titled section and a sentence of consequence for every field. Eleven lines of
// prose before anything was typed. Each sentence was defensible; together they
// were a wall, and the header comment listed five earlier fixes that had each
// added one more. Redesigned from the data the server actually needs:
//
//   Sell a card   the card · a price
//   Trade cards   your card · what you want · your card's value
//
// So step 1 is one question with two answers, and step 2 is those controls and
// nothing else. The card's four fields render INLINE (`UnlistedItemFields`)
// rather than behind a "Your card" row that opened a second modal.
//
// WHAT LEFT THE COMPOSER, AND WHERE IT WENT:
//
//   "I'm buying" (buyer hosts, seller joins and puts up the card)
//                 dropped. It was the most complex branch, the only one that made
//                 the JOINER pass the identity gate, and a buyer who wants a card can
//                 browse or message. The server still accepts `hostRole: 'BUYER'`
//                 for invites that already exist; the UI simply stops making new ones.
//   the note      the room. They see it after they join, which is when there is
//                 something to say it about.
//   cash to even  the room's Payment Terms. A trade is sent as an even swap and
//                 negotiated from there; that is what the negotiation states exist
//                 for. `cashAmountCents: 0`.
//   the prose     the fee is stated once, under the price, as the number it produces.
//                 The link's two facts — 14 days, first to open joins — are one line
//                 in the footer. Everything else was the room's job to explain.
//
// KEPT: the footer names the next thing to do while the button is disabled. That
// is the one line of guidance that was earning its place.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowLeft01Icon, BanknoteIcon, RepeatIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { FieldError } from '@/components/motion/FieldError';
import { Button } from '@/components/ui/button';
import { ChoiceTile } from '@/components/ui/choice-tile';
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Textarea } from '@/components/ui/textarea';
import {
  EMPTY_UNLISTED_DRAFT,
  UnlistedItemFields,
  isUnlistedDraftComplete,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemFields';
import { DEAL_INVITE_ERROR_COPY } from '@/components/deals/inviteErrors';
import { pathsFromUnlistedDraft } from '@/components/deals/uploadDealItem';
import { cashPriceProblem, dollarsToCents } from '@/domain/deals/dealInvite';
import { FRICTION_TAX_CENTS } from '@/domain/dispute/frictionTax';
import {
  PLATFORM_FEE_BPS,
  platformFeeCentsFor,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { createDealInvite } from '@/lib/actions/dealInvites';
import { formatAud } from '@/lib/format';
import { navigateWithType } from '@/lib/motion/navigate';

type Kind = 'CASH_SALE' | 'TRADE';

/** Derived from the basis points so the copy cannot drift from what is charged. */
const FEE_PERCENT_LABEL = `${PLATFORM_FEE_BPS / 100}%`;

/** The invite TTL in days, for the footer. */
const INVITE_TTL_DAYS = 14;

export function DealComposeForm({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind | null>(null);
  const [draft, setDraft] = useState<UnlistedItemDraft>(EMPTY_UNLISTED_DRAFT);
  const [priceDollars, setPriceDollars] = useState('');
  const [valueDollars, setValueDollars] = useState('');
  const [wanted, setWanted] = useState('');

  const cardComplete = isUnlistedDraftComplete(draft);
  const priceCents = dollarsToCents(priceDollars);
  const valueCents = dollarsToCents(valueDollars);
  /** The collateral figure as typed, or a placeholder until there is one. */
  const valueLabel = valueCents != null && valueCents > 0 ? formatAud(valueCents) : 'This amount';
  const feeCents = priceCents != null && priceCents > 0 ? platformFeeCentsFor(priceCents) : null;

  /**
   * The next thing the member has to do, or `null` when the form is ready to send.
   * Drives the footer hint AND the button's disabled state, so the two cannot
   * disagree. Covers PRESENCE only — range rules stay as messages on submit.
   */
  function missingRequirement(): string | null {
    if (!kind) return null;
    if (!cardComplete) return 'Describe your card and add a photo.';
    if (kind === 'CASH_SALE') {
      if (priceCents == null) return 'Enter a price.';
      return null;
    }
    if (wanted.trim() === '') return 'Say what you want from them.';
    if (dollarsToCents(valueDollars) == null) return "Say what your card is worth.";
    return null;
  }

  const missing = missingRequirement();

  function submit() {
    if (!kind) return;
    setError(null);

    startTransition(async () => {
      if (!isUnlistedDraftComplete(draft)) {
        setError('Describe your card and add a photo.');
        return;
      }

      if (kind === 'CASH_SALE') {
        const cents = dollarsToCents(priceDollars);
        const priceProblem = cashPriceProblem(cents);
        if (priceProblem) {
          setError(priceProblem);
          return;
        }
        const uploaded = await pathsFromUnlistedDraft(draft, cents!);
        if (!uploaded.ok) {
          setError(uploaded.message);
          return;
        }
        const result = await createDealInvite({
          kind: 'CASH_SALE',
          hostRole: 'SELLER',
          item: uploaded.item,
          priceCents: cents!,
        });
        if (!result.ok) {
          const message = result.message || DEAL_INVITE_ERROR_COPY[result.error];
          setError(message);
          toast.error(message);
          return;
        }
        onSuccess?.();
        navigateWithType(router, result.data.path, 'nav-forward');
        return;
      }

      const fmvCents = dollarsToCents(valueDollars);
      if (fmvCents == null || fmvCents < 1) {
        setError("Say what your card is worth.");
        return;
      }
      const uploaded = await pathsFromUnlistedDraft(draft, fmvCents);
      if (!uploaded.ok) {
        setError(uploaded.message);
        return;
      }
      // An even swap. Cash to even, if any, is negotiated in the room.
      const result = await createDealInvite({
        kind: 'TRADE',
        item: uploaded.item,
        wantedDescription: wanted,
        cashAmountCents: 0,
        cashDirection: 'PROPOSER_PAYS',
        declaredValueCents: fmvCents,
      });
      if (!result.ok) {
        const message = result.message || DEAL_INVITE_ERROR_COPY[result.error];
        setError(message);
        toast.error(message);
        return;
      }
      onSuccess?.();
      navigateWithType(router, result.data.path, 'nav-forward');
    });
  }

  // ---------------------------------------------------------------- step 1 ----
  if (!kind) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Private deal</DialogTitle>
          <DialogDescription>Send a link. Whoever opens it joins you in a room.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-snug">
          <ChoiceTile
            id="deal-kind-cash"
            name="deal-kind"
            type="radio"
            checked={false}
            onChange={() => setKind('CASH_SALE')}
            icon={BanknoteIcon}
            label="Sell a card"
          />
          <ChoiceTile
            id="deal-kind-trade"
            name="deal-kind"
            type="radio"
            checked={false}
            onChange={() => setKind('TRADE')}
            icon={RepeatIcon}
            label="Trade cards"
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
        </DialogFooter>
      </>
    );
  }

  // ---------------------------------------------------------------- step 2 ----
  const selling = kind === 'CASH_SALE';

  return (
    <>
      <DialogHeader>
        {/* The back arrow shares the title row rather than sitting above it: one
            line of chrome, and the title says which branch you are in. */}
        <div className="flex items-center gap-snug">
          <button
            type="button"
            onClick={() => {
              setKind(null);
              setError(null);
            }}
            disabled={isPending}
            aria-label="Back to deal type"
            className="-ml-1.5 grid size-8 shrink-0 place-items-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:border-iris disabled:opacity-50"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
          </button>
          <DialogTitle>{selling ? 'Sell a card' : 'Trade cards'}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          {selling
            ? 'Describe the card and set a price.'
            : 'Describe your card, what you want for it, and what it is worth.'}
        </DialogDescription>
      </DialogHeader>

      {/* `space-y-group`, not `section`. Every group opens with its own label, so
          the labels do the separating; 32px between them was a third of a phone
          sheet spent on air. */}
      <div className="space-y-group">
        <UnlistedItemFields
          draft={draft}
          onChange={setDraft}
          idPrefix="deal-card"
          descriptionLabel={selling ? 'What are you selling?' : 'What are you trading?'}
          descriptionPlaceholder="What it is, set, grade — anything they should know."
        />

        {selling ? (
          <div className="space-y-snug">
            <Label htmlFor="deal-price">Price</Label>
            <MoneyInput
              id="deal-price"
              size="lg"
              min="0.01"
              value={priceDollars}
              onChange={(event) => setPriceDollars(event.target.value)}
            />
            {/* THE ONE LINE OF ARITHMETIC. The fee as the number it produces, not
                as a rule to apply. Postage and everything else are the room's. */}
            <p className="text-meta text-muted-foreground">
              {feeCents != null
                ? `They pay ${formatAud(priceCents! + feeCents)} including the ${FEE_PERCENT_LABEL} fee.`
                : `A ${FEE_PERCENT_LABEL} fee is added for the buyer.`}
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-snug">
              <Label htmlFor="deal-wanted">What you want from them</Label>
              <Textarea
                id="deal-wanted"
                value={wanted}
                onChange={(event) => setWanted(event.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="Set, card, or grade they should put up."
                className="resize-none"
              />
            </div>
            <div className="space-y-snug">
              <Label htmlFor="deal-value">Your card&apos;s value</Label>
              <MoneyInput
                id="deal-value"
                size="lg"
                min="0.01"
                value={valueDollars}
                onChange={(event) => setValueDollars(event.target.value)}
              />
              {/* THE COLLATERAL, STATED FROM THE RULES. This figure becomes the card's
                  FMV, and `bondPolicy` authorises 100% of a trader's OWN side as their
                  hold — so it sizes YOUR hold, not theirs (they enter their own value
                  when they join). "Both of you hold this much" was wrong. The hold is an
                  authorisation, released in full when the swap completes; a condition
                  dispute captures at most `FRICTION_TAX_CENTS` ($20) from the party
                  found against, and only fraud takes the whole hold. */}
              <p className="text-meta text-muted-foreground">
                {`${valueLabel} is held on your card as collateral and released when the swap completes. If a dispute goes against you, up to ${formatAud(FRICTION_TAX_CENTS)} of it is kept.`}
              </p>
            </div>
          </>
        )}

        <FieldError message={error ?? undefined} />
      </div>

      {/* The reason the action is unavailable, beside the action; and the link's two
          facts, once, where the link is made. */}
      <p className="text-meta text-muted-foreground" id="deal-submit-blocker">
        {missing && !isPending
          ? missing
          : `The link works for ${INVITE_TTL_DAYS} days and the first person to open it joins.`}
      </p>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="button"
          onClick={submit}
          disabled={isPending || missing != null}
          aria-busy={isPending}
          aria-describedby="deal-submit-blocker"
        >
          {isPending ? 'Creating link…' : 'Create link'}
        </Button>
      </DialogFooter>
    </>
  );
}
