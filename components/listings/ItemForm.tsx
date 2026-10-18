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
// THREE STEPS, not one long scroll: 1 Details (listing kind, title, description, game,
// condition and slab details), 2 Photos, 3 Price & location, which publishes. The rules
// for which field is on which step, and what each step needs before Next, live in
// `lib/listings/itemFormSteps.ts`. The steps apply at every width with one behaviour:
// the open step is `useState`, visibility is CSS and `hidden`, so the server render and
// the first client render agree. From `lg` the photo panel stays the left column on
// every step (hiding it would empty most of the fixed two-column card); below `lg` it is
// step 2's body. Every field's state lives here and hidden steps stay mounted, so Back
// never loses input. Edit mode may jump to any step; create mode reaches no further than
// the first incomplete one. A server error naming a field opens that field's step.
//
// Key behaviours:
//  - Fair_Market_Value is entered in DOLLARS in the UI but converted to integer
//    AUD cents (`Math.round(dollars * 100)`) before calling the action, since
//    money is integer cents end-to-end.
//  - Image count is enforced client-side (1–10) on step 2 with a friendly message
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
  ImageOffIcon,
  ImagePlusIcon,
  LibraryIcon,
  PackageIcon,
  XIcon,
} from '@hugeicons/core-free-icons';

import { createItem, updateItem, type ItemRow } from "@/lib/actions/listings";
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
import { StepProgress } from "@/components/ui/step-progress";
import { Input } from "@/components/ui/input";
import type { ListingKind } from "@/domain/orchestrator/cashSaleOrchestrator";
import {
  clearItemFormDraft,
  hasItemFormDraft,
  useInitialItemFormDraft,
  useItemFormDraft,
} from "@/lib/listings/useItemFormDraft";
import { trackActionFailure, trackFormAbandoned, UX_NAMES } from "@/lib/analytics/track";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { PlacePicker } from "@/components/location";
import type { PlaceValue } from "@/lib/location/types";
import { formatMoney, itemImageUrl } from "@/lib/format";
import { betaFeeNote, feesWaivedForBeta, platformFeeRateLabel } from "@/lib/fees/feeLabels";
import { buyerPaysCents } from "@/lib/listings/buyerPrice";
import { CARD_GAMES, cardGameName, cardGameSlug } from "@/lib/catalog/cardGames";
import { ITEM_CONDITIONS, isItemCondition } from "@/lib/catalog/conditions";
import { deleteListingDraft, saveListingDraft } from "@/lib/actions/listingDrafts";
import type { ItemFormDraftFields } from "@/lib/listings/useItemFormDraft";
import { cn } from "@/lib/utils";

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
import {
  Card,
  CardContent,
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
}

/**
 * The two kinds of listing (0064), with the copy that tells them apart.
 *
 * The distinction has to land here, at the only point where the seller chooses:
 * a single listing is held for one buyer, a shopfront is not held for anyone.
 * Everything downstream — no reservation, several concurrent contracts, a price
 * that comes from each contract rather than from this form — follows from it.
 */
/** One line under the bar per step, in ITEM_FORM_STEP_LABELS order. */
const STEP_HINTS = [
  "",
  "",
] as const;

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
 * What the price means to each side, once one is typed: what buyers will see on the
 * listing, and what the seller receives. The fee is added on top of the seller's
 * price, so a seller entering $100 could not tell whether buyers would see $100 or
 * more — and nothing said they keep the full $100.
 *
 * Nothing shows until there is a price: two empty figures read as disabled fields. The
 * line is the last thing in the step, so its arrival moves nothing a seller is using.
 * The live region stays mounted while empty, or the first figure would not be announced.
 */
function PriceReadout({ cents, currency }: { cents: number | null; currency: string }) {
  const valid = cents != null && cents > 0;
  return (
    <div className="space-y-tight">
      <p className="text-body" aria-live="polite">
        {valid ? (
          <>
            Buyers see{" "}
            <span className="font-medium tabular-nums">
              {formatMoney(buyerPaysCents(cents, currency), currency)}
            </span>
            {" · "}you&apos;ll get{" "}
            <span className="font-medium tabular-nums">{formatMoney(cents, currency)}</span>
          </>
        ) : null}
      </p>
      <p className="text-meta text-muted-foreground">
        {feesWaivedForBeta()
          ? `${betaFeeNote()}.`
          : `The ${platformFeeRateLabel(currency)} buyer fee is added to your price. Card processing is shown on your statement.`}
      </p>
    </div>
  );
}

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
  restoreDraft,
  draftDecided,
}: ItemFormProps & { restoreDraft: boolean; draftDecided: boolean }) {
  const router = useRouter();

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

  const fileInputRef = React.useRef<HTMLInputElement>(null);

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
  // double-click on step 2's Next would otherwise land on step 3's publish and save a
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

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    if (picked.length > 0) {
      pending.add(picked);
      setError(null);
    }
    // Reset the native input so re-picking the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = "";
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

    // ONE SUBMIT, THREE MEANINGS. The footer button and the phone header both submit
    // this form (Enter in a field does too); before the last step that is Next.
    if (step < 2) {
      goNext();
      return;
    }
    // Only a deliberate publish from a step 3 the seller has had time to see.
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
    // Both guaranteed by step 3's check above.
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

  // The first image (kept or newly added) is the cover shown in the big
  // left-hand preview, mirroring how Facebook Marketplace always leads with a
  // large primary photo and keeps the rest as a filmstrip beside it. The preview URL
  // is the file's own stable one — never minted here, where it would change on every
  // render and make the browser re-decode the cover each time anything re-rendered.
  const coverUrl =
    keptPaths.length > 0
      ? itemImageUrl(keptPaths[0])
      : newFiles.length > 0
        ? newFiles[0].url
        : null;

  // FIXED HEIGHT ON DESKTOP, and the details rail scrolls inside it.
  //
  // Previously the grid was `min-h`, so its height was whatever the rail's content
  // came to and the photo panel grew with every field added. Making the height
  // definite is what lets the middle row scroll and what keeps the left column the
  // same size no matter how much is in the form.
  //
  // Definite against the dynamic viewport so the internal rail, rather than the
  // document, owns scrolling. The shell budget is subtracted below; overlay
  // keyboards subtract their published inset as well.
  //
  // A CONSEQUENCE FOR THE LAST FIELD ON STEP 3. `Based near` is a combobox, and
  // `PlaceSearch` positions its suggestions absolutely against the input. Once the rail
  // became a scroll box (today, the step body inside it — the footer is pinned beneath)
  // the suggestions were clipped at its bottom edge, so the third
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
    // acquire. The clipping the rounded corners rely on is unchanged.
    //
    // AND BELOW `lg` IT CLIPS THE X-AXIS ONLY (`max-lg:overflow-x-clip`), because clipping
    // the y-axis here broke the last field in the form. This card is the nearest clipping
    // ancestor of `Based near`, which sits at the bottom of it with only `CardContent`'s
    // padding underneath — so `PlaceSearch` measured about 24px of room, floored its
    // suggestion list to one clipped row, and the field was unusable until a failed submit
    // added a validation message and grew the box. The horizontal clip is the half that is
    // actually load-bearing (it stops an intrinsically-wide input shearing the layout on a
    // phone); nothing needs the vertical half below `lg`, where there is no internal scroll
    // region to contain.
    //
    // `overflow-x: clip` with `overflow-y: visible` is a legal pair — `clip` is the only
    // clipping value that does not force the other axis to `auto`, which is exactly why
    // `hidden` could not be used for this. `clippingBounds` now tests `overflow-y` alone, so
    // it walks past this card below `lg` and measures the viewport instead. From `lg` the
    // full `overflow-clip` returns and the rail's step body (`overflow-y-auto`) is the
    // clipping ancestor, which is the behaviour the drop-up logic was written for.
    // NO `lg:max-h`. The card uses the shell's full desktop budget and that is
    // all — it was also capped
    // at `52rem` (832px), which on anything taller than about a 950px viewport left
    // the card short of the space it had while the details rail scrolled internally
    // anyway. Measured at 1920x1080: the card stopped at 832px with 155px of viewport
    // still empty below it, and the rail hid 49px of itself. Removing the cap lets it
    // use the height and the rail's scrollbar goes away on a tall display.
    //
    // The height is still PINNED to the viewport, deliberately. That is what keeps
    // the header in place and makes the rail the single scrolling region, and it is
    // what gives both columns a definite height to fill. Unpinning it was tried and
    // reverted: with a content-sized row the two columns compete to set the height
    // and the photo panel wins as soon as the filmstrip has a few rows in it.
    <Card className="mx-auto w-full min-w-0 max-w-7xl max-lg:overflow-x-clip lg:overflow-clip lg:grid lg:h-[calc(100dvh-8.25rem-var(--keyboard-inset,0px))] lg:min-h-[34rem] lg:grid-cols-[minmax(0,1.65fr)_minmax(min(340px,40%),0.95fr)] lg:grid-rows-[auto_1fr]">
      {/* THE HEADER IS ALWAYS RENDERED NOW, in create mode on a phone too. It used to be
          `max-md:hidden` in create mode, because the phone chrome already says "New
          listing" and the card's title duplicated it — that half is still hidden. What
          is new is the step row above it: Back, which step this is, and the
          indicator, which a phone needs as much as a desktop does.

          THE STEPPER LEADS THE CARD. It used to sit under the title with its own
          visible step heading ("Details" beside "Step 1 of 3"), which named the step
          twice — once there and once under its bar. The heading is now `sr-only`: it
          is still the focus target on a step change, so a screen reader announces
          the step, but the bar's label is the only visible name. */}
      <CardHeader className="lg:col-start-2 lg:row-start-1 lg:border-l lg:border-border lg:px-7 lg:pb-5 lg:pt-7">
        {/* ONE TOP ROW: Back, the page title, and the step counter on the right, then
            the bar. No subtitle: the one that was here talked about price on every
            step. The title is hidden below `md` in create mode because the phone chrome
            already says "New listing". Back is dropped on step 1 and appears before the
            title from step 2; the row's `min-h-8` keeps the bar below from moving. */}
        <div className="flex min-h-8 items-center gap-snug">
          <button
            type="button"
            onClick={() => goToStep((step - 1) as ItemFormStep)}
            disabled={step === 1 || isSubmitting}
            aria-hidden={step === 1 || undefined}
            tabIndex={step === 1 ? -1 : undefined}
            aria-label={step > 1 ? `Back to ${ITEM_FORM_STEP_LABELS[step - 2]}` : undefined}
            className={cn(
              "-ml-1.5 grid size-8 shrink-0 place-items-center rounded-full border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:border-ring disabled:opacity-50",
              // Gone, not invisible, on step 1, so the title starts flush left.
              step === 1 && "hidden",
            )}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" aria-hidden />
          </button>
          <CardTitle
            className={cn("min-w-0 flex-1 truncate text-subhead", mode === "create" && "max-md:invisible")}
          >
            {mode === "create" ? "Sell an item" : "Edit listing"}
          </CardTitle>
          <span className="ml-auto shrink-0 text-meta tabular-nums text-muted-foreground">
            Step {step} of 2
          </span>
        </div>
        <StepProgress
          steps={ITEM_FORM_STEP_LABELS}
          current={step}
          onSelect={(n) => goToStep(n as ItemFormStep)}
          canSelect={(n) => !isSubmitting && (n <= reachableUpTo || n < step)}
        />
        {STEP_HINTS[step - 1] ? (
          <p className="hidden pt-snug text-body text-muted-foreground md:block">
            {STEP_HINTS[step - 1]}
          </p>
        ) : null}
        {/* The step's heading, for assistive tech only: the focus target on a step
            change (see `goToStep`). Visually the bar's label above names the step. */}
        <h4
          ref={stepHeadingRef}
          tabIndex={-1}
          className="sr-only focus:outline-none"
        >
          {ITEM_FORM_STEP_LABELS[step - 1]}
        </h4>
      </CardHeader>

      <form
        // Unconditional. It was create-only, for the phone header's benefit; the
        // header now submits in edit mode too and `form=` needs the id to exist.
        id={ITEM_FORM_ID}
        onSubmit={handleSubmit}
        noValidate
        className="lg:contents"
      >
        {/* `pt-0` is `CardContent`'s default, and it is right because the `CardHeader`
            above supplies the top padding at every width. It did not in CREATE mode on
            a phone while that whole header was `max-md:hidden`, and this restored
            `max-md:pt-group` to compensate; the header's step row now always renders,
            so the compensation went with it. */}
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
        <CardContent className="grid grid-cols-1 gap-5 lg:contents">
          {/* Photos occupy the full-height left panel, keeping image entry
              visually distinct from the listing details rail. */}
          {/* `lg:min-h-0` + `lg:overflow-hidden` are what make the photo actually
              yield space to the filmstrip instead of overflowing the fixed panel: a
              grid item defaults to `min-height:auto`, which refuses to shrink below
              its content. */}
          {/* `flex flex-col` WITH `gap`, not `space-y`. The column was `space-y-cozy`
              with an `lg:space-y-group` override, and stacking two `space-y` values
              through a breakpoint is hard to reason about — `gap` is one declaration
              that the flex container owns.
              
              `gap-group` (16px) at `lg`, up from 12px: at `cozy` the label sat almost
              on the cover and the filmstrip almost on that, so three separate things
              read as one crowded block. `group` is the scale's "between related
              components" step, which the form's own field blocks already use. */}
          {/* STEP 2 BELOW `lg`, AND THE LEFT COLUMN ON EVERY STEP FROM `lg`. The desktop
              card is a fixed two-column grid, and hiding this panel on steps 1 and 3
              would leave most of the card empty; below `lg` the panel is the whole of
              step 2's body. Hidden by a `max-lg:` class rather than unmounted, so the
              picked files and their previews survive every step change. */}
          <div
            className={cn(
              "flex flex-col gap-cozy lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:gap-group lg:overflow-hidden lg:bg-card lg:p-section",
              step !== 2 && "max-lg:hidden",
            )}
          >
            {/* NO COUNT LINE UNDER THE LABEL. "Add 1–10 photos. N selected." spent a
                whole row restating what the panel already shows: the tiles are the
                count, and the add target disappearing at ten is the ceiling. The
                bounds are still enforced — `IMAGES_MIN` on step 2's Next, `IMAGES_MAX` on the
                add tile — and a shortfall is reported by `imagesError` below, which is
                where a member actually needs to read it. */}
            {/* Says it is required up front, rather than at step 2's Next. The count is
                live, so the ceiling is visible before the add tile disappears. */}
            <div className="flex items-baseline justify-between gap-snug">
              <Label htmlFor="images">
                Photos <span className="font-normal text-muted-foreground">· required</span>
              </Label>
              <span className="text-meta tabular-nums text-muted-foreground">
                {totalImages} of {IMAGES_MAX}
              </span>
            </div>

            {/* TWO LAYOUTS, SPLIT AT `lg`.

                From `lg`: the cover in the left two thirds, every photo stacked down the
                right third, two to the column, each exactly half its height. The panel
                has a FIXED height there (see the Card), so the row is the flex child that
                takes the remainder (`lg:flex-1`) and `lg:grid-rows-[minmax(0,1fr)]`
                hands that definite height to both cells, which is what lets the strip's
                percentage rows resolve. Past two photos the column scrolls.

                Below `lg`: the cover full width, and the photos as a WRAPPING grid of
                small squares under it. The phone used to run the desktop layout too,
                and with a third of a ~330px row to work in each tile was ~125x165px, so
                only two photos were ever visible and the rest sat below an internal
                scroll with nothing saying they were there. Five to a row, ten photos
                plus the add tile is three rows of ~60px squares: every photo on screen
                at once.

                `grid-cols-1` when there are no photos yet, at every width — otherwise the
                desktop drop target would sit in two thirds of the row with a dead column
                beside it. The empty state's height is an aspect ratio capped at `22svh`;
                `lg:max-h-none lg:aspect-auto` lets it take the desktop panel instead.

                `min-h-0` AT EVERY WIDTH. This row is a flex item in a column, and a flex
                item's automatic minimum height is its CONTENT height, which beats an
                aspect ratio — a tall phone photo once stretched the whole row to ~3x
                its intended height. */}
            <div
              className={`relative grid min-h-0 grid-cols-1 gap-cozy lg:aspect-auto lg:max-h-none lg:flex-1 lg:grid-rows-[minmax(0,1fr)]${
                totalImages > 1
                  ? " lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
                  : totalImages === 1
                  ? ""
                  : " aspect-[16/10] max-h-[22svh]"
              }`}
            >
            {/* Large cover preview / empty drop target. Clicking it opens the
                file picker, same affordance as the add tile in the strip beside it.

                Empty, or from `lg`: `h-full min-h-0` and nothing about its own size —
                the row above decides the height and this fills its cell. With photos
                below `lg` the row has no height of its own (it is the cover plus the
                thumbnail grid stacked), so the cover carries an `aspect-[4/3]`. The image
                is `object-contain` throughout, so nothing crops. */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSubmitting}
              // `p-cozy lg:p-group` — the photo needs room INSIDE its own frame. The
              // image is `h-full w-full object-contain`, so with no padding it grew to
              // the button's edges and sat directly against the border, which read as
              // the frame gripping the card rather than presenting it.
              //
              // The `--input` edge, because this is a control: the same edge every field
              // on this form wears, at the 3:1 SC 1.4.11 wants, and one pixel so it is no
              // heavier than they are. Empty, it is dashed on white with a violet glyph,
              // which reads as the place photos go. With a cover it turns solid and the
              // fill muted, which letterboxes the photo instead of framing a drop target.
              className={`flex ${totalImages > 0 ? "max-lg:aspect-[4/3] lg:h-full" : "h-full"} ${coverUrl ? "bg-muted" : "border-dashed bg-card"} min-h-0 w-full flex-col items-center justify-center gap-snug overflow-hidden rounded-lg border border-input p-cozy text-muted-foreground transition-colors hover:border-foreground/60 hover:bg-accent focus:outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:text-muted-foreground lg:p-group`}
              // NAMED ONLY IN THE COVER STATE, and that is the whole of F41.
              //
              // With no photo the button's own words ("Add photos", below) are its
              // accessible name. With one, the words are replaced by the image — so on
              // `/listings/[id]/edit`, which always has a cover, this became a button
              // announced as nothing at all. The photo's `alt` was the only text left,
              // and "Cover photo" describes what is SHOWN rather than what pressing it
              // does, which is why the label goes here and the image goes decorative
              // rather than the other way round.
              aria-label={coverUrl ? 'Add or replace photos' : undefined}
              aria-describedby={imagesError ? "images-error" : undefined}
            >
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverUrl}
                  alt=""
                  width={640}
                  height={640}
                  className="h-full w-full object-contain"
                />
              ) : (
                <>
                  <HugeiconsIcon icon={ImagePlusIcon} className="size-8 text-iris" aria-hidden />
                  <span className="text-body font-medium text-foreground">Add photos</span>
                  {/* THE SHOTS A CARD BUYER LOOKS FOR, named. A blank box said nothing
                      about what to photograph, and the slab label and the corners are
                      what a buyer of a graded or raw card checks first. Labels only —
                      every slot is the same picker, and the first photo is the cover. */}
                  {/* The slot grid needs the desktop panel's height; a phone's empty
                      cover is capped at 22svh, so it gets the same list as one line. */}
                  <span className="text-meta lg:hidden">Front, back, slab label and corners</span>
                  {/* Plain text, not boxes: dashed chips inside the button read as
                      four separate targets. */}
                  <span className="hidden text-meta lg:inline">
                    Front · Back · Slab label or cert · Corners and flaws
                  </span>
                  <span className="text-meta">
                    Up to {IMAGES_MAX} photos · the first is the cover
                  </span>
                </>
              )}
            </button>

            {/* ONE PHOTO: no filmstrip (it would only repeat the cover), so the cover
                carries the remove control the strip tile used to. A sibling, not a
                child, because a button cannot sit inside the cover button. */}
            {totalImages === 1 ? (
              <button
                type="button"
                onClick={() =>
                  keptPaths.length === 1
                    ? removeKeptPath(keptPaths[0])
                    : pending.remove(newFiles[0].key)
                }
                disabled={isSubmitting}
                className="group/remove absolute right-1 top-1 grid size-8 place-items-center focus:outline-none"
                aria-label="Remove image"
              >
                <RemoveMark />
              </button>
            ) : null}

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
                one can be removed individually, plus the add tile while there is room.

                BELOW `lg`: a wrapping grid of `aspect-square` tiles, five to a row
                (six from `sm`), sized by WIDTH. Nothing scrolls and nothing hides.

                FROM `lg`, TWO TILES TALL. `lg:auto-rows-[calc(50%_-_0.25rem)]` makes every
                row exactly half the strip's height less half the `gap-snug` (0.5rem)
                between them, so two tiles fill the column edge to edge and a third
                starts below the fold: the strip scrolls for the rest. The tiles used to
                be `aspect-[5/7]` — sized by their WIDTH — so in a third of the row they
                stopped well short of the bottom of the panel with two photos and
                overflowed it with three, and the panel's height had nothing to do with
                how tall they were. A percentage row only resolves against a definite
                height, which is why the wrapper above goes to the trouble of having one
                and why this is `h-full min-h-0` inside it.

                `content-start` is deliberate even though two rows fill the column: with
                a single photo the strip holds that photo and the add tile, and with ten
                it holds eleven tiles that scroll; neither wants distributing. */}
            {totalImages > 1 ? (
              <ul className="grid grid-cols-5 gap-snug sm:grid-cols-6 lg:h-full lg:min-h-0 lg:auto-rows-[calc(50%_-_0.25rem)] lg:grid-cols-1 lg:content-start lg:overflow-y-auto">
                {keptPaths.map((path) => {
                  const url = itemImageUrl(path);
                  return (
                    <li
                      key={path}
                      className="group relative aspect-square min-h-0 overflow-hidden rounded-md border bg-muted lg:aspect-auto"
                    >
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt="Existing item image"
                          width={320}
                          height={320}
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
                        className="group/remove absolute right-0 top-0 grid size-8 place-items-center focus:outline-none"
                        aria-label="Remove image"
                      >
                        <RemoveMark />
                      </button>
                    </li>
                  );
                })}
                {newFiles.map(({ key, file, url }) => (
                  <li
                    key={key}
                    className="group relative aspect-square min-h-0 overflow-hidden rounded-md border bg-muted lg:aspect-auto"
                  >
                    {/* The file's own stable preview URL. Minting one here re-decoded
                        every thumbnail on every render — see `usePreviewFiles`. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={file.name}
                      width={320}
                      height={320}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => pending.remove(key)}
                      disabled={isSubmitting}
                      className="group/remove absolute right-0 top-0 grid size-8 place-items-center focus:outline-none"
                      aria-label={`Remove ${file.name}`}
                    >
                      <RemoveMark />
                    </button>
                  </li>
                ))}
                {totalImages < IMAGES_MAX ? (
                  <li className="aspect-square min-h-0 lg:aspect-auto">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isSubmitting}
                      className="flex h-full w-full items-center justify-center rounded-md border border-input text-muted-foreground transition-colors hover:border-foreground/60 hover:bg-muted focus:outline-none focus-visible:border-ring disabled:cursor-not-allowed disabled:text-muted-foreground"
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

          {/* Details form — a dedicated right-hand rail: the open step's body, then the
              footer pinned beneath it.

              `lg:min-h-0` is required, not cosmetic: this is the grid's `1fr` row and a
              grid item defaults to `min-height:auto`, which grows the row to fit its
              content and would push the footer out of the card. */}
          <div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2 lg:min-h-0 lg:border-l lg:border-border">
            {/* THE ONLY SCROLLING REGION. Now that the card's height is definite this is
                where the overflow belongs — the header stays pinned, the photo column
                stays put, and the footer below stays where it is on every step. It is
                also the clipping ancestor `PlaceSearch` measures from `lg`. */}
            <div
              className="space-y-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:px-7"
            >
            {/* STEP 1: the card. Hidden steps stay mounted (`hidden`), so their state,
                and `PlacePicker`'s typed query, survive every step change. */}
            <div hidden={step !== 1} className={cn("space-y-5", step === 1 && "lg:flex lg:flex-1 lg:flex-col")}>
            {/* Listing kind (0064). First, because it changes what the rest of
                this form means: for a shopfront the price below is only a guide
                and the condition covers a mixed pile. Locked in edit mode. */}
            <fieldset className="space-y-snug" disabled={mode === "edit"}>
              <legend className="mb-snug text-body font-medium leading-none">
                What are you listing?
              </legend>
              <div className="grid grid-cols-2 gap-snug">
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

            {/* Title FIRST, its own field again. It was derived from the description's
                first line, which made the seller's one sentence do two jobs — a
                label for contracts and emails, and the pitch shown on the tile —
                and wrote the first words twice when both were shown. */}
            <div className="space-y-snug">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                name="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={TITLE_MAX_LENGTH}
                placeholder="Charizard Base Set Holo"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? "title-error" : undefined}
                disabled={isSubmitting}
              />
              {titleError ? (
                <FieldError id="title-error" message={titleError} />
              ) : null}
            </div>

            {/* FILLS THE REST OF THE RAIL from `lg`, so there is no dead band above the
                footer on a tall screen and nothing to scroll on a short one. */}
            <div className="space-y-snug lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Set, number, print and anything a buyer should know, e.g. light whitening on the back corners"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={6}
                className="min-h-36 resize-none lg:flex-1"
                aria-invalid={descriptionError ? true : undefined}
                aria-describedby={
                  descriptionError ? "description-error" : undefined
                }
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

            {/* Price, on step 1 with what is being sold. For a binder this is
                INDICATIVE only: each contract's real total is the sum of the cards
                that buyer asks for, so the label must not promise a purchase price. */}
            <div className="space-y-snug">
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
              {isShopfront ? (
                <p id="fmv-hint" className="text-body text-muted-foreground">
                  Prices are only a guide until terms are agreed.
                </p>
              ) : (
                <PriceReadout cents={dollarsToCents(fmvDollars)} currency={item?.currency ?? "aud"} />
              )}
            </div>
            </div>

            {/* STEP 2: game, condition and place, then publish (below `lg` the photo
                panel sits above it). No "Is it graded?" question: Graded is one entry in
                the condition list, and slab details are not asked for. */}
            <div hidden={step !== 2} className="space-y-5">
            {/* `grid-cols-1` below `sm` for the same reason as the outer grid: a
                bare grid's implicit `auto` column sizes to the Select triggers'
                min-content and overflows the clipped card on a phone. `minmax(0,
                1fr)` lets the single column shrink to the row's width. */}
            <div className="grid grid-cols-1 gap-cozy sm:grid-cols-2">
              <div className="space-y-snug">
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
                    <SelectValue placeholder="Select" />
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

              <div className="space-y-snug">
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
                    aria-describedby={conditionError ? "condition-error" : undefined}
                  >
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
                {conditionError ? (
                  <FieldError id="condition-error" message={conditionError} />
                ) : null}
              </div>
            </div>

            <div className="space-y-snug">
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
            </div>
            </div>
            </div>

            {/* Outside the step body, so a general error shows on whichever step is open. */}
            {generalError ? (
              <div className="lg:px-7">
                <FieldError message={generalError} />
              </div>
            ) : null}

            {/* THE FOOTER IS PINNED BENEATH THE STEP'S SCROLL REGION from `lg`, so Back,
                Next and Save draft sit in the same place on every step. When this was one
                long form the submit ended it and scrolled with the fields, because a
                frozen button beside moving fields read as chrome; with one step's fields
                at a time there is little to scroll, and a Next that moves between steps
                would be the worse jump. Full width in the narrow desktop rail,
                right-aligned in the wide stacked layout.

                The primary is `max-md:hidden`, because below `md` the phone header
                carries it and a second one here would be a duplicate — two controls with
                the same accessible name break the strict locator in
                `tests/e2e/support/listings.ts`. In edit mode nothing else is in this row,
                so the whole row goes below `md`.

                NO CANCEL. Dismissal is the back chevron in the header on a phone and
                browser-back elsewhere, and a "Cancel" beside "Save changes" invited the
                misread that it discards rather than navigates. */}
            <div
              className={cn(
                "flex shrink-0 flex-col gap-snug border-t border-border pt-5 sm:flex-row sm:justify-end lg:justify-between lg:px-7 lg:pb-7",
                mode === "edit" && "max-md:hidden",
              )}
            >
              {mode === "create" ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={saveDraft}
                  disabled={isSubmitting || savingDraft}
                  aria-busy={savingDraft}
                  className="w-full sm:w-auto lg:-ml-3"
                >
                  {draftId ? "Update draft" : "Save draft"}
                </Button>
              ) : null}
              {/* TWO ELEMENTS, NOT ONE RELABELLED. Next is a plain button and publish is
                  the submit, keyed apart so React swaps the node rather than retyping it;
                  with `handleSubmit`'s step-change window this keeps the second click of
                  a double-click on Next from publishing. */}
              <Button
                key={step === 2 ? "publish" : "next"}
                type={step === 2 ? "submit" : "button"}
                onClick={step === 2 ? undefined : goNext}
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="w-full max-md:hidden sm:w-auto lg:ml-auto lg:min-w-36"
              >
                {/* WIDTH PINNED TO THE RESTING LABEL. Where the button is `w-auto`,
                    swapping "Create listing" for the shorter "Saving…" shrank it under
                    the pointer on every submit. The resting label stays in the box,
                    `invisible` (so it is out of the accessibility tree and the name
                    stays single), and the live label is laid over it in the same grid
                    cell. The sizer is always the submit label, which is longer than
                    "Next", so the button is one width on every step too. */}
                <span className="grid">
                  <span className="invisible col-start-1 row-start-1">{submitLabel}</span>
                  <span className="col-start-1 row-start-1">
                    {isSubmitting ? "Saving…" : primaryLabel}
                  </span>
                </span>
              </Button>
            </div>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

/**
 * The visible half of a thumbnail's remove control: a 24px disc inside the 32px
 * button that is its hit area. The disc was the hit area itself — 44px on a phone —
 * which on a thumbnail-sized tile covered a third of the photo it was removing.
 * 32px clears WCAG 2.5.8's 24px minimum with room to spare, and the extra 8px sits
 * in the tile's corner where there is nothing else to tap. The focus ring is drawn
 * on the disc, which is the part a keyboard user can see.
 */
function RemoveMark() {
  return (
    <span className="grid size-6 place-items-center rounded-full border border-transparent bg-background/85 text-foreground shadow-sm transition-colors group-hover/remove:bg-background group-focus-visible/remove:border-ring">
      <HugeiconsIcon icon={XIcon} className="size-3.5" aria-hidden />
    </span>
  );
}
