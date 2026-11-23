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

import { useEffect, useState, type DragEvent } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ImagePlusIcon, XIcon } from '@hugeicons/core-free-icons';

import { cn } from '@/lib/utils';

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
        // ONE EXAMPLE, ON THE ONE FIELD WHERE THE FORMAT MATTERS (Depop, Airtasker:
        // "e.g. ..."). A title is name, set number and grade, which is what a collector
        // searches by; the other fields here explain themselves and carry none.
        placeholder="e.g. Charizard ex 199/165, PSA 10"
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
  placeholder,
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
    // NO PLACEHOLDER BY DEFAULT. The label asks the question, and grey text in an
    // empty box reads as a filled-in field at a glance (Etsy and Stripe leave theirs
    // blank). A caller may still pass one.
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
            <SelectValue placeholder="Choose" />
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
            <SelectValue placeholder="Choose" />
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

export function UnlistedPhotoField({
  draft,
  onChange,
  idPrefix = 'unlisted',
  layout = 'strip',
}: PieceProps & {
  /**
   * `strip` (default): a picker button beside the label and a row of small
   * thumbnails, for the compact join dialog. `grid`: the gallery the marketplaces
   * use (Depop, Etsy, Turo on Mobbin), square tiles with the first marked as the
   * cover and an Add tile after them, and a drop zone while there are none. For the
   * deal composer, where the photos are the largest thing on the form.
   */
  layout?: 'strip' | 'grid';
}) {
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

  /**
   * Move a photo within the order shown. The draft stores kept photos (already in
   * Storage) ahead of new ones, and that order is the order saved, so a move is
   * applied within whichever of the two lists it falls in. A move across them (a new
   * photo in front of a kept one, when editing) is not one the draft can store, and
   * is ignored. A new deal has no kept photos, so every move applies there.
   */
  function movePhoto(from: number, to: number) {
    const kept = draft.keptPaths.length;
    if (from < kept !== to < kept) return;
    if (from < kept) {
      update(draft, onChange, 'keptPaths', reorder(draft.keptPaths, from, to));
    } else {
      update(draft, onChange, 'images', reorder(draft.images, from - kept, to - kept));
    }
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

  if (layout === 'grid') {
    return (
      <PhotoGrid
        labelId={labelId}
        count={count}
        atCap={atImageCap}
        photos={strip}
        onAdd={addImages}
        onMove={movePhoto}
      />
    );
  }

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
          <label className="inline-flex h-10 cursor-pointer items-center gap-tight rounded-md border border-input bg-card px-group text-body font-medium text-foreground transition-colors hover:border-input-hover hover:bg-accent hover:text-accent-foreground has-[:focus-visible]:border-ring md:h-9">
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
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-md border border-transparent bg-obsidian/75 text-mist transition-colors hover:bg-obsidian focus-visible:border-ring focus-visible:outline-none"
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

/** `list` with the item at `from` moved to `to`. */
function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return list;
  next.splice(to, 0, moved);
  return next;
}

/**
 * The `grid` layout of {@link UnlistedPhotoField}, laid out the way the marketplace
 * listing forms on Mobbin do it (Etsy, Zillow, Depop, Nextdoor, 2026-11-22):
 *
 * - SMALL TILES, MANY TO A ROW. Six to a row at the form's width (five on a phone),
 *   so ten photos and the Add tile take two short rows. Four large tiles to a row
 *   put eight photos over three rows and pushed the title off the screen.
 * - ADD COMES FIRST (Zillow, Depop), so adding another never means looking for the
 *   end of the list, and the button does not move as photos arrive.
 * - DRAG TO REORDER (Zillow, Nextdoor), with "Make cover" on each tile for a keyboard
 *   or a phone. The first photo is the cover: the one the other person sees first.
 *
 * With no photos it is one drop zone the width of the form (Airtasker's main-image
 * area). Files can be dropped on the zone or the Add tile as well as picked.
 */
export function PhotoGrid({
  labelId,
  count,
  atCap,
  photos,
  onAdd,
  onMove,
  max = UNLISTED_IMAGES_MAX,
  inputId,
  disabled = false,
  describedBy,
}: {
  labelId: string;
  count: number;
  atCap: boolean;
  photos: { key: string; src: string | null; remove: () => void }[];
  onAdd: (files: File[]) => void;
  /** Move the photo at `from` to `to`. A move the draft cannot store is ignored. */
  onMove: (from: number, to: number) => void;
  /** The photo cap, for the count and the slot count. */
  max?: number;
  /** The file input's id, for a form that points a label or an error at it. */
  inputId?: string;
  disabled?: boolean;
  /** An error message's id, announced with the picker. */
  describedBy?: string;
}) {
  const [fileOver, setFileOver] = useState(false);
  const empty = photos.length === 0;
  /** Every tile the grid can hold: the Add tile and the photo cap. */
  const slots = max + 1;
  const emptySlots = Math.max(slots - photos.length - (atCap || empty ? 0 : 1), 0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

  const fileDropHandlers = {
    onDragOver: (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setFileOver(true);
    },
    onDragLeave: () => setFileOver(false),
    onDrop: (event: DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      setFileOver(false);
      onAdd(Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/')));
    },
  };

  const input = (
    <input
      id={inputId}
      type="file"
      accept="image/*"
      multiple
      aria-label="Add photos"
      aria-describedby={describedBy}
      aria-invalid={describedBy ? true : undefined}
      disabled={disabled}
      className="sr-only"
      onChange={(event) => {
        onAdd(Array.from(event.target.files ?? []));
        // Clear the input so picking the same file again still fires a change event.
        event.currentTarget.value = '';
      }}
    />
  );

  return (
    <div className="space-y-snug">
      <div className="flex items-baseline justify-between gap-cozy">
        <p className="text-body font-medium" id={labelId}>
          Photos
          <span className="ml-1.5 font-normal text-muted-foreground">
            {count === 0 ? '(required)' : `${count} of ${max}`}
          </span>
        </p>
        {photos.length > 1 ? (
          <p className="text-meta text-muted-foreground">Drag to reorder</p>
        ) : null}
      </div>

      {/* ONE SIZE, EMPTY OR FULL. The grid always lays out every slot it can hold
          (the Add tile plus ten photos), the unused ones as faint empty tiles the way
          Depop and Etsy show theirs, so it is the same height with no photos, one, or
          ten, and nothing under it moves when a photo is added or removed. With no
          photos the drop zone lies over the grid at exactly its size. */}
      <div className="relative">
        <ul
          aria-labelledby={labelId}
          aria-hidden={empty || undefined}
          className="grid grid-cols-5 gap-snug sm:grid-cols-6"
        >
          {atCap || empty ? null : (
            <li>
              <label
                {...fileDropHandlers}
                className={cn(
                  'flex aspect-square cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border border-input bg-card text-muted-foreground transition-colors hover:border-input-hover hover:bg-accent hover:text-foreground has-[:focus-visible]:border-ring',
                  fileOver && 'border-foreground bg-accent text-foreground',
                )}
              >
                <HugeiconsIcon icon={ImagePlusIcon} className="size-5" aria-hidden />
                <span className="text-meta font-medium">Add</span>
                {input}
              </label>
            </li>
          )}
          {photos.map((photo, index) => (
            <li
              key={photo.key}
              draggable
              onDragStart={(event) => {
                setDragFrom(index);
                event.dataTransfer.effectAllowed = 'move';
                // Some browsers start no drag without data.
                event.dataTransfer.setData('text/plain', String(index));
              }}
              onDragOver={(event) => {
                if (dragFrom === null) return;
                event.preventDefault();
                setDragOver(index);
              }}
              onDragLeave={() => setDragOver((over) => (over === index ? null : over))}
              onDrop={(event) => {
                if (dragFrom === null) return;
                event.preventDefault();
                if (dragFrom !== index) onMove(dragFrom, index);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              className={cn(
                'group relative aspect-square cursor-grab overflow-hidden rounded-lg border bg-muted transition-[opacity,box-shadow] active:cursor-grabbing',
                index === 0 ? 'border-foreground' : 'border-border',
                dragFrom === index && 'opacity-40',
                dragOver === index && dragFrom !== index && 'ring-2 ring-foreground ring-offset-1',
              )}
            >
              {photo.src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photo.src}
                  alt={`Photo ${index + 1} of ${photos.length}${index === 0 ? ', the cover' : ''}`}
                  draggable={false}
                  className="pointer-events-none size-full object-cover"
                />
              ) : null}
              {index === 0 ? (
                <span className="absolute inset-x-0 bottom-0 bg-obsidian/75 py-0.5 text-center text-[0.6875rem] font-medium leading-tight text-mist">
                  Cover
                </span>
              ) : (
                // For a keyboard or a phone, where a drag is not available: shown on
                // hover and on focus, and always reachable by Tab.
                <button
                  type="button"
                  onClick={() => onMove(index, 0)}
                  className="absolute inset-x-0 bottom-0 bg-obsidian/75 py-0.5 text-center text-[0.6875rem] font-medium leading-tight text-mist opacity-0 transition-opacity focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                >
                  Make cover
                  <span className="sr-only"> (photo {index + 1})</span>
                </button>
              )}
              <button
                type="button"
                onClick={photo.remove}
                className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-md border border-transparent bg-obsidian/75 text-mist transition-colors hover:bg-obsidian focus-visible:border-ring focus-visible:outline-none"
              >
                <HugeiconsIcon icon={XIcon} aria-hidden="true" className="size-3" />
                <span className="sr-only">Remove photo {index + 1}</span>
              </button>
            </li>
          ))}
          {/* The empty slots that keep the grid one size (see above). */}
          {Array.from({ length: emptySlots }, (_, slot) => (
            <li key={`slot-${slot}`} aria-hidden className="aspect-square rounded-lg bg-muted/50" />
          ))}
        </ul>
        {empty ? (
          <label
            {...fileDropHandlers}
            className={cn(
              'absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-snug rounded-xl border border-input bg-muted/40 px-group text-center transition-colors hover:border-input-hover hover:bg-muted/70 has-[:focus-visible]:border-ring',
              fileOver && 'border-foreground bg-accent',
            )}
          >
            <span className="grid size-11 place-items-center rounded-full border border-border bg-card text-foreground">
              <HugeiconsIcon icon={ImagePlusIcon} className="size-5" aria-hidden />
            </span>
            <span className="text-body font-medium text-foreground">Add photos</span>
            <span className="max-w-xs text-pretty text-meta text-muted-foreground">
              Drag them here or choose files. Up to {max}, and the first is
              the cover.
            </span>
            {input}
          </label>
        ) : null}
      </div>
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
