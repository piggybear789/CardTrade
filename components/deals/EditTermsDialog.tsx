'use client';

// components/deals/EditTermsDialog.tsx
//
// Section-scoped editor for a private deal. Each Contract Detail row opens this
// dialog with a `section` that shows only that row's fields and saves only those
// keys through `updateTerms` — so "Edit terms" never dumps the whole deal form.
//
// Editing still CLEARS BOTH CONFIRMATIONS (database trigger); the warning stays
// on every section.

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, ImagePlus, Loader2, Pencil, ShieldCheck, X } from 'lucide-react';

import { PlacePicker } from '@/components/location';
import type { PlaceValue } from '@/lib/location/types';
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
import { uploadItemImages } from '@/lib/storage/uploadItemImages';
import {
  updateTerms,
  type DealRow,
  type HandoverMethod,
  type UpdateTermsInput,
  type UpdateTermsResult,
} from '@/lib/actions/deals';
import {
  DEAL_CASH_MAX,
  DEAL_COLLATERAL_MAX,
  DEAL_DELIVERY_COST_MAX,
  DEAL_PHOTOS_MAX,
  DEAL_PHOTOS_MIN,
  DEAL_TEXT_MAX,
} from '@/lib/marketplace-constants';
import { deliveryNotesFromDetails } from '@/lib/handover/terms';
import { cn } from '@/lib/utils';

/** Which Contract Detail row opened this dialog. */
export type EditTermsSection = 'exchange' | 'terms' | 'money' | 'collateral';

const SECTION_COPY: Record<
  EditTermsSection,
  { title: string; description: string; saveLabel: string }
> = {
  exchange: {
    title: 'Your side of the trade',
    description: 'Describe and photograph what you bring.',
    saveLabel: 'Save your side',
  },
  terms: {
    title: 'Handover terms',
    description: 'Choose how the goods change hands, then fill in the details.',
    saveLabel: 'Save terms',
  },
  money: {
    title: 'Cash component',
    description:
      'Optional cash paid through Stripe when you both confirm — not handed over at the meetup. Leave blank for goods only.',
    saveLabel: 'Save cash',
  },
  collateral: {
    title: 'Agreed trade value',
    description:
      'The total worth of the exchange. When collateral is required — someone unverified, or DittoBond opted in — each hold is 100% of this via Stripe.',
    saveLabel: 'Save value',
  },
};

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

function deliveryNotesFrom(deal: DealRow): string {
  return deliveryNotesFromDetails(deal.delivery_details);
}

function centsToDollars(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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

function placeFromDeal(deal: DealRow): PlaceValue | null {
  if (!deal.meeting_location?.trim()) return null;
  return {
    label: deal.meeting_location,
    placeId: deal.meeting_place_id ?? `deal:${deal.id}`,
    lat: deal.meeting_lat ?? -37.8136,
    lng: deal.meeting_lng ?? 144.9631,
    precision: 'exact',
  };
}

export interface EditTermsDialogProps {
  deal: DealRow;
  /** Which detail row opened this — controls fields and save payload. */
  section: EditTermsSection;
  /** True when the viewer is the deal's creator (maps "mine" vs "theirs"). */
  iAmCreator: boolean;
  /** True when at least one party has already confirmed (sharpens the warning). */
  someoneConfirmed: boolean;
  /** Rendered as the trigger; defaults to an outline "Edit terms" button. */
  triggerLabel?: string;
  /** Optional layout classes supplied by the surface hosting the trigger. */
  triggerClassName?: string;
}

/** Dialog for editing one section of a deal's substantive terms. */
export function EditTermsDialog({
  deal,
  section,
  iAmCreator,
  someoneConfirmed,
  triggerLabel = 'Edit terms',
  triggerClassName,
}: EditTermsDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [inlineError, setInlineError] = useState<string | null>(null);
  const copy = SECTION_COPY[section];

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
  const [myItemText, setMyItemText] = useState(myItemInitial);
  const [keptPhotoPaths, setKeptPhotoPaths] = useState<string[]>(myPhotosInitial);
  const [newPhotoFiles, setNewPhotoFiles] = useState<File[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [meetingPlace, setMeetingPlace] = useState<PlaceValue | null>(() =>
    placeFromDeal(deal),
  );
  const [meetingAt, setMeetingAt] = useState(toLocalInputValue(deal.meeting_at));
  const [deliveryDetails, setDeliveryDetails] = useState(deliveryNotesFrom(deal));
  const [deliveryCost, setDeliveryCost] = useState(
    centsToDollars(deal.delivery_cost_cents),
  );
  const [cash, setCash] = useState(centsToDollars(deal.cash_amount_cents));
  const [collateral, setCollateral] = useState(centsToDollars(deal.collateral_cents));
  const [collateralOptIn, setCollateralOptIn] = useState(Boolean(deal.collateral_opt_in));
  const [cashPayerId, setCashPayerId] = useState<string>(
    deal.cash_payer_id ?? deal.creator_id,
  );

  useEffect(() => {
    if (open) return;
    setMethod(deal.handover_method ?? 'IN_PERSON');
    setMyItemText(myItemInitial);
    setKeptPhotoPaths(myPhotosInitial);
    setNewPhotoFiles([]);
    setMeetingPlace(placeFromDeal(deal));
    setMeetingAt(toLocalInputValue(deal.meeting_at));
    setDeliveryDetails(deliveryNotesFrom(deal));
    setDeliveryCost(centsToDollars(deal.delivery_cost_cents));
    setCash(centsToDollars(deal.cash_amount_cents));
    setCollateral(centsToDollars(deal.collateral_cents));
    setCollateralOptIn(Boolean(deal.collateral_opt_in));
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

    if (section === 'exchange') {
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
    }

    if (section === 'terms') {
      if (method === 'IN_PERSON' && !meetingPlace?.label.trim()) {
        setInlineError('Add where you plan to meet.');
        return;
      }
    }

    let deliveryCostCents: number | null = null;
    if (section === 'terms' && method === 'DELIVERY') {
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

    let cashAmountCents: number | null = null;
    if (section === 'money' && cash.trim()) {
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
    if (section === 'collateral' && collateral.trim()) {
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
      let newPhotoPaths: string[] = [];
      if (section === 'exchange' && newPhotoFiles.length > 0) {
        const uploaded = await uploadItemImages(newPhotoFiles);
        if (!uploaded.ok) {
          setInlineError(uploaded.message);
          toast.error(uploaded.message);
          return;
        }
        newPhotoPaths = uploaded.paths;
      }

      const input: UpdateTermsInput = {};
      if (section === 'exchange') {
        input.myItemText = myItemText;
        input.myPhotos = keptPhotoPaths;
        input.myNewPhotoPaths = newPhotoPaths;
      } else if (section === 'terms') {
        input.handoverMethod = method;
        input.meetingLocation =
          method === 'IN_PERSON' ? meetingPlace!.label.trim() : undefined;
        input.meetingLat = method === 'IN_PERSON' ? meetingPlace!.lat : null;
        input.meetingLng = method === 'IN_PERSON' ? meetingPlace!.lng : null;
        input.meetingPlaceId = method === 'IN_PERSON' ? meetingPlace!.placeId : null;
        input.meetingAt =
          method === 'IN_PERSON' && meetingAt
            ? new Date(meetingAt).toISOString()
            : null;
        input.deliveryDetails = method === 'DELIVERY' ? deliveryDetails : undefined;
        input.deliveryCostCents = deliveryCostCents;
      } else if (section === 'money') {
        input.cashAmountCents = cash.trim() ? cashAmountCents : null;
        input.cashPayerId = cash.trim() ? cashPayerId : null;
      } else {
        input.collateralCents = collateral.trim() ? collateralCents : null;
        input.collateralOptIn = collateralOptIn;
      }

      const result = await updateTerms(deal.id, input);

      if (result.ok) {
        toast.success(
          result.confirmationsCleared
            ? 'Saved — both parties must confirm again.'
            : 'Saved.',
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            'h-8 gap-1.5 px-2.5 text-xs font-medium [&_svg]:size-3.5',
            triggerClassName,
          )}
        >
          <Pencil aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn(
          'gap-0 overflow-hidden p-0 sm:max-h-[min(92dvh,100dvh-3rem)]',
          section === 'exchange' ? 'sm:max-w-xl' : 'sm:max-w-lg',
        )}
      >
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-3 text-left sm:px-5">
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5">
            <div
              className="cardtrade-warning mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
              role="note"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                {someoneConfirmed
                  ? 'Changing this clears both confirmations — you will both need to confirm again.'
                  : 'Any change clears both confirmations, so you both re-confirm before the deal becomes binding.'}
              </p>
            </div>

            <div className="space-y-4 py-4">
              {section === 'exchange' ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                      <ShieldCheck className="size-5" aria-hidden />
                    </div>
                    <div>
                      <p className="font-medium">Describe and photograph what you bring</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        The other participant cannot edit this evidence. Photos become
                        part of the binding record.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="terms-my-item">
                      Item details{' '}
                      {goodsRequired ? <span className="text-destructive">*</span> : null}
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
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <Label htmlFor="terms-photos">
                          Evidence photos{' '}
                          {goodsRequired ? (
                            <span className="text-destructive">*</span>
                          ) : null}
                        </Label>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {totalPhotos} of {DEAL_PHOTOS_MAX} photos · front, back and
                          condition details
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
                      <ul
                        className="grid grid-cols-3 gap-2 sm:grid-cols-4"
                        aria-label="Your deal photos"
                      >
                        {keptPhotoPaths.map((path) => {
                          const url = itemImageUrl(path);
                          return (
                            <li
                              key={path}
                              className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
                            >
                              {url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={url}
                                  alt="Existing item evidence"
                                  className="h-full w-full object-cover"
                                />
                              ) : null}
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                className="absolute right-1 top-1 size-8 shadow-sm"
                                aria-label="Remove photo"
                                onClick={() =>
                                  setKeptPhotoPaths((current) =>
                                    current.filter((item) => item !== path),
                                  )
                                }
                              >
                                <X className="size-4" aria-hidden />
                              </Button>
                            </li>
                          );
                        })}
                        {newPhotoFiles.map((file, index) => (
                          <li
                            key={`${file.name}-${file.lastModified}-${index}`}
                            className="group relative aspect-square overflow-hidden rounded-lg border bg-muted"
                          >
                            <LocalPhotoPreview file={file} />
                            <Button
                              type="button"
                              variant="secondary"
                              size="icon"
                              className="absolute right-1 top-1 size-8 shadow-sm"
                              aria-label={`Remove ${file.name}`}
                              onClick={() =>
                                setNewPhotoFiles((current) =>
                                  current.filter((_, itemIndex) => itemIndex !== index),
                                )
                              }
                            >
                              <X className="size-4" aria-hidden />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <button
                        type="button"
                        className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed bg-background px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-primary/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => photoInputRef.current?.click()}
                      >
                        <ImagePlus className="mb-2 size-6 text-primary" aria-hidden />
                        <span className="text-sm font-medium">
                          Add clear photos of your item
                        </span>
                        <span className="mt-1 text-xs text-muted-foreground">
                          JPEG, PNG, WebP or GIF
                        </span>
                      </button>
                    )}
                  </div>
                </>
              ) : null}

              {section === 'terms' ? (
                <>
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
                      <PlacePicker
                        id="terms-location"
                        label="Meeting location"
                        precision="exact"
                        value={meetingPlace}
                        onChange={setMeetingPlace}
                        required
                        hint="Pick a public spot both parties can find."
                        textFallbackPlaceholder="e.g. Melbourne Central, outside the clock"
                      />
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
                          Postage agreed between you (separate from Stripe deal
                          cash). Enter 0 for free delivery.
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
                </>
              ) : null}

              {section === 'money' ? (
                <div className="space-y-2">
                  <Label htmlFor="terms-cash">Cash component (AUD)</Label>
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
                        <SelectItem value={myPartyId}>I pay via Stripe</SelectItem>
                        <SelectItem value={theirPartyId}>They pay via Stripe</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : cash.trim() && !theirPartyId ? (
                    <p className="text-xs text-muted-foreground">
                      You&apos;ll be recorded as the Stripe payer for now. You can
                      switch it once the other party joins.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Leave blank for a goods-only trade. Cash is never exchanged
                      in person — Stripe charges the payer when you both confirm.
                    </p>
                  )}
                </div>
              ) : null}

              {section === 'collateral' ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="terms-collateral">Agreed trade value (AUD)</Label>
                    <div className="relative">
                      <span
                        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                        aria-hidden
                      >
                        $
                      </span>
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
                      Cards plus any cash. If left blank it falls back to the cash value
                      only, which understates a trade that also includes cards.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={collateralOptIn}
                      onChange={(event) => setCollateralOptIn(event.target.checked)}
                      className="mt-0.5 h-4 w-4"
                      disabled={isPending}
                    />
                    <span>
                      <span className="font-medium">Require DittoBond collateral</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        Both sides post a Stripe hold on confirm even when you are both
                        DittoShield verified. Changing this clears both confirmations.
                      </span>
                    </span>
                  </label>
                </div>
              ) : null}

              {inlineError ? (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {inlineError}
                </p>
              ) : null}
            </div>
          </div>

          <DialogFooter className="shrink-0 border-t bg-background px-4 py-3 sm:px-5">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {isPending ? 'Saving…' : copy.saveLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
