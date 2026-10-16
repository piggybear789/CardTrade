# Verification: item form 3-step refactor (first pass)

Run from `c:\dev\Marketplace`. No build, typecheck, lint, full suite, dev server or
Playwright (user rule).

## Commands and results

1. `npx vitest --run tests/unit/itemFormSteps.test.ts`
   - Test Files 1 passed (1), Tests 23 passed (23).
2. `npx vitest --run tests/component/itemFormSteps.test.tsx`
   - First run: 5 of 6 failed with `Unable to find an accessible element with the role
     "button" and name "Next"`. Cause: jsdom applies no Tailwind, so the primary button's
     `invisible` width sizer (`submitLabel`) leaked into the computed accessible name. In a
     browser `visibility:hidden` text is excluded, so the real name is "Next" / "Create
     listing" / "Save changes". The test now finds the form's `type="submit"` button and
     asserts its live label span instead (`primary(label)` helper). No component change.
   - After that: Test Files 1 passed (1), Tests 6 passed (6).
3. Final combined run:
   `npx vitest --run tests/unit/itemFormSteps.test.ts tests/component/itemFormSteps.test.tsx`
   - Test Files 2 passed (2), Tests 29 passed (29).

## Component test coverage (`tests/component/itemFormSteps.test.tsx`)

1. Create, fresh: "Step 1 of 3", Details has `aria-current="step"`, steps 2 and 3 disabled.
   Next shows "Description must be at least 1 character" inline (Description gets
   `aria-invalid`), stays on step 1, `createItem` not called.
2. Edit: change Title, Next. The "Photos" heading gets focus. "Back to Details" puts focus
   on "Details", and Title still holds the changed value.
3. Edit: Next, Next, then `updateItem` still not called. "Save changes" on step 3 calls it
   once, with the exact pre-refactor payload (`toHaveBeenCalledWith`).
4. Create from `serverDraft`: step 2 Next with no photo is blocked ("Add at least one image
   of your item."). Add a file, Next, then "Create listing" calls `createItem` once with the
   exact payload (`images: ['u/new.jpg']`, `imageDims: [null]`, `listingKind: 'SINGLE'`).
5. Edit: `updateItem` returns `validation-error` on `title`. The form jumps to step 1
   (`aria-current`), shows the message, and Title has `aria-invalid="true"` and focus.
6. Edit: the indicator jumps straight to "Step 3: Price & location".

## Deviation from the plan, recorded

The plan expected "Description is required" for a blank description. The schema's actual
first issue for `''` is `Description must be at least 1 character` (the `min(1)` check).
The step check runs the server's own schema, so it shows the server's own message. The
component test and the e2e spec assert that message. `'   '` still yields "Description is
required" through the schema's `refine`.

## Not run

- Editor diagnostics could not be read from this agent. The touched files were checked by
  reading them. `npm run typecheck` was not run (user rule).
- No existing component or unit test renders `ItemForm`, `DealSteps` or the deal dialogs
  (grepped `tests/unit`, `tests/component`, `tests/property`), so there was nothing else to run.
- Playwright files (`tests/e2e/support/listings.ts`, `tests/e2e/specs/listings.spec.ts`)
  were edited and not run. Pre-existing and untouched: `createListing` clicks `#condition`
  straight after `#game`, but on a single listing that select only renders after "Raw card"
  is chosen.
