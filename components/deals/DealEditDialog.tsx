'use client';

// components/deals/DealEditDialog.tsx
//
// Change a deal nobody has joined yet: the card, its photos, and the price or what
// you want for it. The link stays the same, so whoever already has it sees the new
// terms, and anyone who joins from now on joins those.
//
// THE COMPOSER'S THREE STEPS. The edit reuses Card, Terms and Review from
// `DealSteps.tsx`, pre-filled with the deal as it stands, so the host edits the deal
// in the same shape they built it. The deal type stays non-editable: a sale and a
// trade are different contracts, so switching is a new link. There is no draft
// persistence here — the deal itself is the saved copy.

import { useState, useTransition, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import {
  DEAL_STEP_PROGRESS,
  DealCardStep,
  DealReviewStep,
  DealTermsStep,
  StepHeader,
  dealStepGap,
  type DealStepName,
} from '@/components/deals/DealSteps';
import { DEAL_INVITE_ERROR_COPY } from '@/components/deals/inviteErrors';
import { pathsFromUnlistedDraft } from '@/components/deals/uploadDealItem';
import { FieldError } from '@/components/motion/FieldError';
import type { UnlistedItemDraft } from '@/components/trade/UnlistedItemFields';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { PendingLabel } from '@/components/ui/pending-label';
import { cashPriceProblem, dollarsToCents } from '@/domain/deals/dealInvite';
import { updateDealInvite, type DealInviteEditable } from '@/lib/actions/dealInvites';
import { isItemCondition } from '@/lib/catalog/conditions';

interface DealEditDialogProps {
  inviteId: string;
  kind: 'CASH_SALE' | 'TRADE';
  editable: DealInviteEditable;
  /** The currency the deal is priced in, from the host's region. */
  currency: string;
}

export function DealEditDialog({
  children,
  ...props
}: DealEditDialogProps & {
  /** The control that opens the dialog — the caller decides how prominent editing is. */
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="md:max-w-lg">
        {/* Mounted only while open, so every opening starts from the deal as it
            stands now rather than from an earlier, abandoned edit. */}
        <DealEditForm {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function centsToDollars(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

/**
 * Where each step's back arrow goes. Card has none: there is no deal-type step to
 * return to, and the dialog's own close button already exits.
 */
const BACK: Record<DealStepName, DealStepName | null> = {
  card: null,
  terms: 'card',
  review: 'terms',
};

function DealEditForm({
  inviteId,
  kind,
  editable,
  currency,
  onDone,
}: DealEditDialogProps & { onDone: () => void }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<DealStepName>('card');
  const [card, setCard] = useState<UnlistedItemDraft>({
    title: editable.title,
    description: editable.description,
    category: editable.category,
    // A grade that has left the scale opens empty, so the dialog asks for one instead
    // of holding a value its Select cannot show.
    condition: isItemCondition(editable.condition) ? editable.condition : '',
    keptPaths: editable.imagePaths,
    images: [],
  });
  const [priceDollars, setPriceDollars] = useState(centsToDollars(editable.priceCents));
  const [valueDollars, setValueDollars] = useState(centsToDollars(editable.valueCents));
  const [wanted, setWanted] = useState(editable.wantedDescription ?? '');

  const selling = kind === 'CASH_SALE';
  const priceCents = dollarsToCents(priceDollars);
  const valueCents = dollarsToCents(valueDollars);

  // Presence only, shared with the composer: range rules come back as messages on Next.
  const missing = dealStepGap(step, { card, selling, priceCents, wanted, valueCents });
  const back = BACK[step];

  function go(next: DealStepName) {
    setError(null);
    setStep(next);
  }

  function leaveTerms() {
    if (selling) {
      const problem = cashPriceProblem(priceCents);
      if (problem) {
        setError(problem);
        return;
      }
    }
    go('review');
  }

  function save() {
    setError(null);
    const cents = selling ? priceCents : valueCents;
    if (cents == null) return;
    if (selling) {
      const problem = cashPriceProblem(cents);
      if (problem) {
        setError(problem);
        return;
      }
    }
    startTransition(async () => {
      const uploaded = await pathsFromUnlistedDraft(card, cents);
      if (!uploaded.ok) {
        setError(uploaded.message);
        return;
      }
      const { description, category, condition, images } = uploaded.item;
      const item = { description, category, condition, images };
      const result = selling
        ? await updateDealInvite({ inviteId, kind: 'CASH_SALE', item, priceCents: cents })
        : await updateDealInvite({
            inviteId,
            kind: 'TRADE',
            item,
            valueCents: cents,
            wantedDescription: wanted,
          });
      if (!result.ok) {
        const message = result.message || DEAL_INVITE_ERROR_COPY[result.error];
        setError(message);
        toast.error(message);
        return;
      }
      toast.success('Deal updated');
      onDone();
      router.refresh();
    });
  }

  return (
    <>
      <StepHeader
        title={step === 'review' ? 'Review your changes' : 'Edit deal'}
        description="The link stays the same."
        progress={DEAL_STEP_PROGRESS[step]}
        onBack={back ? () => go(back) : undefined}
        backDisabled={isPending}
      />

      <div className="space-y-group">
        {step === 'card' ? (
          <DealCardStep card={card} onCard={setCard} selling={selling} idPrefix="deal-edit" />
        ) : null}

        {step === 'terms' ? (
          <DealTermsStep
            selling={selling}
            idPrefix="deal-edit"
            currency={currency}
            priceDollars={priceDollars}
            onPriceDollars={setPriceDollars}
            wanted={wanted}
            onWanted={setWanted}
            valueDollars={valueDollars}
            onValueDollars={setValueDollars}
          />
        ) : null}

        {step === 'review' ? (
          <DealReviewStep
            card={card}
            selling={selling}
            priceCents={priceCents}
            wanted={wanted}
            currency={currency}
          />
        ) : null}

        <FieldError message={error ?? undefined} />
      </div>

      <p className="text-meta text-muted-foreground" id="deal-edit-blocker">
        {missing && !isPending ? missing : null}
      </p>
      <DialogFooter>
        <Button
          type="button"
          onClick={step === 'card' ? () => go('terms') : step === 'terms' ? leaveTerms : save}
          disabled={isPending || missing != null}
          aria-busy={isPending}
          aria-describedby="deal-edit-blocker"
        >
          {/* Width-stable, as in the composer: the pending text and spinner share the
              resting label's grid cell. */}
          <PendingLabel pending={isPending} pendingLabel="Saving…">
            {step === 'review' ? 'Save changes' : 'Next'}
          </PendingLabel>
        </Button>
      </DialogFooter>
    </>
  );
}
