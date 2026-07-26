'use client';

// components/trade/EditTradeOfferDialog.tsx
//
// Revise an offer you have already sent, without withdrawing and starting again.
// Editing in place means the other trader keeps looking at the same offer and
// simply sees the new terms, rather than it disappearing and reappearing.
//
// The primary item is fixed here: swapping out what you are fundamentally
// offering is a different offer, so that path is Withdraw and offer again.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatAud } from '@/lib/format';
import { amendTradeProposal } from '@/lib/actions/tradeProposals';
import { TRADE_PROPOSAL_MESSAGE_MAX } from '@/lib/marketplace-constants';

/** An item the proposer could include, with whether it is currently included. */
export interface OfferableItem {
  id: string;
  title: string;
  fmvCents: number;
}

export interface EditTradeOfferDialogProps {
  proposalId: string;
  /** The fixed primary item, shown for context but not editable here. */
  primaryTitle: string;
  /** Items currently in the bundle beyond the primary one. */
  currentExtraItemIds: string[];
  /** Everything else the proposer could add. */
  offerableItems: OfferableItem[];
  currentCashCents: number;
  currentDeclaredValueCents: number | null;
  currentMessage: string | null;
  /** The value being asked for, so the running comparison still makes sense. */
  requestedFmvCents: number;
}

/** Format integer cents as a plain dollars string for an input. */
function centsToDollars(cents: number): string {
  return cents > 0 ? (cents / 100).toFixed(2) : '';
}

/** Parse a dollars string into integer AUD cents; 0 when blank or invalid. */
function dollarsToCents(value: string): number {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

const ERROR_MESSAGES: Record<string, string> = {
  'not-owner': 'You can only edit your own open offer.',
  'item-not-found': 'One of those items could not be found.',
  'item-unavailable': 'One of those items is no longer available.',
  'invalid-cash': 'Enter a valid cash amount.',
  'invalid-declared-value': 'Enter a valid value for your side.',
  unauthenticated: 'Sign in to edit this offer.',
};

export function EditTradeOfferDialog({
  proposalId,
  primaryTitle,
  currentExtraItemIds,
  offerableItems,
  currentCashCents,
  currentDeclaredValueCents,
  currentMessage,
  requestedFmvCents,
}: EditTradeOfferDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [extraItemIds, setExtraItemIds] = useState<string[]>(currentExtraItemIds);
  const [cashDollars, setCashDollars] = useState(centsToDollars(currentCashCents));
  const [valueDollars, setValueDollars] = useState(
    centsToDollars(currentDeclaredValueCents ?? 0),
  );
  const [message, setMessage] = useState(currentMessage ?? '');

  const cashAmountCents = dollarsToCents(cashDollars);
  const declaredValueCents = dollarsToCents(valueDollars);
  const offerTotalCents = declaredValueCents + cashAmountCents;

  function toggleItem(itemId: string) {
    setExtraItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await amendTradeProposal({
        proposalId,
        extraItemIds,
        cashAmountCents,
        declaredValueCents: declaredValueCents > 0 ? declaredValueCents : null,
        message,
      });
      if (result.ok) {
        setOpen(false);
        toast.success('Offer updated.');
        router.refresh();
        return;
      }
      const copy =
        result.message ??
        ERROR_MESSAGES[result.error ?? ''] ??
        'Your changes could not be saved.';
      setError(copy);
      toast.error(copy);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={isPending}>
          <Pencil aria-hidden />
          Edit terms
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit your offer</DialogTitle>
          <DialogDescription>
            They see the new terms straight away. To change {primaryTitle} itself,
            withdraw and offer again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {offerableItems.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Items you are including</legend>
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {offerableItems.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5 text-sm">
                      <input
                        type="checkbox"
                        checked={extraItemIds.includes(item.id)}
                        onChange={() => toggleItem(item.id)}
                        className="size-4 shrink-0"
                        disabled={isPending}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatAud(item.fmvCents)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-cash">Cash you add</Label>
              <Input
                id="edit-cash"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                autoComplete="off"
                placeholder="0.00"
                value={cashDollars}
                onChange={(e) => setCashDollars(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-value">Your trade value</Label>
              <Input
                id="edit-value"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                autoComplete="off"
                placeholder="0.00"
                value={valueDollars}
                onChange={(e) => setValueDollars(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-message">Note</Label>
            <Textarea
              id="edit-message"
              rows={2}
              maxLength={TRADE_PROPOSAL_MESSAGE_MAX}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={isPending}
              placeholder="Anything you want them to know…"
            />
          </div>

          <p className="rounded-md border p-3 text-sm" role="status" aria-live="polite">
            Your side {formatAud(offerTotalCents)} · their side{' '}
            {formatAud(requestedFmvCents)}
          </p>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={isPending} aria-busy={isPending}>
            {isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
