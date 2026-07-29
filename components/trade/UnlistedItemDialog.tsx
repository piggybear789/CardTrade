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
import { ImagePlus, Lock, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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

/** Collectible categories, mirroring the listing form. */
const CATEGORIES = [
  'Trading Cards',
  'Coins',
  'Stamps',
  'Comics',
  'Memorabilia',
] as const;

/** Condition grades, mirroring the listing form (TCGplayer's standard scale). */
const CONDITIONS = [
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
  title: string;
  description: string;
  category: string;
  condition: string;
  images: File[];
}

/** An empty draft, used when opening the dialog to add rather than edit. */
const EMPTY_DRAFT: UnlistedItemDraft = {
  title: '',
  description: '',
  category: '',
  condition: '',
  images: [],
};

/** True when a draft has everything `createPrivateTradeItem` requires. */
export function isUnlistedDraftComplete(draft: UnlistedItemDraft): boolean {
  return (
    draft.title.trim() !== '' &&
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
  /** Who will be able to see this item, for the privacy assurance. */
  counterpartName: string;
  onSave: (draft: UnlistedItemDraft) => void;
}

export function UnlistedItemDialog({
  open,
  onOpenChange,
  initial,
  counterpartName,
  onSave,
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
          <DialogTitle>Offer Terms</DialogTitle>
          <DialogDescription>
            Describe an item you hold but have never listed, and put it up in this
            trade.
          </DialogDescription>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Lock className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
            <span>
              Only {counterpartName} sees this, and only inside this trade. It is
              never added to the marketplace.
            </span>
          </p>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unlisted-title">Title</Label>
            <Input
              id="unlisted-title"
              value={draft.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={120}
              autoComplete="off"
              placeholder="1999 Charizard, holo…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unlisted-description">Description</Label>
            <Textarea
              id="unlisted-description"
              value={draft.description}
              onChange={(e) => set('description', e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Condition details, grading, anything they should know…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="unlisted-category">Category</Label>
              <Select
                value={draft.category}
                onValueChange={(value) => set('category', value)}
              >
                <SelectTrigger id="unlisted-category">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
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
            <p className="text-sm font-medium leading-none" id="unlisted-photos-label">
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
                  <label className="flex size-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-muted-foreground ring-offset-background transition-colors hover:border-solid hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2">
                    <ImagePlus aria-hidden="true" className="size-5" />
                    <span className="text-[0.6875rem] font-medium">Add</span>
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

            <p className="text-xs text-muted-foreground">
              {draft.images.length < UNLISTED_IMAGES_MIN
                ? `At least ${UNLISTED_IMAGES_MIN} photo. They are the evidence base if this trade is ever disputed.`
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
            {initial ? 'Save item' : 'Add to offer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
