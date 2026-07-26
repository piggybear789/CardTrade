'use client';

// components/deals/EditTermsDialog.tsx
//
// Step 3 of the private deal flow: agree the handover. Either party may edit the
// terms while the deal is in TERMS or CONFIRMATION.
//
// The dialog carries an explicit warning that editing CLEARS BOTH CONFIRMATIONS —
// the database enforces this with a trigger, so the UI must never imply that a
// tick survives a terms change.

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Pencil } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import {
  updateTerms,
  type DealRow,
  type HandoverMethod,
  type UpdateTermsResult,
} from '@/lib/actions/deals';
import {
  DEAL_CASH_MAX,
  DEAL_DELIVERY_COST_MAX,
  DEAL_TEXT_MAX,
  DEAL_TITLE_MAX,
} from '@/lib/marketplace-constants';

/** Friendly, inline-safe messages for each typed updateTerms error. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in again.',
  'not-participant': 'You are not part of this deal.',
  'invalid-state': 'Terms can only be changed before the deal becomes binding.',
  'invalid-title': 'Give the deal a short title (3–120 characters).',
  'invalid-cash': 'Enter a valid cash amount, or leave it blank.',
  'invalid-collateral': 'Enter a valid collateral amount.',
  'invalid-payer': 'Choose who pays the cash component.',
  'missing-meeting-location': 'Add where you plan to meet.',
  'invalid-delivery-cost': 'Enter the delivery cost, or 0 for free delivery.',
  'persistence-error': 'Could not save the terms. Please try again.',
};

function messageForError(result: Extract<UpdateTermsResult, { ok: false }>): string {
  return ERROR_MESSAGES[result.error] ?? result.detail ?? 'Could not save the terms.';
}

/**
 * Recover just the human-written shipping notes from `delivery_details`. The
 * server prepends a generated price line ("Delivered — $12.00 delivery…") to
 * whatever the parties typed, so that line is dropped here rather than being fed
 * back in as notes and duplicated on every save.
 */
function deliveryNotesFrom(deal: DealRow): string {
  const stored = deal.delivery_details ?? '';
  if (deal.delivery_cost_cents == null) return stored;
  const [first, ...rest] = stored.split('\n');
  return first.startsWith('Delivered —') ? rest.join('\n') : stored;
}

/** Format integer AUD cents as a plain dollars string for a number input. */
function centsToDollars(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

/** Convert an ISO timestamp to a value the datetime-local input accepts. */
function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface EditTermsDialogProps {
  deal: DealRow;
  /** True when the viewer is the deal's creator (maps "mine" vs "theirs"). */
  iAmCreator: boolean;
  /** True when at least one party has already confirmed (sharpens the warning). */
  someoneConfirmed: boolean;
  /** Rendered as the trigger; defaults to an outline "Edit terms" button. */
  triggerLabel?: string;
}

/** Dialog for editing the deal's substantive terms, including the handover. */
export function EditTermsDialog({
  deal,
  iAmCreator,
  someoneConfirmed,
  triggerLabel = 'Edit terms',
}: EditTermsDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [inlineError, setInlineError] = useState<string | null>(null);

  // `counterparty_id` is null until somebody joins via the share link, and terms
  // are only editable after that — so the payer choice is hidden while it is.
  const myPartyId = iAmCreator ? deal.creator_id : deal.counterparty_id;
  const theirPartyId = iAmCreator ? deal.counterparty_id : deal.creator_id;

  const myItemInitial =
    (iAmCreator ? deal.creator_item_text : deal.counterparty_item_text) ?? '';
  const theirItemInitial =
    (iAmCreator ? deal.counterparty_item_text : deal.creator_item_text) ?? '';

  const [method, setMethod] = useState<HandoverMethod>(
    deal.handover_method ?? 'IN_PERSON',
  );
  const [title, setTitle] = useState(deal.title);
  const [description, setDescription] = useState(deal.description ?? '');
  const [myItemText, setMyItemText] = useState(myItemInitial);
  const [theirItemText, setTheirItemText] = useState(theirItemInitial);
  const [meetingLocation, setMeetingLocation] = useState(deal.meeting_location ?? '');
  const [meetingAt, setMeetingAt] = useState(toLocalInputValue(deal.meeting_at));
  const [deliveryDetails, setDeliveryDetails] = useState(deliveryNotesFrom(deal));
  const [deliveryCost, setDeliveryCost] = useState(
    centsToDollars(deal.delivery_cost_cents),
  );
  const [cash, setCash] = useState(centsToDollars(deal.cash_amount_cents));
  const [cashPayerId, setCashPayerId] = useState<string>(
    deal.cash_payer_id ?? deal.creator_id,
  );

  // Re-seed the form whenever the live deal changes underneath a closed dialog.
  useEffect(() => {
    if (open) return;
    setMethod(deal.handover_method ?? 'IN_PERSON');
    setTitle(deal.title);
    setDescription(deal.description ?? '');
    setMyItemText(myItemInitial);
    setTheirItemText(theirItemInitial);
    setMeetingLocation(deal.meeting_location ?? '');
    setMeetingAt(toLocalInputValue(deal.meeting_at));
    setDeliveryDetails(deliveryNotesFrom(deal));
    setDeliveryCost(centsToDollars(deal.delivery_cost_cents));
    setCash(centsToDollars(deal.cash_amount_cents));
    setCashPayerId(deal.cash_payer_id ?? deal.creator_id);
  }, [open, deal, myItemInitial, theirItemInitial]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setInlineError(null);

    if (method === 'IN_PERSON' && !meetingLocation.trim()) {
      setInlineError('Add where you plan to meet.');
      return;
    }
    // Delivery is priced separately from the goods, so the cost is what has to
    // be agreed; shipping notes stay optional.
    let deliveryCostCents: number | null = null;
    if (method === 'DELIVERY') {
      const dollars = Number.parseFloat(deliveryCost);
      if (!Number.isFinite(dollars) || dollars < 0) {
        setInlineError('Enter the delivery cost, or 0 for free delivery.');
        return;
      }
      deliveryCostCents = Math.round(dollars * 100);
      if (deliveryCostCents > DEAL_DELIVERY_COST_MAX) {
        setInlineError('That delivery cost is too large.');
        return;
      }
    }

    // Dollars -> integer cents at the boundary; blank removes the cash leg.
    let cashAmountCents: number | null = null;
    if (cash.trim()) {
      const dollars = Number.parseFloat(cash);
      if (!Number.isFinite(dollars) || dollars <= 0) {
        setInlineError('Enter a cash amount greater than zero, or leave it blank.');
        return;
      }
      cashAmountCents = Math.round(dollars * 100);
      if (cashAmountCents > DEAL_CASH_MAX) {
        setInlineError('That cash amount is too large.');
        return;
      }
    }

    startTransition(async () => {
      const result = await updateTerms(deal.id, {
        handoverMethod: method,
        meetingLocation: method === 'IN_PERSON' ? meetingLocation : undefined,
        meetingAt:
          method === 'IN_PERSON' && meetingAt
            ? new Date(meetingAt).toISOString()
            : null,
        deliveryDetails: method === 'DELIVERY' ? deliveryDetails : undefined,
        deliveryCostCents,
        title,
        description,
        myItemText,
        theirItemText,
        cashAmountCents,
        cashPayerId: cashAmountCents === null ? null : cashPayerId,
      });

      if (result.ok) {
        toast.success(
          result.confirmationsCleared
            ? 'Terms saved — both parties must confirm again.'
            : 'Terms saved.',
        );
        setOpen(false);
        router.refresh();
        return;
      }
      const message = messageForError(result);
      setInlineError(message);
      toast.error(message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Deal terms</DialogTitle>
            <DialogDescription>
              Agree what each side brings and how you&apos;ll hand over.
            </DialogDescription>
          </DialogHeader>

          <div
            className="mt-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
            role="note"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              {someoneConfirmed
                ? 'Changing any term clears both confirmations — you will both need to confirm again.'
                : 'Any change to the terms clears both confirmations, so you both re-confirm before the deal becomes binding.'}
            </p>
          </div>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="terms-title">Title</Label>
              <Input
                id="terms-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={DEAL_TITLE_MAX}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="terms-my-item">What you bring</Label>
                <Textarea
                  id="terms-my-item"
                  value={myItemText}
                  onChange={(e) => setMyItemText(e.target.value)}
                  maxLength={DEAL_TEXT_MAX}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="terms-their-item">What they bring</Label>
                <Textarea
                  id="terms-their-item"
                  value={theirItemText}
                  onChange={(e) => setTheirItemText(e.target.value)}
                  maxLength={DEAL_TEXT_MAX}
                  rows={3}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="terms-description">Description</Label>
              <Textarea
                id="terms-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={DEAL_TEXT_MAX}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="terms-method">Handover method</Label>
              <Select
                value={method}
                onValueChange={(value) => setMethod(value as HandoverMethod)}
              >
                <SelectTrigger id="terms-method">
                  <SelectValue placeholder="Choose a handover method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN_PERSON">Meet in person</SelectItem>
                  <SelectItem value="DELIVERY">Delivery / shipping</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {method === 'IN_PERSON' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="terms-location">Meeting location</Label>
                  <Input
                    id="terms-location"
                    placeholder="e.g. Melbourne Central, outside the clock"
                    value={meetingLocation}
                    onChange={(e) => setMeetingLocation(e.target.value)}
                    maxLength={DEAL_TEXT_MAX}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="terms-time">Meeting time (optional)</Label>
                  <Input
                    id="terms-time"
                    type="datetime-local"
                    value={meetingAt}
                    onChange={(e) => setMeetingAt(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="terms-delivery-cost">Delivery cost (AUD)</Label>
                  <div className="relative">
                    <span
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                      aria-hidden
                    >
                      $
                    </span>
                    <Input
                      id="terms-delivery-cost"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={deliveryCost}
                      onChange={(e) => setDeliveryCost(e.target.value)}
                      className="pl-7"
                      aria-describedby="terms-delivery-cost-hint"
                      required
                    />
                  </div>
                  <p
                    id="terms-delivery-cost-hint"
                    className="text-xs text-muted-foreground"
                  >
                    Charged on top of the cash component. Enter 0 for free
                    delivery.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="terms-delivery">Delivery notes (optional)</Label>
                  <Textarea
                    id="terms-delivery"
                    placeholder="Courier, tracked post, timing…"
                    value={deliveryDetails}
                    onChange={(e) => setDeliveryDetails(e.target.value)}
                    maxLength={DEAL_TEXT_MAX}
                    rows={3}
                  />
                </div>
              </>
            )}

            <fieldset className="space-y-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">Cash component</legend>
              <div className="space-y-2">
                <Label htmlFor="terms-cash">Amount (AUD, blank for none)</Label>
                <div className="relative">
                  <span
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                    aria-hidden
                  >
                    $
                  </span>
                  <Input
                    id="terms-cash"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    className="pl-7"
                  />
                </div>
              </div>
              {cash.trim() && myPartyId && theirPartyId ? (
                <div className="space-y-2">
                  <Label htmlFor="terms-payer">Who pays</Label>
                  <Select value={cashPayerId} onValueChange={setCashPayerId}>
                    <SelectTrigger id="terms-payer">
                      <SelectValue placeholder="Choose who pays" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={myPartyId}>I pay</SelectItem>
                      <SelectItem value={theirPartyId}>They pay</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </fieldset>

            {inlineError ? (
              <p role="alert" className="text-sm text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Saving…' : 'Save terms'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
