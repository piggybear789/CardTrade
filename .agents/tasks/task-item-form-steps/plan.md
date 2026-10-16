# Implementation Plan: "Sell an item" becomes a 3-step flow

Work directly in `c:\dev\Marketplace` (branch `main`, no worktree). The tree has unrelated
uncommitted work (`components/deals/DealComposeForm.tsx`, `DealEditDialog.tsx`,
`DealInviteShare.tsx` modified; `components/deals/DealSteps.tsx` untracked; two staged catalog
files). Build on top of it. Never revert, stash, reset, checkout or commit. The user commits.

## Verification rules (user rule, binding)

- Do NOT run `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test` (the full
  suite) or `npm run dev`. Do not run Playwright.
- Verify with editor diagnostics plus ONLY the affected files:
  `npx vitest --run tests/unit/itemFormSteps.test.ts` and
  `npx vitest --run tests/component/itemFormSteps.test.tsx`.

## Facts established by reading the code

1. **State is plain `React.useState`, not react-hook-form.** `ItemFormInner` holds every field in
   its own `useState` (`title`, `description`, `game`, `condition`, `grader`, `grade`,
   `certNumber`, `rawChosen`, `listingKind`, `fmvDollars`, `location`, `keptPaths`, plus
   `usePreviewFiles()` for new photos). Validation is a manual `handleSubmit` that sets one
   `error: { field: ErrorField; message } | null`, rendered inline through `errorFor(field)`.
   The brief's "reuse react-hook-form + trigger([...])" does not apply. Per-step validation
   re-groups these manual checks by step. Do NOT move the form onto react-hook-form.
2. **Routes:** `app/(workspace)/listings/new/page.tsx` renders `<ItemForm mode="create"
   defaultLocation serverDraft />`. `app/(workspace)/listings/[id]/edit/page.tsx` renders
   `<ItemForm mode="edit" item />`. Their `loading.tsx` files render
   `components/listings/ItemFormSkeleton.tsx`, which must keep matching the form's geometry.
3. **Phone chrome:** `components/layout/mobile-chrome/variants.tsx` `ItemFormChrome` renders
   `<Button type="submit" form={ITEM_FORM_ID}>` with the label the form publishes through
   `publishItemFormChrome({ submitting, label })` (`lib/listings/itemFormChrome.ts`). Below
   `md` it is the ONLY primary control: the form's own submit is `max-md:hidden`, so the
   e2e strict locator never sees two buttons with the same name.
4. **No component or unit test renders `ItemForm` or `DealSteps` today** (grepped `tests/`).
   Playwright helpers that drive the form: `tests/e2e/support/listings.ts` (`createListing`),
   plus `tests/e2e/specs/listings.spec.ts` (the edit test and "refuses a listing with no
   title"). `tests/e2e/debug/*` are throwaway probes. Leave them alone.
5. **Server-side rules** live in `domain/validation/item.ts` (`itemSubmissionSchema`,
   `IMAGES_MIN`/`IMAGES_MAX` = 1/10) and `domain/validation/grading.ts` (`normalizeGrading`).
   For grader and grade, `normalizeGrading` uses the same messages as the form's inline checks.
   `createItem` derives a blank title from the description, so the title is NOT required on
   the client.
6. **DealSteps is dialog-bound.** `StepHeader` renders `DialogHeader`/`DialogTitle`/
   `DialogDescription`, and the step bodies are bound to `UnlistedItemDraft`. Only the
   progress bar has no dialog dependency: `<div className="grid grid-cols-3 gap-tight"
   aria-hidden>` of `h-1 rounded-full bg-primary|bg-muted` spans.

## Decisions

- **D1: Share only the progress bar, as `components/ui/step-progress.tsx`.** The bar has no
  dialog dependency, and the deal's markup can be reproduced byte for byte. So both flows
  render one primitive, and their progress always looks the same. `StepHeader`, the step
  bodies and `dealStepGap` stay in `DealSteps.tsx`. They are dialog- and draft-bound, and
  sharing them would mean threading two domains through one component. The primitive has
  two modes. With no `onSelect`, it is the deal's decorative `aria-hidden` bar, unchanged.
  With `onSelect`, it renders a labelled `<nav><ol>` of real `<button>`s with `aria-current="step"`.
  ItemForm uses the second mode.
- **D2: Steps apply at EVERY width, with one behaviour and no media query.** The step lives in
  `useState`. Visibility is CSS and `hidden` attributes, so the server and the first client render
  agree (step 1), with no hydration fork. Resizing across `lg` loses nothing. At `lg` the
  photo panel stays visible on every step, because it is the left column of a fixed two-column
  grid. Hiding it would leave 63% of the card empty on steps 1 and 3. Below `lg` the photo
  panel IS step 2's body (`max-lg:hidden` unless step 2). The desktop rail now holds one
  step's fields at a time, so most of its internal scrolling also goes away. The `lg:` grid,
  the `max-lg:overflow-x-clip lg:overflow-clip` card rules, `grid-cols-1`, the bare file
  `<input>` and the photo panel's classes all stay exactly as they are.
- **D3: The three steps (labels are static, so the indicator never changes width):**
  1. **Details**: listing kind, Title, Description, Game, condition (binder: "Typical
     condition"; single: "Is it graded?" tiles, then grader/grade/cert or the raw condition
     select). The grading fields stay here because they qualify the condition.
  2. **Photos**: the existing photo panel (cover, filmstrip, add tile, `#images` input,
     `images-error`). At `lg` the rail also shows a short step-2 body (see item 4).
  3. **Price & location**: price `MoneyInput` + `PriceReadout` (single) or the "Typical
     price" hint (binder), `PlacePicker` "Based near", and the publish button.
  The listing kind is not on step 3. It changes what the rest of the form means, so it goes
  first, as today.
- **D4: Checks that gate Next. Steps are checked in order, and the first failure is shown.**
  - Step 1: (a) description, via `runSchema(itemSubmissionSchema.pick({ description: true }),
    { description })` → field `description`. (b) `!game` → `{ category, "Select the card
    game." }` (existing). (c) condition, via `runSchema(itemSubmissionSchema.pick({
    condition: true }), { condition })` → field `condition`. (d) if `listingKind !==
    'SHOPFRONT'`, `normalizeGrading(condition, { grader, grade, certNumber })` → its `field` /
    `message` (`grader` "Choose who graded the card.", `grade` "Enter the grade on the
    label." are the existing messages; it adds the server's grade-length and cert-pattern checks).
    (a), (c) and the extra grading checks are not new rules. The server already refuses
    these inputs. Running the domain's own schema at the step boundary means a seller is no
    longer sent back from step 3. The messages cannot drift from the server's.
  - Step 2: `totalImages < IMAGES_MIN` → "Add at least one image of your item.";
    `totalImages > IMAGES_MAX` → `You can add at most ${IMAGES_MAX} images.` (existing).
  - Step 3: `dollarsToCents(fmvDollars) === null` → `{ fmvCents, "Enter a price in dollars
    (e.g. 123.45)." }`; `!location?.label.trim()` → `{ location, "Add where this listing is
    based (suburb or city)." }` (existing).
  - Publishing (submit on step 3) re-runs steps 1→3 and jumps to the first failing step. An
    edit can jump straight to step 3, past steps it never visited.
- **D5: Next is never disabled.** Pressing it runs the step's check, shows the existing inline
  `FieldError` beside the field (`role="alert"`), and focuses that field. This keeps the
  form's existing pattern, where field-level validation stays beside its field. A
  disabled Next would also need a separate explanation line, and the phone header
  button could not show one.
- **D6: Navigation.** `step: 1 | 2 | 3` lives in `ItemFormInner`. All field state already lives
  there, and hidden step bodies stay MOUNTED (`hidden` attribute). So Back and jumps never lose
  data, and `PlacePicker`'s internal query survives too.
  - Back: an arrow button in the step header row, like the deal `StepHeader`, at every width.
    On step 1 it stays rendered but is `invisible` + `disabled`, so the title does not shift.
  - Indicator: edit mode lets you select every step. In create mode, step `n` is selectable
    only when `n <= firstIncompleteStep` (the first step whose check fails, or 3). Back
    is always allowed.
  - Next/publish is ONE `type="submit"` control (the footer button at `md+`, the phone header
    below `md`). `handleSubmit` on steps 1–2 advances (D5). On step 3 it publishes. Enter
    in a text field therefore advances, too.
  - On any user-initiated step change, focus moves to the step heading (`tabIndex={-1}`).
    It is not focused on first mount.
  - Accepted, recorded: a fast double-click on step 2's Next can land the second click on
    step 3's publish. If the price and place are already filled (edit, restored draft), that
    saves. This matches the deal composer's single-button Next/Get link and is not guarded.
- **D7: Server and upload errors jump to their step.** Every error goes through one
  `failAt({ field, message })`. It sets `error`, sets `step` to `stepForField(field)` when
  that differs from the current step, and queues focus. Mapping, every `ErrorField`:
  | field | step |
  |---|---|
  | `title`, `description`, `category`, `condition`, `grader`, `grade`, `certNumber` | 1 |
  | `images` | 2 |
  | `fmvCents`, `location` | 3 |
  | `null` (general) | stays on the current step |
  A server `field` that maps to no step (e.g. `(root)`) is shown as a general error
  (`field: null`). Today it is cast to `ErrorField` and rendered nowhere. `uploadItemImages`
  failure → `images` → step 2.
- **D8: Geometry.**
  - `lg+`: the rail becomes a flex column. The step body is the scroll region (`lg:flex-1
    lg:min-h-0 lg:overflow-y-auto lg:px-7`), and the footer is pinned beneath it
    (`shrink-0`). Back/Next/Save draft therefore sit in the same place on every step. This
    deliberately replaces the "submit ends the form and scrolls with the fields" note, which
    was written for one long form. Rewrite that comment. `PlaceSearch` still finds a
    `overflow-y: auto` ancestor (the step body), so the drop-up logic works as before. With
    only the price above it there is now room to drop down.
  - Below `md`: the primary control is the phone header button, which never moves, and Back
    is in the step header at the top of the card. Navigating takes no scrolling.
  - `md`–`lg`: the footer ends the step body. A step change is a view change. Focus (and so
    scroll) goes to the step heading, which sits at the same spot on every step.
  - The footer primary keeps its "width pinned to the resting label" grid. The invisible
    sizer is always `submitLabel` (longer than "Next"), so the button is the same width on all
    steps and while "Saving…" shows.
  - The step header is always rendered (create mode included). Only the card title and
    description keep the create-mode `max-md:hidden`, so `CardContent`'s create-only
    `max-md:pt-group` must go: the header supplies the top padding again.
  - `ItemFormSkeleton` must be updated in the same pass to draw step 1 (item 6).
- **D9: Phone chrome.** Publish `{ submitting: isSubmitting, label: step === 3 ? submitLabel :
  'Next' }`. `ITEM_FORM_ID` and `form=` are unchanged, so the header button submits the form,
  and `handleSubmit` decides between advancing and publishing. Update the `label` doc comment
  in `lib/listings/itemFormChrome.ts` to say it can also be "Next".
- **D10: Copy and icons.** Member copy keeps "Binder or bulk listing" / "Many cards, nothing
  held". Never "shopfront". Icons come only from `@hugeicons/react` + `@hugeicons/core-free-icons`
  (`ArrowLeft01Icon`, `ImagePlusIcon`). Compose classes with `cn()`.

## Steps

- [ ] 1. **Pure step rules module.** Create `lib/listings/itemFormSteps.ts`. Open it with a
      header comment (what it is, why it is pure: shared by the form and its tests, and
      mirrors the server's validators rather than restating them). Export:
      - `type ItemFormStep = 1 | 2 | 3`, `ITEM_FORM_STEP_LABELS = ['Details', 'Photos',
        'Price & location'] as const`.
      - `type ItemFormErrorField = 'title' | 'description' | 'category' | 'condition' |
        'grader' | 'grade' | 'certNumber' | 'fmvCents' | 'images' | 'location'`.
      - `stepForField(field: string | null | undefined): ItemFormStep | null` per the D7 table.
      - `dollarsToCents(raw: string): number | null`, moved verbatim from `ItemForm.tsx`
        (same `Math.round(dollars * 100)`; no money behaviour change).
      - `interface ItemFormStepInput { listingKind: 'SINGLE' | 'SHOPFRONT'; description;
        game; condition; grader; grade; certNumber; totalImages: number; fmvDollars;
        locationLabel: string | null }`.
      - `itemFormStepProblem(step, input): { field: ItemFormErrorField; message: string } |
        null`, implementing D4 in exactly that order. Imports: `runSchema` from
        `@/domain/validation/result`; `itemSubmissionSchema`, `IMAGES_MIN`, `IMAGES_MAX` from
        `@/domain/validation/item`; `normalizeGrading` from `@/domain/validation/grading`.
        For `runSchema` results, return `{ field, message }` with the field asserted to the
        union.
      - `firstIncompleteStep(input): ItemFormStep | null`: the first of 1, 2, 3 with a problem.
      JSDoc each export. Single quotes, semicolons, no `'server-only'`, no React.
      Add `tests/unit/itemFormSteps.test.ts` (domain project, Node). Cover: every field in the
      D7 table plus `null` / `'(root)'` → `null`; step 1 problem order (blank description
      first, then game, then condition, then grader, then grade, then a bad cert); a binder
      (`SHOPFRONT`) with `Graded` and no grader passes step 1; a blank title does not block;
      step 2 at 0/1/10/11 images; step 3 at a blank or non-numeric price and a blank location;
      `firstIncompleteStep` for a fully valid input (`null`) and for an input broken only on step 2.
      Files: `lib/listings/itemFormSteps.ts`, `tests/unit/itemFormSteps.test.ts`
      Verify: `npx vitest --run tests/unit/itemFormSteps.test.ts`: all pass. Editor
      diagnostics clean on both files.

- [ ] 2. **Shared progress primitive and deal adoption.** Create `components/ui/step-progress.tsx`
      (mark it `'use client'`, since it takes an `onSelect` handler). Props: `steps: readonly string[]` (2–4), `current: number`
      (1-based), `onSelect?: (step: number) => void`, `canSelect?: (step: number) => boolean`
      (default: all), `className?`. Use a static column map
      `{ 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }` so Tailwind sees the classes.
      - No `onSelect`: render exactly `<div className={cn('grid gap-tight', COLS[n],
        className)} aria-hidden>` with one `<span>` per step (`key={n}`, className
        `h-1 rounded-full bg-primary` when `n <= current`, else `h-1 rounded-full bg-muted`).
        This is the deal's current DOM.
      - With `onSelect`: `<nav aria-label="Form steps"><ol className={cn('grid gap-tight',
        COLS[n], className)}>`. Each `<li>` holds a `<button type="button">`
        (`onClick={() => onSelect(n)}`, `disabled={!canSelect(n)}`,
        `aria-current={n === current ? 'step' : undefined}`, `min-h-8 w-full min-w-0 flex
        flex-col gap-tight text-left`, a focus-visible treatment copied from
        `components/ui/button.tsx`, `disabled:cursor-not-allowed`). Inside it: the same bar
        span, then `<span className="text-meta">` with `<span className="sr-only">Step {n}:
        </span>{label}`, `text-foreground font-medium` when current, else
        `text-muted-foreground`. Let labels wrap rather than truncate. No horizontal overflow
        at 320px.
      Then in `components/deals/DealSteps.tsx`, replace only the inline `{progress ? (<div
      className="grid grid-cols-3 gap-tight" aria-hidden>…</div>) : null}` block with
      `{progress ? <StepProgress steps={DEAL_STEP_LABELS} current={progress} /> : null}`.
      Add `const DEAL_STEP_LABELS = ['Card', 'Terms', 'Review'] as const;` (module-private)
      and the import. Keep the comment above the bar. Touch nothing else in the deal files.
      Files: `components/ui/step-progress.tsx`, `components/deals/DealSteps.tsx`
      Verify: editor diagnostics clean on both. Reading confirms the deal bar's rendered
      classes, `aria-hidden` and keys are unchanged. Interactive mode is covered by item 7's test.

- [ ] 3. **Step state, handlers and validation in `ItemFormInner`** (no markup moves yet, so
      the form still renders today's layout and still submits).
      In `components/listings/ItemForm.tsx`:
      - Delete the local `dollarsToCents` and `ErrorField`, and import `dollarsToCents`,
        `ItemFormErrorField`, `ItemFormStep`, `ITEM_FORM_STEP_LABELS`, `itemFormStepProblem`,
        `firstIncompleteStep` and `stepForField` from `@/lib/listings/itemFormSteps`.
        Define `type ErrorField = ItemFormErrorField | null` locally so `errorFor` keeps its
        signature. Replace the local `IMAGES_MIN`/`IMAGES_MAX` consts with the domain imports
        (same values).
      - Add `const [step, setStep] = React.useState<ItemFormStep>(1)`, `stepHeadingRef`
        (`HTMLHeadingElement`), and `pendingFocus = React.useRef<string | 'heading' | null>(null)`.
        Add an effect on `[step, error]` that consumes `pendingFocus`: focus
        `document.getElementById(id)` when it exists, else the heading. Clear it after.
      - Build `stepInput: ItemFormStepInput` from state (`totalImages`,
        `locationLabel: location?.label ?? null`).
        `const reachableUpTo = mode === 'edit' ? 3 : (firstIncompleteStep(stepInput) ?? 3)`.
      - Field-to-element focus map: `title→'title'`, `description→'description'`,
        `category→'game'`, `condition→'condition'` (fall back to `'graded-yes'` when that
        element is absent), `grader→'grader'`, `grade→'grade'`, `certNumber→'cert'`,
        `fmvCents→'fmv'`, `images` and `location` → `'heading'`.
      - `goToStep(n)`: `setError(null)`, `pendingFocus.current = 'heading'`, `setStep(n)`.
      - `failAt(problem: { field: ErrorField; message: string })`: `setError(problem)`.
        If `problem.field`, set `target = stepForField(problem.field)`. If `target` is set,
        call `setStep(target)` and queue focus for the field's element.
      - `goNext()`: `const p = itemFormStepProblem(step, stepInput)`. If `p`, call `failAt(p)`.
        Otherwise call `goToStep(step + 1)`.
      - `handleSubmit`: after `preventDefault()` / `setError(null)`, `if (step < 3) {
        goNext(); return; }`. Then replace the existing game / grading / fmv / images /
        location checks with: for `s` of 1, 2, 3, `const p = itemFormStepProblem(s,
        stepInput)`; if `p`, call `failAt(p)` and return. Then
        `const fmvCents = dollarsToCents(fmvDollars)!` and `location!`, and keep EVERYTHING
        from `locationPayload` onward byte-for-byte identical: the upload, both
        `createItem`/`updateItem` payloads, success handling and `catch`/`finally`. Route the
        upload failure through `failAt({ field: 'images', message })`.
      - `surfaceActionError`: in the `validation-error` branch use
        `failAt({ field: stepForField(field) ? (field as ItemFormErrorField) : null, message: … })`.
        Leave the gate branch and the fallback unchanged (field `null`).
      - Chrome: publish `label: step === 3 ? submitLabel : 'Next'`, and add `step` to the
        deps. Update the `label` JSDoc in `lib/listings/itemFormChrome.ts` ("the label of the
        form's primary control: 'Next' before the last step, then 'Create listing' / 'Save
        changes'").
      Files: `components/listings/ItemForm.tsx`, `lib/listings/itemFormChrome.ts`
      Verify: editor diagnostics clean (no unused imports or vars). `npx vitest --run
      tests/unit/itemFormSteps.test.ts` still passes.

- [ ] 4. **Step markup in `ItemForm`.** Restructure the JSX with the card/grid classes untouched:
      - `CardHeader`: drop the create-mode `max-md:hidden` from the header itself. Wrap
        `CardTitle` + `CardDescription` in a `<div className={cn('space-y-snug', mode ===
        'create' && 'max-md:hidden')}>`. Below it add the step row: `<div className="flex
        items-center gap-snug">` with the Back button. Copy the classes and `ArrowLeft01Icon`
        from DealSteps' `StepHeader`. `aria-label={`Back to ${ITEM_FORM_STEP_LABELS[step -
        2]}`}` on steps 2–3. On step 1: `invisible`, `disabled`, `aria-hidden`.
        `onClick={() => goToStep(step - 1)}`. Then `<h4 ref={stepHeadingRef} tabIndex={-1}
        className="min-w-0 flex-1 text-body font-semibold focus:outline-none">{label}</h4>`,
        and `<span className="shrink-0 text-meta tabular-nums text-muted-foreground">Step
        {step} of 3</span>`. Under the row: `<StepProgress steps={ITEM_FORM_STEP_LABELS}
        current={step} onSelect={(n) => goToStep(n as ItemFormStep)} canSelect={(n) => n <=
        reachableUpTo || n < step} />`. Add a comment explaining why the header is always rendered now.
      - `CardContent`: remove the create-only `max-md:pt-group` (and update its comment).
      - Photo panel `<div>`: add `step !== 2 && 'max-lg:hidden'` through `cn()`. Keep every
        other class and the whole subtree as they are.
      - Rail: change to `flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-2 lg:min-h-0
        lg:border-l lg:border-border` (remove `space-y-5`, `lg:overflow-y-auto`, `lg:px-7
        lg:pb-7` from the rail). Inside it:
        - Step body: `<div className="space-y-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto
          lg:px-7">`, with three children:
          - `<div hidden={step !== 1} className="space-y-5">` holding the listing-kind
            fieldset, Title, Description, the Game/condition grid and the graded fieldset,
            moved unchanged.
          - `<div hidden={step !== 2}><div className="space-y-snug max-lg:hidden">` (nested so
            the `hidden` attribute never competes with a display utility): one paragraph,
            "Add 1 to {IMAGES_MAX} photos in the panel. Front, back, slab label and corners.
            The first is the cover.", a `text-meta tabular-nums` line "{totalImages} of
            {IMAGES_MAX} added", and an outline `<Button type="button">` "Add photos"
            (`ImagePlusIcon`) that calls `fileInputRef.current?.click()`. Disable it at
            `IMAGES_MAX` or while submitting.
          - `<div hidden={step !== 3} className="space-y-5">` holding the price block and the
            `PlacePicker` block, moved unchanged.
        - `{generalError ? <FieldError message={generalError} /> : null}`, moved out of the
          step body to sit between the body and the footer, inside a `lg:px-7` wrapper, so a
          general error shows on whichever step is open.
        - Footer: keep `flex flex-col gap-snug border-t border-border pt-5 sm:flex-row
          sm:justify-end lg:flex-col`, add `shrink-0 lg:px-7 lg:pb-7`, and add `max-md:hidden`
          when `mode === 'edit'`, because nothing in it is visible on a phone in edit mode.
          Children: Save draft (create only, unchanged). Then the existing `type="submit"`
          primary (`max-md:hidden` kept), whose grid sizer is still the invisible
          `submitLabel` and whose live label is `isSubmitting ? 'Saving…' : step === 3 ?
          submitLabel : 'Next'`.
      - Rewrite the stale comments: the "THE SUBMIT ENDS THE FORM" note becomes the D8 lg note
        (pinned footer beneath the step's scroll region). The "THE ONLY SCROLLING REGION" note
        moves to the step body. The `PlaceSearch` note on the return statement now names the
        step body as the clipping ancestor at `lg`. Add a short paragraph to the module header
        comment describing the three steps and D2.
      Files: `components/listings/ItemForm.tsx`
      Verify: editor diagnostics clean. Read through the JSX and confirm: the Card className
      string is byte-identical; `id={ITEM_FORM_ID}`, `noValidate`, `lg:contents` on the form
      and `CardContent` are unchanged; the bare `#images` input is still inside the photo
      panel; no field was removed or duplicated (each id appears once).

- [ ] 5. **Shared-chrome sanity read.** No code change is expected in
      `components/layout/mobile-chrome/variants.tsx`. Its button already renders whatever
      `label` is published and submits `ITEM_FORM_ID`. Update only its JSDoc on
      `ItemFormChrome` ("The label comes from the form…") to note that the form publishes
      "Next" before the last step and that submitting advances the form until then.
      Files: `components/layout/mobile-chrome/variants.tsx` (comment only)
      Verify: editor diagnostics clean.

- [ ] 6. **Skeleton matches step 1.** Update `components/listings/ItemFormSkeleton.tsx` so swapping
      in the form causes no shift at any width:
      - `CardHeader`: no longer `max-md:hidden` in create mode. Wrap its two existing
        `TextLines` in a `div` with `space-y-snug` that is `max-md:hidden` in create mode. Add
        the step row (`TextLines className="text-body"` `widths={['w-1/3']}` standing in for
        the 32px row: use a `flex items-center gap-snug min-h-8` wrapper) and the indicator
        (a `grid grid-cols-3 gap-tight` of three `min-h-8` cells, each a `h-1` bar over a
        `text-meta` line).
      - `CardContent`: drop the create-only `max-md:pt-group`.
      - Photo panel `div`: add `max-lg:hidden` (step 1 hides it below `lg`).
      - Rail: the same flex-column/body/footer class split as item 4. The body holds only the
        step-1 blocks in the form's order: listing kind (existing), Title (new: label line +
        `h-10 md:h-9` field, which was missing), Description (existing). Then the Game row
        (one select; single is the default kind) and the "Is it graded?" legend line over a
        `grid grid-cols-2 gap-snug` of two tile placeholders, reusing the listing-kind tile
        placeholder markup. Remove the price and `Based near` blocks (step 3 now).
      - Footer: create draws two `h-10 md:h-9` bars (Save draft visible at all widths, primary
        `max-md:hidden`). Edit draws one primary bar with the whole footer `max-md:hidden`,
        matching item 4.
      Update the skeleton's comments that describe the old five-block rail and the
      submit-at-the-end layout.
      Files: `components/listings/ItemFormSkeleton.tsx`
      Verify: editor diagnostics clean. Compare the class strings side by side with item 4's
      header, rail, body and footer.

- [ ] 7. **Component test.** Add `tests/component/itemFormSteps.test.tsx` (jsdom project, uses
      `tests/setup.ts`). Follow the mocking style in `tests/component/listingPane.test.tsx`.
      Mock: `next/navigation` (`useRouter` → `{ push, refresh }`); `sonner`;
      `@/lib/actions/listings` (`createItem`, `updateItem` as `vi.fn()`);
      `@/lib/actions/listingDrafts` (`saveListingDraft`, `deleteListingDraft`);
      `@/lib/storage/uploadItemImages` (resolves `{ ok: true, paths: ['u/new.jpg'],
      dims: [null] }`); `@/lib/motion/navigate` (`navigateWithType`); `@/lib/analytics/track`
      (`trackActionFailure`, `trackFormAbandoned`, `UX_NAMES: { itemForm, createItem,
      updateItem }`); `@/components/location` (a `PlacePicker` stub that renders its `label`,
      `value?.label`, and `error` as `<p role="alert">`). Stub
      `URL.createObjectURL`/`revokeObjectURL`. If framer-motion's `FieldError` misbehaves in
      jsdom, mock `@/components/motion/FieldError` as a plain `<p role="alert" id>`. Avoid
      driving Radix `Select`: use prefilled data (an `ItemRow` fixture for edit, built from the
      type in `lib/actions/listings.ts`; `serverDraft={{ id: 'd1', fields }}` for create, with
      a game slug from `lib/catalog/cardGames.ts`, condition `'Near Mint'`, fmv `'80.00'` and a
      `PlaceValue` location). Cases:
      1. Create, fresh form: "Step 1 of 3" is shown; the "Step 1: Details" button has
         `aria-current="step"`; the steps 2 and 3 buttons are disabled. Clicking Next (footer
         `type="submit"` button named "Next") shows "Description is required" and stays on step 1.
         `createItem` was not called.
      2. Back preserves data: edit fixture. Change Title, click Next. The heading "Photos"
         receives focus (`toHaveFocus`). Click "Back to Details". Title still holds the changed value.
      3. Submit only on step 3, payload unchanged (edit): Next, then Next, with `updateItem` not
         called. On step 3, click "Save changes": `updateItem` is called once with
         `(item.id, { title, description, category: cardGameName(slug), condition, grading:
         { grader, grade, certNumber }, fmvCents, images: item.image_paths,
         imageDims: item.image_paths.map(() => null), location: { label, placeId, lat, lng,
         countryCode, precision: 'suburb' } })` (`toHaveBeenCalledWith`, exact object).
      4. Create payload (serverDraft prefill): Next to step 2. Add a `File` via
         `fireEvent.change` on `#images`. Next, then click "Create listing". `createItem` is
         called once with the exact object (`images: ['u/new.jpg']`, `imageDims: [null]`,
         `listingKind: 'SINGLE'`, `grading: { grader: '', grade: '', certNumber: '' }`).
      5. Server field error jumps: edit, with `updateItem` resolving `{ ok: false, error:
         'validation-error', field: 'title', message: 'Title must be at most 120 characters' }`.
         After "Save changes" on step 3, the "Step 1: Details" button has `aria-current="step"`,
         the message is visible, and Title has `aria-invalid="true"`.
      6. Edit lets the indicator jump straight to "Step 3: Price & location".
      Files: `tests/component/itemFormSteps.test.tsx`
      Verify: `npx vitest --run tests/component/itemFormSteps.test.tsx`: all six pass. Then
      re-run `npx vitest --run tests/unit/itemFormSteps.test.ts`.

- [ ] 8. **Keep the Playwright helpers truthful (edit only, do not run).** In
      `tests/e2e/support/listings.ts` `createListing`, keep the existing order and its comments.
      Do the selects, then Title and Description on step 1, then click `getByRole('button',
      { name: 'Next' })`. On step 2, call `setInputFiles` and wait for the remove button, then
      Next. On step 3, fill Price, then `fillPlace` (it is now after photos, so update the
      "PLACE BEFORE PHOTOS" comment: the upload settles before step 3 renders the field, and
      Next waits on it). Then click "Create listing" as before. The name "Next" is unique per
      viewport (the footer button is `max-md:hidden`, and the header exists only below `md`).
      In `tests/e2e/specs/listings.spec.ts`, the edit test must reach "Save changes" via
      `getByRole('button', { name: /Step 3: Price & location/ })` after filling Title.
      "refuses a listing with no title" becomes "keeps a blank listing on step 1": check One
      item, click Next, expect "Description is required", the URL still `/listings/new`, and
      "Step 1 of 3" visible.
      Files: `tests/e2e/support/listings.ts`, `tests/e2e/specs/listings.spec.ts`
      Verify: editor diagnostics clean on both. Do NOT run Playwright (user rule).

## Final check (the coder's last item, no build or full suite)

- Run only: `npx vitest --run tests/unit/itemFormSteps.test.ts` and
  `npx vitest --run tests/component/itemFormSteps.test.tsx`. Both pass.
- Editor diagnostics clean on every touched file: `lib/listings/itemFormSteps.ts`,
  `components/ui/step-progress.tsx`, `components/deals/DealSteps.tsx`,
  `components/listings/ItemForm.tsx`, `components/listings/ItemFormSkeleton.tsx`,
  `lib/listings/itemFormChrome.ts`, `components/layout/mobile-chrome/variants.tsx`,
  and the tests.
- `git status` shows only these files changed beyond the pre-existing unrelated work.
  Nothing is committed.
