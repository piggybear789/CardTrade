"use client";

// components/listings/ItemForm.tsx
//
// Client form for creating and editing a collectible Item (Req 3.1, 3.2, 3.3,
// 3.4, 3.5, 3.7). It is used by both `/listings/new` (create) and
// `/listings/[id]/edit` (edit); the VERIFIED gate itself is enforced by those
// pages, this component focuses on capturing + validating input and wiring to
// the listing Server Actions.
//
// Key behaviours:
//  - Fair_Market_Value is entered in DOLLARS in the UI but converted to integer
//    AUD cents (`Math.round(dollars * 100)`) before calling the action, since
//    money is integer cents end-to-end.
//  - Image count is enforced client-side (1–10) with a friendly message before
//    any upload work happens on the server (Req 3.3).
//  - Selected files are uploaded browser → Supabase Storage first
//    (`uploadItemImages`), and only the resulting object paths are sent to the
//    action. That keeps photo bytes out of the Server Action body, which Next
//    caps, and preserves the original file and its EXIF. In edit mode the paths
//    already on the Item are kept and the newly uploaded ones appended.
//  - Field-level validation errors returned by the action (`field` + `message`)
//    are surfaced inline against the offending input and announced to assistive
//    tech via `role="alert"` + `aria-describedby`.
//  - On success the user is redirected to the item detail page `/listings/[id]`.

import * as React from "react";
import { useRouter } from "next/navigation";
import { navigateWithType } from "@/lib/motion/navigate";
import { FieldError } from "@/components/motion/FieldError";
import { toast } from "sonner";
import { ImageOff, ImagePlus, Library, Package, X } from "lucide-react";

import { createItem, updateItem, type ItemRow } from "@/lib/actions/listings";
import type { ListingKind } from "@/domain/orchestrator/cashSaleOrchestrator";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { PlacePicker } from "@/components/location";
import type { PlaceValue } from "@/lib/location/types";
import { itemImageUrl } from "@/lib/format";
import { CARD_GAMES, cardGameName, cardGameSlug } from "@/lib/catalog/cardGames";
import { uploadItemImages } from "@/lib/storage/uploadItemImages";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Condition grades shown for a collectible, matching TCGplayer's standard scale. */
const CONDITIONS = [
  "Graded",
  "Unopened",
  "Near Mint",
  "Mint",
  "Lightly Played",
  "Heavily Played",
  "Damaged",
] as const;

/** Inclusive image-count bounds enforced in the UI (mirrors Req 3.1/3.3). */
const IMAGES_MIN = 1;
const IMAGES_MAX = 10;

/** Which server field a validation error maps to for inline display. */
type ErrorField =
  | "description"
  | "category"
  | "condition"
  | "fmvCents"
  | "images"
  | "location"
  | null;

function placeFromItem(item?: ItemRow): PlaceValue | null {
  if (
    !item?.location_label ||
    item.location_lat == null ||
    item.location_lng == null
  ) {
    return null;
  }
  return {
    label: item.location_label,
    placeId: item.location_place_id ?? `item:${item.id}`,
    lat: item.location_lat,
    lng: item.location_lng,
    // Carried so an edit that does not touch the place keeps its country instead of
    // clearing it, which would quietly drop the listing out of its own region.
    countryCode: item.location_country_code,
    precision: item.location_precision === "exact" ? "exact" : "suburb",
  };
}

export interface ItemFormProps {
  /** `create` renders an empty form; `edit` prefills from {@link item}. */
  mode: "create" | "edit";
  /** The existing item to edit; required when `mode === "edit"`. */
  item?: ItemRow;
}

/**
 * The two kinds of listing (0064), with the copy that tells them apart.
 *
 * The distinction has to land here, at the only point where the seller chooses:
 * a single listing is held for one buyer, a shopfront is not held for anyone.
 * Everything downstream — no reservation, several concurrent contracts, a price
 * that comes from each contract rather than from this form — follows from it.
 */
const LISTING_KINDS = [
  {
    value: "SINGLE" as const,
    icon: Package,
    label: "One item",
  },
  {
    value: "SHOPFRONT" as const,
    icon: Library,
    label: "Multiple items",
  },
];

/**
 * Convert a dollars string (e.g. `"123.45"`) to integer AUD cents. Returns
 * `null` when the input is empty or not a finite number so the caller can show
 * a friendly validation message rather than sending garbage to the server.
 */
function dollarsToCents(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

/** Format integer AUD cents back to a plain dollars string for the input. */
function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function ItemForm({ mode, item }: ItemFormProps) {
  const router = useRouter();

  const [description, setDescription] = React.useState(item?.description ?? "");
  const [game, setGame] = React.useState(() => cardGameSlug(item?.category));
  const [condition, setCondition] = React.useState(item?.condition ?? "");
  // Immutable after creation: contracts already open against a shopfront depend
  // on it not being reserved, and a single listing's live contract depends on the
  // opposite. Switching either way mid-flight would break one of them.
  const [listingKind, setListingKind] = React.useState<ListingKind>(
    item?.listing_kind ?? "SINGLE",
  );
  const isShopfront = listingKind === "SHOPFRONT";
  const [fmvDollars, setFmvDollars] = React.useState(
    item ? centsToDollars(item.fmv_cents) : "",
  );
  const [location, setLocation] = React.useState<PlaceValue | null>(() =>
    placeFromItem(item),
  );

  // Edit mode: existing stored object paths the user chooses to keep.
  const [keptPaths, setKeptPaths] = React.useState<string[]>(
    mode === "edit" ? (item?.image_paths ?? []) : [],
  );
  // Newly selected files (create: all images; edit: additions).
  const [newFiles, setNewFiles] = React.useState<File[]>([]);

  const [error, setError] = React.useState<{
    field: ErrorField;
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const totalImages = keptPaths.length + newFiles.length;

  function errorFor(field: Exclude<ErrorField, null>): string | undefined {
    return error?.field === field ? error.message : undefined;
  }

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length > 0) {
      setNewFiles((prev) => [...prev, ...picked]);
      setError(null);
    }
    // Reset the native input so re-picking the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeKeptPath(path: string) {
    setKeptPaths((prev) => prev.filter((p) => p !== path));
  }

  function removeNewFile(index: number) {
    setNewFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!game) {
      setError({ field: "category", message: "Select the card game." });
      return;
    }

    // Client-side FMV parse (Req 3.2): keep dollars<->cents conversion explicit.
    const fmvCents = dollarsToCents(fmvDollars);
    if (fmvCents === null) {
      setError({
        field: "fmvCents",
        message: "Enter a price in dollars (e.g. 123.45).",
      });
      return;
    }

    // Client-side image-count guard (Req 3.3) with a friendly message.
    if (totalImages < IMAGES_MIN) {
      setError({
        field: "images",
        message: "Add at least one image of your item.",
      });
      return;
    }
    if (totalImages > IMAGES_MAX) {
      setError({
        field: "images",
        message: `You can add at most ${IMAGES_MAX} images.`,
      });
      return;
    }

    if (!location?.label.trim()) {
      setError({
        field: "location",
        message: "Add where this listing is based (suburb or city).",
      });
      return;
    }

    const locationPayload = {
      label: location.label.trim(),
      placeId: location.placeId,
      lat: location.lat,
      lng: location.lng,
      // Resolved by the Places lookup and forwarded so the listing lands in a
      // region (0065). Null on the free-text fallback, which resolves no country;
      // `normalizeItemLocation` accepts that as unscoped rather than refusing.
      countryCode: location.countryCode ?? null,
      precision: "suburb" as const,
    };

    setIsSubmitting(true);
    try {
      // Photos go browser → Storage first; only their object paths travel in the
      // action call. Sending the files themselves puts them in the Server Action
      // body, which Next caps at `serverActions.bodySizeLimit`, and a single
      // phone photo can exceed it.
      let uploadedPaths: string[] = [];
      if (newFiles.length > 0) {
        const uploaded = await uploadItemImages(newFiles);
        if (!uploaded.ok) {
          setError({ field: "images", message: uploaded.message });
          setIsSubmitting(false);
          return;
        }
        uploadedPaths = uploaded.paths;
      }

      if (mode === "create") {
        const result = await createItem({
          description,
          category: cardGameName(game),
          condition,
          fmvCents,
          images: uploadedPaths,
          location: locationPayload,
          listingKind,
        });

        if (result.ok) {
          toast.success("Listing created");
          navigateWithType(router, `/listings/${result.data.id}`, "nav-forward");
          router.refresh();
          return;
        }
        surfaceActionError(result.error, result.field, result.message);
      } else {
        // Paths already on the Item, then the ones just uploaded — both are
        // plain object paths, so the action does no byte handling at all.
        const images: string[] = [...keptPaths, ...uploadedPaths];
        const result = await updateItem(item!.id, {
          description,
          category: cardGameName(game),
          condition,
          fmvCents,
          images,
          location: locationPayload,
        });

        if (result.ok) {
          toast.success("Listing updated");
          navigateWithType(router, `/listings/${result.data.id}`, "nav-forward");
          router.refresh();
          return;
        }
        surfaceActionError(result.error, result.field, result.message);
      }
    } catch {
      const message = "Something went wrong. Please try again.";
      setError({ field: null, message });
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Map a listing action error into an inline field error and/or a toast. */
  function surfaceActionError(
    code: string,
    field: string | undefined,
    message: string | undefined,
  ) {
    if (code === "validation-error" && field) {
      setError({
        field: field as Exclude<ErrorField, null>,
        message: message ?? "Please correct the highlighted field.",
      });
      return;
    }
    // Listing has no verification gate, so `not-verified`/`seller-not-verified`
    // are not returned by `createItem` today; the generic fallback covers them
    // if that ever changes.
    const fallback = message ?? "We couldn't save your listing. Please try again.";
    setError({ field: null, message: fallback });
    toast.error(fallback);
  }

  const descriptionError = errorFor("description");
  const gameError = errorFor("category");
  const conditionError = errorFor("condition");
  const fmvError = errorFor("fmvCents");
  const imagesError = errorFor("images");
  const locationError = errorFor("location");
  const generalError = error && error.field === null ? error.message : undefined;

  // The first image (kept or newly added) is the cover shown in the big
  // left-hand preview, mirroring how Facebook Marketplace always leads with a
  // large primary photo and keeps the rest as a filmstrip underneath.
  const coverUrl =
    keptPaths.length > 0
      ? itemImageUrl(keptPaths[0])
      : newFiles.length > 0
        ? URL.createObjectURL(newFiles[0])
        : null;

  // FIXED HEIGHT ON DESKTOP, and the details rail scrolls inside it.
  //
  // Previously the grid was `min-h`, so its height was whatever the rail's content
  // came to and the photo panel grew with every field added. Making the height
  // definite is what lets the middle row scroll and what keeps the left column the
  // same size no matter how much is in the form.
  //
  // Clamped rather than a bare `calc`: `100svh` minus the 4rem app header and the
  // page's own padding is the right target, but the exact padding is the shell's
  // business, not this component's. `min-h`/`max-h` mean a short laptop still gets a
  // usable form (and scrolls) and a very tall monitor does not stretch one column of
  // fields over 1200px. `svh` for the same reason as the photo below: `dvh` would
  // resize the whole card as a mobile URL bar hides.
  //
  // A CONSEQUENCE FOR THE LAST FIELD IN THE RAIL. `Based near` is a combobox, and
  // `PlaceSearch` positions its suggestions absolutely against the input. Once the rail
  // became a scroll box the suggestions were clipped at its bottom edge, so the third
  // one down was sliced in half and the rest were unreachable. `PlaceSearch` measures
  // its nearest clipping ancestor and opens upwards when there is no room below, which
  // is what keeps that field usable inside a definite-height card — do not assume a
  // popover in this rail can grow downwards.
  return (
    <Card className="mx-auto w-full max-w-7xl overflow-hidden lg:grid lg:h-[calc(100svh-7rem)] lg:max-h-[52rem] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1.65fr)_minmax(min(340px,40%),0.95fr)] lg:grid-rows-[auto_1fr_auto]">
      <CardHeader className="lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border lg:px-7 lg:pb-5 lg:pt-7">
        <CardTitle className="text-subhead">
          {mode === "create" ? "List an item" : "Edit listing"}
        </CardTitle>
        <CardDescription>
          {isShopfront
            ? "Describe what buyers can pick from. You agree the cards and the price with each buyer separately."
            : "Describe your collectible and set its price in Australian dollars."}
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} noValidate className="lg:contents">
        <CardContent className="grid gap-8 lg:contents">
          {/* Photos occupy the full-height left panel, keeping image entry
              visually distinct from the listing details rail. */}
          {/* `lg:min-h-0` + `lg:overflow-hidden` are what make the photo actually
              yield space to the filmstrip instead of overflowing the fixed panel: a
              grid item defaults to `min-height:auto`, which refuses to shrink below
              its content. */}
          <div className="space-y-3 lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:bg-muted lg:p-8">
            <Label htmlFor="images">Photos</Label>
            <p className="text-body text-muted-foreground">
              Add {IMAGES_MIN}–{IMAGES_MAX} photos. {totalImages} selected.
            </p>

            {/* Large cover preview / empty drop target. Clicking it opens the
                file picker, same affordance as the thumbnail grid below.

                On `lg` the panel now has a FIXED height, so this is the element that
                absorbs the difference: `lg:flex-1` takes whatever is left after the
                label, the count and the filmstrip, which means adding photos SHRINKS
                the cover rather than making the card taller. `lg:min-h-[10rem]` is
                the floor — with ten thumbnails the strip is several rows, and without
                a floor the cover could be squeezed to the height of its own icon.
                `lg:aspect-auto` and `lg:max-h-none` get the mobile rules out of the
                way: `aspect-[3/4]` ties height to WIDTH, which on the wide side of
                the grid resolved to roughly 900px, and a `max-h` cap fought the flex.

                Below `lg` the card is stacked, there is no rail alongside and so
                nothing to match: the portrait ratio sets the shape and `60svh` keeps
                it off the whole screen. `svh` rather than `dvh` so the target does
                not resize as a mobile URL bar hides on scroll.

                The image is `object-contain` throughout, so nothing crops. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
              className={`flex aspect-[3/4] max-h-[60svh] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border-2 border-dashed border-input bg-muted text-muted-foreground transition-colors hover:border-gold/40 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-muted-foreground md:aspect-auto md:min-h-[10rem] md:max-h-none md:flex-1`}
              aria-describedby={imagesError ? "images-error" : undefined}
            >
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverUrl}
                  alt="Cover photo"
                  width={640}
                  height={640}
                  className="h-full w-full object-contain"
                />
              ) : (
                <>
                  <ImagePlus className="size-8" aria-hidden />
                  <span className="text-body font-medium">Add photos</span>
                </>
              )}
            </button>

            <Input
              id="images"
              name="images"
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFilesSelected}
              className="sr-only"
              aria-invalid={imagesError ? true : undefined}
              aria-describedby={imagesError ? "images-error" : undefined}
              disabled={isSubmitting}
            />

            {/* Filmstrip of every selected photo, including the cover, so each
                one can be removed individually.

                `lg:shrink-0` so the strip keeps its size and the COVER gives way
                instead — the cover is the flexible one. Capped and scrollable because
                ten thumbnails in four columns is three rows, which at this panel width
                is taller than the cover's floor; without the cap the panel would
                overflow its now-fixed height. */}
            {totalImages > 0 ? (
              <ul className="grid grid-cols-4 gap-2 lg:max-h-[9.5rem] lg:shrink-0 lg:overflow-y-auto">
                {keptPaths.map((path) => {
                  const url = itemImageUrl(path);
                  return (
                    <li
                      key={path}
                      className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                    >
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt="Existing item image"
                          width={160}
                          height={160}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ImageOff className="size-5" aria-hidden />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeKeptPath(path)}
                        disabled={isSubmitting}
                        className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Remove image"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </li>
                  );
                })}
                {newFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      width={160}
                      height={160}
                      className="h-full w-full object-cover"
                      onLoad={(e) =>
                        URL.revokeObjectURL((e.target as HTMLImageElement).src)
                      }
                    />
                    <button
                      type="button"
                      onClick={() => removeNewFile(index)}
                      disabled={isSubmitting}
                      className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
                {totalImages < IMAGES_MAX ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmitting}
                      className="flex aspect-square w-full items-center justify-center rounded-md border-2 border-dashed border-input text-muted-foreground transition-colors hover:border-gold/40 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:text-muted-foreground"
                      aria-label="Add another photo"
                    >
                      <ImagePlus className="size-5" aria-hidden />
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}

            {imagesError ? (
              <FieldError id="images-error" message={imagesError} />
            ) : null}
          </div>

          {/* Details form — a dedicated right-hand rail. */}
          {/* THE ONLY SCROLLING REGION. This is the grid's `1fr` row, so now that the
              card's height is definite this is where the overflow belongs — the
              header and footer stay pinned and the photo column stays put.
              `lg:min-h-0` is required, not cosmetic: a grid item defaults to
              `min-height:auto`, which grows the row to fit its content and would
              silently defeat `overflow-y-auto`. */}
          <div className="space-y-5 lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-border lg:px-7 lg:pb-7">
            {/* Listing kind (0064). First, because it changes what the rest of
                this form means: for a shopfront the price below is only a guide
                and the condition covers a mixed pile. Locked in edit mode. */}
            <fieldset className="space-y-2" disabled={mode === "edit"}>
              <legend className="mb-2 text-body font-medium leading-none">
                What are you listing?
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {LISTING_KINDS.map((kind) => (
                  <ChoiceTile
                    key={kind.value}
                    id={`listing-kind-${kind.value}`}
                    name="listingKind"
                    type="radio"
                    icon={kind.icon}
                    label={kind.label}
                    checked={listingKind === kind.value}
                    onChange={() => setListingKind(kind.value)}
                  />
                ))}
              </div>
              {/* NO "nothing is reserved" NOTE HERE, and that is not the rule being
                  dropped. `product.md` requires the fact to be stated, and the
                  seller gets it where it is actionable rather than hypothetical: on
                  their own listing, the shopfront branch of `ItemActions` renders
                  "N open contracts — Nothing here is reserved. Check what each buyer
                  has asked for before you accept, so you don't promise the same card
                  twice", above a linked list of those contracts with buyer names and
                  amounts. A paragraph at creation time warned about a collision that
                  could not exist yet and named no contracts to check. The
                  buyer-facing half is separate and untouched (`BuyButton`: "Nothing
                  is held for you yet"). */}
              {mode === "edit" ? (
                <p className="text-body text-muted-foreground">
                  This can&apos;t be changed after a listing is created.
                </p>
              ) : null}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={6}
                aria-invalid={descriptionError ? true : undefined}
                aria-describedby={
                  descriptionError ? "description-error" : undefined
                }
                disabled={isSubmitting}
              />
              <p className="text-body text-muted-foreground">
                The first line is used as the listing title in the catalog.
              </p>
              {descriptionError ? (
                <FieldError id="description-error" message={descriptionError} />
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="game">Game</Label>
                <Select
                  value={game}
                  onValueChange={setGame}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="game"
                    aria-invalid={gameError ? true : undefined}
                    aria-describedby={gameError ? "game-error" : undefined}
                  >
                    <SelectValue placeholder="Select a game" />
                  </SelectTrigger>
                  <SelectContent>
                    {CARD_GAMES.map((option) => (
                      <SelectItem key={option.slug} value={option.slug}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {gameError ? (
                  <FieldError id="game-error" message={gameError} />
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="condition">
                  {isShopfront ? "Typical condition" : "Condition"}
                </Label>
                <Select
                  value={condition}
                  onValueChange={(v) => setCondition(v)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="condition"
                    aria-invalid={conditionError ? true : undefined}
                    aria-describedby={
                      conditionError ? "condition-error" : undefined
                    }
                  >
                    <SelectValue placeholder="Select a condition" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {conditionError ? (
                  <FieldError id="condition-error" message={conditionError} />
                ) : null}
              </div>
            </div>

            {/* Fair Market Value (dollars). For a shopfront this is INDICATIVE
                only: each contract's real total is the sum of the cards that
                buyer asks for, so the label must not promise a purchase price. */}
            <div className="space-y-2">
              <Label htmlFor="fmv">
                {isShopfront ? "Typical price" : "Price"}
              </Label>
              <MoneyInput
                id="fmv"
                name="fmv"
                min="0.01"
                placeholder="123.45"
                value={fmvDollars}
                onChange={(e) => setFmvDollars(e.target.value)}
                aria-invalid={fmvError ? true : undefined}
                aria-describedby={
                  fmvError ? "fmv-error" : isShopfront ? "fmv-hint" : undefined
                }
                disabled={isSubmitting}
              />
              <FieldError id="fmv-error" message={fmvError} />
            </div>

            <div className="space-y-2">
              <PlacePicker
                label="Based near"
                precision="suburb"
                value={location}
                onChange={setLocation}
                disabled={isSubmitting}
                required
                error={locationError}
              />
            </div>

            {generalError ? (
              <FieldError message={generalError} />
            ) : null}
          </div>
        </CardContent>

        <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted px-6 pb-4 pt-4 sm:flex-row sm:justify-end lg:col-start-2 lg:row-start-3 lg:border-l lg:border-border lg:px-7">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              navigateWithType(
                router,
                item ? `/listings/${item.id}` : "/listings",
                "nav-back",
              )
            }
            disabled={isSubmitting}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="w-full sm:w-auto"
          >
            {isSubmitting
              ? "Saving…"
              : mode === "create"
                ? "Create listing"
                : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
