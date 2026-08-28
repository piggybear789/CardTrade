'use client';

// components/deals/DealComposeForm.tsx
//
// Start a private deal: cash-for-a-card or a trade. Every card is unlisted
// (UnlistedItemDialog → createPrivateTradeItem). Rendered inside StartDealProvider.
// Success navigates to /t/… so the host can copy the link.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BanknoteIcon, RepeatIcon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { FieldError } from '@/components/motion/FieldError';
import { Button } from '@/components/ui/button';
import { ChoiceTile } from '@/components/ui/choice-tile';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DialogRow } from '@/components/ui/dialog-row';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
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
import { deriveItemTitle } from '@/domain/validation';
import { createDealInvite } from '@/lib/actions/dealInvites';
import { navigateWithType } from '@/lib/motion/navigate';

type Kind = 'CASH_SALE' | 'TRADE';
type HostRole = 'SELLER' | 'BUYER';

function paymentCents(terms: PaymentTerms): number {
  return dollarsToCents(terms.cashDollars) ?? 0;
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

  function submit() {
    setError(null);
    if (!kind) {
      setError('Choose cash for a card, or a trade.');
      return;
    }

    startTransition(async () => {
      if (kind === 'CASH_SALE') {
        const priceCents = dollarsToCents(priceDollars);
        const priceProblem = cashPriceProblem(priceCents);
        if (priceProblem) {
          setError(priceProblem);
          return;
        }
        if (hostRole === 'SELLER') {
          if (!draft || !isUnlistedDraftComplete(draft)) {
            setError('Describe the card you are selling.');
            return;
          }
          const uploaded = await pathsFromUnlistedDraft(draft, priceCents!);
          if (!uploaded.ok) {
            setError(uploaded.message);
            return;
          }
          const result = await createDealInvite({
            kind: 'CASH_SALE',
            hostRole: 'SELLER',
            item: uploaded.item,
            priceCents: priceCents!,
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
          priceCents: priceCents!,
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
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-body font-medium">What kind of deal?</legend>
          <div className="grid grid-cols-2 gap-2">
            <ChoiceTile
              id="deal-kind-cash"
              name="deal-kind"
              type="radio"
              checked={kind === 'CASH_SALE'}
              onChange={() => setKind('CASH_SALE')}
              icon={BanknoteIcon}
              label="Cash for a card"
              align="center"
            />
            <ChoiceTile
              id="deal-kind-trade"
              name="deal-kind"
              type="radio"
              checked={kind === 'TRADE'}
              onChange={() => setKind('TRADE')}
              icon={RepeatIcon}
              label="Trade cards"
              align="center"
            />
          </div>
        </fieldset>

        {kind === 'CASH_SALE' ? (
          <fieldset className="space-y-2">
            <legend className="text-body font-medium">Your side</legend>
            <div className="grid grid-cols-2 gap-2">
              <ChoiceTile
                id="deal-role-seller"
                name="deal-role"
                type="radio"
                checked={hostRole === 'SELLER'}
                onChange={() => setHostRole('SELLER')}
                label="I'm selling"
                align="center"
              />
              <ChoiceTile
                id="deal-role-buyer"
                name="deal-role"
                type="radio"
                checked={hostRole === 'BUYER'}
                onChange={() => setHostRole('BUYER')}
                label="I'm buying"
                align="center"
              />
            </div>
          </fieldset>
        ) : null}

        {needsCard ? (
          <DialogRow
            label="Your card"
            hint={cardLabel || 'Describe an unlisted card'}
            filled={Boolean(draft)}
            required
            onClick={() => setItemDialogOpen(true)}
          />
        ) : null}

        {kind === 'CASH_SALE' ? (
          <div className="space-y-2">
            <Label htmlFor="deal-price">Price</Label>
            <MoneyInput
              id="deal-price"
              min="0.01"
              value={priceDollars}
              onChange={(event) => setPriceDollars(event.target.value)}
            />
          </div>
        ) : null}

        {kind === 'TRADE' ? (
          <div className="space-y-2">
            <Label htmlFor="deal-value">What your card is worth</Label>
            <MoneyInput
              id="deal-value"
              min="0.01"
              value={valueDollars}
              onChange={(event) => setValueDollars(event.target.value)}
            />
          </div>
        ) : null}

        {needsWanted ? (
          <div className="space-y-2">
            <Label htmlFor="deal-wanted">
              {kind === 'TRADE' ? 'What you want from them' : 'What you want to buy'}
            </Label>
            <Textarea
              id="deal-wanted"
              value={wanted}
              onChange={(event) => setWanted(event.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Set, card, or grade they should put up…"
            />
          </div>
        ) : null}

        {kind === 'TRADE' ? (
          <DialogRow
            label="Payment Terms"
            hint={
              paymentCents(terms) > 0
                ? 'Cash to even is set'
                : 'Optional cash to even'
            }
            filled={paymentCents(terms) > 0 || terms.message.trim() !== ''}
            onClick={() => setTermsOpen(true)}
          />
        ) : (
          <div className="space-y-2">
            <Label htmlFor="deal-note">Note (optional)</Label>
            <Textarea
              id="deal-note"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={2000}
              rows={2}
            />
          </div>
        )}

        <FieldError message={error ?? undefined} />
      </div>
      <DialogFooter>
        <Button
          type="button"
          onClick={submit}
          disabled={isPending || !kind}
          aria-busy={isPending}
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
