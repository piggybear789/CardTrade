'use client';

// components/trade/UnlistedItemFields.tsx
//
// The four fields that describe a card nobody has listed: what it is, which game,
// what condition, and at least one photo. Shared by `UnlistedItemDialog` (the trade
// offer form's detour) and the private-deal composer, which renders them INLINE so
// that starting a deal is one screen rather than a form with a second modal inside it.
//
// Controlled: the caller owns the draft. Nothing here persists anything.

import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ImagePlusIcon, XIcon } from '@hugeicons/core-free-icons';

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
export const CONDITIONS = [
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
 * An unlisted Item as described in the form, before it is created. Mirrors the
 * `private` variant of `ProposalOffer` minus the valuation, which the offer form
 * owns because it is stated once for the whole side.
 */
export interface UnlistedItemDraft {
  description: string;
  category: string;
  condition: string;
  images: File[];
}

/** An empty draft, used when opening the form to add rather than edit. */
export const EMPTY_UNLISTED_DRAFT: UnlistedItemDraft = {
  description: '',
  category: '',
  condition: '',
  images: [],
};

export function isUnlistedDraftComplete(draft: UnlistedItemDraft): boolean {
  return (
    draft.description.trim() !== '' &&
    draft.category !== '' &&
    draft.condition !== '' &&
    draft.images.length >= UNLISTED_IMAGES_MIN &&
    draft.images.length <= UNLISTED_IMAGES_MAX
  );
}

export interface UnlistedItemFieldsProps {
  draft: UnlistedItemDraft;
  onChange: (draft: UnlistedItemDraft) => void;
  /** Prefix for the field ids, so two instances on one page do not collide. */
  idPrefix?: string;
  /**
   * Label for the description. Defaults to the neutral "Describe the card"; a flow
   * that knows what the card is FOR should say so — "What are you selling?",
   * "What are you trading?" — because that is the question the member is answering.
   */
  descriptionLabel?: string;
  /** Placeholder for the description; the offer form and the deal composer differ. */
  descriptionPlaceholder?: string;
}

export function UnlistedItemFields({
  draft,
  onChange,
  idPrefix = 'unlisted',
  descriptionLabel = 'Describe the card',
  descriptionPlaceholder = '1999 Charizard holo, condition details, grading, anything they should know…',
}: UnlistedItemFieldsProps) {
  /** Update one field, leaving the rest of the draft alone. */
  function set<K extends keyof UnlistedItemDraft>(key: K, value: UnlistedItemDraft[K]) {
    onChange({ ...draft, [key]: value });
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
    set('images', draft.images.filter((_, i) => i !== index));
  }

  const atImageCap = draft.images.length >= UNLISTED_IMAGES_MAX;
  const id = (suffix: string) => `${idPrefix}-${suffix}`;

  const pickerInput = (
    <input
      type="file"
      accept="image/*"
      multiple
      aria-label="Add photos"
      className="sr-only"
      onChange={(e) => {
        addImages(Array.from(e.target.files ?? []));
        // Clear the input so picking the same file again still fires a change event.
        e.currentTarget.value = '';
      }}
    />
  );

  return (
    <div className="space-y-group">
      {/* No Title field, matching the listing form: the short label is derived
          from this description by `deriveItemTitle`. A trader states what the card
          is once, and arbitration still gets a stable label on the contract.
          Two rows: the placeholder is one line and the field grows with typing. */}
      <div className="space-y-snug">
        <Label htmlFor={id('description')}>{descriptionLabel}</Label>
        <Textarea
          id={id('description')}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          maxLength={2000}
          rows={2}
          placeholder={descriptionPlaceholder}
          className="resize-none"
        />
      </div>

      {/* SIDE BY SIDE AT EVERY WIDTH. Stacked below `sm`, these two selects were
          80px of the phone sheet for two one-word answers. At 414px each gets
          ~185px; a long game name truncates in the trigger and is whole in the
          list. */}
      <div className="grid grid-cols-2 gap-cozy">
        <div className="space-y-snug">
          {/* "Category", matching the listing form and the catalog filter. Not
              "Game" — Sports Cards is in the list — and not "Genre", which to a
              collector means fantasy or sport, not Pokémon. */}
          <Label htmlFor={id('game')}>Category</Label>
          <Select
            value={cardGameSlug(draft.category)}
            onValueChange={(value) => set('category', cardGameName(value))}
          >
            <SelectTrigger id={id('game')}>
              <SelectValue placeholder="Select" />
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

        <div className="space-y-snug">
          <Label htmlFor={id('condition')}>Condition</Label>
          <Select value={draft.condition} onValueChange={(value) => set('condition', value)}>
            <SelectTrigger id={id('condition')}>
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

      <div className="space-y-snug">
        {/* LABEL AND CONTROL ON ONE ROW. With no photos yet this used to be a
            label, a 64px "Add" tile and a line of hint — three rows for an empty
            state. Now the label carries the count and the requirement, and the
            picker is a control-height button beside it. The thumbnail strip only
            exists once there is something to show in it. */}
        <div className="flex items-center justify-between gap-cozy">
          <p className="text-body font-medium" id={id('photos-label')}>
            Photos
            <span className="ml-1.5 font-normal text-muted-foreground">
              {draft.images.length === 0
                ? '(required)'
                : `${draft.images.length} of ${UNLISTED_IMAGES_MAX}`}
            </span>
          </p>
          {atImageCap ? null : (
            // The input lives inside its label so the button is the control:
            // clicking anywhere on it opens the picker, and `has-` puts the focus
            // edge on the button rather than the hidden input.
            <label className="inline-flex h-9 cursor-pointer items-center gap-tight rounded-md border border-border bg-card/80 px-cozy text-body font-medium text-foreground transition-colors hover:border-foreground/20 hover:bg-accent hover:text-accent-foreground has-[:focus-visible]:border-iris md:h-8 md:px-2.5">
              <HugeiconsIcon icon={ImagePlusIcon} aria-hidden="true" className="size-3.5" />
              {draft.images.length === 0 ? 'Add photos' : 'Add more'}
              {pickerInput}
            </label>
          )}
        </div>

        {previews.length > 0 ? (
          // The strip is the record of what you picked: a filename tells you
          // nothing about a collectible's condition, a thumbnail does. The inset
          // padding keeps focus rings off the scroll container's edge.
          <ul
            aria-labelledby={id('photos-label')}
            className="-mx-tight flex gap-snug overflow-x-auto px-tight py-tight"
          >
            {previews.map((preview, index) => (
              <li
                key={preview}
                className="relative size-14 shrink-0 overflow-hidden rounded-md border"
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
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full border border-transparent bg-obsidian/75 text-mist transition-colors hover:bg-obsidian focus-visible:border-iris focus-visible:outline-none"
                >
                  <HugeiconsIcon icon={XIcon} aria-hidden="true" className="size-3" />
                  <span className="sr-only">Remove photo {index + 1}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
