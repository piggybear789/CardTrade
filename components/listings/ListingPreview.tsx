'use client';

// components/listings/ListingPreview.tsx
//
// The listing editor's live preview: the listing's page as a buyer on a computer
// meets it.
//
// THE DESKTOP PAGE, SCALED AS ONE PIECE (2026-11-23). The page is laid out at a fixed
// desktop size (`PAGE`) and scaled to fit the canvas (`DeviceStage`), so it wraps and
// truncates exactly as it will on the site, at any canvas width. No device frame: a
// plain card, as Contra's editor shows its page. It is the real composition: the
// gallery (thumbnail rail beside the frame, `GALLERY_SHELL`) and `ListingDesktopPane`
// fed the form's own values.
//
// THE PHOTOS ARE LIVE, THE REST IS A PICTURE. The gallery is a photo manager in the
// place the buyer will see it, using the form's own actions:
//
//   - The rail: click a thumbnail to show it, drag to reorder; the first is the cover.
//   - The frame: arrows and the arrow keys move through the photos; "Make cover",
//     remove and add sit on it on hover; files dropped on it are added.
//   - No photos: the frame is a picker and a drop target.
//
// The rest is `ListingDesktopPane` (title, price, meta line, seller card, description),
// `inert` and hidden from assistive tech: none of it goes anywhere. It leaves out what is
// the same on every listing (the buy buttons, the message box, the fee note and the
// protection line), so the preview shows only what the seller wrote.
//
// Below `lg` the canvas is not shown, and the form ends with the catalog tile instead
// (`frame="none"`): the reader is already on a phone.

import { useState, type DragEvent, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/icon';
import {
  CameraPlusIcon,
  CaretLeftIcon,
  CaretRightIcon,
  PlusIcon,
  XIcon,
} from '@/components/ui/icons';

import { DeviceStage } from '@/components/editor/DevicePreview';
import { CatalogItemCard } from '@/components/listings/ItemCard';
import { ListingDesktopPane } from '@/components/listings/ListingDesktopPane';
import type { CatalogItem, CatalogSeller } from '@/lib/actions/listings';
import { cn } from '@/lib/utils';

export interface ListingPreviewInput {
  title: string;
  description: string;
  /** Integer minor units, or null while the price field is empty or unreadable. */
  priceCents: number | null;
  currency: string;
  /** The card game's display name, or null before one is chosen. */
  category: string | null;
  condition: string;
  isShopfront: boolean;
  locationLabel: string | null;
  /** The cover's URL: a stored photo's, or a picked file's object URL. */
  coverSrc: string | null;
  photoCount: number;
  /** When the listing was published; null for a new one, which reads "just now". */
  createdAt: string | null;
  seller: CatalogSeller | null;
}

/**
 * The form's photos and what can be done to them, for the canvas. Every action is the
 * form's own (`addPhotos`, `movePhoto`, a photo's `remove`), so the preview and the
 * form's grid can never disagree about the order or the count.
 */
export interface PreviewPhotos {
  /** In the order shown; the first is the cover. */
  items: readonly { key: string; src: string | null }[];
  /** Whether another photo fits under the cap. */
  canAdd: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  /** Move the photo at `from` to `to`. Moving to 0 makes it the cover. */
  onMove: (from: number, to: number) => void;
  /**
   * Whether that move can be saved. In edit mode the saved photos stay ahead of new
   * ones (`movePhoto`), so a move across the two is refused.
   */
  canMove: (from: number, to: number) => boolean;
  disabled: boolean;
}

const TITLE_PLACEHOLDER = 'Your item';
const PRICE_PLACEHOLDER = 'Your price';

/**
 * The page's natural size, in CSS pixels, before it is scaled to the canvas: about the
 * listing page's content column on a 1280-1440px screen, at its 16:10-ish height.
 */
const PAGE = { width: 900, height: 600 };

/** The form's values in the shape the tile reads. Only the fields it draws matter. */
function previewItem(input: ListingPreviewInput, title: string): CatalogItem {
  return {
    id: 'preview',
    title,
    description: input.description,
    category: input.category ?? 'Game',
    condition: input.condition,
    listing_kind: input.isShopfront ? 'SHOPFRONT' : 'SINGLE',
    fmv_cents: input.priceCents ?? 0,
    currency: input.currency,
    status: 'AVAILABLE',
    image_paths: [],
    watch_count: 0,
    created_at: input.createdAt ?? new Date().toISOString(),
    seller: input.seller,
  } as unknown as CatalogItem;
}

export function ListingPreview({
  input,
  frame,
  photos,
}: {
  input: ListingPreviewInput;
  /** `canvas` for the pane beside the form; `none` for the bare tile under it below `lg`. */
  frame: 'canvas' | 'none';
  /** The live photos. Required on the canvas, where they can be worked on. */
  photos?: PreviewPhotos;
}) {
  const title = input.title.trim() || TITLE_PLACEHOLDER;
  const pricePlaceholder =
    input.priceCents == null || input.priceCents <= 0 ? PRICE_PLACEHOLDER : undefined;

  if (frame === 'none' || !photos) {
    return (
      <div aria-hidden inert className="pointer-events-none select-none rounded-xl bg-muted/60 p-cozy">
        <div className="mx-auto w-44">
          <CatalogItemCard
            item={previewItem(input, title)}
            coverSrc={input.coverSrc}
            pricePlaceholder={pricePlaceholder}
          />
        </div>
      </div>
    );
  }

  return (
    <DeviceStage width={PAGE.width} height={PAGE.height}>
      {/* Inset by 12px inside the stage so the card's shadow is not clipped. */}
      <div className="size-full p-3">
        <div className="flex size-full gap-6 overflow-hidden surface rounded-2xl bg-card p-7">
          {/* The gallery column. */}
          <div className="flex min-w-0 flex-1 flex-col">
            <PhotoGallery photos={photos} />
          </div>

          {/* The pane column. It scrolls inside itself when the description is long;
              the content is inert, not the scroller, so the wheel still reaches it.

              THE SCROLLER BLEEDS 6px PAST THE COLUMN and pads it back, as the real
              page's column does (`lg:-mx-tight lg:px-tight`). A card's edge is a
              box-shadow outside its box, and a scroller clips everything outside its
              own box, so the seller card lost its right edge where the two met. */}
          <div className="relative min-w-0 flex-1">
            <div className="absolute -inset-x-1.5 inset-y-0 overflow-y-auto overscroll-contain px-1.5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div aria-hidden inert className="h-full select-none">
                {/* `showTrust={false}` and no actions: the buy buttons, the message box,
                    the fee note and the protection line are the same on every listing,
                    so they told the seller nothing about theirs. The price is still the
                    fee-inclusive figure, and the line under the canvas says so. */}
                <ListingDesktopPane
                  showTrust={false}
                  title={title}
                  description={input.description}
                  priceCents={input.priceCents ?? 0}
                  pricePlaceholder={pricePlaceholder}
                  currency={input.currency}
                  isShopfront={input.isShopfront}
                  itemId="preview"
                  // As a buyer sees it, so the seller card reads as it will to them.
                  isOwner={false}
                  showWatch={false}
                  initialWatching={false}
                  sellerId={input.seller?.id ?? 'preview'}
                  sellerDisplayName={input.seller?.displayName ?? null}
                  sellerAvatarPath={input.seller?.avatarPath ?? null}
                  sellerVerified={input.seller?.isVerified ?? false}
                  sellerTrusted={input.seller?.isTrustedSeller ?? false}
                  sellerFirstName={input.seller?.identityFirstName ?? null}
                  sellerRating={input.seller?.rating ?? null}
                  sellerRatingCount={input.seller?.ratingCount}
                  sellerIdentity={null}
                  locationLabel={input.locationLabel}
                  // A new listing reads "Listed just now", as it will when published, so
                  // the meta line is never empty.
                  createdAt={input.createdAt ?? new Date().toISOString()}
                  condition={input.condition || null}
                >
                  {null}
                </ListingDesktopPane>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DeviceStage>
  );
}

/* -------------------------------------------------------------------------------------
 * The gallery: the thumbnail rail and the frame, as the desktop page lays them out.
 * Sizes are the page's own (`size-14` thumbnails, an `lg:gap-snug` shell); the frame's
 * controls are a little larger than a page control, because the page is drawn at about
 * two thirds of its size.
 * ----------------------------------------------------------------------------------- */

/** Overlay control on the photo: a light chip that reads on any photo. */
const PHOTO_CHIP =
  'grid place-items-center rounded-full bg-background/95 text-foreground shadow-[0_1px_3px_hsl(var(--obsidian)/0.25)] transition-[opacity,background-color] hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none';

/** Hidden until the frame is hovered or something in it has focus. */
const ON_HOVER = 'opacity-0 group-hover/photo:opacity-100 group-focus-within/photo:opacity-100';

function PhotoGallery({ photos }: { photos: PreviewPhotos }) {
  const [active, setActive] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const count = photos.items.length;
  // Clamped in render, so removing the last photo shows the one before it.
  const index = Math.min(active, Math.max(count - 1, 0));
  const current = photos.items[index] ?? null;
  // A drop shows the first of the new photos, which are added at the end.
  const drop = useFileDrop(photos, () => setActive(count));

  const go = (next: number) => setActive((next + count) % count);

  /** Move a photo, keeping the one that was showing on screen. */
  function move(from: number, to: number) {
    if (!photos.canMove(from, to)) return;
    photos.onMove(from, to);
    setActive(to);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (count < 2) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      go(index - 1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      go(index + 1);
    }
  }

  if (!current) {
    // No photos yet: the frame is the picker, and a drop target.
    return (
      <label
        {...drop.handlers}
        className={cn(
          'flex min-h-0 flex-1 cursor-pointer flex-col items-center justify-center gap-cozy rounded-lg border border-dashed border-input bg-muted/50 px-group text-center transition-colors hover:border-input-hover hover:bg-muted has-[:focus-visible]:border-ring',
          drop.over && 'border-foreground bg-accent',
        )}
      >
        <span className="grid size-14 place-items-center rounded-full border border-border bg-card text-foreground">
          <Icon icon={CameraPlusIcon} className="size-6" aria-hidden />
        </span>
        <span className="text-lead font-semibold text-foreground">Drop photos here</span>
        <span className="text-body text-muted-foreground">or click to choose them</span>
        <PhotoInput photos={photos} />
      </label>
    );
  }

  const canMakeCover = index > 0 && photos.canMove(index, 0);

  return (
    <div
      role="group"
      aria-label="Listing photos"
      aria-roledescription="carousel"
      onKeyDown={onKeyDown}
      className="flex min-h-0 flex-1 gap-snug"
    >
      {/* THE RAIL. Click shows a photo, drag reorders; the cover leads it. */}
      <ul
        aria-label="Photos, in order"
        className="flex w-14 shrink-0 flex-col gap-snug overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.items.map((photo, thumb) => {
          const selected = thumb === index;
          return (
            <li
              key={photo.key}
              draggable={!photos.disabled}
              onDragStart={(event) => {
                setDragFrom(thumb);
                event.dataTransfer.effectAllowed = 'move';
                // Some browsers start no drag without data.
                event.dataTransfer.setData('text/plain', String(thumb));
              }}
              onDragOver={(event) => {
                if (dragFrom === null || !photos.canMove(dragFrom, thumb)) return;
                event.preventDefault();
                setDragOver(thumb);
              }}
              onDragLeave={() => setDragOver((over) => (over === thumb ? null : over))}
              onDrop={(event) => {
                if (dragFrom === null) return;
                event.preventDefault();
                if (dragFrom !== thumb) move(dragFrom, thumb);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              className={cn(
                'relative shrink-0 transition-opacity',
                dragFrom === thumb && 'opacity-40',
              )}
            >
              <button
                type="button"
                onClick={() => setActive(thumb)}
                aria-label={`Show photo ${thumb + 1}${thumb === 0 ? ', the cover' : ''}`}
                aria-current={selected ? 'true' : undefined}
                className={cn(
                  'relative block size-14 cursor-grab overflow-hidden rounded-md border bg-muted transition-[border-color,box-shadow] active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'border-foreground ring-1 ring-foreground' : 'border-border hover:border-foreground/40',
                  dragOver === thumb && dragFrom !== thumb && 'ring-2 ring-foreground ring-offset-1',
                )}
              >
                {photo.src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.src} alt="" draggable={false} className="pointer-events-none size-full object-cover" />
                ) : null}
                {thumb === 0 ? (
                  <span className="absolute inset-x-0 bottom-0 bg-obsidian/75 py-px text-center text-[0.625rem] font-medium leading-tight text-mist">
                    Cover
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
        {photos.canAdd ? (
          <li className="shrink-0">
            <label
              title="Add photos"
              className="grid size-14 cursor-pointer place-items-center rounded-md border border-dashed border-input bg-card text-muted-foreground transition-colors hover:border-input-hover hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
            >
              <Icon icon={PlusIcon} className="size-5" aria-hidden />
              <PhotoInput photos={photos} onPicked={() => setActive(count)} />
            </label>
          </li>
        ) : null}
      </ul>

      {/* THE FRAME: the photo with its controls, and a drop target. */}
      <div
        {...drop.handlers}
        className={cn(
          'group/photo relative min-w-0 flex-1 overflow-hidden rounded-lg border bg-muted transition-shadow',
          drop.over && 'ring-2 ring-foreground ring-offset-2',
        )}
      >
        {current.src ? (
          // The blurred copy behind fills the letterbox, as the page's frame does.
          <div className="absolute inset-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.src} alt="" aria-hidden draggable={false} className="absolute inset-0 size-full scale-110 object-cover opacity-90 blur-lg" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={current.src} alt="" draggable={false} className="absolute inset-0 size-full object-contain" />
          </div>
        ) : null}

        {/* Top left: the cover's tag, or the action that makes this one the cover. */}
        {index === 0 ? (
          <span className="absolute left-3 top-3 rounded-md bg-obsidian/75 px-2.5 py-1 text-body font-medium text-mist">
            Cover
          </span>
        ) : canMakeCover ? (
          <button
            type="button"
            onClick={() => move(index, 0)}
            disabled={photos.disabled}
            className={cn(PHOTO_CHIP, ON_HOVER, 'absolute left-3 top-3 h-9 px-group text-body font-medium')}
          >
            Make cover
          </button>
        ) : null}

        {/* Top right: remove this photo. */}
        <button
          type="button"
          onClick={() => photos.onRemove(index)}
          disabled={photos.disabled}
          aria-label={`Remove photo ${index + 1}`}
          className={cn(PHOTO_CHIP, ON_HOVER, 'absolute right-3 top-3 size-9')}
        >
          <Icon icon={XIcon} className="size-4" aria-hidden />
        </button>

        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label="Previous photo"
              className={cn(PHOTO_CHIP, ON_HOVER, 'absolute left-3 top-1/2 size-10 -translate-y-1/2')}
            >
              <Icon icon={CaretLeftIcon} className="size-5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label="Next photo"
              className={cn(PHOTO_CHIP, ON_HOVER, 'absolute right-3 top-1/2 size-10 -translate-y-1/2')}
            >
              <Icon icon={CaretRightIcon} className="size-5" aria-hidden />
            </button>
            <span className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-obsidian/65 px-2.5 py-1 text-body font-medium tabular-nums text-mist">
              {index + 1} / {count}
            </span>
          </>
        ) : null}

        <span className="sr-only" aria-live="polite">
          Photo {index + 1} of {count}
          {index === 0 ? ', the cover' : ''}
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------------------
 * Adding photos: the picker and the drop target.
 * ----------------------------------------------------------------------------------- */

/**
 * The preview's own file input. Named "Add more photos", not "Add photos", so a test
 * looking for the form grid's picker by its label still finds exactly one.
 */
function PhotoInput({ photos, onPicked }: { photos: PreviewPhotos; onPicked?: () => void }) {
  return (
    <input
      type="file"
      accept="image/*"
      multiple
      aria-label="Add more photos"
      disabled={photos.disabled || !photos.canAdd}
      className="sr-only"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        // Clear the input so picking the same file again still fires a change event.
        event.currentTarget.value = '';
        if (files.length === 0) return;
        onPicked?.();
        photos.onAdd(files);
      }}
    />
  );
}

const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

/**
 * Accept image files dropped on an element. `over` lights the target while a file is
 * held over it. `onAdded` runs just before the files are handed to the form.
 */
function useFileDrop(photos: PreviewPhotos, onAdded?: () => void) {
  const [over, setOver] = useState(false);
  const accepting = photos.canAdd && !photos.disabled;
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent) => {
        if (!accepting || !isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        // Moving onto a child fires a leave on the parent; only a real exit counts.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(false);
      },
      onDrop: (event: DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setOver(false);
        if (!accepting) return;
        const files = Array.from(event.dataTransfer.files).filter((file) =>
          file.type.startsWith('image/'),
        );
        if (files.length === 0) return;
        onAdded?.();
        photos.onAdd(files);
      },
    },
  };
}
