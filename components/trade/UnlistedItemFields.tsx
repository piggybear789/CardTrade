'use client';

// components/trade/UnlistedItemFields.tsx
//
// The four fields that describe a card nobody has listed: what it is, which game,
// what condition, and at least one photo. Shared by `UnlistedItemDialog` (the trade
// offer form's detour) and the private-deal composer.
//
// EXPORTED AS PIECES AS WELL AS A WHOLE. `UnlistedItemFields` keeps the order the
// trade offer form has always shown; the deal composer composes the same pieces with
// the photos first, because on a phone the camera is the first thing reached for and
// the photo is what the other person trusts. One set of fields, two orders, no flag.
//
// Controlled: the caller owns the draft. Nothing here persists anything.

import { useEffect, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ImagePlusIcon, XIcon } from '@hugeicons/core-free-icons';

import { TITLE_MAX_LENGTH } from '@/domain/validation/item';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { CARD_GAMES, cardGameName, cardGameSlug } from '@/lib/catalog/cardGames';
import { ITEM_CONDITIONS } from '@/lib/catalog/conditions';
import { itemImageUrl } from '@/lib/format';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export const UNLISTED_IMAGES_MIN = 1;
export const UNLISTED_IMAGES_MAX = 10;

/**
 * An unlisted Item as described in the form, before it is created. Mirrors the
 * `private` variant of `ProposalOffer` minus the valuation, which the offer form
 * owns because it is stated once for the whole side.
 */
export interface UnlistedItemDraft {
  title: string;
  description: string;
  category: string;
  condition: string;
  /**
   * Photos already in Storage, as object paths, when the draft edits a card that
   * exists. They come first, ahead of anything newly picked. Empty for a new card.
   */
  keptPaths: string[];
  /** Photos picked in this form, not uploaded yet. */
  images: File[];
}

/** An empty draft, used when opening the form to add rather than edit. */
export const EMPTY_UNLISTED_DRAFT: UnlistedItemDraft = {
  title: '',
  description: '',
  category: '',
  condition: '',
  keptPaths: [],
  images: [],
};

/** Every photo on the draft, kept and new. The one count the rules apply to. */
export function unlistedPhotoCount(draft: UnlistedItemDraft): number {
  return draft.keptPaths.length + draft.images.length;
}

export function isUnlistedDraftComplete(draft: UnlistedItemDraft): boolean {
  return unlistedDraftGap(draft) === null;
}

/**
 * The first thing a draft is missing, as the line a form shows beside its disabled
 * action, or `null` when it is complete. Photos first, matching the composer's order.
 */
export function unlistedDraftGap(draft: UnlistedItemDraft): string | null {
  const photos = unlistedPhotoCount(draft);
  if (photos < UNLISTED_IMAGES_MIN) return 'Add at least one photo.';
  if (photos > UNLISTED_IMAGES_MAX) {
    return `Keep it to ${UNLISTED_IMAGES_MAX} photos.`;
  }
  if (draft.title.trim() === '') return 'Give the card a title.';
  if (draft.description.trim() === '') return 'Describe the card.';
  if (draft.category === '') return 'Choose a category.';
  if (draft.condition === '') return 'Choose a condition.';
  return null;
}

interface PieceProps {
  draft: UnlistedItemDraft;
  onChange: (draft: UnlistedItemDraft) => void;
  /** Prefix for the field ids, so two instances on one page do not collide. */
  idPrefix?: string;
}

function update<K extends keyof UnlistedItemDraft>(
  draft: UnlistedItemDraft,
  onChange: (draft: UnlistedItemDraft) => void,
  key: K,
  value: UnlistedItemDraft[K],
) {
  onChange({ ...draft, [key]: value });
}

export function UnlistedTitleField({ draft, onChange, idPrefix = 'unlisted' }: PieceProps) {
  const id = `${idPrefix}-title`;
  return (
    <div className="space-y-snug">
      <Label htmlFor={id}>Title</Label>
      <Input
        id={id}
        value={draft.title}
        onChange={(e) => update(draft, onChange, 'title', e.target.value)}
        maxLength={TITLE_MAX_LENGTH}
        placeholder="1999 Charizard holo"
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}

export function UnlistedDescriptionField({
  draft,
  onChange,
  idPrefix = 'unlisted',
  label = 'Describe the card',
  placeholder = 'Condition details, grading, anything they should know…',
}: PieceProps & {
  /**
   * A flow that knows what the card is FOR should say so — "What are you selling?",
   * "What are you trading?" — because that is the question the member is answering.
   */
  label?: string;
  placeholder?: string;
}) {
  const id = `${idPrefix}-description`;
  return (
    // The placeholder names facts rather than repeating the title's example: the title
    // carries what the card is and this carries what condition it is in.
    <div className="space-y-snug">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={draft.description}
        onChange={(e) => update(draft, onChange, 'description', e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder={placeholder}
        className="resize-none"
      />
    </div>
  );
}

export function UnlistedCategoryConditionFields({
  draft,
  onChange,
  idPrefix = 'unlisted',
}: PieceProps) {
  const gameId = `${idPrefix}-game`;
  const conditionId = `${idPrefix}-condition`;
  return (
    // SIDE BY SIDE AT EVERY WIDTH. Stacked below `sm`, these two selects were 80px
    // of the phone sheet for two one-word answers. At 414px each gets ~185px; a long
    // game name truncates in the trigger and is whole in the list.
    <div className="grid grid-cols-2 gap-cozy">
      <div className="space-y-snug">
        {/* "Category", matching the listing form and the catalog filter. Not "Game"
            — Sports Cards is in the list — and not "Genre", which to a collector
            means fantasy or sport, not Pokémon. */}
        <Label htmlFor={gameId}>Category</Label>
        <Select
          value={cardGameSlug(draft.category)}
          onValueChange={(value) => update(draft, onChange, 'category', cardGameName(value))}
        >
          <SelectTrigger id={gameId}>
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
        <Label htmlFor={conditionId}>Condition</Label>
        <Select
          value={draft.condition}
          onValueChange={(value) => update(draft, onChange, 'condition', value)}
        >
          <SelectTrigger id={conditionId}>
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {ITEM_CONDITIONS.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function UnlistedPhotoField({ draft, onChange, idPrefix = 'unlisted' }: PieceProps) {
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
    const room = UNLISTED_IMAGES_MAX - draft.keptPaths.length;
    update(draft, onChange, 'images', [...draft.images, ...picked].slice(0, Math.max(room, 0)));
  }

  function removeImageAt(index: number) {
    update(
      draft,
      onChange,
      'images',
      draft.images.filter((_, i) => i !== index),
    );
  }

  function removeKept(path: string) {
    update(
      draft,
      onChange,
      'keptPaths',
      draft.keptPaths.filter((kept) => kept !== path),
    );
  }

  const count = unlistedPhotoCount(draft);
  const atImageCap = count >= UNLISTED_IMAGES_MAX;
  const labelId = `${idPrefix}-photos-label`;
  const strip = [
    ...draft.keptPaths.map((path) => ({
      key: path,
      src: itemImageUrl(path),
      remove: () => removeKept(path),
    })),
    ...previews.map((preview, index) => ({
      key: preview,
      src: preview,
      remove: () => removeImageAt(index),
    })),
  ];

  return (
    <div className="space-y-snug">
      {/* LABEL AND CONTROL ON ONE ROW. With no photos yet this used to be a label, a
          64px "Add" tile and a line of hint — three rows for an empty state. Now the
          label carries the count and the requirement, and the picker is a
          control-height button beside it. The thumbnail strip only exists once there
          is something to show in it. */}
      <div className="flex items-center justify-between gap-cozy">
        <p className="text-body font-medium" id={labelId}>
          Photos
          <span className="ml-1.5 font-normal text-muted-foreground">
            {count === 0 ? '(required)' : `${count} of ${UNLISTED_IMAGES_MAX}`}
          </span>
        </p>
        {atImageCap ? null : (
          // The input lives inside its label so the button is the control: clicking
          // anywhere on it opens the picker, and `has-` puts the focus edge on the
          // button rather than the hidden input.
          <label className="inline-flex h-10 cursor-pointer items-center gap-tight rounded-md border border-input bg-card px-group text-body font-medium text-foreground transition-colors hover:border-foreground/60 hover:bg-accent hover:text-accent-foreground has-[:focus-visible]:border-iris md:h-9">
            <HugeiconsIcon icon={ImagePlusIcon} aria-hidden="true" className="size-3.5" />
            {count === 0 ? 'Add photos' : 'Add more'}
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
          </label>
        )}
      </div>

      {strip.length > 0 ? (
        // The strip is the record of what you picked: a filename tells you nothing
        // about a collectible's condition, a thumbnail does. The inset padding keeps
        // focus rings off the scroll container's edge.
        <ul aria-labelledby={labelId} className="-mx-tight flex gap-snug overflow-x-auto px-tight py-tight">
          {strip.map((photo, index) => (
            <li key={photo.key} className="relative size-14 shrink-0 overflow-hidden rounded-md border bg-muted">
              {photo.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.src}
                  alt={`Photo ${index + 1} of ${strip.length}`}
                  className="size-full object-cover"
                />
              ) : null}
              <button
                type="button"
                onClick={photo.remove}
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
  );
}

export interface UnlistedItemFieldsProps extends PieceProps {
  /** Label for the description. See {@link UnlistedDescriptionField}. */
  descriptionLabel?: string;
  /** Placeholder for the description; the offer form and the deal composer differ. */
  descriptionPlaceholder?: string;
}

/** All five fields, in the order the trade offer form has always used. */
export function UnlistedItemFields({
  draft,
  onChange,
  idPrefix = 'unlisted',
  descriptionLabel,
  descriptionPlaceholder,
}: UnlistedItemFieldsProps) {
  return (
    <div className="space-y-group">
      <UnlistedTitleField draft={draft} onChange={onChange} idPrefix={idPrefix} />
      <UnlistedDescriptionField
        draft={draft}
        onChange={onChange}
        idPrefix={idPrefix}
        label={descriptionLabel}
        placeholder={descriptionPlaceholder}
      />
      <UnlistedCategoryConditionFields draft={draft} onChange={onChange} idPrefix={idPrefix} />
      <UnlistedPhotoField draft={draft} onChange={onChange} idPrefix={idPrefix} />
    </div>
  );
}
