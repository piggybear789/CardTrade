# Decluttered listing detail pane (desktop column, phone stack, skeleton)

Commit `7f5fe8d` simplifies the right-hand pane of `/listings/[id]` and the phone stack beside it. The chip row is gone, and a badge now appears only when a listing can't be bought (Under contract, Sold, Closed). Game, condition and location collapse into one muted meta line. The green fee-and-hold line becomes a muted "Includes $X buyer fee" note carrying the (i) breakdown. The bordered three-row protection card becomes one unboxed line. Both layouts now share one borderless `ListingSellerRow`, and Details becomes an unboxed two-column `<dl>`. The user's amendment kept Message seller as the last full-width row of the action stack, tinted `secondary` through a new `tone` prop that defaults to `outline` everywhere else. No action, gate or money path changed.

Watch for: the phone skeleton reserves no space for the phone-only Message button under the seller row (possible small shift, not introduced here); fee note now also renders for owners and unavailable listings (deliberate); binder copy still reads "Multiple items", not "binder or bulk listing" (pre-existing, recorded plan decision); rendered layout is visually unverified.

**Verdict**: APPROVED

## High-level view

Who sees which action is unchanged. `ItemActions` branching, `showOffer = Boolean(sellerIdentity) && !isShopfront`, `showTrust`, `showBuyerBar` and the JSON-LD `availability` are untouched. `canMessage` is the same expression the inline Message condition used before, so the refactor only renamed it. The only buyer-visible logic difference is that the fee note follows `!isShopfront` instead of `showTrust`/`!isOwner`. The (i) popover beside the price already rendered for everyone, so this widens where text appears, not what anyone is told.

The two layouts now draw from shared pieces: `listingMetaLine`, `ListingFeeNote`, `ListingProtectionLine` and `ListingSellerRow`. That ends the drift between a link card on phones and a `Card` on desktop. Both use unique heading ids, because both trees are in the DOM at once. Protection copy is accurate for a Cash_Sale ("your payment is held until you accept the card/cards") and contains no "escrow" wording.

`ListingTrust.tsx` now exports exactly the two components that remain, with a rewritten header. No caller of `ListingFeeLine`, `ListingTrustRows` or the `chips` prop survives anywhere in `app/`, `components/`, `lib/` or `tests/`. No `lucide-react` was added. Every class is an existing token.

The skeleton was rewritten to the new order. Both halves now match the components block for block, apart from the gaps below.

<details>
<summary>Issues (5)</summary>

1. **Phone skeleton omits the phone Message row** — (possible, not introduced here) the stack renders a `md:hidden` `MessageSellerButton` at `mt-snug` under the seller row for signed-in buyers, but `PhoneStackSkeleton` reserves nothing there, so the description may drop about 44px on swap. Consider reserving `mt-snug h-10` in a follow-up.
2. **Fee note shown to owners and on unavailable listings** — (confirmed, deliberate per plan) it was previously gated on `!isOwner` (desktop) / `showTrust` (phone). It's harmless because the popover was already universal; note it for the user.
3. **Binder copy says "Multiple items"** — (confirmed, pre-existing) product rules ask for "binder or bulk listing". The plan kept "Multiple items" to match `ItemCard`/`ItemForm`, and "nothing is held" is now on the page. A copy change app-wide is a separate decision for the user.
4. **Seller name fallback differs between layouts** — (confirmed, nit) the stack passes `'Seller'` and the desktop pane passes `'Unknown seller'` into the same shared row. Pick one.
5. **Visual check not done** — (confirmed) no dev server ran, so the rendered pane and the skeleton → page swap are unverified in a browser. The user should eyeball the available, sold, binder and owner states at ≥1024px and ~390px.

</details>

<details>
<summary>Details</summary>

### Unavailable-only status badge and the meta line

`page.tsx` swaps `STATUS_BADGE` + `listingChips` for `UNAVAILABLE_BADGE` and a computed `unavailableBadge`. It is null when `isAvailable`, "Closed" for a closed shopfront, and otherwise the RESERVED/SOLD entry. `isAvailable` is computed exactly as before. The badge keeps its `aria-label="Availability: …"` in both layouts. The unused `Badge`/`BadgeProps` imports were removed.

`listingMetaLine` gives a single listing `category · condition · location`, which puts the listed date only in Details, as intended. A binder has no Details, so its line keeps "Listed …" and leads with "Multiple items · nothing is held". The phone stack keeps its `line-clamp-2 min-h-[2lh]` reserve, so a missing location still doesn't move anything below.

On desktop, the save count moved to `WatchButton count={watchCount}`. That button only renders for signed-in non-owners, so guests and owners no longer see a public save count. The phone meta line also drops "N saves" outright. The plan accepted this, and the owner still has saves in `ownerStats`.

### Price, fee note and protection line

The price markup is unchanged apart from losing the popover sibling. `ListingFeeNote` computes the fee and total with the same functions the panes used inline (`platformFeeCentsFor`, `buyerPaysCents`, `platformFeeRateLabel`), so the disclosed figure can't drift from the charge. The note and the popover trigger are muted, and no `text-trust` remains on the pane.

The visibility change in issue 2 is that phones used to show the green line only under `showTrust`, and desktop excluded owners. Now a non-shopfront listing always shows the note, including Sold and Reserved ones and the owner's view.

`ListingProtectionLine` keeps the sr-only "How this purchase is protected" heading and links to `/safety`, the same destination the old card's "How buyer protection works" link used.

### Action stack and the Message button

The amendment overrides the target-design item "Message seller moved into the seller card", and the diff follows the amendment. Message stays a full-width `size="lg"` row after `ItemActions`, now `tone="secondary"`. The new `tone` prop defaults to `outline`, so the seller profile and the other call sites are unaffected.

The phone-only copy under the seller row is kept (`md:hidden`, also secondary). Below `md` the action stack is hidden behind the buyer bar whenever `showBuyerBar` is true. `canMessage` implies `showBuyerBar`, so no viewport shows two Message buttons. Buy now is the only `action`-variant (purple) control, and the outline Offer | Trade pair is untouched.

### Seller row

`ListingSellerRow` is borderless with a `border-t pt-group` divider. It always renders both lines: `StarRating` prints "No ratings yet" for null, and the identity line falls back to "Name not verified yet" / "Buyers see your verified name here". Arriving data therefore doesn't change its height.

The separate `#reviews` rating link was dropped to avoid an anchor nested inside the row's anchor. This is a small navigation loss, justified in the header comment. The name fallback mismatch is issue 4.

### Details list

The bordered, right-aligned rows became `grid grid-cols-[auto_minmax(0,1fr)] gap-x-group gap-y-tight` with left-aligned `dd` and `break-words`. Row logic and the PSA verify link are unchanged.

### Skeleton

The badge cluster that the page's nav no longer has is gone from the back-nav row. `DesktopPaneSkeleton` no longer draws the stale round icons, `mt-auto` pin and composer. It now mirrors header (`space-y-snug`), action stack (Buy, the pair, the Message row), protection line, seller row and description.

The desktop skeleton always reserves the Message and protection rows, which a guest or owner won't see. Both sit below the price, so only content further down moves on swap, and only for those viewers.

On the phone side, the old condition pill and bordered seller card are gone. The phone-only Message row isn't reserved: issue 1. The old skeleton didn't reserve it either, so this isn't a regression, but the rewrite was the natural place to fix it.

### Test coverage

`tests/component/listingPane.test.tsx` (9 tests, reported passing in `verification.md`) covers:

- fee-note copy and the (i) trigger
- no `text-trust`
- protection copy and the `/safety` link, with the plural on a binder and no "escrow"
- the seller row's "No ratings yet", real-name and owner/seller link targets
- the pane's absent badge when available, the meta line, the "Sold" badge, and "nothing is held" on a binder

Not tested: `ListingDetailStack` (the phone layout), the `tone` prop on `MessageSellerButton`, `ListingDetails` markup, and the page-level `unavailableBadge` mapping for RESERVED and closed shopfront. Builds, typecheck and the full component project weren't run, per the user's rule. No other test imports the touched components, so the targeted run is adequate evidence.

</details>

<details>
<summary>File map</summary>

- `app/(workspace)/listings/[id]/(detail)/page.tsx`: unavailable-only badge; new pane props; Message gets `tone="secondary"`; chips removed
- `app/(workspace)/listings/[id]/(detail)/loading.tsx`: both skeletons rewritten to the new order; nav badge cluster removed
- `components/listings/ListingDesktopPane.tsx`: badge/meta/price/fee note/actions/protection/seller row/description/details; exports `listingMetaLine`, `ListingStatusBadge`
- `components/listings/ListingDetailStack.tsx`: same content stacked; condition pill, link card and bottom trust rows removed
- `components/listings/ListingSellerRow.tsx` (new): the shared borderless seller row
- `components/listings/ListingTrust.tsx`: `ListingFeeNote` + `ListingProtectionLine` replace the old line and card
- `components/listings/ListingDetails.tsx`: unboxed two-column `<dl>`
- `components/messages/MessageSellerButton.tsx`: `tone` prop (`outline` default, `secondary` opt-in)
- `tests/component/listingPane.test.tsx` (new): pane and primitive tests

Full diff: `git show 7f5fe8d`
</details>
