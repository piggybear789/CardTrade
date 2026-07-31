'use client';

// components/deals/DealGoodsDialog.tsx
//
// Everything about the creator's own side of a deal — what kinds of thing they
// are putting up, the cash among it, the photos and the write-up — edited away
// from the deal form.
//
// Same reasoning as the trade flow's UnlistedItemDialog: a drop zone, a preview
// grid, and a textarea are most of a page on their own, and only some roles need
// them. Held here, the new-deal card keeps one row summarising what is attached,
// and its height no longer depends on how many photos were picked.
//
// The kinds a trader ticks decide what else this window asks for, so those
// choices live here too rather than on the card: tick Cash and the amount appears
// beneath, tick Cards or Items and the photos do.
//
// Nothing is uploaded here. Files are handed back to the form, which uploads them
// to Storage on submit so the originals (and their EXIF) survive as the
// arbitration evidence base.

import { useEffect, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChoiceTile } from '@/components/ui/choice-tile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DealOfferKind, DealRole } from '@/lib/actions/deals';
import { DEAL_PHOTOS_MAX, DEAL_TEXT_MAX } from '@/lib/marketplace-constants';

/** What a trader can put up. Choosing these decides what else this dialog asks. */
const OFFER_OPTIONS: { value: DealOfferKind; label: string; hint: string }[] = [
  { value: 'CARDS', label: 'Cards', hint: 'Graded or raw' },
  { value: 'CASH', label: 'Cash', hint: 'Via Pinch' },
  { value: 'ITEMS', label: 'Items', hint: 'Photos required' },
];

/** What the creator is putting forward, as typed. */
export interface DealGoods {
  description: string;
  photos: File[];
  /**
   * Cash on the creator's own side, in dollars as entered. Only a trader has
   * this: a buyer's or seller's amount is the deal's price, not part of what they
   * are putting up, so it stays on the card.
   */
  cashDollars: string;
  /** A trader's mix of cards, cash and other items. Empty for other roles. */
  offerKinds: DealOfferKind[];
}

export const EMPTY_DEAL_GOODS: DealGoods = {
  description: '',
  photos: [],
  cashDollars: '',
  offerKinds: [],
};

/** True when a dollars string is a plain amount greater than zero. */
function isPositiveAmount(value: string): boolean {
  const trimmed = value.trim();
  if (!/^(?:\d+|\d*\.\d{1,2})$/.test(trimmed)) return false;
  return Number(trimmed) > 0;
}

export interface DealGoodsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Names whose item this is — "What you are selling", "What you are buying" —
   * so the window repeats the row that opened it rather than renaming the task.
   */
  title: string;
  /** What the deal currently carries, which seeds the fields on open. */
  value: DealGoods;
  /**
   * The side the creator is on, which decides which fields this window asks for.
   * Never `BUYER`: a buyer puts up cash, so the form gives them no goods row and
   * never opens this window.
   */
  role: DealRole | null;
  /** A validation message about the photos from the form's submit attempt. */
  error?: string;
  /** A validation message about the write-up from the form's submit attempt. */
  descriptionError?: string;
  /** A validation message about the cash amount from the form's submit attempt. */
  cashError?: string;
  /** A validation message about the kinds picked, from the form's submit attempt. */
  offerError?: string;
  onSave: (goods: DealGoods) => void;
}

export function DealGoodsDialog({
  open,
  onOpenChange,
  title,
  value,
  role,
  error,
  descriptionError,
  cashError,
  offerError,
  onSave,
}: DealGoodsDialogProps) {
  const [draft, setDraft] = useState<DealGoods>(value);

  // Re-seed on open so cancelling leaves what the deal already carries alone.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  // Object URLs for the preview strip, revoked whenever the selection changes or
  // the dialog goes away, so each URL is created exactly once.
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = draft.photos.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [draft.photos]);

  /** Photos add to the selection so several folders can be picked from. */
  function addPhotos(picked: File[]) {
    setDraft((current) => ({
      ...current,
      photos: [...current.photos, ...picked].slice(0, DEAL_PHOTOS_MAX),
    }));
  }

  function removePhotoAt(index: number) {
    setDraft((current) => ({
      ...current,
      photos: current.photos.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  /** Toggling a kind off takes what it asked for with it. */
  function toggleKind(kind: DealOfferKind) {
    setDraft((current) => {
      const offerKinds = current.offerKinds.includes(kind)
        ? current.offerKinds.filter((selected) => selected !== kind)
        : [...current.offerKinds, kind];
      const keepsGoods =
        offerKinds.includes('CARDS') || offerKinds.includes('ITEMS');
      return {
        ...current,
        offerKinds,
        photos: keepsGoods ? current.photos : [],
        cashDollars: offerKinds.includes('CASH') ? current.cashDollars : '',
      };
    });
  }

  const trading = role === 'TRADER';
  const tradesGoods =
    draft.offerKinds.includes('CARDS') || draft.offerKinds.includes('ITEMS');
  /** A buyer puts up cash, so there is nothing of theirs to photograph. */
  const showPhotos = role === 'SELLER' || (trading && tradesGoods);
  const photosRequired = showPhotos;
  const showCash = trading && draft.offerKinds.includes('CASH');

  const atCap = draft.photos.length >= DEAL_PHOTOS_MAX;
  const descriptionRequired = photosRequired;
  const complete =
    (!trading || draft.offerKinds.length > 0) &&
    (!photosRequired || draft.photos.length > 0) &&
    (!descriptionRequired || draft.description.trim() !== '') &&
    (!showCash || isPositiveAmount(draft.cashDollars));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {trading
              ? 'Pick what you are putting up, then fill in what each part needs. All of it is used as evidence if the deal is ever disputed.'
              : 'Photos and a description of the item you are putting up. Both are used as evidence if the deal is ever disputed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {trading ? (
            <fieldset
              className="space-y-2"
              aria-invalid={offerError ? true : undefined}
              aria-describedby={offerError ? 'deal-offer-error' : undefined}
            >
              <legend className="text-sm font-medium">
                You put up
                <span className="text-destructive" aria-hidden>
                  {' '}
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </legend>
              <div className="grid grid-cols-3 gap-1.5">
                {OFFER_OPTIONS.map((option) => (
                  <ChoiceTile
                    key={option.value}
                    id={`deal-offer-${option.value}`}
                    name="deal-offer"
                    type="checkbox"
                    label={option.label}
                    hint={option.hint}
                    checked={draft.offerKinds.includes(option.value)}
                    invalid={Boolean(offerError)}
                    onChange={() => toggleKind(option.value)}
                  />
                ))}
              </div>
              {offerError ? (
                <p id="deal-offer-error" role="alert" className="text-sm text-destructive">
                  {offerError}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          {showCash ? (
            <div className="space-y-2">
              <Label htmlFor="deal-cash">
                Cash you pay via Pinch
                <span className="text-destructive" aria-hidden>
                  {' '}
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </Label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                  aria-hidden
                >
                  $
                </span>
                <Input
                  id="deal-cash"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  autoComplete="off"
                  value={draft.cashDollars}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      cashDollars: event.target.value,
                    }))
                  }
                  className="pl-7"
                  aria-invalid={cashError ? true : undefined}
                  aria-describedby={cashError ? 'deal-cash-error' : undefined}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Charged through Pinch when you both confirm — not handed over in
                person.
              </p>
              {cashError ? (
                <p id="deal-cash-error" role="alert" className="text-sm text-destructive">
                  {cashError}
                </p>
              ) : null}
            </div>
          ) : null}

          {showPhotos ? (
            <div className="space-y-2">
              <p id="deal-photos-label" className="text-sm font-medium leading-none">
                Photos
                <span className="ml-1.5 font-normal text-muted-foreground">
                  {draft.photos.length} of {DEAL_PHOTOS_MAX}
                </span>
              </p>

              {/* A thumbnail says what a filename cannot about a collectible's
                  condition. The inset padding keeps focus rings off the scroll
                  container's edge. */}
              <ul
                aria-labelledby="deal-photos-label"
                className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1"
              >
                {previews.map((preview, index) => (
                  <li
                    key={preview}
                    className="relative size-16 shrink-0 overflow-hidden rounded-md border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview}
                      alt={`Photo ${index + 1} of ${draft.photos.length}`}
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhotoAt(index)}
                      className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-obsidian/75 text-parchment ring-offset-background transition-colors hover:bg-obsidian focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    >
                      <X aria-hidden="true" className="size-3" />
                      <span className="sr-only">Remove photo {index + 1}</span>
                    </button>
                  </li>
                ))}

                {atCap ? null : (
                  <li className="shrink-0">
                    {/* The input lives inside its label so the tile is the
                        control, and `has-` puts the focus ring on the tile. */}
                    <label className="flex size-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground ring-offset-background transition-colors hover:border-solid hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2">
                      <ImagePlus aria-hidden="true" className="size-5" />
                      <span className="text-[0.6875rem] font-medium">Add</span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        aria-label="Add photos"
                        className="sr-only"
                        onChange={(event) => {
                          addPhotos(Array.from(event.target.files ?? []));
                          // Clear the input so picking the same file again still
                          // fires a change event.
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                  </li>
                )}
              </ul>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {photosRequired && draft.photos.length === 0
                    ? 'At least one photo. Front, back and any flaws.'
                    : 'The first photo is the one they see first.'}
                </p>
              )}
            </div>
          ) : null}

          {descriptionRequired ? (
            <div className="space-y-2">
              <Label htmlFor="deal-description">
                Description
                <span className="text-destructive" aria-hidden>
                  {' '}
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </Label>
              <Textarea
                id="deal-description"
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                placeholder="Condition, grading, anything both sides should know"
                maxLength={DEAL_TEXT_MAX}
                rows={3}
                required
                aria-invalid={descriptionError ? true : undefined}
                aria-describedby={
                  descriptionError ? 'deal-description-error' : undefined
                }
              />
              {descriptionError ? (
                <p
                  id="deal-description-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {descriptionError}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!complete}
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
