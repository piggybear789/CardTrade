'use client';

// components/deals/DealEditDialog.tsx
//
// Change a deal nobody has joined yet: the card, its photos, and the price or what
// you want for it. The link stays the same, so whoever already has it sees the new
// terms, and anyone who joins from now on joins those.
//
// ONE SCREEN, NOT THE COMPOSER'S STEPS. The host has been through those once, and an
// edit is usually one field, a price or a typo. The deal type is not editable: a
// sale and a trade are different contracts, so switching is a new link.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { HugeiconsIcon } from '@hugeicons/react';
import { LoaderCircleIcon, PencilEdit02Icon } from '@hugeicons/core-free-icons';
import { toast } from 'sonner';

import { SaleTermsBreakdown, TradeTermsBreakdown } from '@/components/deals/DealTermsBreakdown';
import { DEAL_INVITE_ERROR_COPY } from '@/components/deals/inviteErrors';
import { pathsFromUnlistedDraft } from '@/components/deals/uploadDealItem';
import { FieldError } from '@/components/motion/FieldError';
import {
  UnlistedCategoryConditionFields,
  UnlistedDescriptionField,
  UnlistedPhotoField,
  unlistedDraftGap,
  type UnlistedItemDraft,
} from '@/components/trade/UnlistedItemFields';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MoneyInput } from '@/components/ui/money-input';
import { Textarea } from '@/components/ui/textarea';
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

export function DealEditDialog(props: DealEditDialogProps) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="shrink-0">
          <HugeiconsIcon icon={PencilEdit02Icon} aria-hidden />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
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
  const [card, setCard] = useState<UnlistedItemDraft>({
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

  // Presence only, like the composer: range rules come back as messages on Save.
  const missing =
    unlistedDraftGap(card) ??
    (selling
      ? priceCents == null
        ? 'Enter a price.'
        : null
      : wanted.trim() === ''
        ? 'Say what you want for it.'
        : valueCents == null || valueCents < 1
          ? 'Say what your card is worth.'
          : null);

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
        setError(result.message || DEAL_INVITE_ERROR_COPY[result.error]);
        return;
      }
      toast.success('Deal updated');
      onDone();
      router.refresh();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit deal</DialogTitle>
        <DialogDescription>The link stays the same.</DialogDescription>
      </DialogHeader>

      <div className="space-y-group">
        <UnlistedPhotoField draft={card} onChange={setCard} idPrefix="deal-edit" />
        <UnlistedDescriptionField
          draft={card}
          onChange={setCard}
          idPrefix="deal-edit"
          label={selling ? 'What are you selling?' : 'What are you trading?'}
          placeholder="What it is, set, grade. Anything they should know."
        />
        <UnlistedCategoryConditionFields draft={card} onChange={setCard} idPrefix="deal-edit" />

        {selling ? (
          <>
            <div className="space-y-snug">
              <Label htmlFor="deal-edit-price">Price</Label>
              <MoneyInput
                id="deal-edit-price"
                size="lg"
                min="0.01"
                value={priceDollars}
                onChange={(event) => setPriceDollars(event.target.value)}
              />
            </div>
            <SaleTermsBreakdown priceCents={priceCents} currency={currency} />
          </>
        ) : (
          <>
            <div className="space-y-snug">
              <Label htmlFor="deal-edit-wanted">What do you want for it?</Label>
              <Textarea
                id="deal-edit-wanted"
                value={wanted}
                onChange={(event) => setWanted(event.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="The card, set or grade they should put up."
                className="resize-none"
              />
            </div>
            <div className="space-y-snug">
              <Label htmlFor="deal-edit-value">What is your card worth?</Label>
              <MoneyInput
                id="deal-edit-value"
                size="lg"
                min="0.01"
                value={valueDollars}
                onChange={(event) => setValueDollars(event.target.value)}
              />
            </div>
            <TradeTermsBreakdown valueCents={valueCents} currency={currency} />
          </>
        )}

        <FieldError message={error ?? undefined} />
      </div>

      <p className="text-meta text-muted-foreground" id="deal-edit-blocker">
        {missing && !isPending ? missing : null}
      </p>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline" disabled={isPending}>
            Cancel
          </Button>
        </DialogClose>
        <Button
          type="button"
          onClick={save}
          disabled={isPending || missing != null}
          aria-busy={isPending}
          aria-describedby="deal-edit-blocker"
        >
          {isPending ? (
            <HugeiconsIcon icon={LoaderCircleIcon} className="animate-spin" aria-hidden />
          ) : null}
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </DialogFooter>
    </>
  );
}
