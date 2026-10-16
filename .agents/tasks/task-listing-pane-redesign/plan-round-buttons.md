# Implementation Plan: round action chips back on the listing pane, plus the review fixes

Follow-up to `7f5fe8d` ("refactor: declutter listing detail pane"). Work in place on
`main` in `c:\dev\Marketplace` (no worktree). This is a visual and structural change only.
Do NOT change server actions, money logic, gating, or which actions are available to whom.

User's words: "Far too much going on here - figure out a better design" / "I think we
should use the old circle buttons instead" / "No - I mean the former round buttons - bring
them back.... fix the rest too".

## Rules for the coder

- Use absolute paths. Relative paths land in the parent workspace.
- Hugeicons only (`@hugeicons/react` + `@hugeicons/core-free-icons`). No `lucide-react`.
  Use `cn()` and the existing tokens (`gap-tight/snug/cozy/group`, `mt-*`, `space-y-*`,
  `text-meta`, `text-body`, `text-display`). Add no new tokens.
- Keep module header comments and JSDoc accurate. Remove imports and exports that become
  unused. Trades say "trade collateral", never "escrow".
- User rule: do NOT run `npm run build`, `lint`, `typecheck`, the full test suite or
  `npm run dev`. Verify with the targeted Vitest files listed per item, and rely on editor
  diagnostics for types.
- The tree is already dirty with UNRELATED work. Some of it is staged:
  `components/listings/CatalogControls.tsx`, `CatalogResults.tsx`,
  `lib/catalog/browseEvents.ts`. Modified: `app/(workspace)/t/[token]/page.tsx`,
  `components/deals/*`, `lib/actions/listings.ts`. Untracked: `.agents/…`, `.kiro/specs/…`,
  `components/deals/DealSteps.tsx`. None of these overlap this plan. Do not stage, revert or
  commit them. Item 9 commits with a pathspec for that reason.

## What history says (confirmed from `git show 81ca4e8`, `81ca4e8^:…`)

Before `81ca4e8`, `ItemActions` in `app/(workspace)/listings/[id]/(detail)/page.tsx`
rendered, for a signed-in non-owner on an available listing with a seller disclosure:

```tsx
<div className="flex flex-col items-stretch gap-snug md:flex-row md:items-start"
     role="group" aria-label="Start a contract">
  <div className="min-w-0 flex-1">{isShopfront ? <ShopfrontBuyButton …/> : <BuyButton …/>}</div>
  <div className="min-w-0 flex-1">{proposeTrade}</div>
  {showOffer ? <div className="min-w-0 flex-1"><MakeOfferDialog itemId fmvCents sellerIdentity /></div> : null}
</div>
```

- None of the three passed a `trigger`, so each drew its default `ListingActionIcon`:
  - Buy: `ShoppingCart01Icon`, label "Buy now", `variant="default"` (filled primary).
  - Propose trade: `ArrowLeftRightIcon`, label "Propose trade", outline. `emphasize` was
    never passed.
  - Make an offer: `HandCoinsIcon`, label "Make an offer", `iconClassName="size-7"`, outline.
- The order was Buy, Trade, Offer. Offer was absent on a shopfront (`showOffer`). Trade
  was always present inside that branch, because `disabledTradeReason` is null whenever
  `sellerIdentity` exists.
- Message was NEVER a round chip. It was `MessageSellerButton variant="inline"` (a compose
  box) under the row, inside `renderListingActions`.
- The phone stack never used the chips. Below `md` the buyer branch is behind the sticky
  `ListingBuyerBar`. `81ca4e8` also moved Message off the bar into a `md:hidden` row under
  the seller card (`sellerAction`), and that row still exists.
- `81ca4e8` replaced the chips with a full-width `variant="action"` Buy, a
  `grid grid-cols-2` of outline "Make an offer" | "Propose trade" buttons, and a full-width
  Message button. `7f5fe8d` then tinted Message `tone="secondary"`.
- Skeleton before `81ca4e8`: three slots `flex min-w-0 flex-1 flex-col items-center gap-tight`,
  each a `Skeleton size-12 rounded-full` over `TextLines text-body leading-tight`, in a
  `flex items-start gap-snug` row.

## Design decisions

1. **Chip row contents and order.** Buy now stays the full-width filled primary above the
   row, as the step brief requires. Under it, one centred row of round outline chips in the
   pre-`81ca4e8` order with Message appended: **Propose trade, Make an offer, Message
   seller**. Offer is hidden on a shopfront and when the seller has no identity disclosure.
   Trade shows only when it is allowed today (`proposeTrade` non-null). Message shows only
   when `canMessage`. Deviation from history: Buy was the first, filled chip, and Message was
   a composer. The brief keeps Buy out of the row so the page has one loud control, and puts
   Message in the row in place of the full-width tinted button.
2. **Row geometry.** Add a new exported `ListingActionRow` in `ListingActionIcon.tsx`:
   `flex flex-col gap-snug md:flex-row md:items-start md:justify-center`, with each child in
   a `min-w-0 md:max-w-32 md:flex-1 md:basis-0` slot. With one, two or three chips the row
   keeps the same height (a 48px chip, `gap-tight`, one `text-body leading-tight` label) and
   the chips stay centred, so a missing chip moves nothing vertically. `max-w-32` (128px)
   fits "Message seller" on one line. The `flex-col` base mirrors the old row. Below `md`
   the buyer branch is behind the buyer bar, so that case is a fallback only.
3. **Message chip.** Add `variant="action"` to `MessageSellerButton`, rendering
   `ListingActionIcon` (`MessageCircleIcon`, label "Message seller"). The name matches
   `WatchButton`'s `action` variant, which is the same round chip. The accessible name stays
   "Message seller", so e2e helpers still find it. The `md:hidden` phone Message row under
   the seller row STAYS, because the chip row never renders below `md`. It goes back to the
   default outline look. With both `tone="secondary"` callers gone, remove the `tone` prop.
4. **Save count (B3).** Add "N saved" as the LAST clause of the shared `listingMetaLine`,
   for every viewer in both layouts, and only when the count is above 0. This matches the
   old chip's and the catalog tile's "only when > 0" rule. Drop `count={watchCount}` from
   the desktop heart so the number appears once. One shared rule beats a heart count for
   some viewers plus a meta clause for others. It also removes a crowding risk: the heart is
   `size-9 md:size-9`, and a number beside the glyph overflows that box (needs verification;
   moot once removed). Accepted trade-off: the meta figure does not move optimistically when
   the viewer toggles the heart. The heart's colour carries the viewer's own state. The phone
   meta line keeps its `line-clamp-2 min-h-[2lh]` reserve, so geometry is fixed.
5. **Fee note (B2).** Both layouts render `ListingFeeNote` only when
   `showTrust && !isShopfront`, where `showTrust = !isOwner && isAvailable && !myContractId`.
   That is "non-owners on a buyable listing", the brief's stated intent and the phone's
   previous gate. Desktop previously used only `!isOwner`. Unifying on `showTrust` also hides
   the note from non-owners on a sold or reserved listing, which the brief's wording asks for.
   Owners still get "Buyers pay / You receive" in their tools.
6. **Binder copy (B4).** "Multiple items" becomes "binder or bulk listing" in web member
   copy in `app/` and `components/`, and the shared meta line keeps "· nothing is held". The
   catalog tile badge is space-constrained (it shares the photo's top edge with the heart
   pill), so it shows "Binder or bulk" with an `sr-only` " listing". Out of scope, list in
   the final report: `lib/actions/trades.ts:271` ("This listing has multiple items. …") is a
   server-action message, and the step forbids server-action changes. `flutter_app/` has NO
   Dart occurrence; only `flutter_app/SPEC.md:246` prose, which already says "binder listing".
7. **Seller fallback (B5).** `ListingDesktopPane` uses `'Seller'`, the same as
   `ListingDetailStack`.

## Steps

- [ ] 1. Add `ListingActionRow` and refresh `ListingActionIcon`'s docs.
      In `ListingActionIcon.tsx`:
      - Export `ListingActionRow({ label, children, className }: { label: string; children: ReactNode; className?: string })`.
        It does `const actions = Children.toArray(children)`, so nulls drop out, and returns
        `null` when `actions` is empty. Otherwise it renders
        `<div role="group" aria-label={label} className={cn('flex flex-col gap-snug md:flex-row md:items-start md:justify-center', className)}>`
        with each action wrapped in `<div key={…} className="min-w-0 md:max-w-32 md:flex-1 md:basis-0">`.
        Use the element's own key from `toArray`, or the index.
      - Add a JSDoc covering decision 2: centred, one fixed height for one to three chips,
        and why `max-w-32`.
      - Update `ListingActionIcon`'s JSDoc from "Used for Buy / Trade / Offer" to: "Propose
        trade, Make an offer and Message seller in the listing page's action row (also Save
        and Report via their `action`/`icon` appearances)".
      - Add `Children` to the `react` import, and keep `type ReactNode`.
      - The file has no `'use client'`. Keep it that way: it is imported by client
        components AND by the server page.
      Files: `c:\dev\Marketplace\components\listings\ListingActionIcon.tsx`
      Verify: `npx vitest --run tests/unit/typeScaleFloor.test.ts` passes. It scans this
      file for sub-12px bracket sizes, so add no `text-[…]`. Tests for the row come in item 8.

- [ ] 2. Give `MessageSellerButton` a round-chip variant and remove `tone`.
      - Add `'action'` to the `variant` union. Before the `inline` branch, add:
        `if (variant === 'action') return <ListingActionIcon icon={isPending ? LoaderCircleIcon : MessageCircleIcon} iconClassName={isPending ? 'animate-spin' : undefined} label="Message seller" onClick={handleClick} disabled={isPending} aria-busy={isPending} className={className} />;`
        The label is identical in both states, for the same reason as the button variant.
      - Import `ListingActionIcon` from `@/components/listings/ListingActionIcon`.
      - Delete the `tone` prop, its JSDoc and its destructure. The final branch goes back to
        `variant="outline"`. Rewrite that branch's comment to: "Outline: the lavender fill is
        this app's selected state, and a message is a way to ask, not a choice already made."
      - Update the file header ("Two variants") and the `variant` JSDoc so they list
        `button`, `inline`, `icon`, `bar` and `action` (the round chip in the listing page's
        action row). Update the function JSDoc ("with two presentation modes").
      - Before deleting `tone`, confirm no other caller passes it. At planning time only the
        two listing-page calls did, and item 4 removes both. The `SellerProfileActions.tsx`
        and `ListingBuyerBar.tsx` callers are untouched.
      Files: `c:\dev\Marketplace\components\messages\MessageSellerButton.tsx`
      Verify: with items 3 and 4 (the page still passes `tone` until item 4). Then in item 8.

- [ ] 3. Desktop pane and phone stack: save count, fee-note gate, seller fallback, binder copy.
      `ListingDesktopPane.tsx`:
      - `listingMetaLine` takes a new `saves: number` argument and appends
        `saves > 0 ? `${saves} saved` : null` as the LAST part, for both kinds.
        Shopfront first part: `'Binder or bulk listing · nothing is held'`. Update the JSDoc
        example to `Pokémon · Graded · Croydon, NSW, Australia · 3 saved` and mention the
        save clause.
      - Pass `saves: watchCount`. Remove `count={watchCount}` from `<WatchButton>`. Change
        the title-row comment so it no longer says the save count sits beside the heart:
        it is in the meta line. Update the `watchCount` prop JSDoc to "for the meta line".
      - Fee note: `{showTrust && !isShopfront ? <ListingFeeNote … /> : null}`. Update the
        `showTrust` JSDoc to "the fee note under the price and the protection line under the
        actions".
      - `const name = isOwner ? 'You' : (sellerDisplayName ?? 'Seller');`
      - Component JSDoc: say the actions are "Buy now, then a row of round chips".
      `ListingDetailStack.tsx`:
      - Add a `watchCount: number` prop ("Members who saved it, for the meta line") and pass
        `saves: watchCount` to `listingMetaLine`.
      - Fee note: `{showTrust && !isShopfront ? <ListingFeeNote … /> : null}`. Replace the
        "Suppressed for a binder" comment with "Only for a buyer who can buy, and never on a
        binder, whose price is an indicative 'from'". Update the `showTrust` JSDoc likewise.
      - Rewrite the "NO MULTI-ITEM NOTICE" comment to quote "Binder or bulk listing ·
        nothing is held".
      - `sellerAction` JSDoc and the `{sellerAction ? …}` comment stay: phones only,
        because from `md` the action row carries the Message chip.
      Files: `c:\dev\Marketplace\components\listings\ListingDesktopPane.tsx`,
      `c:\dev\Marketplace\components\listings\ListingDetailStack.tsx`
      Verify: with item 4, since the page must pass `watchCount` to the stack.

- [ ] 4. Wire the page: chip row in `ItemActions`, Message chip, no `tone`.
      In `app/(workspace)/listings/[id]/(detail)/page.tsx`:
      - Import `ListingActionRow` from `@/components/listings/ListingActionIcon`. Add
        `type ReactNode` to the `react` import. After the edits, drop `ArrowLeftRightIcon`
        and `HandCoinsIcon` from the Hugeicons import if they are unused. `ShoppingCart01Icon`
        stays (Buy trigger).
      - `ItemActions` gets a new prop `messageAction: ReactNode` with the JSDoc "The Message
        seller chip, or null. Rendered last in the action row." In `renderListingActions`,
        pass
        `messageAction={canMessage ? <MessageSellerButton itemId={item.id} sellerId={item.owner_id} variant="action" /> : null}`.
        Delete the trailing `<section aria-labelledby={headingId}>…MessageSellerButton…</section>`
        and its "A BUTTON, NOT A COMPOSER" comment. Drop the `headingId` parameter and update
        both call sites (`'message-seller-heading'` and `'message-seller-heading-desktop'`).
        `canMessage` is unchanged, and it is exactly the condition for reaching the buyer
        branch, so who can message does not change.
      - `proposeTrade`: remove the `trigger={…}` prop so `ProposeTradeDialog` draws its
        default outline `ListingActionIcon`. Keep every other prop and the visibility
        condition. Update the comment above it ("Desktop never shows a dead Propose Trade
        chip …; Message is still available beside it").
      - Buyer branch return:
        ```tsx
        <div className="space-y-group">
          {!sellerIdentity ? (<StatusNotice …unchanged… />) : (
            <div role="group" aria-label="Start a contract">
              {isShopfront ? <ShopfrontBuyButton …unchanged trigger… /> : <BuyButton …unchanged trigger… />}
            </div>
          )}
          <ListingActionRow label="Other ways to deal">
            {proposeTrade}
            {showOffer && sellerIdentity ? (
              <MakeOfferDialog itemId={itemId} fmvCents={fmvCents} currency={currency} sellerIdentity={sellerIdentity} />
            ) : null}
            {messageAction}
          </ListingActionRow>
          {regionGateNotice}
        </div>
        ```
        `MakeOfferDialog` loses only its `trigger`, so its default chip (`HandCoinsIcon`,
        `iconClassName="size-7"`) returns. The Buy triggers, the `summary`, `showOffer` and
        the payout-setup notice are unchanged. Delete the old
        `grid grid-cols-2 / grid-cols-1` wrapper.
      - Rewrite the comment block above `showOffer` ("ONE FILLED ACTION, THEN TWO
        OUTLINES…") to: "ONE FILLED ACTION, THEN A ROW OF ROUND CHIPS. Buy now is the
        full-width primary. Propose trade, Make an offer and Message seller are round
        `ListingActionIcon` chips under it, in the order the row had before `81ca4e8`
        (Trade, Offer), with Message last. `81ca4e8` swapped the chips for labelled outline
        buttons, and that column had too much going on."
      - The stack's `sellerAction` (`md:hidden`): remove `tone="secondary"` and keep
        `variant="button" size="default" className="w-full"`.
      - Pass `watchCount={watchCount}` to `<ListingDetailStack>`.
      - Leave `showTrust`, `canMessage`, `showBuyerBar`, `unavailableBadge`, the JSON-LD and
        every other branch of `ItemActions` exactly as they are.
      Files: `c:\dev\Marketplace\app\(workspace)\listings\[id]\(detail)\page.tsx`
      Verify: `npx vitest --run tests/unit/moneyCurrencyRendering.test.ts tests/unit/navigationGraph.test.ts tests/unit/typeScaleFloor.test.ts`
      passes. The first two scan this page. Editor diagnostics show no errors in the page,
      `MessageSellerButton.tsx`, `ListingDesktopPane.tsx` or `ListingDetailStack.tsx`.
      Needs verification during implementation: at `lg` the pane is about half the content
      width. Confirm three 128px-max chips plus two `gap-snug` fit without the labels
      wrapping. If a label wraps, the row grows a line for that listing only. If wrapping
      shows up, drop `md:max-w-32` to `md:max-w-28`, not the gap.

- [ ] 5. Skeleton: reserve the chip row on desktop and the phone Message row.
      In `loading.tsx`:
      - `DesktopPaneSkeleton` action block becomes:
        `<div className="space-y-group">`, then `<Skeleton className="h-10 w-full" />` (Buy,
        `size="lg"` is `md:h-10`), then
        `<div className="flex items-start justify-center gap-snug">` with three
        `<div className="flex min-w-0 max-w-32 flex-1 basis-0 flex-col items-center gap-tight">`
        slots. Each slot holds `<Skeleton className="size-12 rounded-full" />` and
        `<TextLines className="text-body leading-tight" widths={['w-2/3']} />`. Delete the
        `grid grid-cols-2` pair and the full-width Message reserve. The comment should say:
        Buy, then the round-chip row; three chips reserved; the row is one height for one to
        three chips, so a binder or a seller without payout setup moves nothing below it.
      - `PhoneStackSkeleton`: after `<SellerRowSkeleton className="mt-group" />`, add
        `<Skeleton className="mt-snug h-10 w-full md:hidden" />` (B1). Comment: the
        `md:hidden` Message row a signed-in buyer gets under the seller row (`size="default"`
        is `h-10` below `md`). A guest or owner sees the description rise by that much,
        which is accepted because a buyer is the common reader. The chip row is NOT reserved
        here. It renders below the description in the md–lg band only, so it moves nothing
        above it.
      - Fee-note reserves stay in both halves (the common reader is a buyer who can buy).
        Add a one-line note that owners and unavailable listings resolve without it.
      - Update the header comment: Desktop is "…price, fee note, Buy now and the round-chip
        row, protection line, seller row, description". Phone is "…the seller row, the
        phone Message row, description".
      Files: `c:\dev\Marketplace\app\(workspace)\listings\[id]\(detail)\loading.tsx`
      Verify: editor diagnostics are clean. No test imports this file. It is checked in the
      item 10 visual pass.

- [ ] 6. Binder copy across web member copy (B4).
      - `components/listings/ItemCard.tsx` (~267): the tile badge text "Multiple items"
        becomes `Binder or bulk<span className="sr-only"> listing</span>`. Needs
        verification: the badge must not reach the heart pill at `right-1.5` on a narrow
        2-column phone tile.
      - `components/listings/ItemForm.tsx` (~182): SHOPFRONT option becomes
        `label: "Binder or bulk listing"`, `hint: "Many cards, nothing held"`. Check the
        `LISTING_KINDS` comment above still reads right.
      - `components/account/ListingsSection.tsx:233`: `'Multiple items'` becomes
        `'Binder or bulk listing'`.
      - `components/trade/TradeOfferForm.tsx:354`: `multiple items` becomes
        `binder or bulk listing`.
      - `components/trade/TradeNegotiationPanel.tsx:270`: "The listing has multiple items,
        so this is the record…" becomes "This is a binder or bulk listing, so this is the
        record…".
      - `components/trade/TradeContract.tsx:1227`: "The listing has multiple items, so
        nothing in it is held." becomes "This is a binder or bulk listing, so nothing in it
        is held."
      - `listingMetaLine` was done in item 3.
      - Do NOT touch `lib/actions/trades.ts:271` (server action) or `flutter_app/`. List both
        in the final report.
      - Afterwards, re-run the search for `Multiple items|multiple items` over `app/` and
        `components/`. Only comments may remain, and those should be reworded too.
      Files: the six component files above.
      Verify: `npx vitest --run tests/component/tradeFeeDisclosure.test.tsx` passes. It
      renders `TradeNegotiationPanel`, and at planning time it asserted none of this copy.

- [ ] 7. Comment touch-ups that would now be false.
      - `components/listings/ListingSellerRow.tsx` header: "\"Message seller\" stays in the
        action stack, not here" becomes "\"Message seller\" is a chip in the action row (and,
        on phones, its own row under this one), not part of the row".
      - `components/listings/WatchButton.tsx`: leave the `count` prop. `ItemCard` still uses
        it. Only check that no comment claims the listing page uses it.
      - `tests/e2e/specs/us-region.spec.ts:177-181`: the comment says "Buy now" comes "via
        `ListingActionIcon`". Buy now is a `Button` trigger, so reword the comment. Do not
        change the selector.
      Files: the three above.
      Verify: no runtime effect. Covered by item 8.

- [ ] 8. Update and extend `tests/component/listingPane.test.tsx`.
      - Add `vi.mock('@/lib/actions/messages', () => ({ getOrCreateConversation: vi.fn(), sendMessage: vi.fn() }))`.
      - Existing meta expectation: props have `watchCount: 3`, so expect
        `'Pokémon · Graded · Croydon, NSW, Australia · 3 saved'`.
      - Binder expectation: `/^Binder or bulk listing · nothing is held/`.
      - Add `listingMetaLine` unit cases: `saves: 0` has no "saved" clause; `saves: 1` ends
        with "· 1 saved".
      - Fee note: the pane with `showTrust={false}` has no text matching /buyer fee/. With
        `showTrust` it has one.
      - Seller fallback: the pane with `sellerDisplayName={null}` renders "Seller" and no
        "Unknown seller".
      - `ListingActionRow`: with `[<button>A</button>, null, <button>B</button>]` it renders
        a `group` named "Other ways to deal" containing exactly two buttons. With only
        `null` children it renders nothing (`container` is empty).
      - `MessageSellerButton variant="action"`: renders a button named "Message seller"
        whose chip span has `md:rounded-full` (the round chip). `MessageSellerButton` with
        no `variant`/`tone` renders a button with the outline classes (`bg-card`), not
        `bg-secondary`.
      - Update the file header comment to mention the round-chip row and the meta-line save
        count.
      Files: `c:\dev\Marketplace\tests\component\listingPane.test.tsx`
      Verify: `npx vitest --run tests/component/listingPane.test.tsx`. All tests pass.

- [ ] 9. Commit locally on `main` (do not push).
      First run `git -C c:\dev\Marketplace status --short` and confirm the unrelated
      staged/modified files listed under "Rules for the coder" are still there and untouched.
      Commit ONLY this plan's files with a pathspec, so the unrelated staged files stay out:
      `git -C c:\dev\Marketplace commit -m "refactor: bring back round action chips on listing pane" -- "app/(workspace)/listings/[id]/(detail)/page.tsx" "app/(workspace)/listings/[id]/(detail)/loading.tsx" components/listings/ListingActionIcon.tsx components/listings/ListingDesktopPane.tsx components/listings/ListingDetailStack.tsx components/listings/ListingSellerRow.tsx components/listings/ItemCard.tsx components/listings/ItemForm.tsx components/account/ListingsSection.tsx components/messages/MessageSellerButton.tsx components/trade/TradeOfferForm.tsx components/trade/TradeNegotiationPanel.tsx components/trade/TradeContract.tsx tests/component/listingPane.test.tsx tests/e2e/specs/us-region.spec.ts`
      Add any file you actually touched beyond this list, and drop any you did not touch.
      Do not use `git add -A` or `git add .`.
      Verify: `git -C c:\dev\Marketplace show --stat HEAD` lists only those files. Afterwards,
      `git status` still shows `CatalogControls.tsx`, `CatalogResults.tsx` and
      `browseEvents.ts` as staged.

- [ ] 10. Visual check (needs verification; the coder cannot see the render by reading).
      If a dev server is ALREADY running, open `/listings/<id>`. Do not start one. Check:
      - ≥1024px: a single listing with a verified seller shows Buy now, then three centred
        round chips (Trade, Offer, Message) with one-line labels. A binder shows two chips
        (Trade, Message), centred, with the same row height. A seller without payout setup
        shows the notice, then the Message chip alone. A guest gets the sign-in notice and
        no chips. The owner gets the owner tools and no fee note.
      - The md–lg band (about 800px): the same chip row under the stack. There is no phone
        Message row (it is `md:hidden`).
      - ~390px: buyer bar, plus a phone Message row under the seller row in outline, not
        tinted.
      - The meta line ends "· N saved" when N > 0. The heart shows no number.
      - The skeleton-to-page swap does not move the title, price or Buy now.
      If no server is running, record this item as unverified in the final report.

## Verification checklist (targeted only; no build, lint, typecheck or full suite)

- `npx vitest --run tests/component/listingPane.test.tsx`
- `npx vitest --run tests/component/tradeFeeDisclosure.test.tsx`
- `npx vitest --run tests/unit/typeScaleFloor.test.ts tests/unit/moneyCurrencyRendering.test.ts tests/unit/navigationGraph.test.ts`
- Editor diagnostics are clean on every touched `.tsx`.
- Search sanity, NOT verification: no `tone=` on `MessageSellerButton` anywhere; no
  `Multiple items` / `multiple items` in `app/` or `components/` member copy; no
  `Unknown seller` in `components/listings/`.

## e2e selectors (do not run e2e; listed so nothing breaks silently)

Every accessible name stays the same, so no selector should break. Playwright's
`getByRole` name match is case-insensitive substring by default and skips `display:none`
copies.

- `'Propose Trade'`: `guards.spec.ts:266`, `trade.spec.ts:103`, `debug/guards-probe.spec.ts:32,72`
  (its comment "it's a ListingActionIcon" becomes true again), `debug/address-hunt.spec.ts:38`,
  `debug/hold-probe.spec.ts:40`, `debug/trade.spec.ts`, `support/auditFixtures.ts:61`.
  These match the chip label "Propose trade".
- `'Make an offer'`: `offers.spec.ts:63`, `debug/inspect.spec.ts:350,382,428`. These match
  the chip label.
- `'Message seller'` `.first()`: `support/messageSeller.ts:65`,
  `debug/phone-message-send.spec.ts:44`. These match the new chip at md+ and the phone row
  below md.
- `'Buy now'`: `us-region.spec.ts:182`, `guards.spec.ts:295`, `cash-sale.spec.ts:111`,
  `debug/*`. Buy is unchanged.
- `listings.spec.ts:152-153`: the owner sees no Buy or Propose Trade. Unchanged.
- Nothing in `tests/` selects "Multiple items", "people saved this" or
  `aria-label="Start a contract"`.

## Report back to the user

- The confirmed history (decision list above), and that Message and Buy differ from the
  pre-`81ca4e8` row as specified.
- Remaining "multiple items" copy outside scope: `lib/actions/trades.ts:271`. No Dart
  occurrences in `flutter_app/`, only `SPEC.md:246` prose.
- The save count no longer updates optimistically on the heart toggle.
- Whether the visual check ran.
