# Verification — Edit deal uses the composer's three steps

Per the user's rule, nothing was built, linted, type-checked or tested. Everything below
was checked by reading the source and grepping the tree.

## Files touched by this change

- `components/deals/DealSteps.tsx` (new)
- `components/deals/DealComposeForm.tsx`
- `components/deals/DealEditDialog.tsx`

## Imports resolve (each name grepped to its `export`)

- `DealSteps.tsx`: `SaleTermsBreakdown` / `TradeTermsBreakdown` (`components/deals/DealTermsBreakdown.tsx`);
  `UnlistedPhotoField`, `UnlistedTitleField`, `UnlistedDescriptionField`,
  `UnlistedCategoryConditionFields`, `unlistedDraftGap`, `UnlistedItemDraft`
  (`components/trade/UnlistedItemFields.tsx`); `dollarsToCents` (`domain/deals/dealInvite.ts`);
  `platformFeeCentsFor` (`domain/orchestrator/cashSaleOrchestrator.ts`); `deriveItemTitle`
  (`domain/validation/item.ts`, re-exported from `@/domain/validation`, which the composer
  already imported it through); `formatMoney`, `itemImageUrl` (`lib/format.ts`;
  `itemImageUrl` accepts `undefined`, so `keptPaths[0]` on an empty strip is safe);
  `DialogHeader/Title/Description`, `Label`, `MoneyInput`, `Textarea` (shadcn `ui/`, same
  paths the composer used); `ArrowLeft01Icon` (`@hugeicons/core-free-icons`, previously imported by the composer).
- `DealEditDialog.tsx`: all `DealSteps` names above are exported there; `DEAL_INVITE_ERROR_COPY`
  (`inviteErrors.ts`), `pathsFromUnlistedDraft` (`uploadDealItem.ts`), `FieldError`
  (`motion/FieldError.tsx`), `PendingLabel` (`ui/pending-label.tsx`), `cashPriceProblem` /
  `dollarsToCents`, `updateDealInvite` / `DealInviteEditable` (`lib/actions/dealInvites.ts`),
  `isItemCondition` (`lib/catalog/conditions.ts`). No lucide-react.
- `DealComposeForm.tsx`: every import left after the removal is still used — `useEffect`
  (resume), `HugeiconsIcon` + `LoaderCircleIcon` (restoring screen), `BanknoteIcon` /
  `RepeatIcon` (kind tiles), `DialogHeader/Title/Description` (restoring + kind screens),
  `dollarsToCents` / `cashPriceProblem` (`leaveTerms`, `createLink`). The removed
  `money` helper, `Label`, `MoneyInput`, `Textarea`, `Unlisted*` fields, breakdowns,
  `platformFeeCentsFor`, `deriveItemTitle`, `formatMoney`, `ArrowLeft01Icon` have no
  remaining references.

## Composer create path unchanged

- `git diff -- components/deals/DealComposeForm.tsx` is limited to imports, `PROGRESS`
  (now `DEAL_STEP_PROGRESS`, assignable to `Partial<Record<Step, number>>`), the card/terms
  branches of `gap()` delegating to `dealStepGap` (verbatim rules; profile branch local),
  the three step bodies swapped for `DealCardStep` / `DealTermsStep` / `DealReviewStep`,
  and deletion of the moved `StepHeader` / `DraftPreview` / `NextSteps`.
- Element ids kept: `idPrefix="deal-card"` on Card, `idPrefix="deal"` on Terms gives
  `deal-price`, `deal-wanted`, `deal-value`.
- `StepHeader` still receives `onBack` on every composer step, so the back arrow renders as before.
- Draft store, resume effect, kind chooser, account/profile steps, `createLink` and the
  "Get link" footer are untouched in the diff. `DealComposeDialog.tsx` and
  `app/deals/page.tsx` are unchanged and still fit `DealComposeFormProps`.
- One shared behaviour change in `DraftPreview`: a kept storage path wins over a new
  upload's object URL, and the object URL is cleared when no new image remains (the
  composer previously kept a stale thumbnail after removing its only photo).

## Editor

- Steps `card → terms → review`, "Step N of 3" on each via `DEAL_STEP_PROGRESS`; Card has no
  back arrow (`onBack` undefined), terms→card, review→terms.
- Pre-fill matches HEAD: title, description, category, condition (out-of-scale guard via
  `isItemCondition`), `keptPaths: editable.imagePaths`, price/value dollars, wanted.
- `updateDealInvite` payload compared against `git show HEAD:components/deals/DealEditDialog.tsx`:
  identical for both `CASH_SALE` and `TRADE`. Success: `toast.success('Deal updated')`,
  close, `router.refresh()`. Failure: `DEAL_INVITE_ERROR_COPY` fallback, inline + `toast.error`.
- Final button "Save changes", pending "Saving…" via `PendingLabel`. No IndexedDB.

## Call site

- `DealInviteShare.tsx` lines 104–113 pass `inviteId`, `kind`, `editable`, `currency` and a
  single `<Button>` child. `DealEditDialogProps` is byte-identical to HEAD and `children:
  ReactElement` is unchanged, so the call site still fits. That file itself was not touched
  by this change.

## Tests referencing these components

None. Grepping `tests/**` for `DealEditDialog`, `DealComposeForm`, `DealComposeDialog` and
`DealSteps` returns no matches.

## Unrelated working-tree changes

`DealInviteShare.tsx` (outline buttons), `app/(workspace)/t/[token]/page.tsx` (vertical
centring), `lib/actions/listings.ts` and the staged catalog files belong to earlier requests.
They were left as they are. They were also not committed: this step was told not to commit
anything, so committing them separately is up to the user.
