'use client';

// components/deals/DealComposeForm.tsx
//
// Start a private deal: cash-for-a-card or a trade. Every card is unlisted
// (UnlistedItemDialog → createPrivateTradeItem). Rendered inside StartDealProvider.
// Success navigates to /t/… so the host can copy the link.
//
// LAYOUT NOTES, because this form was reported as reading badly and the reasons are
// specific rather than a matter of taste:
//
//  1. IT WAS FOUR EQUAL TILES. "What kind of deal?" and "Your side" were both
//     `ChoiceTile` grids, so the modal drew four identically weighted bordered
//     options and read as one flat set of four rather than a choice that reveals a
//     second, narrower one. The kind stays as tiles — those two options really are
//     comparable — and the side became a `SegmentedControl`, which is visibly a
//     different KIND of control: one track, one selected segment.
//  2. IT WAS AN UNGROUPED STACK. Legend, row, label, input, label, textarea, all at
//     one indent with only whitespace between them, so nothing said which fields
//     belonged together. Fields now sit in titled sections.
//  3. THE PRICE WAS ONE FIELD AMONG SEVERAL. On an invite whose entire purpose is
//     "this card for this money", the amount is the thing being decided, so it gets
//     `MoneyInput size="lg"`.
//  4. NOTHING SAID WHAT HAPPENS NEXT. The invite expires in 14 days, the fee is 5%
//     of the price, and a shared link is claimable by whoever opens it first — none
//     of which appeared anywhere. Each is now disclosed next to the control it bears
//     on rather than discovered afterwards.
//  5. THE BUTTON WENT DEAD WITH NO REASON GIVEN. It was `disabled` until a kind was
//     picked, and every other missing field only surfaced as red text AFTER a click.
//     `missingRequirement` names the next thing to do, in the footer, continuously.
//
// References for the shape: Wise's request-a-payment states the reason its CTA is
// disabled directly above it; Behance's Request Payment puts a one-line consequence
// under each section label; Mercury's payment request discloses the link's expiry
// inline; Bonsai's Add New Income uses a segmented control for the binary that
// changes the rest of the form.

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  BanknoteIcon,
  Clock01Icon,
  RepeatIcon,
} from '@hugeicons/core-free-icons';
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
import { DialogRow } from '@/components/ui/dialog-row';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Textarea } from '@/components/ui/textarea';
import {
  EMPTY_PAYMENT_TERMS,
  PaymentTermsDialog,
  type PaymentTerms,
} from '@/components/trade/PaymentTermsDialog';
import {
  UnlistedItemDialog,
  isUnlistedDraftComplete,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemDialog';
import { DEAL_INVITE_ERROR_COPY } from '@/components/deals/inviteErrors';
import { pathsFromUnlistedDraft } from '@/components/deals/uploadDealItem';
import { cashPriceProblem, dollarsToCents } from '@/domain/deals/dealInvite';
import {
  PLATFORM_FEE_BPS,
  platformFeeCentsFor,
} from '@/domain/orchestrator/cashSaleOrchestrator';
import { deriveItemTitle } from '@/domain/validation';
import { createDealInvite } from '@/lib/actions/dealInvites';
import { formatAud } from '@/lib/format';
import { navigateWithType } from '@/lib/motion/navigate';

type Kind = 'CASH_SALE' | 'TRADE';
type HostRole = 'SELLER' | 'BUYER';

/**
 * The fee rate as members read it, derived from the basis points rather than typed
 * as "5%" — same reason as `ListingDesktopPane`: the copy cannot drift from what is
 * actually charged.
 */
const FEE_PERCENT_LABEL = `${PLATFORM_FEE_BPS / 100}%`;

/** The invite TTL in days, for the expiry disclosure. */
const INVITE_TTL_DAYS = 14;

function paymentCents(terms: PaymentTerms): number {
  return dollarsToCents(terms.cashDollars) ?? 0;
}

/**
 * A titled group of fields.
 *
 * `title` is a plain `<p>` and not a heading, because a dialog already owns the
 * heading level via `DialogTitle` and these are groups within one form, not sections
 * of a document. `description` carries the consequence of the fields below it, which
 * is where the fee, the expiry and the "nothing is held" facts live.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-snug">
      <div className="space-y-tight">
        <p className="text-body font-medium">{title}</p>
        {description ? (
          <p className="text-body text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function DealComposeForm({ onSuccess }: { onSuccess?: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<Kind | null>(null);
  const [hostRole, setHostRole] = useState<HostRole>('SELLER');
  const [draft, setDraft] = useState<UnlistedItemDraft | null>(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [priceDollars, setPriceDollars] = useState('');
  const [valueDollars, setValueDollars] = useState('');
  const [wanted, setWanted] = useState('');
  const [message, setMessage] = useState('');
  const [terms, setTerms] = useState<PaymentTerms>(EMPTY_PAYMENT_TERMS);
  const [termsOpen, setTermsOpen] = useState(false);

  const needsCard = kind === 'TRADE' || (kind === 'CASH_SALE' && hostRole === 'SELLER');
  const needsWanted = kind === 'TRADE' || (kind === 'CASH_SALE' && hostRole === 'BUYER');
  const cardLabel = draft ? deriveItemTitle(draft.description) : '';
  const cardComplete = Boolean(draft && isUnlistedDraftComplete(draft));

  const priceCents = dollarsToCents(priceDollars);
  const feeCents = priceCents != null && priceCents > 0 ? platformFeeCentsFor(priceCents) : null;

  /**
   * The next thing the member has to do, or `null` when the form is ready to send.
   *
   * Drives the footer hint AND the button's disabled state, so the two cannot
   * disagree. Deliberately only covers PRESENCE — `cashPriceProblem` and the
   * server still own the range and length rules, which stay as messages on submit
   * because they are about a value that IS there and is wrong.
   */
  function missingRequirement(): string | null {
    if (!kind) return 'Pick cash for a card, or a trade.';
    if (kind === 'CASH_SALE') {
      if (hostRole === 'SELLER' && !cardComplete) return 'Describe the card you are selling.';
      if (hostRole === 'BUYER' && wanted.trim() === '') return 'Say what you want to buy.';
      if (priceCents == null) return 'Enter a price.';
      return null;
    }
    if (!cardComplete) return 'Describe the card you are putting up.';
    if (dollarsToCents(valueDollars) == null) return 'Say what your card is worth.';
    if (wanted.trim() === '') return 'Say what you want from them.';
    return null;
  }

  const missing = missingRequirement();

  function submit() {
    setError(null);
    if (!kind) {
      setError('Choose cash for a card, or a trade.');
      return;
    }

    startTransition(async () => {
      if (kind === 'CASH_SALE') {
        const cents = dollarsToCents(priceDollars);
        const priceProblem = cashPriceProblem(cents);
        if (priceProblem) {
          setError(priceProblem);
          return;
        }
        if (hostRole === 'SELLER') {
          if (!draft || !isUnlistedDraftComplete(draft)) {
            setError('Describe the card you are selling.');
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
            message,
          });
          if (!result.ok) {
            setError(result.message || DEAL_INVITE_ERROR_COPY[result.error]);
            toast.error(result.message || DEAL_INVITE_ERROR_COPY[result.error]);
            return;
          }

          onSuccess?.();
          navigateWithType(router, result.data.path, 'nav-forward');
          return;
        }

        const result = await createDealInvite({
          kind: 'CASH_SALE',
          hostRole: 'BUYER',
          wantedDescription: wanted,
          priceCents: cents!,
          message,
        });
        if (!result.ok) {
          setError(result.message || DEAL_INVITE_ERROR_COPY[result.error]);
          toast.error(result.message || DEAL_INVITE_ERROR_COPY[result.error]);
          return;
        }

        onSuccess?.();
        navigateWithType(router, result.data.path, 'nav-forward');
        return;
      }

      if (!draft || !isUnlistedDraftComplete(draft)) {
        setError('Describe the card you are putting up.');
        return;
      }
      const fmvCents = dollarsToCents(valueDollars);
      if (fmvCents == null || fmvCents < 1) {
        setError('Say what your card is worth.');
        return;
      }
      const uploaded = await pathsFromUnlistedDraft(draft, fmvCents);
      if (!uploaded.ok) {
        setError(uploaded.message);
        return;
      }
      const cashAmountCents = paymentCents(terms);
      const declared = dollarsToCents(terms.valueDollars);
      const result = await createDealInvite({
        kind: 'TRADE',
        item: uploaded.item,
        wantedDescription: wanted,
        cashAmountCents,
        cashDirection: terms.cashDirection,
        declaredValueCents: declared && declared > 0 ? declared : fmvCents,
        message: terms.message || message,
      });
      if (!result.ok) {
        setError(result.message || DEAL_INVITE_ERROR_COPY[result.error]);
        toast.error(result.message || DEAL_INVITE_ERROR_COPY[result.error]);
        return;
      }

      onSuccess?.();
      navigateWithType(router, result.data.path, 'nav-forward');
    });
  }

  return (
    <>
      <DialogHeader>
        {/* The trigger names the thing ("Private Deal"), the dialog names the
            task. This is a creation form — it picks a kind and sends an invite
            link — so echoing the trigger verbatim would read like a detail view
            of a deal that already exists. */}
        <DialogTitle>Start a Private Deal</DialogTitle>
        <DialogDescription>
          Send a private link. They join, and you finish in a sale or trade room.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-group">
        <Section title="What kind of deal?">
          <div className="grid gap-snug sm:grid-cols-2">
            <ChoiceTile
              id="deal-kind-cash"
              name="deal-kind"
              type="radio"
              checked={kind === 'CASH_SALE'}
              onChange={() => setKind('CASH_SALE')}
              icon={BanknoteIcon}
              label="Cash for a card"
              hint="One card, one price"
            />
            <ChoiceTile
              id="deal-kind-trade"
              name="deal-kind"
              type="radio"
              checked={kind === 'TRADE'}
              onChange={() => setKind('TRADE')}
              icon={RepeatIcon}
              label="Trade cards"
              hint="Swap, cash to even optional"
            />
          </div>
        </Section>

        {kind === 'CASH_SALE' ? (
          <>
            {/* A MODE SWITCH, NOT A THIRD AND FOURTH OPTION. Which side you take
                changes who brings the card, who pays, and which fields below are
                even rendered — so it reads as one control with two settings rather
                than as more tiles matching the pair above. */}
            <Section
              title="Your side"
              description={
                hostRole === 'SELLER'
                  ? 'You put up the card. They pay, and the money is held until they accept it.'
                  : 'You pay. They put up the card, so they need a verified identity to join.'
              }
            >
              <SegmentedControl
                name="deal-role"
                label="Your side of this deal"
                value={hostRole}
                onChange={setHostRole}
                options={[
                  { value: 'SELLER', label: "I'm selling" },
                  { value: 'BUYER', label: "I'm buying" },
                ]}
              />
            </Section>

            <Section
              title={hostRole === 'SELLER' ? 'The card' : 'What you want to buy'}
              description={
                hostRole === 'SELLER'
                  ? 'Unlisted — it never appears in the catalog and only whoever opens your link sees it.'
                  : 'Set, card, or grade. They put this up when they join, so be specific enough to hold them to it.'
              }
            >
              {needsCard ? (
                <DialogRow
                  label="Your card"
                  hint={cardLabel || 'Describe an unlisted card'}
                  filled={Boolean(draft)}
                  required
                  onClick={() => setItemDialogOpen(true)}
                />
              ) : null}
              {needsWanted ? (
                <>
                  <Label htmlFor="deal-wanted" className="sr-only">
                    What you want to buy
                  </Label>
                  <Textarea
                    id="deal-wanted"
                    value={wanted}
                    onChange={(event) => setWanted(event.target.value)}
                    maxLength={1000}
                    rows={3}
                    placeholder="Set, card, or grade they should put up…"
                  />
                </>
              ) : null}
            </Section>

            <Section
              title="Price"
              description={
                feeCents != null
                  ? `The buyer pays ${formatAud(priceCents! + feeCents)} — ${formatAud(priceCents!)} plus the ${FEE_PERCENT_LABEL} platform fee. Postage is agreed separately.`
                  : `A ${FEE_PERCENT_LABEL} platform fee is added on top. Postage is agreed separately.`
              }
            >
              <Label htmlFor="deal-price" className="sr-only">
                Price
              </Label>
              <MoneyInput
                id="deal-price"
                size="lg"
                min="0.01"
                value={priceDollars}
                onChange={(event) => setPriceDollars(event.target.value)}
              />
            </Section>

            <Section title="Note" description="Optional. They see this before they join.">
              <Label htmlFor="deal-note" className="sr-only">
                Note
              </Label>
              <Textarea
                id="deal-note"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="Anything they should know…"
              />
            </Section>
          </>
        ) : null}

        {kind === 'TRADE' ? (
          <>
            <Section
              title="Your card"
              description="Unlisted — it never appears in the catalog and only whoever opens your link sees it."
            >
              <DialogRow
                label="Your card"
                hint={cardLabel || 'Describe an unlisted card'}
                filled={Boolean(draft)}
                required
                onClick={() => setItemDialogOpen(true)}
              />
            </Section>

            <Section
              title="What your card is worth"
              description={`Both sides put up a temporary card hold for this much while the swap is in flight, and a ${FEE_PERCENT_LABEL} fee applies to each of you. Nothing is charged if it completes.`}
            >
              <Label htmlFor="deal-value" className="sr-only">
                What your card is worth
              </Label>
              <MoneyInput
                id="deal-value"
                size="lg"
                min="0.01"
                value={valueDollars}
                onChange={(event) => setValueDollars(event.target.value)}
              />
            </Section>

            <Section
              title="What you want from them"
              description="Be specific enough to hold them to it — this becomes part of the trade's terms."
            >
              <Label htmlFor="deal-wanted-trade" className="sr-only">
                What you want from them
              </Label>
              <Textarea
                id="deal-wanted-trade"
                value={wanted}
                onChange={(event) => setWanted(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Set, card, or grade they should put up…"
              />
            </Section>

            <Section
              title="Cash to even"
              description="Optional. Use this when the two sides are not an even swap."
            >
              <DialogRow
                label="Payment Terms"
                hint={paymentCents(terms) > 0 ? 'Cash to even is set' : 'Optional cash to even'}
                filled={paymentCents(terms) > 0 || terms.message.trim() !== ''}
                onClick={() => setTermsOpen(true)}
              />
            </Section>
          </>
        ) : null}

        {/* THE LINK'S OWN TERMS, disclosed here rather than discovered later. Both
            facts are load-bearing: a shared link is claimable by whoever opens it
            first, and it stops working after the TTL. */}
        {kind ? (
          <p className="flex items-start gap-snug rounded-lg border border-border bg-muted px-cozy py-snug text-body text-muted-foreground">
            <HugeiconsIcon
              icon={Clock01Icon}
              className="mt-0.5 size-4 shrink-0"
              aria-hidden
            />
            <span>
              The link works for {INVITE_TTL_DAYS} days and opens the deal for the first
              person to join. You can cancel it any time before that.
            </span>
          </p>
        ) : null}

        <FieldError message={error ?? undefined} />
      </div>

      {/* The reason the action is unavailable, beside the action. It used to appear
          only after a click, so the button read as broken rather than as waiting. */}
      {missing && !isPending ? (
        <p className="text-body text-muted-foreground" id="deal-submit-blocker">
          {missing}
        </p>
      ) : null}

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
          aria-describedby={missing ? 'deal-submit-blocker' : undefined}
        >
          {isPending ? 'Creating link…' : 'Create deal link'}
        </Button>
      </DialogFooter>

      <UnlistedItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        initial={draft}
        onSave={setDraft}
        title="Your card"
        saveLabel={draft ? 'Save card' : 'Add card'}
      />
      <PaymentTermsDialog
        open={termsOpen}
        onOpenChange={setTermsOpen}
        terms={terms}
        counterpartName="them"
        valuePlaceholder={valueDollars || '0.00'}
        onSave={setTerms}
      />
    </>
  );
}
