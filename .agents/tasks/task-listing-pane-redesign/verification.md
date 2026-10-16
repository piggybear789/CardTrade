# Verification — listing pane redesign (iteration 1)

## Ran

- `npx vitest --run tests/component/listingPane.test.tsx` → 1 file, 9 tests passed.
  Covers: `ListingFeeNote` copy + (i) trigger + no `text-trust`; `ListingProtectionLine`
  copy, `/safety` link, plural on a binder, no "escrow"; `ListingSellerRow` always shows
  "No ratings yet", "Real name", seller/owner link targets; `ListingDesktopPane` has no
  availability badge when available, meta line `Pokémon · Graded · Croydon, NSW, Australia`,
  no "Single item", no `text-trust`, "Sold" badge when passed, binder meta says "nothing is held".
- Grep of `tests/**` for removed copy ("Availability: Available", "people saved this",
  "How buyer protection works", "Includes the ", "Single item", "Payment held until"):
  no hits outside the new test.

## Not run (and why)

- `npm run build`, `npm run lint`, `npm run typecheck`, full `npm run test`, and
  `npx vitest --run --project component`: the user's rule forbids routine build/lint/
  typecheck/full-suite runs. No other existing test imports the touched components.
- `tests/unit/actionLogCoverage.test.ts`: no `'use server'` module was touched.
- In-browser visual check (plan step 8): no dev server running, and agents must not start
  one. The rendered layout and skeleton → page swap are UNVERIFIED visually.

## Deviations from the plan text

- Amendment applied: Message seller stays in the action stack, full width, `tone="secondary"`
  (new prop on `MessageSellerButton`, default `outline`, so the seller profile and other
  call sites are unchanged). `ListingSellerRow` has no action slot.
- The phone stack keeps its `md:hidden` Message under the seller row (also `secondary`),
  because below `md` the action stack is hidden behind the buyer bar; removing it would
  have changed who can message on a phone.
- Binder meta reads "Multiple items · nothing is held" (plan said "nothing is reserved");
  the product rule is that binder copy must say nothing is held.
- `ListingProtectionLine` takes a `headingId` so the two in-DOM instances do not share an id.
