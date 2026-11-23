"use client";

// components/listings/ItemForm.tsx
//
// Client form for creating and editing a collectible Item (Req 3.1, 3.2, 3.3,
// 3.4, 3.5, 3.7). It is used by both `/listings/new` (create) and
// `/listings/[id]/edit` (edit); the gates themselves are enforced by those pages and
// re-checked in the actions, so this component focuses on capturing + validating input
// and wiring to the listing Server Actions.
//
// THE DRAFT IS NOT A NICETY. `useState` survives a failed submit — nothing here remounts
// or redirects on `{ ok: false }` — but it does not survive the member LEAVING to resolve
// whatever the error complained about, because `beforeunload` never fires on a client-side
// navigation. The first real seller followed a gate error's own link, came back to an empty
// form, and repeated that five times. `useItemFormDraft` closes that loop for create mode;
// the photos are the one thing it cannot keep, and the restore notice says so.
//
// A FULL-SCREEN EDITOR, the deal composer's frame (`components/editor/`): the editor
// bar with its close, the form on the left with its actions in a footer under it, and
// from `lg` a canvas on the right with a live preview of the listing, as its catalog
// tile or its page, with no device frame (`ListingPreview`). The pages render it outside
// the workspace shell, so there is no rail and no hub bar.
//
// TWO STEPS, not one long scroll: 1 Your item (listing kind, photos, title,
// description), 2 Price & details (price, game, condition, place), which publishes. The
// rules for which field is on which step, and what each step needs before Next, live in
// `lib/listings/itemFormSteps.ts`. The open step is `useState`, visibility is `hidden`,
// so the server render and the first client render agree. Every field's state lives
// here and hidden steps stay mounted, so Back never loses input. Edit mode may jump to
// any step; create mode reaches no further than the first incomplete one. A server
// error naming a field opens that field's step.
//
// Key behaviours:
//  - Fair_Market_Value is entered in DOLLARS in the UI but converted to integer
//    AUD cents (`Math.round(dollars * 100)`) before calling the action, since
//    money is integer cents end-to-end.
//  - Image count is enforced client-side (1–10) on step 1 with a friendly message
//    before any upload work happens on the server (Req 3.3).
//  - Selected files are uploaded browser → Supabase Storage first
//    (`uploadItemImages`), and only the resulting object paths are sent to the
//    action. That keeps photo bytes out of the Server Action body, which Next
//    caps, and preserves the original file and its EXIF — except a photo too
//    large for the image optimizer, which is re-encoded so the catalog can
//    serve it resized (`fitOversizedForDisplay`). In edit mode the paths
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
import {
  ArrowLeft01Icon,
  LibraryIcon,
  PackageIcon,
} from '@hugeicons/core-free-icons';

import { createItem, updateItem, type CatalogSeller, type ItemRow } from "@/lib/actions/listings";
import { IMAGES_MAX, TITLE_MAX_LENGTH } from "@/domain/validation/item";
import {
  dollarsToCents,
  firstIncompleteStep,
  ITEM_FORM_STEP_LABELS,
  itemFormStepProblem,
  stepForField,
  type ItemFormErrorField,
  type ItemFormStep,
  type ItemFormStepInput,
} from "@/lib/listings/itemFormSteps";
import { Input } from "@/components/ui/input";
import type { ListingKind } from "@/domain/orchestrator/cashSaleOrchestrator";
import {
  clearItemFormDraft,
  hasItemFormDraft,
  useInitialItemFormDraft,
  useItemFormDraft,
} from "@/lib/listings/useItemFormDraft";
import { trackActionFailure, trackFormAbandoned, UX_NAMES } from "@/lib/analytics/track";
import { PlacePicker } from "@/components/location";
import type { PlaceValue } from "@/lib/location/types";
import { itemImageUrl } from "@/lib/format";
import { SaleTermsBreakdown } from "@/components/deals/DealTermsBreakdown";
import { CARD_GAMES, cardGameName, cardGameSlug } from "@/lib/catalog/cardGames";
import { ITEM_CONDITIONS, isItemCondition } from "@/lib/catalog/conditions";
import { deleteListingDraft, saveListingDraft } from "@/lib/actions/listingDrafts";
import type { ItemFormDraftFields } from "@/lib/listings/useItemFormDraft";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  ActionFooter,
  EDITOR_CANVAS_CLASS,
  EDITOR_GRID_HEIGHT_BARLESS,
  EditorPageHeader,
  EditorSteps,
  OptionCard,
  ScreenHeading,
} from "@/components/editor/EditorFrame";
import { PhotoGrid } from "@/components/trade/UnlistedItemFields";
import {
  ListingPreview,
  type ListingPreviewInput,
  type PreviewPhotos,
} from "@/components/listings/ListingPreview";

/** A publish submit this soon after the step changed is a stray second click. */
const STEP_SUBMIT_GUARD_MS = 400;
import {
  ITEM_FORM_ID,
  publishItemFormChrome,
} from "@/lib/listings/itemFormChrome";
import { uploadItemImages } from "@/lib/storage/uploadItemImages";
import type { ImageDim } from "@/lib/images/dimensions";
import { usePreviewFiles } from "@/lib/images/usePreviewFiles";
import { Button } from "@/components/ui/button";
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

/** Which server field a validation error maps to for inline display; `null` is general. */
type ErrorField = ItemFormErrorField | null;

/**
 * The element focused when an error lands on a field. `images` and `location` focus
 * the step heading instead: the picker is a hidden file input, and the place search
 * reports its own error beside itself.
 */
const FIELD_FOCUS_ID: Record<ItemFormErrorField, string> = {
  title: "title",
  description: "description",
  category: "game",
  condition: "condition",
  grader: "grader",
  grade: "grade",
  certNumber: "cert",
  fmvCents: "fmv",
  images: "heading",
  location: "heading",
};

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
  /**
   * Create mode: where this seller's most recent listing is based, read server-side.
   * Prefills "Based near" so a seller who always trades from the same suburb does not
   * search for it on every listing. Lowest priority — a restored draft's place wins.
   */
  defaultLocation?: PlaceValue | null;
  /**
   * Create mode: a saved draft (0131) to open, from `/listings/new?draft=`. Takes the
   * place of the session draft, which is the unsaved scratch copy.
   */
  serverDraft?: { id: string; fields: ItemFormDraftFields } | null;
  /**
   * The currency the price is quoted in: the listing's own when editing, else the
   * seller's trading region's, which is what `set_row_currency_from_region` gives
   * the new row (0068). Defaults to AUD.
   */
  currency?: string;
  /** The seller as buyers see them, for the preview's seller line. */
  previewSeller?: CatalogSeller | null;
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
    hint: "A card or sealed product",
  },
  {
    value: "SHOPFRONT" as const,
    icon: LibraryIcon,
    label: "Multiple items",
    hint: "Buyers pick cards. Nothing is held",
  },
];


/** Format integer AUD cents back to a plain dollars string for the input. */
function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** No-op subscription: the value below only changes once, at hydration. */
function subscribeNever(): () => void {
  return () => {};
}

/**
 * The listing form, with the create-mode draft restored WITHOUT a hydration mismatch.
 *
 * `useInitialItemFormDraft` reads sessionStorage, which the server cannot see. Reading it
 * during the hydration render made the browser's first render (restored form plus the
 * "We kept what you had typed" notice) disagree with the server's HTML (empty form), and
 * React threw the server tree away and re-rendered the whole form on the client.
 *
 * So the hydration render is the empty form the server sent, and the draft is consulted
 * only once hydration is done. When one exists, the inner form remounts ONCE under a new
 * key and seeds itself from it, which is the effect-free restore the hook was written for.
 * A member with no draft — nearly everyone — gets no remount. On a client navigation
 * `hydrated` is already true on the first render, so the draft is read immediately and
 * nothing remounts at all.
 *
 * The decision is captured in a ref so it is made exactly once: the form writes its own
 * draft as the member types, and re-deciding later would remount the form under them.
 */
export function ItemForm(props: ItemFormProps) {
  const hydrated = React.useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const restoreDecision = React.useRef<boolean | null>(null);
  if (hydrated && restoreDecision.current === null) {
    restoreDecision.current = props.mode === "create" && !props.serverDraft && hasItemFormDraft();
  }
  const restoreDraft = restoreDecision.current === true;

  return (
    <ItemFormInner
      key={props.serverDraft ? `draft-${props.serverDraft.id}` : restoreDraft ? "restored" : "fresh"}
      {...props}
      restoreDraft={restoreDraft}
      draftDecided={restoreDecision.current !== null}
    />
  );
}

function ItemFormInner({
  mode,
  item,
  defaultLocation = null,
  serverDraft = null,
  currency: currencyProp,
  previewSeller = null,
  restoreDraft,
  draftDecided,
}: ItemFormProps & { restoreDraft: boolean; draftDecided: boolean }) {
  const router = useRouter();
  const currency = item?.currency ?? currencyProp ?? "aud";
  const [confirmingClose, setConfirmingClose] = React.useState(false);

  // CREATE ONLY. An edit form is backed by a row, so a stored draft would raise a
  // "which is newer" conflict with no safe default — see `useItemFormDraft`.
  const draftEnabled = mode === "create";
  const sessionRestored = useInitialItemFormDraft(draftEnabled && restoreDraft);
  const restored = serverDraft?.fields ?? sessionRestored;
  // The saved draft this form is editing, once it has one (0131).
  const [draftId, setDraftId] = React.useState<string | null>(serverDraft?.id ?? null);
  const [savingDraft, startSavingDraft] = React.useTransition();

  // EVERY INITIALISER PREFERS THE ROW, THEN THE DRAFT, THEN EMPTY. The row can only be
  // present in edit mode and the draft only in create mode, so the two never compete; the
  // order is written out anyway so adding a third source later has an obvious place to go.
  const [title, setTitle] = React.useState(
    item?.title ?? restored?.title ?? "",
  );
  const [description, setDescription] = React.useState(
    item?.description ?? restored?.description ?? "",
  );
  const [game, setGame] = React.useState(() =>
    item ? cardGameSlug(item.category) : (restored?.game ?? ''),
  );
  // A stored grade that has since left the scale starts EMPTY rather than prefilled: the
  // Select cannot display a value it has no option for, so it would sit blank while still
  // holding one, and the seller could not see what they were about to save.
  const [condition, setCondition] = React.useState<string>(() => {
    const stored = item?.condition ?? restored?.condition ?? "";
    return isItemCondition(stored) ? stored : "";
  });
  // Slab details (0129), used only while the condition is Graded on a single listing.
  const [grader] = React.useState(() => item?.grader ?? restored?.grader ?? "");
  const [grade] = React.useState(() => item?.grade ?? restored?.grade ?? "");
  const [certNumber] = React.useState(
    () => item?.cert_number ?? restored?.certNumber ?? "",
  );
  // Immutable after creation: contracts already open against a shopfront depend
  // on it not being reserved, and a single listing's live contract depends on the
  // opposite. Switching either way mid-flight would break one of them.
  const [listingKind, setListingKind] = React.useState<ListingKind>(
    item?.listing_kind ?? ((restored?.listingKind as ListingKind | undefined) ?? "SINGLE"),
  );
  const isShopfront = listingKind === "SHOPFRONT";
  const [fmvDollars, setFmvDollars] = React.useState(
    item ? centsToDollars(item.fmv_cents) : (restored?.fmvDollars ?? ""),
  );
  const [location, setLocation] = React.useState<PlaceValue | null>(() =>
    item
      ? placeFromItem(item)
      : ((restored?.location as PlaceValue | null) ?? defaultLocation),
  );
  // Still showing the prefilled place, untouched. Drives the "from your last listing"
  // hint, and keeps the prefill out of the session draft (below).
  const locationIsDefault =
    mode === "create" &&
    defaultLocation != null &&
    location?.placeId === defaultLocation.placeId;

  // Edit mode: existing stored object paths the user chooses to keep.
  const [keptPaths, setKeptPaths] = React.useState<string[]>(
    mode === "edit" ? (item?.image_paths ?? []) : [],
  );
  // Newly selected files (create: all images; edit: additions), each with the ONE
  // preview URL it owns. This was a bare `File[]` with `URL.createObjectURL(file)`
  // called in render for the cover and every thumbnail, so each keystroke in the
  // description re-decoded every photo — the typing lag. See `usePreviewFiles`.
  const pending = usePreviewFiles();
  const newFiles = pending.items;

  const [error, setError] = React.useState<{
    field: ErrorField;
    message: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // THE OPEN STEP. Every field's state lives above, in this component, and the hidden
  // steps stay MOUNTED, so Back, Next and a jump from the indicator never lose input.
  const [step, setStep] = React.useState<ItemFormStep>(1);
  const stepHeadingRef = React.useRef<HTMLHeadingElement>(null);
  // What to focus once the step (or error) the last action set has rendered: an
  // element id, or the step heading. Consumed by the effect below; null on first
  // mount, so arriving at the form does not steal focus.
  const pendingFocus = React.useRef<string | null>(null);
  React.useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    const element =
      target === "heading"
        ? null
        : document.getElementById(target) ??
          null;
    (element ?? stepHeadingRef.current)?.focus();
  }, [step, error]);

  /** The submit control's resting label, shared by the footer and the phone header. */
  const submitLabel = mode === "create" ? "Create listing" : "Save changes";
  /** The primary control's label on the open step: Next until the last one. */
  const primaryLabel = step === 2 ? submitLabel : "Next";

  // BOTH MODES PUBLISH NOW. This was `if (mode !== "create") return`, so the phone
  // header could only ever offer Create — an edit had its submit at the bottom of a
  // long scrolling form with a Cancel above it. It reads "Next" before the last step,
  // because the header button submits this form and submitting advances it until then.
  React.useEffect(() => {
    publishItemFormChrome({ submitting: isSubmitting, label: primaryLabel });
    return () => publishItemFormChrome(null);
  }, [isSubmitting, primaryLabel]);

  // A BOOLEAN DEPENDENCY, not the field values. Keyed on `description` itself this
  // effect unsubscribed and resubscribed the `beforeunload` listener on every
  // keystroke; the dirty flag only changes when the form goes from empty to touched
  // (or back), which is the only time the listener needs to change.
  const isDirty =
    title.trim() !== "" ||
    description.trim() !== "" ||
    newFiles.length > 0 ||
    fmvDollars.trim() !== "";
  // WHETHER CLOSING LOSES ANYTHING, for the editor bar's close. Create: any input at
  // all. Edit: the row always has a title, so it is a change from what was loaded.
  const editSnapshot = JSON.stringify({
    title,
    description,
    game,
    condition,
    fmvDollars,
    place: location?.placeId ?? null,
    kept: keptPaths,
    added: newFiles.length,
  });
  const [loadedSnapshot] = React.useState(editSnapshot);
  const hasWork =
    mode === "create"
      ? isDirty || game !== "" || condition !== "" || keptPaths.length > 0
      : editSnapshot !== loadedSnapshot;
  React.useEffect(() => {
    if (!isDirty || isSubmitting) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty, isSubmitting]);

  // KEEPS THE TEXT ACROSS AN IN-APP NAVIGATION, which `beforeunload` above cannot: that
  // handler covers a reload or a closed tab and never fires on a client-side route change.
  // Following a gate error's own link to the verification tab is a client-side route
  // change, so before this the remedy for the error destroyed the work.
  //
  // Disabled while submitting so a successful create does not re-write a draft on its way
  // out; `clearItemFormDraft()` on success is what actually retires it.
  useItemFormDraft(
    {
      title,
      description,
      game,
      condition,
      listingKind,
      fmvDollars,
      grader,
      grade,
      certNumber,
      // THE PREFILL IS NOT INPUT. Counted as a draft, a seller who opened the form and
      // left would come back to "We kept what you had typed" over a form they never
      // typed in. It comes back from the server on the next visit anyway.
      location: locationIsDefault ? null : location,
    },
    // `draftDecided`: never write before the restore decision is made, or the empty
    // hydration render would CLEAR the stored draft before it could be restored.
    draftEnabled && draftDecided && !isSubmitting,
  );

  // RECORDS LEAVING A FORM WITH UNSAVED INPUT (0121). On its own an abandonment is
  // ordinary; an abandonment moments after an ACTION_FAILURE or GATE_BLOCKED on the same
  // session is a member who was pushed out by an error they could not resolve, which is the
  // pattern the first seller reported and the one no existing log could show.
  //
  // In an unmount cleanup rather than a navigation handler because there is no App Router
  // navigation event, and the ref keeps the check honest: reading `isDirty` and
  // `isSubmitting` directly in the cleanup would close over their values from whichever
  // render last re-subscribed the effect.
  const abandonState = React.useRef({ isDirty: false, isSubmitting: false });
  // Mirrored in an effect rather than assigned during render. A ref write in the render body
  // is a side effect, and under a double-invoked or abandoned render it can record state
  // from a render that never committed.
  React.useEffect(() => {
    abandonState.current = { isDirty, isSubmitting };
  }, [isDirty, isSubmitting]);
  React.useEffect(() => {
    const path = window.location.pathname;
    return () => {
      const { isDirty: dirty, isSubmitting: submitting } = abandonState.current;
      // A submit in flight is not an abandonment — it is the opposite, and the success path
      // unmounts this component by navigating to the new listing.
      if (dirty && !submitting) {
        trackFormAbandoned(UX_NAMES.itemForm, path);
      }
    };
  }, []);

  const totalImages = keptPaths.length + newFiles.length;

  // What the step checks read. The same rules gate Next and re-run on publish.
  const stepInput: ItemFormStepInput = {
    listingKind,
    description,
    game,
    condition,
    grader,
    grade,
    certNumber,
    totalImages,
    fmvDollars,
    locationLabel: location?.label ?? null,
  };
  // EDIT reaches every step: the listing already exists, so every step has its data.
  // CREATE reaches up to the first incomplete step, never past it.
  const reachableUpTo: ItemFormStep =
    mode === "edit" ? 2 : (firstIncompleteStep(stepInput) ?? 2);

  // WHEN THE OPEN STEP LAST CHANGED. A publish submit inside `STEP_SUBMIT_GUARD_MS` of
  // it is ignored: Next and publish sit in the same spot, so the second click of a fast
  // double-click on step 1's Next would otherwise land on step 2's publish and save a
  // listing the seller never saw. The phone header's button submits this form too and
  // is caught by the same check.
  const stepChangedAt = React.useRef(0);
  function openStep(n: ItemFormStep) {
    stepChangedAt.current = Date.now();
    setStep(n);
  }

  /** Open step `n` and move focus to its heading. A user-initiated change. */
  function goToStep(n: ItemFormStep) {
    // The open step is a no-op: setting a focus request with no re-render would leave
    // it pending for whichever unrelated update next runs the focus effect.
    if (n === step) return;
    setError(null);
    pendingFocus.current = "heading";
    openStep(n);
  }

  /**
   * Report an error inline beside its field, opening the step that holds the field
   * and focusing it. A general error (`field: null`) stays on the open step.
   */
  function failAt(problem: { field: ErrorField; message: string }) {
    setError(problem);
    if (!problem.field) return;
    const target = stepForField(problem.field);
    if (target === null) return;
    if (target !== step) openStep(target);
    pendingFocus.current = FIELD_FOCUS_ID[problem.field];
  }

  /** Next: check the open step, then move on, or show what it still needs. */
  function goNext() {
    const problem = itemFormStepProblem(step, stepInput);
    if (problem) {
      failAt(problem);
      return;
    }
    goToStep((step + 1) as ItemFormStep);
  }

  function errorFor(field: Exclude<ErrorField, null>): string | undefined {
    return error?.field === field ? error.message : undefined;
  }

  function removeKeptPath(path: string) {
    setKeptPaths((prev) => prev.filter((p) => p !== path));
  }

  /**
   * SAVE DRAFT, ON PURPOSE. The session copy survives a reload but not a closed tab,
   * and never showed up anywhere; a saved draft is a row under My listings to come back
   * to. Photos are not kept — see 0131 — and the button says so.
   */
  function saveDraft() {
    startSavingDraft(async () => {
      const result = await saveListingDraft(draftId, {
        title,
        description,
        game,
        condition,
        listingKind,
        fmvDollars,
        grader,
        grade,
        certNumber,
        location: locationIsDefault ? null : location,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setDraftId(result.data.id);
      clearItemFormDraft();
      toast.success("Draft saved. Photos are added when you publish.", {
        action: { label: "My drafts", onClick: () => router.push("/listings/mine?show=drafts") },
      });
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // ONE SUBMIT, TWO MEANINGS. The footer button and the phone header both submit
    // this form (Enter in a field does too); before the last step that is Next.
    if (step < 2) {
      goNext();
      return;
    }
    // Only a deliberate publish from a step 2 the seller has had time to see.
    if (Date.now() - stepChangedAt.current < STEP_SUBMIT_GUARD_MS) return;

    // Publishing re-checks every step, in order, because an edit can jump straight
    // here past steps it never opened. The first failure opens its own step. These are
    // the form's client-side guards (Req 3.2 price parse, Req 3.3 image count), grouped
    // by step in `itemFormSteps`.
    for (const s of [1, 2] as const) {
      const problem = itemFormStepProblem(s, stepInput);
      if (problem) {
        failAt(problem);
        return;
      }
    }
    // Both guaranteed by step 2's check above.
    const fmvCents = dollarsToCents(fmvDollars)!;
    if (!location) return;

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
        const uploaded = await uploadItemImages(pending.files, {
          fitOversizedForDisplay: true,
        });
        if (!uploaded.ok) {
          failAt({ field: "images", message: uploaded.message });
          setIsSubmitting(false);
          return;
        }
        uploadedPaths = uploaded.paths;
        uploadedDims = uploaded.dims;
      }

      if (mode === "create") {
        const result = await createItem({
          title,
          description,
          category: cardGameName(game),
          condition,
          grading: isShopfront || !grader ? undefined : { grader, grade, certNumber },
          fmvCents,
          images: uploadedPaths,
          imageDims: uploadedDims,
          location: locationPayload,
          listingKind,
        });

        if (result.ok) {
          // The listing exists now, so the draft is spent. Cleared BEFORE navigating: the
          // unmount that follows must not leave a stored copy of a listing that was
          // published, or the next visit to this form restores work already done.
          clearItemFormDraft();
          // Published, so the saved draft it came from is spent too.
          if (draftId) void deleteListingDraft(draftId);
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
          title,
          description,
          category: cardGameName(game),
          condition,
          grading: isShopfront || !grader ? undefined : { grader, grade, certNumber },
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
    // RECORDS THE CODE, NEVER THE MESSAGE (0121). `code` is a machine slug from
    // `ListingActionError`; `message` is prose and would be refused by the event
    // validator anyway. Fire-and-forget — it cannot fail and is not awaited.
    trackActionFailure(
      mode === "create" ? UX_NAMES.createItem : UX_NAMES.updateItem,
      code,
      window.location.pathname,
    );

    // OPENS THE STEP THAT HOLDS THE FIELD, so the error is beside the field it names
    // rather than on a step the seller is not looking at. A field the form does not
    // render (a schema's `(root)`) is shown as a general error instead of nowhere.
    if (code === "validation-error" && field) {
      failAt({
        field: stepForField(field) ? (field as ItemFormErrorField) : null,
        message: message ?? "Please correct the highlighted field.",
      });
      return;
    }

    // BOTH GATE REFUSALS GET A DESTINATION, not just a sentence.
    //
    // This branch used to be absent, with a comment asserting that listing "has no
    // verification gate" so `not-verified` / `seller-not-verified` were unreachable. They
    // were reachable — `createItem` returned both — so they fell through to the generic
    // fallback: a toast with no link, saying "complete your seller profile", naming a tab
    // that does not exist. The first seller to hit it re-entered this form five times
    // hunting for the screen it meant.
    //
    // The page-level gate in `/listings/new` now catches both before the form renders, so
    // reaching here means the member's state changed mid-session — they opened the form,
    // and something (a failed identity check, a withdrawn account) moved underneath them.
    // Rare, and precisely when a dead end is least forgivable, because the form is full.
    if (code === "not-verified" || code === "seller-not-verified") {
      const gateMessage =
        message ?? "You can't publish a listing yet. Check your verification status.";
      setError({ field: null, message: gateMessage });
      toast.error(gateMessage, {
        // Keeps the typed form mounted — the member leaves only if they choose to, and the
        // draft is restored by `useItemFormDraft` if they do.
        action: {
          label: "Open verification",
          onClick: () => {
            navigateWithType(router, "/profile?tab=verification", "nav-forward");
          },
        },
        duration: 12_000,
      });
      return;
    }

    const fallback = message ?? "We couldn't save your listing. Please try again.";
    setError({ field: null, message: fallback });
    toast.error(fallback);
  }

  const titleError = errorFor("title");
  const descriptionError = errorFor("description");
  const gameError = errorFor("category");
  const conditionError = errorFor("condition");
  const fmvError = errorFor("fmvCents");
  const imagesError = errorFor("images");
  const locationError = errorFor("location");
  const generalError = error && error.field === null ? error.message : undefined;

  // The photos in the order shown: the ones already on the listing, then the ones
  // just picked. The first is the cover. The preview URL is each file's own stable
  // one, never minted here, where it would change on every render and make the
  // browser decode every photo again.
  const photos = [
    ...keptPaths.map((path) => ({
      key: path,
      src: itemImageUrl(path),
      remove: () => removeKeptPath(path),
    })),
    ...newFiles.map(({ key, url }) => ({
      key,
      src: url as string | null,
      remove: () => pending.remove(key),
    })),
  ];
  const coverUrl = photos[0]?.src ?? null;

  function addPhotos(picked: File[]) {
    const room = IMAGES_MAX - totalImages;
    if (room <= 0 || picked.length === 0) return;
    pending.add(picked.slice(0, room));
    setError(null);
  }

  /**
   * Move a photo within the order shown. Kept photos are saved ahead of new ones (see
   * `handleSubmit`), so a move applies within whichever of the two lists it falls
   * in; a move across them is not one the save can store, and is ignored.
   */
  function movePhoto(from: number, to: number) {
    const kept = keptPaths.length;
    if (from < kept !== to < kept) return;
    if (from < kept) {
      setKeptPaths((prev) => {
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    } else {
      pending.move(from - kept, to - kept);
    }
  }

  /** Close: back where they came from. Asks first if there is work to lose. */
  function requestClose() {
    if (hasWork) {
      setConfirmingClose(true);
      return;
    }
    leave();
  }

  function leave() {
    // Discarding is deliberate, so the session copy goes too. A saved draft stays
    // under My listings: it was saved on purpose.
    if (mode === "create") clearItemFormDraft();
    if (window.history.length > 1) {
      router.back();
      return;
    }
    navigateWithType(
      router,
      mode === "edit" && item ? `/listings/${item.id}` : "/listings/mine",
      "nav-back",
    );
  }

  const preview: ListingPreviewInput = {
    title,
    description,
    priceCents: dollarsToCents(fmvDollars),
    currency,
    category: game ? cardGameName(game) : null,
    condition,
    isShopfront,
    locationLabel: location?.label ?? null,
    coverSrc: coverUrl,
    photoCount: totalImages,
    createdAt: item?.created_at ?? null,
    seller: previewSeller,
  };

  // The same photos and actions as the form's grid, so the canvas can work on them in
  // place (browse, reorder, make cover, remove, add) and the two always agree.
  const previewPhotos: PreviewPhotos = {
    items: photos,
    canAdd: totalImages < IMAGES_MAX,
    onAdd: addPhotos,
    onRemove: (index) => photos[index]?.remove(),
    onMove: movePhoto,
    // `movePhoto` ignores a move across saved and new photos (saved ones are stored
    // first), so the preview offers only the moves it will keep.
    canMove: (from, to) =>
      from !== to && from < keptPaths.length === to < keptPaths.length,
    disabled: isSubmitting,
  };

  const footerNote = generalError
    ? generalError
    : step === 2
      ? mode === "create"
        ? "It goes live in the catalog as soon as you publish."
        : "Saved changes show on the listing straight away."
      : null;

  const heading = mode === "create" ? "Sell an item" : "Edit listing";

  return (
    <div className="flex flex-1 flex-col">
      {/* NO EDITOR BAR. It held a close button beside "Sell an item", a name the step
          tabs and the site header's Sell already make plain, and it cost the one-screen
          editor 56px of height. Closing is Cancel in the footer now (Etsy's listing
          editor), and on a phone the site's back strip, as before. */}

      {/* FROM `lg` THE EDITOR IS EXACTLY ONE SCREEN, as `/deals` is: the form column
          scrolls inside itself if a step outgrows it, and the preview centres in the
          canvas beside it. Below `lg` there is no canvas and the page scrolls. */}
      <div
        className={cn(
          "grid flex-1 lg:flex-none lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]",
          EDITOR_GRID_HEIGHT_BARLESS,
        )}
      >
        <form
          // Unconditional: the phone header submits this form in both modes, and
          // `form=` needs the id to exist.
          id={ITEM_FORM_ID}
          onSubmit={handleSubmit}
          noValidate
          className="flex min-w-0 flex-col lg:min-h-0"
        >
          {/* THE ONLY SCROLLING REGION from `lg`, and so the clipping ancestor
              `PlaceSearch` measures for `Based near`, the last field on step 2: it
              opens its suggestions upwards when there is no room below. Do not assume
              a popover in this pane can grow downwards. Below `lg` the page scrolls and
              the viewport is the bound. */}
          <div className="min-w-0 flex-1 px-4 pb-section pt-group sm:px-6 md:px-8 md:pt-section lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:px-10 lg:pb-8 lg:pt-8">
            <div className="mx-auto w-full max-w-xl space-y-5">
              {/* The page's `<h1>` and line, with the editor's close beside the title,
                  as `/deals` has it (`EditorPageHeader`). From `md`; below it the phone
                  header names the page and the site's back strip closes, so it stays
                  for the outline only. The close asks before discarding work
                  (`requestClose`). The column's `space-y-5` spaces it from the tabs. */}
              <EditorPageHeader
                title={heading}
                description={
                  mode === "create"
                    ? "List one card, or multiple items buyers can pick from."
                    : "Update the photos, price and details."
                }
                onClose={requestClose}
                closeLabel={mode === "create" ? "Close" : "Close without saving"}
                className="sr-only md:not-sr-only"
              />

              <EditorSteps
                steps={ITEM_FORM_STEP_LABELS.map((label, index) => {
                  const n = (index + 1) as ItemFormStep;
                  return {
                    label,
                    done: n < step,
                    enabled: !isSubmitting && (n <= reachableUpTo || n < step),
                  };
                })}
                current={step - 1}
                onSelect={(index) => goToStep((index + 1) as ItemFormStep)}
                disabled={isSubmitting}
              />

              <ScreenHeading
                headingRef={stepHeadingRef}
                title={ITEM_FORM_STEP_LABELS[step - 1]}
                description={
                  step === 1
                    ? "Photos first, then what it is."
                    : isShopfront
                      ? "A typical price, the game, and where you trade from."
                      : "What you want for it, the game, and where you trade from."
                }
              />

              {/* STEP 1: what it is. Hidden steps stay mounted (`hidden`), so their state,
                  and `PlacePicker`'s typed query, survive every step change. */}
              <div hidden={step !== 1} className="space-y-group">
                {/* Listing kind (0064). First, because it changes what the rest of the
                    form means: for a binder the price is only a guide and the condition
                    covers a mixed pile. Locked in edit mode. */}
                <fieldset disabled={mode === "edit" || isSubmitting} className="space-y-snug">
                  <legend className="sr-only">What are you listing?</legend>
                  <div role="radiogroup" aria-label="Listing kind" className="grid gap-cozy sm:grid-cols-2">
                    {LISTING_KINDS.map((kind) => (
                      <OptionCard
                        key={kind.value}
                        id={`listing-kind-${kind.value}`}
                        name="listingKind"
                        checked={listingKind === kind.value}
                        onSelect={() => setListingKind(kind.value)}
                        icon={kind.icon}
                        label={kind.label}
                        hint={kind.hint}
                        disabled={mode === "edit" && listingKind !== kind.value}
                      />
                    ))}
                  </div>
                  {/* NO "nothing is reserved" NOTE beyond the binder card's own line. The
                      seller gets the rest where it is actionable: on their own listing,
                      the shopfront branch of `ItemActions` lists the open contracts so
                      they don't promise the same card twice. The buyer-facing half is
                      separate (`BuyButton`: "Nothing is held for you yet"). */}
                  {mode === "edit" ? (
                    <p className="text-meta text-muted-foreground">
                      This can&apos;t be changed after a listing is created.
                    </p>
                  ) : null}
                </fieldset>

                {/* THE PHOTO GRID THE DEAL COMPOSER USES: Add first, six to a row, drag
                    to reorder, "Make cover", and the same height with none or ten, so
                    nothing under it moves when a photo is added. */}
                <div className="space-y-snug">
                  <PhotoGrid
                    labelId="images-label"
                    inputId="images"
                    count={totalImages}
                    atCap={totalImages >= IMAGES_MAX}
                    max={IMAGES_MAX}
                    photos={photos}
                    onAdd={addPhotos}
                    onMove={movePhoto}
                    disabled={isSubmitting}
                    describedBy={imagesError ? "images-error" : undefined}
                  />
                  {imagesError ? <FieldError id="images-error" message={imagesError} /> : null}
                </div>

                {/* Title, its own field: a label for contracts and emails, and the line
                    on the tile. A blank title falls back to the description's first
                    sentence (`deriveItemTitle`). */}
                <div className="space-y-snug">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    name="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    maxLength={TITLE_MAX_LENGTH}
                    placeholder="e.g. Charizard ex 199/165, PSA 10"
                    autoComplete="off"
                    spellCheck={false}
                    aria-invalid={titleError ? true : undefined}
                    aria-describedby={titleError ? "title-error" : undefined}
                    disabled={isSubmitting}
                  />
                  {titleError ? <FieldError id="title-error" message={titleError} /> : null}
                </div>

                <div className="space-y-snug">
                  <Label htmlFor="description">Description</Label>
                  {/* GROWS WITH WHAT IS TYPED. A fixed four lines (112px) held about 300
                      of the 2,000 characters allowed, so a seller describing wear
                      corner by corner typed into a box that scrolled. Six lines to
                      start, then it grows to about fourteen and only then scrolls
                      (`field-sizing: content`; where that is unsupported, `rows`
                      gives the six-line box and the corner handle resizes it). */}
                  <Textarea
                    id="description"
                    name="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={2000}
                    rows={6}
                    placeholder="Set and number, edition, and anything a buyer should know: whitening, scratches, centring."
                    className="min-h-36 max-h-80 resize-y [field-sizing:content]"
                    aria-invalid={descriptionError ? true : undefined}
                    aria-describedby={descriptionError ? "description-error" : undefined}
                    disabled={isSubmitting}
                  />
                  {descriptionError ? (
                    <FieldError id="description-error" message={descriptionError} />
                  ) : description.length > 1800 ? (
                    // Only near the ceiling, where it is information rather than noise.
                    <p className="text-right text-meta tabular-nums text-muted-foreground">
                      {2000 - description.length} characters left
                    </p>
                  ) : null}
                </div>
              </div>

              {/* STEP 2: the price, the game and condition, and the place, then publish.
                  No "Is it graded?" question: Graded is one entry in the condition list. */}
              <div hidden={step !== 2} className="space-y-group">
                {/* For a binder the price is INDICATIVE only: each contract's real total
                    is the sum of the cards that buyer asks for, so the label must not
                    promise a purchase price. */}
                {/* THE PRICE IS THE POINT OF THIS STEP, so it is the deal composer's
                    large field (`MoneyInput size="lg"`) with the same breakdown under
                    it: what buyers pay, the service fee, and what the seller receives.
                    `holdHeight` draws the rows with "—" until a price is typed, so the
                    fields below do not move on the first digit. A listing with
                    multiple items keeps its one-line hint: its price is only a guide,
                    so there is no total to break down. */}
                <div className="space-y-snug">
                  <Label htmlFor="fmv">{isShopfront ? "Typical price" : "Price"}</Label>
                  <MoneyInput
                    id="fmv"
                    name="fmv"
                    size="lg"
                    min="0.01"
                    value={fmvDollars}
                    onChange={(e) => setFmvDollars(e.target.value)}
                    aria-invalid={fmvError ? true : undefined}
                    aria-describedby={fmvError ? "fmv-error" : isShopfront ? "fmv-hint" : undefined}
                    disabled={isSubmitting}
                  />
                  <FieldError id="fmv-error" message={fmvError} />
                  {isShopfront ? (
                    <p id="fmv-hint" className="text-meta text-muted-foreground">
                      Prices are only a guide until terms are agreed.
                    </p>
                  ) : (
                    <div aria-live="polite">
                      <SaleTermsBreakdown
                        priceCents={dollarsToCents(fmvDollars)}
                        currency={currency}
                        payerLabel="Buyers pay"
                        holdHeight
                      />
                    </div>
                  )}
                </div>

                {/* `grid-cols-1` below `sm`: a bare grid's implicit `auto` column sizes
                    to the Select triggers' min-content and overflows on a phone. */}
                <div className="grid grid-cols-1 gap-cozy sm:grid-cols-2">
                  <div className="space-y-snug">
                    <Label htmlFor="game">Game</Label>
                    <Select value={game} onValueChange={setGame} disabled={isSubmitting}>
                      <SelectTrigger
                        id="game"
                        aria-invalid={gameError ? true : undefined}
                        aria-describedby={gameError ? "game-error" : undefined}
                      >
                        <SelectValue placeholder="Choose" />
                      </SelectTrigger>
                      <SelectContent>
                        {CARD_GAMES.map((option) => (
                          <SelectItem key={option.slug} value={option.slug}>
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {gameError ? <FieldError id="game-error" message={gameError} /> : null}
                  </div>

                  <div className="space-y-snug">
                    <Label htmlFor="condition">
                      {isShopfront ? "Typical condition" : "Condition"}
                    </Label>
                    <Select value={condition} onValueChange={(v) => setCondition(v)} disabled={isSubmitting}>
                      <SelectTrigger
                        id="condition"
                        aria-invalid={conditionError ? true : undefined}
                        aria-describedby={conditionError ? "condition-error" : undefined}
                      >
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
                    {conditionError ? (
                      <FieldError id="condition-error" message={conditionError} />
                    ) : null}
                  </div>
                </div>

                <PlacePicker
                  label="Based near"
                  precision="suburb"
                  value={location}
                  onChange={setLocation}
                  disabled={isSubmitting}
                  required
                  error={locationError}
                  locate
                />

                {/* Below `lg` there is no canvas beside the form, so the tile ends the
                    last step, without a device frame: the reader is already on one. */}
                <div className="space-y-cozy border-t border-border pt-5 lg:hidden">
                  <h3 className="text-subhead font-semibold text-foreground">
                    How buyers see it
                  </h3>
                  <ListingPreview input={preview} frame="none" />
                </div>
              </div>
            </div>
          </div>

          {/* THE FOOTER, under the form as on `/deals`: what to know on the left, the
              actions on the right. Not sticky on a phone, where the header carries the
              primary and a pinned bar would sit over the place suggestions; in edit
              mode it holds nothing on step 1 there, so it goes.

              The primary is `max-md:hidden`, because below `md` the phone header
              carries it and a second one would be a duplicate: two controls with the
              same accessible name break the strict locator in
              `tests/e2e/support/listings.ts`. NO CANCEL: closing is the close at the
              end of the step tabs, and the phone header's back. */}
          <ActionFooter
            note={footerNote}
            error={Boolean(generalError)}
            className={cn("max-md:static", mode === "edit" && step === 1 && "max-md:hidden")}
          >
            {mode === "create" ? (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={saveDraft}
                disabled={isSubmitting || savingDraft}
                aria-busy={savingDraft}
                className="min-w-0 flex-1 sm:flex-none"
              >
                {draftId ? "Update draft" : "Save draft"}
              </Button>
            ) : null}
            {step === 2 ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => goToStep(1)}
                disabled={isSubmitting}
                className="min-w-0 flex-1 sm:flex-none"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} aria-hidden />
                Back
              </Button>
            ) : null}
            {/* TWO ELEMENTS, NOT ONE RELABELLED. Next is a plain button and publish is
                the submit, keyed apart so React swaps the node rather than retyping it;
                with `handleSubmit`'s step-change window this keeps the second click of a
                double-click on Next from publishing. */}
            <Button
              key={step === 2 ? "publish" : "next"}
              type={step === 2 ? "submit" : "button"}
              size="lg"
              onClick={step === 2 ? undefined : goNext}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="max-md:hidden sm:min-w-36"
            >
              {/* WIDTH PINNED TO THE RESTING LABEL: the submit label sits `invisible`
                  in the box and the live label is laid over it, so "Saving…" does not
                  shrink the button under the pointer and Next is the same width. */}
              <span className="grid">
                <span className="invisible col-start-1 row-start-1">{submitLabel}</span>
                <span className="col-start-1 row-start-1">
                  {isSubmitting ? "Saving…" : primaryLabel}
                </span>
              </span>
            </Button>
          </ActionFooter>
        </form>

        {/* THE CANVAS: the listing page as a buyer on a computer sees it, with its
            photos live (`ListingPreview`). One view: the catalog tile it used to toggle
            to was the cover cropped square beside the title and price, which the page
            already shows. */}
        <div className={EDITOR_CANVAS_CLASS}>
          <div className="flex min-h-0 flex-1 flex-col gap-group px-8 py-8">
            <div className="flex min-h-9 items-center gap-cozy">
              <p className="min-w-0 flex-1 truncate text-body font-semibold text-foreground">
                Preview
              </p>
              <p className="shrink-0 text-meta text-muted-foreground">
                Drag the thumbnails to reorder
              </p>
            </div>
            <div className="min-h-0 flex-1">
              <ListingPreview input={preview} frame="canvas" photos={previewPhotos} />
            </div>
            <p className="mx-auto min-h-[2lh] max-w-md text-balance text-center text-meta text-muted-foreground">
              {isShopfront
                ? "Buyers see your typical price as a guide, and nothing is held when they ask."
                : "Buyers see the price with the service fee included. You get your full price."}
            </p>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmingClose}
        onOpenChange={setConfirmingClose}
        title={mode === "create" ? "Discard this listing?" : "Discard your changes?"}
        description={
          mode === "create"
            ? draftId
              ? "Changes since you last saved the draft will be lost."
              : "Your photos and details will not be saved."
            : "The listing stays as it was saved."
        }
        confirmLabel="Discard"
        confirmVariant="destructive"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setConfirmingClose(false);
          leave();
        }}
      />
    </div>
  );
}

