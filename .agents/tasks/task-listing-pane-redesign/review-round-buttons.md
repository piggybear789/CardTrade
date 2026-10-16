# Round action chips back on the listing pane, plus the declutter follow-ups

Commit `a850778` restores the round `ListingActionIcon` chips that `81ca4e8` replaced with labelled outline buttons. Buy now stays the one full-width primary. Under it, a new `ListingActionRow` lays out Propose trade, Make an offer and Message seller as centred round chips. Trade and Offer keep their pre-`81ca4e8` order, Message is appended through a new `MessageSellerButton variant="action"`, and the now-orphaned `tone` prop is gone. The Part B fixes are in the same commit: fee-note gates restored, the save count moved into the shared meta line for every viewer, "Multiple items" copy replaced with "binder or bulk listing", and the desktop seller fallback aligned to 'Seller'. Server actions, money logic and gating are untouched. Each chip's visibility condition is carried over verbatim.

Watch for: the row keys chips by index rather than by the element key `Children.toArray` already provides (possible, non-blocking). "multi-item listing" survives in `MessageLog.tsx` transcript rewrites. That is pre-existing and SQL-coupled (informational). There was no visual check of the md–lg band or of the skeleton swap.

**Verdict**: APPROVED

## High-level view

The chip set matches history. Before `81ca4e8` the row was Buy, Trade, Offer as three `ListingActionIcon`s, with Save and Report as icons beside the title, never chips. The diff keeps Buy out of the row as the brief requires, restores Trade then Offer by dropping their custom `trigger` props so `ProposeTradeDialog` and `MakeOfferDialog` draw their default chips again, and appends Message. The labelled Offer|Trade grid and the full-width tinted Message section are deleted, along with the `headingId` plumbing they needed.

Visibility is unchanged. `proposeTrade` keeps its auth/owner/availability/seller-setup condition. Offer still needs `showOffer` (single listing with a seller disclosure); the added `&& sellerIdentity` is redundant with `showOffer` and only narrows the type. Message is still `canMessage`. `canMessage` implies `showBuyerBar`, and the `md:hidden` phone Message row lives under that same condition, so phones never see both the row and a Message chip. Below `md` the whole action block is hidden behind the buyer bar.

Geometry holds from `md` up. Slots are equal-basis, `max-w-32` and centred, so a missing chip closes up sideways at the same row height. The desktop skeleton reserves Buy plus three 48px circles over one-line labels inside the same `space-y-group`. The phone skeleton now reserves the `md:hidden` Message row (`h-10`). Owner and guest renders resolve shorter on both, a trade-off the comments acknowledge.

Part B matches the pre-`7f5fe8d` state where history exists. The fee note is `!isShopfront && !isOwner` on desktop and `showTrust && !isShopfront` on phone, byte-for-byte the gates before `7f5fe8d`. The save count is "N saved" as the meta line's last clause, only when N > 0, for every viewer, and the heart no longer carries a number. The binder copy now reads "binder or bulk listing" and states nothing is held in the meta line, form tile, My listings, trade form, negotiation panel and trade contract. Both panes fall back to 'Seller'.

<details>
<summary>Issues (3)</summary>

1. **Index keys in `ListingActionRow`**: use the key `Children.toArray` assigns (`isValidElement(action) ? action.key : index`) rather than the bare index. Today the set is fixed per server render, so this is a nit, but index keys would remount a dialog if a sibling chip ever toggled client-side.
2. **Stale e2e comment**: `tests/e2e/specs/listings.spec.ts` was edited but still says the kind tiles "no longer carry a description". `ItemForm` renders `hint` ("Held for one buyer" / "Many cards, nothing held"). Reword the comment when next touched. The prefix selectors are unaffected.
3. **Residual "multi-item listing" copy**: `components/messages/MessageLog.tsx:337-342` actively rewrites "for a binder or bulk listing." into "for a multi-item listing." It is pre-existing and mirrors `describe_cash_sale_event` (0119), so the fix belongs in a follow-up that changes the SQL and client together. The same goes for `lib/actions/trades.ts:271`. Out of scope here; record it as a follow-up.

</details>

<details><summary>Details</summary>

### Fidelity to the pre-`81ca4e8` row

`81ca4e8^:page.tsx` rendered `BuyButton`/`ShopfrontBuyButton`, then `{proposeTrade}`, then `{showOffer ? <MakeOfferDialog/> : null}`, none with a `trigger`. `81ca4e8^:ListingDesktopPane.tsx` shows `WatchButton variant="icon"` and `ReportDialog appearance="icon-only"` in the title row, and `{children}` in `mt-auto space-y-group pt-group`. So the chip set was exactly Buy/Trade/Offer. The new row is Trade, Offer, Message, with Buy promoted above it. That is the deviation the brief asked for. Both dialogs' default triggers are still `ListingActionIcon` (confirmed: `MakeOfferDialog.tsx:147`, `ProposeTradeDialog.tsx:92`), so removing `trigger` really does bring back the round outline chips, including Offer's `size-7` glyph.

### `ListingActionRow` and the Message chip

```tsx
{actions.map((action, index) => (
  <div key={index} className="min-w-0 md:max-w-32 md:flex-1 md:basis-0">
```

`Children.toArray` drops `null`/`false`, which the test for an empty row covers. The returned elements already carry stable keys, and wrapping them under `key={index}` throws that away (possible, non-blocking; see Issues 1). The file has no `'use client'`, so the server page can still import it.

`MessageSellerButton`'s `action` branch reuses the pending spinner and the constant "Message seller" label, so the e2e helpers (`support/messageSeller.ts`, `phone-message-send.spec.ts`) that `.first()` the accessible name still resolve. The `tone` prop and both of its callers are gone, and the default branch is back to `variant="outline"`, which a test confirms (`bg-card`, not `bg-secondary`).

### Unrelated tree state

`git diff HEAD~1` includes the working tree, which carries unrelated staged and modified deal/catalog work. The commit itself (`git show HEAD --stat`) contains only this plan's 16 files, so the pathspec commit kept the unrelated work out.

### Test coverage

The new component tests cover the meta-line save clause (0 / 1 / 3), the binder meta line, the desktop fee note for buyer vs owner, the 'Seller' fallback, row null-dropping and empty render, and the Message chip vs outline default.

Not tested: chip order and per-chip visibility inside `ItemActions` (a server-page function, not unit-rendered), the phone stack's `showTrust` fee gate, and the `ItemCard` badge fitting beside the heart on a narrow tile. No visual check ran, so the md–lg band label wrapping at `max-w-32` and the skeleton-to-page swap are unverified, as the coder's note states.

</details>

<details><summary>File map</summary>

- `app/(workspace)/listings/[id]/(detail)/page.tsx`: chip row in `ItemActions`, `messageAction` prop, triggers removed, `tone` removed, `watchCount` passed to the stack.
- `app/(workspace)/listings/[id]/(detail)/loading.tsx`: desktop reserves Buy plus three chips; phone reserves the Message row.
- `components/listings/ListingActionIcon.tsx`: new `ListingActionRow`; JSDoc.
- `components/messages/MessageSellerButton.tsx`: `action` variant; `tone` removed.
- `components/listings/ListingDesktopPane.tsx`: meta-line save clause, heart count dropped, fee gate `!isOwner`, 'Seller' fallback.
- `components/listings/ListingDetailStack.tsx`: `watchCount` prop, fee gate `showTrust`, comments.
- `components/listings/ItemCard.tsx`, `ItemForm.tsx`, `components/account/ListingsSection.tsx`, `components/trade/TradeOfferForm.tsx`, `TradeNegotiationPanel.tsx`, `TradeContract.tsx`: binder copy.
- `components/listings/ListingSellerRow.tsx`: header comment.
- `tests/component/listingPane.test.tsx`: updated and new cases.
- `tests/e2e/specs/listings.spec.ts`, `us-region.spec.ts`: comments only.

Full diff: `git -C c:\dev\Marketplace show a850778`.

</details>
