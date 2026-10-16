# "Sell an item" listing form becomes a 3-step flow

The listing form (`components/listings/ItemForm.tsx`) used to be one long scroll. It is now three steps: 1 Details (listing kind, title, description, game, condition and slab details), 2 Photos, 3 Price & location, which publishes. The step rules are a pure module (`lib/listings/itemFormSteps.ts`). It runs the domain's own `itemSubmissionSchema` and `normalizeGrading` at step boundaries, so the inline messages match what the server would return. All field state stays in the existing plain `useState` and hidden steps stay mounted. A single `type="submit"` control (footer from `md`, phone header below `md`) means "Next" until step 3. The deal composer's progress bar moved into a shared `components/ui/step-progress.tsx` with an extra interactive mode. The `createItem`/`updateItem` payloads match HEAD byte for byte.

Watch for: a fast double-click on step 2's Next can publish from step 3 before the seller sees it (likely; recorded as accepted in the plan, non-blocking). Clicking the indicator's current step leaves a stale focus request behind (confirmed, minor).

**Verdict**: APPROVED

## High-level view

The step model lives in `itemFormSteps.ts`. Each `ErrorField` maps to one step: title, description, category, condition, grader, grade and certNumber go to step 1, images to step 2, fmvCents and location to step 3. An unknown field such as `(root)` returns `null`. Every error goes through `failAt`, which opens the field's step and queues focus on it. That one path serves Next-time checks, publish-time re-checks, upload failures and server `validation-error` results. Publishing re-runs steps 1 to 3 in order, so an edit that jumps straight to step 3 still cannot submit invalid data. The form gained client-side checks for description, condition and grading. The server already refuses those inputs, so no payload changes.

Navigation follows the plan. Edit mode can open any step from the indicator. Create mode can open steps only up to the first incomplete one, and can always go back. The Back arrow stays rendered on step 1, invisible and disabled, so the title row never shifts. A user-initiated step change moves focus to a `tabIndex=-1` step heading.

Geometry: the Card class string is unchanged. From `lg` the rail becomes a flex column. The step body is the only `overflow-y-auto` region (and the clipping ancestor `PlaceSearch` measures), and the footer is pinned beneath it as `shrink-0`. Below `lg` the photo panel is step 2's body (`max-lg:hidden` otherwise). At `lg` it stays the left column on every step. `ItemFormSkeleton` was redrawn to step 1's shape.

`StepProgress` keeps the deal bar's exact class set and `aria-hidden` when it has no `onSelect`. `DealSteps` changed only at that one call site.

<details>
<summary>Issues (2)</summary>

1. **Double-click Next → publish (non-blocking)**: the primary button stays in the same place and its label changes to "Save changes" / "Create listing" on step 3. A second fast click on step 2's Next therefore publishes. Edit mode is always valid, so it saves without the seller seeing step 3. Recorded as accepted in the plan (D6). A cheap guard: ignore a publish submit within a few hundred ms of arriving on step 3, or only publish when step 3 has been rendered for one frame.
2. **Stale pendingFocus on current-step click (non-blocking, minor)**: `goToStep(step)` for the already-open step with no error leaves `pendingFocus.current = 'heading'` set without a re-render. A later general error (for example a gate refusal) then also pulls focus to the heading. Make the current step's indicator button a no-op, or clear `pendingFocus` when `n === step`.

</details>

<details><summary>Details</summary>

### Submit path and payload parity

I compared `handleSubmit` with `git show HEAD:components/listings/ItemForm.tsx`. From `locationPayload` onward the code is the same as HEAD: upload, the `createItem` object (title, description, category via `cardGameName`, condition, `grading` undefined for a binder, fmvCents, images, imageDims, location, listingKind) and the `updateItem` object (kept paths followed by uploaded paths, `imageDims` with nulls for kept photos). Only two things changed in this region. The upload failure now goes through `failAt({ field: 'images' })`, which also opens step 2. A redundant `if (!location) return` replaces the old inline location check, which step 3's check already guarantees. `dollarsToCents` was moved without changes (`Math.round(dollars * 100)`). The component tests assert both payloads with exact `toHaveBeenCalledWith` objects.

The diff contains a change to `lib/actions/listings.ts`. It removes `conditionCounts` from the catalog facets and does not touch the item actions. The main tree no longer references `conditionCounts` anywhere, and this pairs with the staged catalog files from the separate listing-revert task. It is not part of this change and does not affect `createItem`/`updateItem`.

### Server error routing

`surfaceActionError` maps a `validation-error` field through `stepForField`. A recognised field opens its step with the message inline and focus on the field: `FIELD_FOCUS_ID` points condition to `graded-yes` when the raw select is not mounted, and images and location to the heading. An unrecognised field becomes a general error that shows on the open step, where before it was cast to `ErrorField` and rendered nowhere. That is an improvement. The gate refusals and the fallback branch are unchanged. The unit test covers every mapping, and the component test checks the title case end to end (jump to step 1, `aria-invalid`, focus).

### Double-submit across the step boundary

Next and publish are the same submit control, and the design pins it in a fixed position (D8). In edit mode, a double-click on step 2's Next lands the second click on step 3's "Save changes", and the save goes through. In create mode the same thing happens when the price comes from a draft and the location from `defaultLocation`, which is common. The plan records this as matching the deal composer, so it is not blocking. The fixed footer does make it more likely than in a scrolling form.

### Focus bookkeeping

The effect on `[step, error]` consumes `pendingFocus`. `goToStep(n)` for the step already open, with no error set, changes no state. Nothing re-renders, and the `'heading'` request stays in the ref until some later `error` change, such as a general error from a gate refusal, triggers the effect. The indicator allows clicking the current step, so this is reachable. The impact is small: an unexpected focus move to the heading.

### Geometry and accessibility

The Card className, `id={ITEM_FORM_ID}`, `noValidate`, both `lg:contents` and the bare `#images` input inside the photo panel are unchanged. The photo panel keeps all its classes plus `step !== 2 && 'max-lg:hidden'` through `cn()`. Each field id appears once. The step wrappers use the `hidden` attribute on blocks with no display utility, and Tailwind 3's `space-y` skips `[hidden]` children, so no gap is left behind. The primary button's invisible sizer is always `submitLabel`, so its width is the same on every step and while "Saving…" shows. The indicator buttons are real `<button>`s with `aria-current="step"`, `sr-only` "Step n:" prefixes, `min-w-0` and wrapping labels, so nothing is forced wider than the card at ~530px. Icons come only from `@hugeicons/react` and `@hugeicons/core-free-icons`. Member copy keeps "Binder or bulk listing" / "Many cards, nothing held", and "shopfront" appears only in comments and code identifiers.

### Tests

The verification note records `tests/unit/itemFormSteps.test.ts` (23 passing) and `tests/component/itemFormSteps.test.tsx` (6 passing). Its account of the jsdom accessible-name workaround (the `invisible` sizer leaks into the name without Tailwind) is plausible and gives me no specific reason to re-run them. Coverage meets criterion 8: step 1 Next blocked, Back keeps data and focus, edit and create publish only from step 3 with exact payloads, step 2 blocked with no photo, a server field error jumps to step 1, and edit can jump from the indicator.

Not tested: the double-click path, a server error on `images` or `location` (opening steps 2 and 3) beyond the unit mapping, binder (`SHOPFRONT`) step 1, and the real `PlacePicker` drop-up in the new step body (stubbed). The Playwright edits were not run, per the user rule.

</details>

<details>
<summary>File map</summary>

- `components/listings/ItemForm.tsx`: step state, `failAt`/`goNext`/`goToStep`, step header + indicator, step bodies, pinned footer
- `lib/listings/itemFormSteps.ts` (new): pure step rules, field→step map, `dollarsToCents`
- `components/ui/step-progress.tsx` (new): shared progress bar, decorative or navigable
- `components/deals/DealSteps.tsx`: inline bar replaced by `StepProgress`
- `components/listings/ItemFormSkeleton.tsx`: redrawn to step 1's geometry
- `lib/listings/itemFormChrome.ts`, `components/layout/mobile-chrome/variants.tsx`: comments only ("Next" label)
- `tests/unit/itemFormSteps.test.ts`, `tests/component/itemFormSteps.test.tsx` (new)
- `tests/e2e/support/listings.ts`, `tests/e2e/specs/listings.spec.ts`: drive the three steps
- Full diff: `git -C c:\dev\Marketplace diff -- components lib tests`

</details>
