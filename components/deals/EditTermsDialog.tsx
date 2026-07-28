'use client';

// components/deals/EditTermsDialog.tsx
//
// Step 3 of the private deal flow: agree the handover. Either party may edit the
// terms while the deal is in TERMS or CONFIRMATION.
//
// The dialog carries an explicit warning that editing CLEARS BOTH CONFIRMATIONS —
// the database enforces this with a trigger, so the UI must never imply that a
// tick survives a terms change.

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, ImagePlus, Loader2, Pencil, ShieldCheck, X } from 'lucide-react';

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
import { itemImageUrl } from '@/lib/format';
import {
  updateTerms,
  type DealPhotoUpload,
  type DealRow,
  type HandoverMethod,
  type UpdateTermsResult,
} from '@/lib/actions/deals';
import {
  DEAL_CASH_MAX,
  DEAL_COLLATERAL_MAX,
  DEAL_DELIVERY_COST_MAX,
  DEAL_PHOTOS_MAX,
  DEAL_PHOTOS_MIN,
  DEAL_TEXT_MAX,
  DEAL_TITLE_MAX,
} from '@/lib/marketplace-constants';

/** Friendly, inline-safe messages for each typed updateTerms error. */
const ERROR_MESSAGES: Record<string, string> = {
  unauthenticated: 'Please sign in again.',
  'not-participant': 'You are not part of this deal.',
  'invalid-state': 'Terms can only be changed before the deal becomes binding.',
  'invalid-title': 'Give the deal a short title (3–120 characters).',
  'item-details-required': 'Describe the item or items you are bringing.',
  'photos-required': `Add at least ${DEAL_PHOTOS_MIN} photo of what you are bringing.`,
  'too-many-photos': `You can add at most ${DEAL_PHOTOS_MAX} photos.`,
  'invalid-photo': 'One of the retained photos does not belong to your side of this deal.',
  'upload-failed': 'Your photos could not be uploaded. Try again.',
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

/** Preview a newly selected local file and release its object URL on cleanup. */
function LocalPhotoPreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  if (!url) return <div className="h-full w-full animate-pulse bg-muted" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="New item evidence" className="h-full w-full object-cover" />;
}

export interface EditTermsDialogProps {
  deal: DealRow;
  /** True when the viewer is the deal's creator (maps "mine" vs "theirs"). */
  iAmCreator: boolean;
  /** True when at least one party has already confirmed (sharpens the warning). */
  someoneConfirmed: boolean;
  /** Rendered as the trigger; defaults to an outline "Edit terms" button. */
  triggerLabel?: string;
  /** Optional layout classes supplied by the surface hosting the trigger. */
  triggerClassName?: string;
}

/** Dialog for editing the deal's substantive terms, including the handover. */
export function EditTermsDialog({
  deal,
  iAmCreator,
  someoneConfirmed,
  triggerLabel = 'Edit terms',
  triggerClassName,
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
  const myPhotosInitial = iAmCreator
    ? deal.creator_photo_paths
    : deal.counterparty_photo_paths;
  const myRole = iAmCreator
    ? deal.creator_role
    : deal.creator_role === 'BUYER'
      ? 'SELLER'
      : deal.creator_role === 'SELLER'
        ? 'BUYER'
        : deal.creator_role;
  const goodsRequired = iAmCreator
    ? myRole === 'SELLER' ||
      (myRole === 'TRADER' &&
        deal.creator_offer_kinds.some((kind) => kind === 'CARDS' || kind === 'ITEMS'))
    : myRole === 'SELLER' || myRole === 'TRADER';

  const [method, setMethod] = useState<HandoverMethod>(
    deal.handover_method ?? 'IN_PERSON',
  );
  const [title, setTitle] = useState(deal.title);
  const [description, setDescription] = useState(deal.description ?? '');
  const [myItemText, setMyItemText] = useState(myItemInitial);
  const [keptPhotoPaths, setKeptPhotoPaths] = useState<string[]>(myPhotosInitial);
  const [newPhotoFiles, setNewPhotoFiles] = useState<File[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [meetingLocation, setMeetingLocation] = useState(deal.meeting_location ?? '');
  const [meetingAt, setMeetingAt] = useState(toLocalInputValue(deal.meeting_at));
  const [deliveryDetails, setDeliveryDetails] = useState(deliveryNotesFrom(deal));
  const [deliveryCost, setDeliveryCost] = useState(
    centsToDollars(deal.delivery_cost_cents),
  );
  const [cash, setCash] = useState(centsToDollars(deal.cash_amount_cents));
  const [collateral, setCollateral] = useState(centsToDollars(deal.collateral_cents));
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
    setKeptPhotoPaths(myPhotosInitial);
    setNewPhotoFiles([]);
    setMeetingLocation(deal.meeting_location ?? '');
    setMeetingAt(toLocalInputValue(deal.meeting_at));
    setDeliveryDetails(deliveryNotesFrom(deal));
    setDeliveryCost(centsToDollars(deal.delivery_cost_cents));
    setCash(centsToDollars(deal.cash_amount_cents));
    setCollateral(centsToDollars(deal.collateral_cents));
    setCashPayerId(deal.cash_payer_id ?? deal.creator_id);
  }, [open, deal, myItemInitial, myPhotosInitial]);

  const totalPhotos = keptPhotoPaths.length + newPhotoFiles.length;

  function handlePhotosSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length > 0) {
      setNewPhotoFiles((current) => [...current, ...picked]);
      setInlineError(null);
    }
    if (photoInputRef.current) photoInputRef.current.value = '';
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setInlineError(null);

    if (goodsRequired && !myItemText.trim()) {
      setInlineError('Describe the item or items you are bringing.');
      return;
    }
    if (goodsRequired && totalPhotos < DEAL_PHOTOS_MIN) {
      setInlineError('Add at least one clear photo of what you are bringing.');
      return;
    }
    if (totalPhotos > DEAL_PHOTOS_MAX) {
      setInlineError(`You can add at most ${DEAL_PHOTOS_MAX} photos.`);
      return;
    }

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

    let collateralCents: number | null = null;
    if (collateral.trim()) {
      const dollars = Number.parseFloat(collateral);
      if (!Number.isFinite(dollars) || dollars < 1) {
        setInlineError('Enter collateral of at least $1, or leave it blank for automatic.');
        return;
      }
      collateralCents = Math.round(dollars * 100);
      if (collateralCents > DEAL_COLLATERAL_MAX) {
        setInlineError('That collateral amount is too large.');
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
        myPhotos: [
          ...keptPhotoPaths,
          ...(newPhotoFiles as unknown as DealPhotoUpload[]),
        ],
        cashAmountCents,
        cashPayerId: cashAmountCents === null ? null : cashPayerId,
        collateralCents,
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
        <Button type="button" variant="outline" size="sm" className={triggerClassName}>
          <Pencil aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0">
        <form onSubmit={handleSubmit} className="flex max-h-[92vh] flex-col">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <DialogTitle>Build the deal</DialogTitle>
            <DialogDescription>
              Add your side first, then review the shared handover and money terms.
              Each person controls their own item evidence.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-y-auto px-6">
            <div
              className="mt-5 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
              role="note"
            >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              {someoneConfirmed
                ? 'Changing any term clears both confirmations — you will both need to confirm again.'
                : 'Any change to the terms clears both confirmations, so you both re-confirm before the deal becomes binding.'}
            </p>
          </div>

          <div className="space-y-6 py-5">
            <fieldset className="space-y-4 rounded-xl border-2 border-primary/20 bg-primary/[0.03] p-4 sm:p-5">
              <legend className="px-2 text-sm font-semibold text-primary">Your side of the trade</legend>
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <ShieldCheck className="size-5" aria-hidden />
                </div>
                <div>
                  <p className="font-medium">Describe and photograph what you bring</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    The other participant cannot edit this evidence. Photos become part of the binding record.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="terms-my-item">
                  Item details {goodsRequired ? <span className="text-destructive">*</span> : null}
                </Label>
                <Textarea
                  id="terms-my-item"
                  value={myItemText}
                  onChange={(event) => setMyItemText(event.target.value)}
                  placeholder="e.g. 1999 Base Set Charizard, PSA 10 — certification number, condition notes and anything included"
                  maxLength={DEAL_TEXT_MAX}
                  rows={4}
                  required={goodsRequired}
                />
                <p className="text-xs text-muted-foreground">
                  Be specific enough that both parties can identify the exact collectible.
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <Label htmlFor="terms-photos">
                      Evidence photos {goodsRequired ? <span className="text-destructive">*</span> : null}
                    </Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {totalPhotos} of {DEAL_PHOTOS_MAX} photos · front, back and condition details
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={totalPhotos >= DEAL_PHOTOS_MAX}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <ImagePlus aria-hidden />
                    Add photos
                  </Button>
                </div>
                <Input
                  ref={photoInputRef}
                  id="terms-photos"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  className="sr-only"
                  onChange={handlePhotosSelected}
                />

                {totalPhotos > 0 ? (
                  <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Your deal photos">
                    {keptPhotoPaths.map((path) => {
                      const url = itemImageUrl(path);
                      return (
                        <li key={path} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={url} alt="Existing item evidence" className="h-full w-full object-cover" />
                          ) : null}
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="absolute right-1 top-1 size-8 shadow-sm"
                            aria-label="Remove photo"
                            onClick={() => setKeptPhotoPaths((current) => current.filter((item) => item !== path))}
                          >
                            <X className="size-4" aria-hidden />
                          </Button>
                        </li>
                      );
                    })}
                    {newPhotoFiles.map((file, index) => (
                      <li key={`${file.name}-${file.lastModified}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg border bg-muted">
                        <LocalPhotoPreview file={file} />
                        <Button
                          type="button"
                          variant="secondary"
                          size="icon"
                          className="absolute right-1 top-1 size-8 shadow-sm"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => setNewPhotoFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          <X className="size-4" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <button
                    type="button"
                    className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed bg-background px-4 py-8 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => photoInputRef.current?.click()}
                  >
                    <ImagePlus className="mb-2 size-6 text-primary" aria-hidden />
                    <span className="text-sm font-medium">Add clear photos of your item</span>
                    <span className="mt-1 text-xs text-muted-foreground">JPEG, PNG, WebP or GIF</span>
                  </button>
                )}
              </div>
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border p-4 sm:p-5">
              <legend className="px-2 text-sm font-semibold">Shared deal summary</legend>
              <div className="space-y-2">
                <Label htmlFor="terms-title">Deal title</Label>
                <Input
                  id="terms-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={DEAL_TITLE_MAX}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="terms-description">Shared notes</Label>
                <Textarea
                  id="terms-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Condition expectations, grading details or anything else both parties agree to"
                  maxLength={DEAL_TEXT_MAX}
                  rows={3}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border p-4 sm:p-5">
              <legend className="px-2 text-sm font-semibold">Handover</legend>
              <div className="space-y-2">
                <Label htmlFor="terms-method">Method</Label>
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
            </fieldset>

            <fieldset className="space-y-4 rounded-xl border p-4 sm:p-5">
              <legend className="px-2 text-sm font-semibold">Money &amp; protection</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="terms-cash">Cash component (AUD)</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>$</span>
                    <Input
                      id="terms-cash"
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      step="0.01"
                      placeholder="No cash"
                      value={cash}
                      onChange={(event) => setCash(event.target.value)}
                      className="pl-7"
                    />
                  </div>
                  {cash.trim() && myPartyId && theirPartyId ? (
                    <Select value={cashPayerId} onValueChange={setCashPayerId}>
                      <SelectTrigger aria-label="Who pays the cash component">
                        <SelectValue placeholder="Choose who pays" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={myPartyId}>I pay</SelectItem>
                        <SelectItem value={theirPartyId}>They pay</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-xs text-muted-foreground">Leave blank for a goods-only trade.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="terms-collateral">Agreed trade value (AUD)</Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden>$</span>
                    <Input
                      id="terms-collateral"
                      type="number"
                      inputMode="decimal"
                      min="1"
                      step="0.01"
                      placeholder="Automatic"
                      value={collateral}
                      onChange={(event) => setCollateral(event.target.value)}
                      className="pl-7"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The total worth of the exchange — cards plus any cash. When collateral is required, each person&apos;s hold is 100% of this amount. If left blank it falls back to the cash value only, which understates a trade that also includes cards.
                  </p>
                </div>
              </div>
            </fieldset>

            {inlineError ? (
              <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {inlineError}
              </p>
            ) : null}
          </div>
          </div>

          <DialogFooter className="border-t bg-background px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Saving…' : 'Save deal changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
