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
//  - In create mode, selected files are passed straight through as `File`
//    (a `Blob`) to `createItem`. In edit mode, previously stored image paths are
//    kept as plain `string`s and any newly added files are appended, matching
//    `UpdateItemInput.images: (string | ImageUpload)[]`.
//  - Field-level validation errors returned by the action (`field` + `message`)
//    are surfaced inline against the offending input and announced to assistive
//    tech via `role="alert"` + `aria-describedby`.
//  - On success the user is redirected to the item detail page `/listings/[id]`.

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageOff, ImagePlus, X } from "lucide-react";

import {
  createItem,
  updateItem,
  type ItemRow,
  type ImageUpload,
} from "@/lib/actions/listings";
import { itemImageUrl } from "@/lib/format";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Collectible categories offered in the catalog. */
const CATEGORIES = [
  "Trading Cards",
  "Coins",
  "Stamps",
  "Comics",
  "Memorabilia",
] as const;

/** Condition grades shown for a collectible, matching TCGplayer's standard scale. */
const CONDITIONS = [
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
  | "title"
  | "description"
  | "category"
  | "condition"
  | "fmvCents"
  | "images"
  | null;

export interface ItemFormProps {
  /** `create` renders an empty form; `edit` prefills from {@link item}. */
  mode: "create" | "edit";
  /** The existing item to edit; required when `mode === "edit"`. */
  item?: ItemRow;
}

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

  const [title, setTitle] = React.useState(item?.title ?? "");
  const [description, setDescription] = React.useState(item?.description ?? "");
  const [category, setCategory] = React.useState(item?.category ?? "");
  const [condition, setCondition] = React.useState(item?.condition ?? "");
  const [fmvDollars, setFmvDollars] = React.useState(
    item ? centsToDollars(item.fmv_cents) : "",
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

    setIsSubmitting(true);
    try {
      if (mode === "create") {
        const result = await createItem({
          title,
          description,
          category,
          condition,
          fmvCents,
          images: newFiles as unknown as ImageUpload[],
        });

        if (result.ok) {
          toast.success("Listing created");
          router.push(`/listings/${result.data.id}`);
          router.refresh();
          return;
        }
        surfaceActionError(result.error, result.field, result.message);
      } else {
        const images: (string | ImageUpload)[] = [
          ...keptPaths,
          ...(newFiles as unknown as ImageUpload[]),
        ];
        const result = await updateItem(item!.id, {
          title,
          description,
          category,
          condition,
          fmvCents,
          images,
        });

        if (result.ok) {
          toast.success("Listing updated");
          router.push(`/listings/${result.data.id}`);
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
    const fallback =
      message ??
      (code === "not-verified"
        ? "Identity verification must be completed first."
        : code === "seller-not-verified"
          ? "Complete verified payout setup before listing an item."
          : "We couldn't save your listing. Please try again.");
    setError({ field: null, message: fallback });
    toast.error(fallback);
  }

  const titleError = errorFor("title");
  const descriptionError = errorFor("description");
  const categoryError = errorFor("category");
  const conditionError = errorFor("condition");
  const fmvError = errorFor("fmvCents");
  const imagesError = errorFor("images");
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

  return (
    <Card className="mx-auto w-full max-w-7xl overflow-hidden lg:grid lg:min-h-[680px] lg:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.95fr)] lg:grid-rows-[auto_1fr_auto]">
      <CardHeader className="lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border/80 lg:px-7 lg:pb-5 lg:pt-7">
        <CardTitle className="text-xl">
          {mode === "create" ? "List an item" : "Edit listing"}
        </CardTitle>
        <CardDescription>
          Describe your collectible and set its price in Australian dollars.
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleSubmit} noValidate className="lg:contents">
        <CardContent className="grid gap-8 lg:contents">
          {/* Photos occupy the full-height left panel, keeping image entry
              visually distinct from the listing details rail. */}
          <div className="space-y-3 lg:col-start-1 lg:row-span-3 lg:row-start-1 lg:bg-muted/20 lg:p-8">
            <Label htmlFor="images">Photos</Label>
            <p className="text-sm text-muted-foreground">
              Add {IMAGES_MIN}–{IMAGES_MAX} photos. {totalImages} selected.
            </p>

            {/* Large cover preview / empty drop target. Clicking it opens the
                file picker, same affordance as the thumbnail grid below. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
              className="flex aspect-square w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border-2 border-dashed border-input bg-muted/40 text-muted-foreground transition-colors hover:border-ring hover:bg-muted/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              aria-describedby={imagesError ? "images-error" : undefined}
            >
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverUrl}
                  alt="Cover photo"
                  className="h-full w-full object-cover"
                />
              ) : (
                <>
                  <ImagePlus className="size-8" aria-hidden />
                  <span className="text-sm font-medium">Add photos</span>
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
                one can be removed individually. */}
            {totalImages > 0 ? (
              <ul className="grid grid-cols-4 gap-2">
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
                        className="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-foreground shadow-sm hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Remove image"
                      >
                        <X className="size-3.5" aria-hidden />
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
                      className="h-full w-full object-cover"
                      onLoad={(e) =>
                        URL.revokeObjectURL((e.target as HTMLImageElement).src)
                      }
                    />
                    <button
                      type="button"
                      onClick={() => removeNewFile(index)}
                      disabled={isSubmitting}
                      className="absolute right-1 top-1 rounded-full bg-background/80 p-1 text-foreground shadow-sm hover:bg-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </li>
                ))}
                {totalImages < IMAGES_MAX ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmitting}
                      className="flex aspect-square w-full items-center justify-center rounded-md border-2 border-dashed border-input text-muted-foreground transition-colors hover:border-ring hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Add another photo"
                    >
                      <ImagePlus className="size-5" aria-hidden />
                    </button>
                  </li>
                ) : null}
              </ul>
            ) : null}

            {imagesError ? (
              <p
                id="images-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {imagesError}
              </p>
            ) : null}
          </div>

          {/* Details form - a dedicated right-hand rail. */}
          <div className="space-y-5 lg:col-start-2 lg:row-start-2 lg:border-l lg:border-border/80 lg:px-7 lg:pb-7">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? "title-error" : undefined}
                disabled={isSubmitting}
              />
              {titleError ? (
                <p id="title-error" role="alert" className="text-sm text-destructive">
                  {titleError}
                </p>
              ) : null}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={5}
                aria-invalid={descriptionError ? true : undefined}
                aria-describedby={
                  descriptionError ? "description-error" : undefined
                }
                disabled={isSubmitting}
              />
              {descriptionError ? (
                <p
                  id="description-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {descriptionError}
                </p>
              ) : null}
            </div>

            {/* Category + Condition */}
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger
                    id="category"
                    aria-invalid={categoryError ? true : undefined}
                    aria-describedby={
                      categoryError ? "category-error" : undefined
                    }
                  >
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {categoryError ? (
                  <p
                    id="category-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {categoryError}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="condition">Condition</Label>
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
                  <p
                    id="condition-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {conditionError}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Price (dollars) */}
            <div className="space-y-2">
              <Label htmlFor="fmv">Price (AUD)</Label>
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                >
                  $
                </span>
                <Input
                  id="fmv"
                  name="fmv"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  className="pl-7"
                  value={fmvDollars}
                  onChange={(e) => setFmvDollars(e.target.value)}
                  aria-invalid={fmvError ? true : undefined}
                  aria-describedby={fmvError ? "fmv-error" : "fmv-hint"}
                  disabled={isSubmitting}
                />
              </div>
              {fmvError ? (
                <p id="fmv-error" role="alert" className="text-sm text-destructive">
                  {fmvError}
                </p>
              ) : (
                <p id="fmv-hint" className="text-sm text-muted-foreground">
                  Enter dollars and cents, e.g. 123.45.
                </p>
              )}
            </div>

            {generalError ? (
              <p role="alert" className="text-sm text-destructive">
                {generalError}
              </p>
            ) : null}
          </div>
        </CardContent>

        <CardFooter className="flex-col-reverse items-stretch gap-2 border-t bg-muted/20 px-6 pb-4 pt-4 sm:flex-row sm:justify-end lg:col-start-2 lg:row-start-3 lg:border-l lg:border-border/80 lg:px-7">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
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
              ? "Saving..."
              : mode === "create"
                ? "Create listing"
                : "Save changes"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
