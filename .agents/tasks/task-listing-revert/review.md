# Listing detail page restored to its pre-81ca4e8 design, keeping fee note and protection strip (pass 2)

Commit b19cceb puts `/listings/[id]` back to its `81ca4e8^` design, and 47f16e4 fixes the one blocker from pass 1. The restored design has round Buy / Trade / Offer chips, Watch and Report beside the title, badges in the back-nav row, the Card seller section, the inline composer and the glyph phone buyer bar. Three pieces of the redesign stay: the fee-inclusive `$420,000.00` headline, the muted "Includes $X buyer fee" line with its (i) breakdown, and the one-line buyer protection strip linking to `/safety`. 47f16e4 restores `ReportDialog` byte-for-byte to `b19cceb^`, which brings back `appearance="none"` and the controlled `open` / `onOpenChange` that `SellerProfileActions` (3a199b6) depends on.

Watch for: unrelated uncommitted and staged work in the tree (catalog, deals, `lib/actions/listings.ts`) that belongs to other tasks (non-blocking, confirmed).

**Verdict**: APPROVED

## High-level view

The revert is faithful. Against `81ca4e8^`, the pane, stack and buyer bar differ only by later additions that were meant to survive:

- `currency` / `summary` for the fee-inclusive dialogs (fc85e1b)
- `ListingDetails` under the description (dde1a4f)
- `displayLegalName`
- the `WatchButton` count
- the outline `MessageSellerButton`
- "Binder or bulk listing · nothing is held" replacing "Multiple items"

Server actions, money derivation, gates and per-action visibility predicates are unchanged. Migration 0133 and the 6443ea4 copy commit are untouched.

`ListingFeeNote` takes its figures from `platformFeeCentsFor` and `buyerPaysCents` rather than re-deriving them, and renders `FeeInfoPopover`. The page gates it with `showTrust && !isShopfront`. `ListingProtectionLine` pluralises "cards" on a binder, links to `/safety`, and uses a distinct heading id in each of its placements.

The pass-1 regression is resolved. `git diff b19cceb^ HEAD -- components/reports/ReportDialog.tsx` is empty, and against `81ca4e8^` the only difference is the additive `none` / controlled-open mode, which the listing page's `icon` / `icon-only` uses ignore. Nothing references the deleted `ListingSellerRow`, `ListingActionRow`, `ListingOverflowMenu` or `shareListingUrl`, and no file in scope imports `lucide-react`.

<details>
<summary>Issues (1)</summary>

1. **Unrelated work in the tree** (non-blocking, confirmed). These are not part of this task: the staged `CatalogControls.tsx`, `CatalogResults.tsx` and `browseEvents.ts`; the unstaged `lib/actions/listings.ts`; the deals files and the untracked `DealSteps.tsx`. Keep them out of this task's commits.

</details>

<details><summary>Details</summary>

### Verification evidence

The 47f16e4 commit message records two checks. First, `npx vitest --run tests/component/listingPane.test.tsx tests/component/tradeFeeDisclosure.test.tsx` passed: 2 files, 17 tests. Second, `npx tsc --noEmit`, filtered to `ReportDialog` and `SellerProfileActions`, reported no errors. b19cceb's message records 5 files and 38 tests passing.

Not tested:

- The page-level `showTrust` gating. The components are rendered with the flag passed in.
- The seller profile's Report menu at runtime. The type-check confirms the props line up again.

</details>

<details>
<summary>File map</summary>

- `components/reports/ReportDialog.tsx` (47f16e4): restored to `b19cceb^`, which brings back the triggerless controlled mode
- `app/(workspace)/listings/[id]/(detail)/page.tsx`, `loading.tsx`: restored layout plus reservations for the fee note, protection strip and details
- `components/listings/ListingDesktopPane.tsx`, `ListingDetailStack.tsx`, `ListingBuyerBar.tsx`: restored layouts with the three kept pieces
- `components/listings/ListingTrust.tsx`: `ListingFeeNote` and `ListingProtectionLine`
- Deleted: `ListingSellerRow.tsx`, `ListingOverflowMenu.tsx`, `lib/listings/shareListingUrl.ts`
- `tests/component/listingPane.test.tsx`: rewritten for the restored layout and the kept pieces

Full diff: `git -C c:\dev\Marketplace diff 81ca4e8^ HEAD`

</details>
