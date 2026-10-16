# Implementation Plan — Edit deal uses the composer's three steps

## Decisions

- **Extract shared pieces, not a mode prop.** `DealComposeForm` is entangled with the
  signed-out draft (IndexedDB), resume, the `kind` chooser and the account/profile steps;
  a `mode="edit"` prop would thread conditionals through all of them. Instead, move the
  step UI into a new module `components/deals/DealSteps.tsx` that both the composer and
  the editor render. One source of truth for the step bodies, the gap rules, the header
  and the progress bar; each caller keeps its own state machine and its own final action.
- **Back on Card in the editor: no back arrow.** `StepHeader`'s `onBack` becomes optional;
  when omitted, the arrow is not rendered. There is no `kind` step to return to, and the
  dialog's own close button already exits (a dead or exit-ish arrow would be a second
  close). The composer always passes `onBack`, so its header is unchanged.
- **Editor titles:** steps 1 and 2 title `Edit deal`, step 3 `Review your changes`; every
  editor step carries the description `The link stays the same.` (today's editor copy).
- **Review preview must show existing photos.** `DraftPreview` today only builds an object
  URL from `card.images[0]`; an edit's photos are `keptPaths`. The shared preview uses
  `itemImageUrl(card.keptPaths[0])` (from `@/lib/format`, same as `UnlistedPhotoField`)
  when a kept path exists — kept photos come first in the strip — else the object URL of
  `images[0]`, else the empty tile. Also clear the thumb when there is no new image.
- **Editor final action:** `Save changes` / pending `Saving…` via `PendingLabel` (matches
  composer footer geometry). Calls `updateDealInvite` with today's exact payload; on
  success `toast.success('Deal updated')`, close, `router.refresh()`; on failure
  `setError(result.message || DEAL_INVITE_ERROR_COPY[result.error])` (inline, as today)
  **plus** `toast.error(message)` to match the composer and the "request failures as
  toasts" rule. No Cancel button (the composer has none; the dialog's X closes).
- No IndexedDB persistence in the editor. Composer behaviour unchanged.
- Tests: nothing under `tests/` references `DealEditDialog`, `DealComposeForm` or
  `DealComposeDialog` (grepped). Per user rules, do NOT run build/lint/typecheck/tests;
  verify by editor diagnostics and reading.

## Steps

- [x] 1. Create `components/deals/DealSteps.tsx` (`'use client'`, header comment: the
      three step bodies shared by the composer and the editor so the host edits a deal in
      the shape they built it). Export:
      - `DEAL_STEP_PROGRESS = { card: 1, terms: 2, review: 3 } as const` and
        `type DealStepName = 'card' | 'terms' | 'review'`.
      - `StepHeader` — moved verbatim from `DealComposeForm.tsx`, with `onBack?: () => void`
        (arrow rendered only when provided) and `backDisabled?: boolean`.
      - `dealStepGap(step, { card, selling, priceCents, wanted, valueCents }): string | null`
        — the card/terms branches of the composer's `gap()` verbatim (`unlistedDraftGap`,
        'Enter a price.', 'Say what you want for it.', 'Say what your card is worth.');
        returns `null` for review.
      - `DealCardStep({ card, onCard, selling, idPrefix })` — the four `Unlisted*` fields
        exactly as the composer renders them (label 'What are you selling?' /
        'What are you swapping?', same placeholder), ids from `idPrefix`.
      - `DealTermsStep({ selling, idPrefix, currency, priceDollars, onPriceDollars,
        wanted, onWanted, valueDollars, onValueDollars })` — the composer's sale branch
        (Price `MoneyInput`, `SaleTermsBreakdown`, postage note) and trade branch (wanted
        `Textarea`, value `MoneyInput`, `TradeTermsBreakdown`). Ids `${idPrefix}-price`,
        `-wanted`, `-value`. Computes cents internally with `dollarsToCents`.
      - `DealReviewStep({ card, selling, priceCents, wanted, currency })` — the composer's
        review block ("What they will see" + `DraftPreview` with the
        `They pay …` / `Wants: …` line using `platformFeeCentsFor` + `formatMoney`, and
        "What happens next" + `NextSteps` with the same two item lists).
      - Keep `DraftPreview` and `NextSteps` as module-private helpers, with the keptPaths
        thumbnail fix described above.
      Imports: `@/components/trade/UnlistedItemFields`, `@/components/deals/DealTermsBreakdown`,
      `@/components/ui/{dialog,label,money-input,textarea}`, `@hugeicons/react`,
      `ArrowLeft01Icon`, `@/domain/deals/dealInvite` (`dollarsToCents`),
      `@/domain/orchestrator/cashSaleOrchestrator` (`platformFeeCentsFor`),
      `@/domain/validation` (`deriveItemTitle`), `@/lib/format` (`formatMoney`, `itemImageUrl`).
      Files: components/deals/DealSteps.tsx
      Verify: editor diagnostics clean on the new file; every import path resolves.

- [x] 2. Refactor `DealComposeForm.tsx` to render the shared pieces with no behaviour change:
      replace `PROGRESS` with `DEAL_STEP_PROGRESS` (lookup typed as
      `Partial<Record<Step, number>>`), make `gap()` delegate card/terms to `dealStepGap`
      (profile branch stays local), swap the inline card/terms/review JSX for
      `<DealCardStep idPrefix="deal-card">`, `<DealTermsStep idPrefix="deal">` (ids remain
      `deal-price`, `deal-wanted`, `deal-value`), `<DealReviewStep currency={quoteCurrency}>`,
      and import `StepHeader` (still always passing `onBack`). Delete the now-moved local
      `StepHeader`, `DraftPreview`, `NextSteps`, and unused imports (`ArrowLeft01Icon`,
      `Label`, `MoneyInput`, `Textarea`, `Unlisted*` fields except `EMPTY_UNLISTED_DRAFT` /
      `UnlistedItemDraft`, breakdowns, `platformFeeCentsFor`, `deriveItemTitle`,
      `formatMoney`/`money` if unused). Keep `dollarsToCents` / `cashPriceProblem` /
      `unlistedDraftGap` only where still referenced. Draft, resume, account, profile,
      Get link untouched.
      Files: components/deals/DealComposeForm.tsx
      Verify: editor diagnostics clean (no unused imports); `DealComposeDialog.tsx` still
      type-fits `DealComposeFormProps`; read through each step and confirm identical markup.

- [x] 3. Rewrite `DealEditForm` in `DealEditDialog.tsx` as a three-step flow. Keep the
      `DealEditDialog` wrapper, its props and trigger-as-children API unchanged (so
      `DealInviteShare.tsx` is untouched); give `DialogContent` `className="md:max-w-lg"` to
      match the composer. State: `step: DealStepName` starting `'card'`, plus the existing
      prefilled `card` (with `isItemCondition` guard and `keptPaths: editable.imagePaths`),
      `priceDollars`, `valueDollars`, `wanted`, `error`, transition. Back map:
      terms→card, review→terms, card→none. `missing = dealStepGap(step, …)`. Next on card →
      terms; Next on terms runs `cashPriceProblem` for sales (as the composer's `leaveTerms`)
      then → review; review button `Save changes` runs the existing `save()` body (upload via
      `pathsFromUnlistedDraft`, `updateDealInvite` payload unchanged, toast + close + refresh,
      error inline + `toast.error`). Render `StepHeader` (title/description per Decisions,
      `progress={DEAL_STEP_PROGRESS[step]}`), the step body with `idPrefix="deal-edit"`,
      `FieldError`, the blocker line `id="deal-edit-blocker"`, and a `DialogFooter` with one
      button using `PendingLabel` (`pendingLabel="Saving…"`, resting `Next` / `Save changes`).
      Replace the header comment's "ONE SCREEN…" paragraph with: the edit reuses the
      composer's three steps (`DealSteps.tsx`) so the host edits the deal in the same shape
      they built it; the deal type stays non-editable because a sale and a trade are
      different contracts, so switching is a new link. Drop now-unused imports
      (`DialogClose`, `DialogHeader/Title/Description`, `Label`, `MoneyInput`, `Textarea`,
      breakdowns, `Unlisted*` field components, `LoaderCircleIcon`, `HugeiconsIcon`).
      Files: components/deals/DealEditDialog.tsx
      Verify: editor diagnostics clean; `DealInviteShare.tsx` call site (`inviteId`, `kind`,
      `editable`, `currency`, `<Button>` child) still type-checks in the editor; manual read
      confirms step 1 has no back arrow, "Step N of 3" shows on all three steps, and the
      payload passed to `updateDealInvite` matches the previous code exactly.
