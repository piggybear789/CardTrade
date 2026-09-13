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
import { HugeiconsIcon } from '@hugeicons/react';
import { ImageOffIcon, ImagePlusIcon, LibraryIcon, PackageIcon, XIcon } from '@hugeicons/core-free-icons';

import { createItem, updateItem, type ItemRow } from "@/lib/actions/listings";
import type { ListingKind } from "@/domain/orchestrator/cashSaleOrchestrator";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { PlacePicker } from "@/components/location";
import type { PlaceValue } from "@/lib/location/types";
import { itemImageUrl } from "@/lib/format";
import { CARD_GAMES, cardGameName, cardGameSlug } from "@/lib/catalog/cardGames";
import {
  ITEM_FORM_ID,
  publishItemFormChrome,
} from "@/lib/listings/itemFormChrome";
import { uploadItemImages } from "@/lib/storage/uploadItemImages";
import type { ImageDim } from "@/lib/images/dimensions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    icon: PackageIcon,
    label: "One item",
  },
  {
    value: "SHOPFRONT" as const,
    icon: LibraryIcon,
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

  /** The submit control's resting label, shared by the footer and the phone header. */
  const submitLabel = mode === "create" ? "Create listing" : "Save changes";

  // BOTH MODES PUBLISH NOW. This was `if (mode !== "create") return`, so the phone
  // header could only ever offer Create — an edit had its submit at the bottom of a
  // long scrolling form with a Cancel above it.
  React.useEffect(() => {
    publishItemFormChrome({ submitting: isSubmitting, label: submitLabel });
    return () => publishItemFormChrome(null);
  }, [isSubmitting, submitLabel]);

  React.useEffect(() => {
    const isDirty =
      description.trim() !== "" ||
      newFiles.length > 0 ||
      fmvDollars.trim() !== "";
    if (!isDirty || isSubmitting) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [description, newFiles.length, fmvDollars, isSubmitting]);

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
      // Measured in the browser, because on this path the server never holds
      // the bytes and so cannot measure them itself. They let the catalog
      // mosaic reserve the right shape before the photo loads; the action
      // treats them as an untrusted claim.
      let uploadedDims: (ImageDim | null)[] = [];
      if (newFiles.length > 0) {
        const uploaded = await uploadItemImages(newFiles);
        if (!uploaded.ok) {
          setError({ field: "images", message: uploaded.message });
          setIsSubmitting(false);
          return;
        }
        uploadedPaths = uploaded.paths;
        uploadedDims = uploaded.dims;
      }

      if (mode === "create") {
        const result = await createItem({
          description,
          category: cardGameName(game),
          condition,
          fmvCents,
          images: uploadedPaths,
          imageDims: uploadedDims,
          location: locationPayload,
          listingKind,
        });

        if (result.ok) {
          
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
          // Kept photos are left null: the action reads their stored sizes back
          // off the row rather than trusting the form to resend them.
          imageDims: [...keptPaths.map(() => null), ...uploadedDims],
          location: locationPayload,
        });

        if (result.ok) {
          
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
    // `overflow-clip`, NEVER `overflow-hidden`. Both clip identically, and the
    // difference is the whole bug: `hidden` makes this a SCROLL CONTAINER on both
    // axes, and below `lg` this card wraps every field on the page. Nothing here is
    // meant to scroll sideways, but a scroll container does not need a scrollbar to
    // be scrolled — the browser's own "bring the focused element into view" scrolls
    // it on every focus, and the member cannot pan it back, because a touch drag on
    // an `overflow:hidden` box is refused. That is the shift-to-the-left on tapping
    // any field, and Radix makes it worse on a Select: opening moves focus into the
    // portalled list and closing restores it to the trigger, so one interaction is
    // three scroll-into-view calls.
    //
    // `clip` is not a scroll container at all, so there is no scroll offset to
    // acquire. The clipping the rounded corners and the footer border rely on is
    // unchanged, and so is `PlaceSearch`'s drop-up measurement — `clippingBounds`
    // looks for a non-`visible` overflow, which `clip` still is.
    // NO `lg:max-h`. The card is `100svh-7rem` and that is all — it was also capped
    // at `52rem` (832px), which on anything taller than about a 950px viewport left
    // the card short of the space it had while the details rail scrolled internally
    // anyway. Measured at 1920x1080: the card stopped at 832px with 155px of viewport
    // still empty below it, and the rail hid 49px of itself. Removing the cap lets it
    // use the height and the rail's scrollbar goes away on a tall display.
    //
    // The height is still PINNED to the viewport, deliberately. That is what keeps
    // the header and footer in place and makes the rail the single scrolling region,
    // and it is what gives both columns a definite height to fill. Unpinning it was
    // tried and reverted: with a content-sized row the two columns compete to set the
    // height and the photo panel wins as soon as the filmstrip has a few rows in it.
    <Card className="mx-auto w-full min-w-0 max-w-7xl overflow-clip lg:grid lg:h-[calc(100svh-7rem)] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1.65fr)_minmax(min(340px,40%),0.95fr)] lg:grid-rows-[auto_1fr_auto]">
      <CardHeader className={`lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border lg:px-7 lg:pb-5 lg:pt-7${mode === "create" ? " max-md:hidden" : ""}`}>
        <CardTitle className="text-subhead">
          {mode === "create" ? "List an item" : "Edit listing"}
        </CardTitle>
        <CardDescription className="hidden md:block">
          {isShopfront
            ? "Describe what buyers can pick from. You agree the cards and the price with each buyer separately."
            : "Describe your collectible and set its price in Australian dollars."}
        </CardDescription>
      </CardHeader>

      <form
        // Unconditional. It was create-only, for the phone header's benefit; the
        // header now submits in edit mode too and `form=` needs the id to exist.
        id={ITEM_FORM_ID}
        onSubmit={handleSubmit}
        noValidate
        className="lg:contents"
      >
        {/* `pt-0` is `CardContent`'s default, and it is right only because a
            `CardHeader` normally sits above it supplying the top padding. In CREATE
            mode that header is `max-md:hidden` — the mobile chrome already renders
            "New Listing", so a second title in the card was a duplicate — which left
            this as the card's first child with no top padding at all, so "Photos" sat
            flush against the border. Restored under the same condition that removes
            the header, rather than unconditionally: from `md` the header is back and
            `pt-0` is correct again. */}
        {/* `grid-cols-1`, not a bare `grid`. Below `lg` this is the stacked
            single-column layout, and a bare grid gives its one implicit column a
            track of `auto`, which sizes to the widest child's MIN-CONTENT. An
            `<input>`/`<textarea>`/`SelectTrigger` carries a large intrinsic width —
            larger still at the 16px touch type floor these fields use to stop iOS
            zooming — so that `auto` track grew past the phone's width, and because
            the `Card` clips (`overflow-clip`), the surplus was sheared off the right
            edge: the "right side shrinking" a member sees. `grid-cols-1` is
            `minmax(0, 1fr)`, whose `0` floor lets the column shrink to the container
            instead of the content, so the fields track the card's width and wrap
            rather than overflow. Irrelevant from `lg`, where `lg:contents` dissolves
            this grid entirely. */}
        <CardContent
          className={`grid grid-cols-1 gap-5 lg:contents${mode === "create" ? " max-md:pt-group" : ""}`}
        >
          {/* Photos occupy the full-height left panel, keeping image entry
              visually distinct from the listing details rail. */}
          {/* `lg:min-h-0` + `lg:overflow-hidden` are what make the photo actually
              yield space to the filmstrip instead of overflowing the fixed panel: a
              grid item defaults to `min-height:auto`, which refuses to shrink below
              its content. */}
          {/* `flex flex-col` WITH `gap`, not `space-y`. The column was `space-y-3`
              with an `lg:space-y-group` override, and stacking two `space-y` values
              through a breakpoint is hard to reason about — `gap` is one declaration
              that the flex container owns.
              
              `gap-group` (16px) at `lg`, up from 12px: at `cozy` the label sat almost
              on the cover and the filmstrip almost on that, so three separate things
              read as one crowded block. `group` is the scale's "between related
              components" step, which the form's own field blocks already use. */}
          <div className="flex flex-col gap-cozy lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:min-h-0 lg:gap-group lg:overflow-hidden lg:bg-card lg:p-8">
            {/* NO COUNT LINE UNDER THE LABEL. "Add 1–10 photos. N selected." spent a
                whole row restating what the panel already shows: the tiles are the
                count, and the add target disappearing at ten is the ceiling. The
                bounds are still enforced — `IMAGES_MIN` on submit, `IMAGES_MAX` on the
                add tile — and a shortfall is reported by `imagesError` below, which is
                where a member actually needs to read it. */}
            <Label htmlFor="images">Photos</Label>

            {/* SIDE BY SIDE BELOW `lg`, stacked from `lg`. On a phone the cover and
                the filmstrip used to run top-down, which spent two blocks of vertical
                space on photos before the member reached a single field. Beside each
                other they cost one.
                
                `lg:contents` dissolves this wrapper at `lg`, so the desktop panel is
                untouched: cover and strip go back to being direct flex children of
                the column, with the cover taking the remainder.
                
                `grid-cols-1` when there are no photos yet — otherwise the empty
                drop target would sit in two thirds of the row with a dead column
                beside it. `items-start` so the strip keeps its own height instead of
                stretching to the cover's. */}
            {/* THE ROW OWNS THE HEIGHT, so both sides are the same height by
                construction rather than by one of them winning.
                
                `aspect-[15/14]` is derived, not picked: the cover takes two thirds of
                the row, and a trading card is about 5:7, so a card-shaped cover wants
                a height of (2/3 x width) x 1.4 = 0.93 x width. That makes the ROW
                roughly 15:14. Both children are then `h-full` and end level.
                
                Doing it here rather than on the cover is what avoids the trap this
                layout kept falling into: an aspect ratio resolves against WIDTH, which
                is definite, so the row height never depends on how much content either
                side happens to have. */}
            <div
              className={`grid gap-cozy lg:contents lg:aspect-auto${
                totalImages > 0
                  ? " aspect-[15/14] grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
                  : " aspect-[16/10] max-h-[22svh] grid-cols-1"
              }`}
            >
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

                Below `lg` the card is stacked: a 4:3 target with a `28svh` cap
                leaves the details in the first screen. `svh` rather than `dvh`
                so the target does not resize as a mobile URL bar hides on scroll.

                The image is `object-contain` throughout, so nothing crops. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
              // `p-cozy lg:p-group` — the photo needs room INSIDE its own frame. The
              // image is `h-full w-full object-contain`, so with no padding it grew to
              // the button's edges and sat directly against the border, which read as
              // the frame gripping the card rather than presenting it.
              //
              // A 1px SOLID `--input` edge, not a 2px dashed one. This is a control, and
              // `--input` is the token that says so — it is the same edge every field on
              // this form wears, at the 3:1 SC 1.4.11 wants. The dashes were carrying
              // "drop a file here" on a button that says "Add photos" in words directly
              // beneath the icon, and at 2px they were the heaviest line on the page.
              className={`flex h-full w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-input bg-muted p-cozy text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-accent focus:outline-none focus-visible:border-iris disabled:cursor-not-allowed disabled:text-muted-foreground md:min-h-[10rem] lg:h-auto lg:flex-1 lg:p-group`}
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
                  <HugeiconsIcon icon={ImagePlusIcon} className="size-8" aria-hidden />
                  <span className="text-body font-medium">Add photos</span>
                </>
              )}
            </button>

            {/* A BARE `<input>`, NEVER THE `Input` COMPONENT. This is visually
                hidden and driven by the dropzone button above it, so none of
                `Input`'s styling is wanted — and applying it made the whole page
                scroll sideways on a phone.
                
                `sr-only` sets `position:absolute; width:1px; margin:-1px`, while
                `Input`'s base string sets `w-full h-9`. tailwind-merge keeps both:
                it groups `sr-only` on its own and does not treat it as conflicting
                with `w-*`, so the two land in the same CSS layer and `w-full` wins
                on source order. That left an ABSOLUTELY POSITIONED, 100%-wide box.
                
                Nothing between here and the root is positioned, so its containing
                block was the initial containing block: `width:100%` resolved
                against the VIEWPORT rather than the card, and the `Card`'s
                `overflow-clip` did not clip it, because an abs-pos box is only
                clipped by an ancestor that is inside its containing block. Sitting
                at its static-position offset — the shell and card padding, a
                constant 32px — it reached 32px past the right edge at EVERY
                viewport width, and `body`'s `overflow-x: clip` could not absorb it
                either, for the same containing-block reason. Measured at 320px and
                390px: `documentElement.scrollWidth` 352 and 422.
                
                The three other file inputs in the app (`MessageComposer`,
                `AvatarUploadField`, `UnlistedItemDialog`) are already bare
                `<input>`s. This was the only one that was not. */}
            <input
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
                instead — the cover is the flexible one.
                
                TWO COLUMN COUNTS, BOTH SET BY THE WIDTH THE STRIP ACTUALLY GETS.
                
                `lg:grid-cols-8` is why this no longer scrolls. Four columns was wrong
                on the desktop panel: at roughly 800px wide `aspect-square` made each
                thumbnail about 194px — nearly the size of the cover it previews — so
                ten photos needed three rows, taller than the cover's own floor. The
                strip was therefore capped at `9.5rem` with `overflow-y-auto`, making
                the seller scroll a panel that had room to spare. At eight columns a
                thumbnail is about 96px and ten photos is two rows.
                
                `grid-cols-1` below `lg`: the strip now sits BESIDE the cover in about
                a third of the row, so it reads as a vertical filmstrip rather than a
                grid. It was four columns when it ran full width under the cover, which
                in a ~115px cell would be ~25px thumbnails. */}
            {totalImages > 0 ? (
              <ul className="grid h-full min-h-0 grid-cols-1 content-start gap-2 overflow-y-auto lg:h-auto lg:content-normal lg:grid-cols-8 lg:overflow-visible lg:shrink-0">
                {keptPaths.map((path) => {
                  const url = itemImageUrl(path);
                  return (
                    <li
                      key={path}
                      className="group relative aspect-[5/7] overflow-hidden rounded-md border bg-muted lg:aspect-square"
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
                          <HugeiconsIcon icon={ImageOffIcon} className="size-5" aria-hidden />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeKeptPath(path)}
                        disabled={isSubmitting}
                        className="absolute right-1 top-1 flex size-11 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm hover:bg-background border border-transparent focus:outline-none focus-visible:border-iris md:size-8"
                        aria-label="Remove image"
                      >
                        <HugeiconsIcon icon={XIcon} className="size-4" aria-hidden />
                      </button>
                    </li>
                  );
                })}
                {newFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="group relative aspect-[5/7] overflow-hidden rounded-md border bg-muted lg:aspect-square"
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
                      className="absolute right-1 top-1 flex size-11 items-center justify-center rounded-full border border-transparent bg-background/80 text-foreground shadow-sm hover:bg-background focus:outline-none focus-visible:border-iris md:size-8"
                      aria-label={`Remove ${file.name}`}
                    >
                      <HugeiconsIcon icon={XIcon} className="size-4" aria-hidden />
                    </button>
                  </li>
                ))}
                {totalImages < IMAGES_MAX ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmitting}
                      className="flex aspect-[5/7] w-full items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted focus:outline-none focus-visible:border-iris disabled:cursor-not-allowed disabled:text-muted-foreground lg:aspect-square"
                      aria-label="Add another photo"
                    >
                      <HugeiconsIcon icon={ImagePlusIcon} className="size-5" aria-hidden />
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}
            </div>

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
              <div className="grid grid-cols-2 gap-2">
                {LISTING_KINDS.map((kind) => (
                  <ChoiceTile
                    key={kind.value}
                    id={`listing-kind-${kind.value}`}
                    name="listingKind"
                    type="radio"
                    icon={kind.icon}
                    label={kind.label}
                    align="center"
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
                rows={4}
                aria-invalid={descriptionError ? true : undefined}
                aria-describedby={
                  descriptionError ? "description-error" : undefined
                }
                disabled={isSubmitting}
              />
              {/* `justify-end`, not `justify-between`. The row used to pair the
                  counter with "The first line is used as the listing title in the
                  catalog."; with that hint gone, `justify-between` would park the
                  counter on the left. The title derivation still happens —
                  `deriveItemTitle` reads the first line — it just is not narrated. */}
              <div className="flex items-center justify-end">
                <span className="text-meta text-muted-foreground tabular-nums">
                  {description.length}/2000
                </span>
              </div>
              {descriptionError ? (
                <FieldError id="description-error" message={descriptionError} />
              ) : null}
            </div>

            {/* `grid-cols-1` below `sm` for the same reason as the outer grid: a
                bare grid's implicit `auto` column sizes to the Select triggers'
                min-content and overflows the clipped card on a phone. `minmax(0,
                1fr)` lets the single column shrink to the row's width. */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="game">Category</Label>
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
                    <SelectValue placeholder="Select a category" />
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

        {/* `max-md:hidden`, because below `md` the phone header carries the submit and
            a second one down here would be a duplicate — and two controls with the
            same accessible name break the strict locator in
            `tests/e2e/support/listings.ts`. From `md` the mobile chrome is
            `md:hidden`, so this footer is the only submit there is.
            
            NO CANCEL. It was an outline button paired with the submit; dismissal is
            the back chevron in the header on a phone and browser-back elsewhere, and
            a destructive-adjacent "Cancel" next to "Save changes" invited the misread
            that it discards rather than navigates. */}
        <CardFooter className="max-md:hidden flex-col items-stretch gap-2 border-t bg-card px-6 pb-4 pt-4 sm:flex-row sm:justify-end lg:col-start-2 lg:row-start-3 lg:border-l lg:border-border lg:px-7">
          <Button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
            className="w-full sm:w-auto"
          >
            {isSubmitting ? "Saving…" : submitLabel}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
