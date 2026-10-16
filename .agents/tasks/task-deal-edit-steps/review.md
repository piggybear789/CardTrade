# Edit deal reuses the composer's three steps (pass 2)

The "Edit deal" dialog used to be one screen with every field stacked. It now walks the composer's Card → Terms → Review flow with "Step N of 3", pre-filled from the invite. The step bodies, the header with its counter and progress bar, the presence rules and the review preview now live once in `components/deals/DealSteps.tsx`. The composer and the editor both render from it, and each keeps its own state machine and final action. Pass 1 had one blocker: no verification was recorded. `verification.md` now records the import resolution, the composer-parity read, the editor payload compared against HEAD, and the `DealInviteShare` call-site fit. The plan's steps are ticked. Re-reading the current code found no regressions.

Watch for: unrelated earlier work still sits in the working tree (confirmed, non-blocking, carried over from pass 1).

**Verdict**: APPROVED

## High-level view

The extraction is a real single source of truth. The composer's inline Card/Terms/Review JSX and its local `StepHeader`, `DraftPreview` and `NextSteps` were deleted, not left beside the shared versions. Its `gap()` delegates only the card and terms branches to `dealStepGap`. Draft persistence, resume, the kind chooser, the account/profile steps and Get link are untouched. Element ids are kept through `idPrefix`.

The editor's flow is `card → terms → review`, and the deal type is fixed from `kind`. Card has no back arrow, through the now-optional `onBack`. Every field is pre-filled, including `keptPaths` and the out-of-scale condition guard. The `updateDealInvite` payload matches the previous code. Review's button reads "Save changes", or "Saving…" through `PendingLabel`. Success toasts, closes and refreshes. Action failures map through `DEAL_INVITE_ERROR_COPY` and show both inline and as a toast. Upload failures show inline only, exactly as in the composer, so the two flows agree. The header comment states the reversed decision. The wrapper's props and trigger-as-children API are unchanged. No IndexedDB was added.

`DraftPreview` now prefers a kept storage path over a new upload's object URL, so an edit shows its existing photo on Review. It also clears a stale thumbnail when the composer's only photo is removed. That change is shared by both flows and is intended.

<details>
<summary>Issues (1)</summary>

1. **Unrelated changes in the working tree** — confirmed, non-blocking. `DealInviteShare.tsx` (outline buttons), `app/(workspace)/t/[token]/page.tsx` (vertical centring), `lib/actions/listings.ts` and the staged catalog files come from earlier requests. Commit them separately.

</details>

<details>
<summary>File map</summary>

- `components/deals/DealSteps.tsx` (new): shared `StepHeader` (optional back), `dealStepGap`, `DEAL_STEP_PROGRESS`, the Card/Terms/Review step bodies, and `DraftPreview` (now shows kept photos) plus `NextSteps`.
- `components/deals/DealComposeForm.tsx`: renders the shared steps. The moved helpers and their imports are removed.
- `components/deals/DealEditDialog.tsx`: three-step editor, `md:max-w-lg`, new header comment, error toast.
- `components/deals/DealInviteShare.tsx`, `app/(workspace)/t/[token]/page.tsx`, `lib/actions/listings.ts`: unrelated earlier work.

Full diff: `git diff -- components/deals`.

</details>
