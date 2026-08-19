'use client';

// components/trade/UnlistedItemDialog.tsx
//
// Describe an Item you hold but have never listed, so you can put it up in a
// Trade offer (Req 5.2 — the goods on either side need not be catalog listings).
//
// This is a detour from composing an offer, not part of it: five fields that used
// to expand inside the offer card and push the running total off screen. Holding
// them in a dialog keeps the card's height constant whichever path you take, and
// the saved draft comes back as one row in the "what I'm putting up" list.
//
// Nothing is persisted here. The draft is handed back to the caller and only
// becomes a real (hidden) Item when the offer is submitted, so abandoning the
// offer leaves nothing behind.

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
import { Label } from '@/components/ui/label';
import { CARD_GAMES, cardGameName, cardGameSlug } from '@/lib/catalog/cardGames';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/** Condition grades, mirroring the listing form (TCGplayer's standard scale). */
const CONDITIONS = [
  'Graded',
  'Unopened',
  'Near Mint',
  'Mint',
  'Lightly Played',
  'Heavily Played',
  'Damaged',
] as const;

export const UNLISTED_IMAGES_MIN = 1;
export const UNLISTED_IMAGES_MAX = 10;

/**
 * An unlisted Item as described in the dialog, before it is created. Mirrors the
 * `private` variant of `ProposalOffer` minus the valuation, which the offer form
 * owns because it is stated once for the whole side.
 */
export interface UnlistedItemDraft {
  description: string;
  category: string;
  condition: string;
  images: File[];
}

/** An empty draft, used when opening the dialog to add rather than edit. */
const EMPTY_DRAFT: UnlistedItemDraft = {
  description: '',
  category: '',
  condition: '',
  images: [],
};

/** True when a draft has everything `createPrivateTradeItem` requires. */
export function isUnlistedDraftComplete(draft: UnlistedItemDraft): boolean {
  return (
    draft.description.trim() !== '' &&
    draft.category !== '' &&
    draft.condition !== '' &&
    draft.images.length >= UNLISTED_IMAGES_MIN &&
    draft.images.length <= UNLISTED_IMAGES_MAX
  );
}

export interface UnlistedItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeds the fields when editing a draft already added to the offer. */
  initial?: UnlistedItemDraft | null;
  onSave: (draft: UnlistedItemDraft) => void;
  /** Defaults to the trade-offer wording. */
  title?: string;
  /** Optional. Hidden from the dialog when omitted. */
  description?: string;
  saveLabel?: string;
}

export function UnlistedItemDialog({
  open,
  onOpenChange,
  initial,
  onSave,
  title = 'Offer Terms',
  description,
  saveLabel,
}: UnlistedItemDialogProps) {
  const [draft, setDraft] = useState<UnlistedItemDraft>(initial ?? EMPTY_DRAFT);

  // Re-seed each time the dialog opens: the same instance serves both adding a
  // draft and editing the one already on the offer.
  useEffect(() => {
    if (open) setDraft(initial ?? EMPTY_DRAFT);
  }, [open, initial]);

  /** Update one field, leaving the rest of the draft alone. */
  function set<K extends keyof UnlistedItemDraft>(
    key: K,
    value: UnlistedItemDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // Object URLs for the preview strip, revoked whenever the selection changes or
  // the component goes away. Held in state rather than derived on render so each
  // URL is created exactly once and can be revoked by the effect that made it.
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = draft.images.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [draft.images]);

  /**
   * Photos add to the selection rather than replacing it, so you can pick from
   * several folders, and the strip is the record of what you chose. Anything past
   * the cap is dropped instead of failing the whole pick.
   */
  function addImages(picked: File[]) {
    set('images', [...draft.images, ...picked].slice(0, UNLISTED_IMAGES_MAX));
  }

  function removeImageAt(index: number) {
    set(
      'images',
      draft.images.filter((_, i) => i !== index),
    );
  }

  const complete = isUnlistedDraftComplete(draft);
  const atImageCap = draft.images.length >= UNLISTED_IMAGES_MAX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* No Title field, matching the listing form: the short label is derived
              from this description by `deriveItemTitle`. A trader states what the card
              is once, and arbitration still gets a stable label on the contract. */}
          <div className="space-y-2">
            <Label htmlFor="unlisted-description">Describe the item</Label>
            <Textarea
              id="unlisted-description"
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="1999 Charizard holo, condition details, grading, anything they should know…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="unlisted-game">Game</Label>
              <Select
                value={cardGameSlug(draft.category)}
                onValueChange={(value) => set('category', cardGameName(value))}
              >
                <SelectTrigger id="unlisted-game">
                  <SelectValue placeholder="Select a game" />
                </SelectTrigger>
                <SelectContent>
                  {CARD_GAMES.map((game) => (
                    <SelectItem key={game.slug} value={game.slug}>
                      {game.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="unlisted-condition">Condition</Label>
              <Select
                value={draft.condition}
                onValueChange={(value) => set('condition', value)}
              >
                <SelectTrigger id="unlisted-condition">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-body font-medium leading-none" id="unlisted-photos-label">
              Photos
              <span className="ml-1.5 font-normal text-muted-foreground">
                {draft.images.length} of {UNLISTED_IMAGES_MAX}
              </span>
            </p>

            {/* The strip is the record of what you picked: a filename tells you
                nothing about a collectible's condition, a thumbnail does. The
                inset padding keeps focus rings off the scroll container's edge. */}
            <ul
              aria-labelledby="unlisted-photos-label"
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
                    alt={`Photo ${index + 1} of ${draft.images.length}`}
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImageAt(index)}
                    className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-obsidian/75 text-parchment ring-offset-background transition-colors hover:bg-obsidian focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  >
                    <X aria-hidden="true" className="size-3" />
                    <span className="sr-only">Remove photo {index + 1}</span>
                  </button>
                </li>
              ))}

              {atImageCap ? null : (
                <li className="shrink-0">
                  {/* The input lives inside its label so the tile is the control:
                      clicking anywhere on it opens the picker, and `has-` puts the
                      focus ring on the tile rather than the hidden input. */}
                  <label className="flex size-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground ring-offset-background transition-colors hover:border-solid hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2">
                    <ImagePlus aria-hidden="true" className="size-5" />
                    <span className="text-meta font-medium">Add</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      aria-label="Add photos"
                      className="sr-only"
                      onChange={(e) => {
                        addImages(Array.from(e.target.files ?? []));
                        // Clear the input so picking the same file again still
                        // fires a change event.
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                </li>
              )}
            </ul>

            <p className="text-body text-muted-foreground">
              {draft.images.length < UNLISTED_IMAGES_MIN
                ? 'At least one photo — used as evidence if this is disputed.'
                : 'The first photo is the one they see first.'}
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!complete}
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            {saveLabel ?? (initial ? 'Save item' : 'Add to offer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
