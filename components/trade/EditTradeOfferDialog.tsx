'use client';

// components/trade/EditTradeOfferDialog.tsx
//
// Revise an offer you have already sent, without withdrawing and starting again.
// Editing in place means the other trader keeps looking at the same offer and
// simply sees the new terms, rather than it disappearing and reappearing.
//
// The primary item is fixed here: swapping out what you are fundamentally
// offering is a different offer, so that path is Withdraw and offer again.
// Handover is method-only — place, postage and tracking are agreed in the room.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MapPin, Pencil, Truck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ChoiceTile } from '@/components/ui/choice-tile';
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
import type { HandoverMethod } from '@/lib/handover/terms';
import type { TradeCashDirection } from '@/domain/orchestrator/tradeProposalRequest';

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
  currentCashDirection: TradeCashDirection;
  currentDeclaredValueCents: number | null;
  currentMessage: string | null;
  /** The value being asked for, so the running comparison still makes sense. */
  requestedFmvCents: number;
  currentHandoverMethod: HandoverMethod | null;
  /** @deprecated Details are agreed in the room; kept for call-site compatibility. */
  currentMeetingLocation?: string | null;
  /** @deprecated Details are agreed in the room; kept for call-site compatibility. */
  currentDeliveryCostCents?: number | null;
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
  'invalid-handover': 'Choose face to face or delivery.',
  unauthenticated: 'Sign in to edit this offer.',
};

export function EditTradeOfferDialog({
  proposalId,
  primaryTitle,
  currentExtraItemIds,
  offerableItems,
  currentCashCents,
  currentCashDirection,
  currentDeclaredValueCents,
  currentMessage,
  requestedFmvCents,
  currentHandoverMethod,
}: EditTradeOfferDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [extraItemIds, setExtraItemIds] = useState<string[]>(currentExtraItemIds);
  const [cashDollars, setCashDollars] = useState(centsToDollars(currentCashCents));
  const [cashDirection, setCashDirection] = useState<TradeCashDirection>(currentCashDirection);
  const [valueDollars, setValueDollars] = useState(
    centsToDollars(currentDeclaredValueCents ?? 0),
  );
  const [message, setMessage] = useState(currentMessage ?? '');
  const [handover, setHandover] = useState<HandoverMethod | null>(currentHandoverMethod);

  const cashAmountCents = dollarsToCents(cashDollars);
  const declaredValueCents = dollarsToCents(valueDollars);
  const yourSideCents =
    declaredValueCents + (cashDirection === 'PROPOSER_PAYS' ? cashAmountCents : 0);
  const theirSideCents =
    requestedFmvCents + (cashDirection === 'COUNTERPART_PAYS' ? cashAmountCents : 0);

  function toggleItem(itemId: string) {
    setExtraItemIds((current) =>
      current.includes(itemId)
        ? current.filter((id) => id !== itemId)
        : [...current, itemId],
    );
  }

  function handleSave() {
    setError(null);
    if (handover === null) {
      setError(ERROR_MESSAGES['invalid-handover']);
      return;
    }
    startTransition(async () => {
      const result = await amendTradeProposal({
        proposalId,
        extraItemIds,
        cashAmountCents,
        cashDirection,
        declaredValueCents: declaredValueCents > 0 ? declaredValueCents : null,
        message,
        handover: { method: handover },
      });
      if (result.ok) {
        toast.success('Offer updated.');
        setOpen(false);
        router.refresh();
        return;
      }
      const copy =
        ERROR_MESSAGES[result.error] ??
        ('detail' in result ? result.detail : undefined) ??
        ('message' in result ? result.message : undefined) ??
        'Could not update the offer.';
      setError(copy);
      toast.error(copy);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setExtraItemIds(currentExtraItemIds);
          setCashDollars(centsToDollars(currentCashCents));
          setCashDirection(currentCashDirection);
          setValueDollars(centsToDollars(currentDeclaredValueCents ?? 0));
          setMessage(currentMessage ?? '');
          setHandover(currentHandoverMethod);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2.5 text-xs font-medium [&_svg]:size-3.5"
        >
          <Pencil aria-hidden />
          Edit offer
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit offer</DialogTitle>
          <DialogDescription>
            Primary item stays {primaryTitle}. Meeting place, postage and tracking
            are agreed in the trade room after acceptance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {offerableItems.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Also include</legend>
              <ul className="space-y-1.5">
                {offerableItems.map((item) => {
                  const checked = extraItemIds.includes(item.id);
                  return (
                    <li key={item.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={checked}
                          onChange={() => toggleItem(item.id)}
                          disabled={isPending}
                        />
                        <span className="min-w-0 flex-1 truncate">{item.title}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {formatAud(item.fmvCents)}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-cash">Cash</Label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                  aria-hidden
                >
                  $
                </span>
                <Input
                  id="edit-cash"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="pl-7"
                  value={cashDollars}
                  onChange={(e) => setCashDollars(e.target.value)}
                  disabled={isPending}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-value">Your side valued at</Label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                  aria-hidden
                >
                  $
                </span>
                <Input
                  id="edit-value"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="pl-7"
                  value={valueDollars}
                  onChange={(e) => setValueDollars(e.target.value)}
                  disabled={isPending}
                />
              </div>
            </div>
          </div>

          {cashAmountCents > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who pays the cash</legend>
              <div className="grid grid-cols-2 gap-1.5">
                <ChoiceTile
                  id="edit-cash-you"
                  name="edit-cash-direction"
                  type="radio"
                  label="You pay via Pinch Payments"
                  hint="Added to your side"
                  checked={cashDirection === 'PROPOSER_PAYS'}
                  onChange={() => setCashDirection('PROPOSER_PAYS')}
                />
                <ChoiceTile
                  id="edit-cash-them"
                  name="edit-cash-direction"
                  type="radio"
                  label="They pay via Pinch Payments"
                  hint="Added to theirs"
                  checked={cashDirection === 'COUNTERPART_PAYS'}
                  onChange={() => setCashDirection('COUNTERPART_PAYS')}
                />
              </div>
            </fieldset>
          ) : null}

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

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Handover</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  {
                    value: 'IN_PERSON' as const,
                    label: 'Face to face',
                    hint: 'Meet and swap',
                    icon: MapPin,
                  },
                  {
                    value: 'DELIVERY' as const,
                    label: 'Delivery',
                    hint: 'Post it',
                    icon: Truck,
                  },
                ] as const
              ).map((option) => (
                <ChoiceTile
                  key={option.value}
                  id={`edit-handover-${option.value}`}
                  name="edit-handover"
                  type="radio"
                  icon={option.icon}
                  label={option.label}
                  hint={option.hint}
                  checked={handover === option.value}
                  onChange={() => setHandover(option.value)}
                />
              ))}
            </div>
          </fieldset>

          <p className="rounded-md border p-3 text-sm" role="status" aria-live="polite">
            You give {formatAud(yourSideCents)} · they give {formatAud(theirSideCents)}
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
