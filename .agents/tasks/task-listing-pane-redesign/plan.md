# Implementation Plan — listing detail pane simplification

Scope: `/listings/[id]` right-hand pane (desktop `ListingDesktopPane`) and the stacked
phone/tablet layout (`ListingDetailStack`), plus the route skeleton. Visual and
structural only. Do NOT touch server actions, `ItemActions` branching/gating, fee maths,
`ListingBuyerBar`, or which actions appear for whom.

Paths (use absolute paths; relative paths land in the parent workspace):
- Page: `c:\dev\Marketplace\app\(workspace)\listings\[id]\(detail)\page.tsx`
- Skeleton: `c:\dev\Marketplace\app\(workspace)\listings\[id]\(detail)\loading.tsx`
- `c:\dev\Marketplace\components\listings\ListingDesktopPane.tsx`
- `c:\dev\Marketplace\components\listings\ListingDetailStack.tsx`
- `c:\dev\Marketplace\components\listings\ListingTrust.tsx`
- `c:\dev\Marketplace\components\listings\ListingDetails.tsx`
- New: `c:\dev\Marketplace\components\listings\ListingSellerRow.tsx`
- New test: `c:\dev\Marketplace\tests\component\listingPane.test.tsx`

## Current structure vs the screenshot summary (confirmed by reading)

Desktop matches the summary, with these specifics:
- Chip row is built in `page.tsx` as `listingChips` (`<Badge variant={statusBadge.variant}>`
  — `STATUS_BADGE.AVAILABLE` is `variant: "default"` = `bg-primary`, the purple chip;
  category `Badge variant="secondary"`; condition `Badge variant="outline"`; then a
  `text-meta` span "N person/people saved this") and passed as the `chips` prop.
- Meta line is `[isShopfront ? 'Multiple items' : 'Single item', 'Listed …', 'Based in …']`.
- Green line is `ListingFeeLine` (`text-meta font-medium text-trust` + `ShieldCheckIcon`).
- The four buttons are `ItemActions` (Buy now `variant="action" size="lg"`; `grid grid-cols-2
  gap-snug` of Make an offer / Propose trade, both `variant="outline" size="lg"`) plus a
  full-width `MessageSellerButton variant="button" size="lg"` appended by
  `renderListingActions(headingId)` inside a `section aria-labelledby={headingId}`.
- Protection card is `ListingTrustRows` (`rounded-lg border bg-card`, `divide-y`, 3 rows,
  `border-t` link "How buyer protection works" → `/safety`).
- Seller card is `<Card className="p-group">`; rating links to `/sellers/{id}#reviews`.
- Details is `ListingDetails` (`divide-y … rounded-lg border bg-card` rows), passed as
  `details`; it is `null` for a shopfront.

Discrepancies to know about:
1. The PHONE stack has no chip row at all. It shows a condition pill beside the price
   (`rounded-full bg-mist`), the green `ListingFeeLine` (only when `showTrust`), a 2-line
   meta line `[saves, category, kindLabel, Listed…, Based in…]`, a whole-card `<Link>`
   seller card with a chevron, Message below it (`md:hidden` wrapper, from page), then
   description, details, and `ListingTrustRows` LAST.
2. `loading.tsx`'s `DesktopPaneSkeleton` is already stale: it draws a badge cluster in the
   back-nav row (the page's nav has only the back button now), seller card BEFORE the
   actions, three round `size-12` action icons and an inline composer pinned with
   `mt-auto`. None of that exists any more. It must be rewritten (item 6).
3. Member copy for a SHOPFRONT is "Multiple items" everywhere (`ItemForm`, `ItemCard`,
   both panes), and `ListingDetailStack` documents that "Binder listing" was removed on
   purpose. DECISION: keep "Multiple items" so this page agrees with the catalog tile and
   the listing form; renaming member copy app-wide is out of scope for a visual pass.
   The "nothing is held" statement already lives in the shopfront flows
   (`ProposeTradeDialog`, buy bar "Nothing is held for you yet"); this pass adds a short
   clause to the shopfront meta line so the page itself says it (item 4/5).
4. `WatchButton` (`variant="icon"`) ALREADY supports a `count` prop drawn beside the heart
   with the optimistic toggle applied — no new component needed.

## Existing tokens to reuse (from `tailwind.config.ts` and current markup)

Spacing: `tight` 0.25rem, `snug` 0.5rem, `cozy` 0.75rem, `group` 1rem, `section` 2rem,
`region` 4rem (used as `gap-*`, `mt-*`, `p*-*`, `space-y-*`).
Type: `text-meta` (0.75/1.4), `text-body` (0.875/1.6), `text-lead` (1/1.5),
`text-subhead`, `text-head` (1.3125/1.25), `text-display` (1.75/1.1); `font-display`.
Colour: `text-muted-foreground`, `text-foreground`, `border-border`, `text-iris-ink`,
`focus-visible:border-iris`. Do NOT use `text-trust` on this pane after the change.
Primitives: `Badge` variants `secondary` / `outline`; `Button` variants `action`,
`outline`, `ghost`, sizes `sm` (`h-9 md:h-8`), `lg` (`h-11 md:h-10`); `Avatar size="md"`
(40px); `Skeleton`, `TextLines`; `cn()` from `@/lib/utils`. Icons: `HugeiconsIcon` +
`ShieldCheckIcon` from `@hugeicons/core-free-icons`. No new tokens.

## Where each piece of today's content goes

| Today | After |
|---|---|
| "Available" chip | Gone. A badge renders only when NOT available: "Under contract" (`secondary`), "Sold" (`outline`), shopfront "Closed" (`outline`). Open shopfront: no badge. |
| Game / condition chips | One muted meta line under the title: `Pokémon · Graded · Croydon, NSW, Australia`. |
| "N people saved this" chip (desktop) / "N saves" (phone meta) | Desktop: `count={watchCount}` on the existing heart `WatchButton`. Phone: dropped from the meta line (the phone header heart is published by `ListingChromePublisher`; leave it as it is). Guests and owners lose the public count on the page; the owner still has saves in `ownerStats`. Accepted. |
| "Single item" | Dropped. Shopfront meta leads with "Multiple items · nothing is reserved". |
| "Listed 2 Oct" | Details "Listed" row (already there). Shopfront has no Details, so its meta line keeps `Listed {relative}`. |
| "Based in Croydon…" | Meta line (location label as-is, no "Based in"). Also stays in Details "Location". |
| Condition pill beside phone price | Removed; condition is in the meta line. |
| Green fee + hold line | Muted subline `Includes {fee} buyer fee` + `FeeInfoPopover` trigger moved from beside the price to the end of this subline. Hold clause removed (protection line says it). |
| Message seller (full-width in action stack, and phone `md:hidden` copy) | One small outline button (`size="sm"`) right-aligned in the seller row, at every width. |
| 3-row protection card | One unboxed line (see copy below) under the actions on desktop; under the price block on the stack. |
| Seller `Card` / phone bordered link card | Shared `ListingSellerRow`: no box, a `border-t border-border pt-group` divider above. |
| Details bordered rows | Compact unboxed two-column `<dl>` grid. |

## ListingTrust.tsx exports

- `ListingFeeLine` — DIES. Replaced by `ListingFeeNote({ priceCents, currency, className })`:
  `<p className="flex items-center gap-tight text-meta text-muted-foreground">Includes {fee} buyer fee<FeeInfoPopover …/></p>`,
  where `fee = formatMoney(platformFeeCentsFor(priceCents, currency), currency)` and the
  popover gets exactly the props both panes pass today
  (`priceText`, `feeText`, `totalText` from `buyerPaysCents`, `rateLabel` from
  `platformFeeRateLabel`). This removes the duplicated popover wiring from both panes.
- `ListingTrustRows` — DIES, with `ROWS` and the `DeliveryTruck01Icon`,
  `JusticeScale01Icon`, `ViewIcon` imports. Replaced by
  `ListingProtectionLine({ isShopfront, className })`.
- Rewrite the header comment: "what protects a buyer, said where they decide: a muted
  fee note under the price and one protection line under the buy actions", keeping the
  WHY ON THE LISTING paragraph.

Exact protection copy (accurate for a Cash_Sale: the platform collects the payment and
releases it when the buyer accepts or the inspection window lapses; this is the same
claim `GuestTrustBand` already makes; no "escrow", nothing about trade collateral):

> [ShieldCheckIcon] **Buyer protection:** your payment is held until you accept the card. How it works

- Shopfront: "…until you accept the cards."
- Markup: `<section aria-labelledby="listing-protection-heading">` with the existing
  `sr-only` h2 "How this purchase is protected", then
  `<p className="flex items-start gap-snug text-meta text-muted-foreground">` — icon
  `mt-px size-3.5 shrink-0 text-muted-foreground`, `<span className="font-medium text-foreground">Buyer protection:</span>`,
  the sentence, then `<Link href="/safety" className="font-medium text-foreground underline underline-offset-4 hover:text-iris-ink">How it works</Link>`.

# Steps

- [ ] 1. Rework `ListingTrust.tsx`: replace `ListingFeeLine` with `ListingFeeNote` and
      `ListingTrustRows` with `ListingProtectionLine` as specified above; update the
      header comment; delete `ROWS` and unused icon imports. Callers still import the old
      names, so do items 1–5 together before verifying.
      Files: `components/listings/ListingTrust.tsx`
      Verify: with items 2–5 (below).

- [ ] 2. Create `ListingSellerRow` (server component, no `'use client'`) shared by both
      layouts. Props: `sellerId, name, isOwner, avatarPath, verified, firstName, rating,
      ratingCount, identity: SellerIdentityDisclosure | null, action?: ReactNode,
      className?`. Structure:
      `<section aria-labelledby="seller-heading-…"` (take a `headingId` prop because both
      layouts are in the DOM at once — use `seller-heading` desktop and
      `seller-heading-stack` phone) with an `sr-only` h2 "Seller", then
      `<div className="flex min-w-0 items-center gap-cozy border-t border-border pt-group">`:
      (a) a `<Link href={isOwner ? '/profile' : `/sellers/${sellerId}`} transitionTypes={['nav-forward']}
      className="flex min-w-0 flex-1 items-center gap-cozy rounded-md border border-transparent focus:outline-none focus-visible:border-iris">`
      holding `Avatar size="md"` and a two-line column `flex min-w-0 flex-col gap-tight`:
      line 1 `flex min-w-0 items-center gap-tight` = name (`truncate text-body font-semibold`)
      + `IdentityBadge verified firstName size={14} iconOnly hideNameWhen={name} className="shrink-0"`
      + `<StarRating rating ratingCount size={12} className="shrink-0 text-meta" />`
      (StarRating already renders "No ratings yet" for null — always rendered, fixed
      geometry); line 2 `truncate text-meta text-muted-foreground` = the existing identity
      copy from `ListingDetailStack` ("Real name"/"Stated name" + `displayLegalName(...)`
      in `font-medium text-foreground`, "· Trading as …", owner "Buyers see your verified
      name here", else "Name not verified yet"). (b) `action` in a `shrink-0` slot.
      The separate `#reviews` rating link is dropped: an anchor inside the row's link
      would be nested interactive content; the seller page carries the reviews. The row's
      height is set by the two text lines (≈ 40px avatar), so a missing `action` (guest,
      owner) does not change it. Lead the file with a header comment explaining it is the
      one seller row for both layouts.
      Files: `components/listings/ListingSellerRow.tsx` (new)
      Verify: with item 7's test.

- [ ] 3. Restyle `ListingDetails` as an unboxed compact two-column list: keep the eyebrow
      h2 and the rows logic; replace the `dl` with
      `<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-group gap-y-tight text-body">`
      with each row as `<Fragment key>` of `<dt className="text-muted-foreground">` and
      `<dd className="min-w-0 break-words text-foreground">` (left-aligned values, no
      borders, no `bg-card`). Update the header comment's last sentence if needed. It is
      the only place condition, game, grade, cert, listed date and location are spelled
      out in full. Only `page.tsx` uses it.
      Files: `components/listings/ListingDetails.tsx`
      Verify: with item 7.

- [ ] 4. Rework `ListingDesktopPane`.
      - Props: remove `chips`; add `statusBadge?: { label: string; variant: 'secondary' | 'outline' } | null`,
        `category: string | null`, `condition: string`, `watchCount: number`,
        `sellerAction?: ReactNode`. Remove `Card`, `FeeInfoPopover`, `platformFeeCentsFor`,
        `platformFeeRateLabel`, `buyerPaysCents`, `displayLegalName`, `IdentityBadge`,
        `StarRating`, `Avatar`, `Link` imports that become unused.
      - Order inside `hidden flex-col gap-group lg:flex`:
        `<header className="space-y-snug">`: badge (only if `statusBadge`, `<Badge variant>`
        with `aria-label={`Availability: ${label}`}`), title row (h2 `text-head` + the
        existing Save/⋯ group; pass `count={watchCount}` to `WatchButton`), meta line
        `<p className="text-meta text-muted-foreground" suppressHydrationWarning>` =
        single: `[category, condition, locationLabel]`; shopfront:
        `['Multiple items · nothing is reserved', category, listedAgo ? `Listed ${listedAgo}` : null, locationLabel]`,
        filtered and joined with ` · `; then the price `<p>` unchanged except the
        `FeeInfoPopover` sibling is removed (keep the `flex flex-wrap items-baseline` wrapper
        or simplify to the `<p>`); then `{!isShopfront ? <ListingFeeNote … className="mt-tight" /> : null}`
        (shown to owners too — the headline they see is the buyer's figure).
      - `<div className="space-y-group">{children}</div>` (actions, unchanged).
      - `{showTrust ? <ListingProtectionLine isShopfront={isShopfront} /> : null}`.
      - `<ListingSellerRow headingId="seller-heading" … action={sellerAction} />` with
        `name = isOwner ? 'You' : (sellerDisplayName ?? 'Unknown seller')`.
      - Description and `details` unchanged in position (keep `pb-group`).
      - Update the JSDoc: what it is (badge only when unavailable, meta), what it costs,
        actions, protection, seller, description, details.
      Files: `components/listings/ListingDesktopPane.tsx`
      Verify: with item 7.

- [ ] 5. Rework `ListingDetailStack` to the same content in the stacked order:
      media → optional status badge (`mt-group` when media, else none; `self-start`) →
      title (unchanged classes) → meta line (same arrays as item 4, keep
      `mt-snug line-clamp-2 min-h-[2lh] text-meta text-muted-foreground` and
      `suppressHydrationWarning` — the 2-line reserve stays) → price (`mt-snug`, remove the
      condition pill and the `FeeInfoPopover` sibling; the price `<p>` may stand alone) →
      `{!isShopfront ? <ListingFeeNote className="mt-tight" /> : null}` →
      `{showTrust ? <ListingProtectionLine isShopfront className="mt-group" /> : null}` →
      `<ListingSellerRow headingId="seller-heading-stack" className="mt-group" action={sellerAction} />`
      → `ExpandableDescription` (`mt-group`) → `details` (`mt-group`). Remove the old
      seller `<Link>` card, `ArrowRight01Icon`, the separate `sellerAction` `<div>`, the
      bottom `ListingTrustRows`, `kindLabel`, `savesLabel`, and the `watchCount` prop if
      no longer read (also remove it at the call site). Add the `statusBadge` prop
      (same type as item 4). Update the "NO MULTI-ITEM NOTICE" comment to say the meta
      line carries "Multiple items · nothing is reserved". Update the `sellerAction` JSDoc
      to "right of the seller row".
      Files: `components/listings/ListingDetailStack.tsx`
      Verify: with item 7.

- [ ] 6. Wire the page and fix the skeleton.
      `page.tsx`:
      - Replace `STATUS_BADGE`/`statusBadge`/`listingChips` with an unavailable-only badge:
        `const UNAVAILABLE_BADGE: Record<'RESERVED' | 'SOLD', {variant: 'secondary'|'outline'; label: string}> = { RESERVED: { variant: 'secondary', label: 'Under contract' }, SOLD: { variant: 'outline', label: 'Sold' } };`
        and `const unavailableBadge = isAvailable ? null : isShopfront ? { variant: 'outline', label: 'Closed' } : (UNAVAILABLE_BADGE[status as 'RESERVED' | 'SOLD'] ?? null);`.
        Drop the now-unused `BadgeProps` import (and `Badge` if unused). Leave `isAvailable`,
        `availability` and the JSON-LD logic untouched.
      - Pass `statusBadge={unavailableBadge}` to both panes; pass `category`, `condition`,
        `watchCount` to the desktop pane; delete the `chips` prop and the stale "badges ride
        above the title" comment.
      - Build ONE `sellerMessage = canMessage ? <MessageSellerButton itemId sellerId variant="button" size="sm" className="w-auto" /> : null`
        and pass it as `sellerAction` to BOTH panes (remove the stack's `md:hidden` wrapper
        and its "Phones only" comment).
      - `renderListingActions`: remove the trailing `MessageSellerButton` section and the
        `headingId` parameter; update both call sites to `renderListingActions()` (or inline
        `<ItemActions …/>`). `canMessage` is the identical condition the removed block used,
        so who can message is unchanged; the md–lg band now gets Message from the seller row.
      - Update the `ItemActions` comment "Message follows as its own outline row (see
        `renderListingActions`)" to "Message lives in the seller row".
      `loading.tsx`:
      - Remove the badge cluster from the back-nav skeleton row (keep the `ml-region h-8 w-40`
        button) and fix its comment.
      - Rewrite `DesktopPaneSkeleton` to mirror item 4 in a `hidden flex-col gap-group lg:flex`:
        header `space-y-snug` with title `TextLines text-head` + `size-9` icon pair on the
        right, meta `TextLines text-meta`, price `TextLines text-display`, fee note
        `TextLines text-meta` at `mt-tight`; actions `space-y-snug`: `Skeleton h-10 w-full`
        then `grid grid-cols-2 gap-snug` of two `h-10`; protection `TextLines text-meta`;
        seller row `flex items-center gap-cozy border-t border-border pt-group` with
        `size-10 rounded-full` + two lines (`text-body`, `text-meta`); description eyebrow +
        4 `text-body` lines. No `mt-auto`, no round icons, no composer.
      - Rewrite `PhoneStackSkeleton` to mirror item 5: carousel, title, 2-line meta reserve,
        price `text-display` (no condition pill), fee note `text-meta`, protection
        `text-meta` at `mt-group`, borderless seller row as above at `mt-group`, description
        4 lines + `h-10` Read more.
      - Update the file's header comment to describe the new order.
      Files: `app/(workspace)/listings/[id]/(detail)/page.tsx`,
      `app/(workspace)/listings/[id]/(detail)/loading.tsx`
      Verify: `npx vitest --run --project component` and
      `npx vitest --run tests/unit/actionLogCoverage.test.ts` pass (no action modules
      touched, sanity only). Rely on editor diagnostics for types; do not run build or
      typecheck unless the user asks.

- [ ] 7. Add `tests/component/listingPane.test.tsx` (jsdom project; follow the mocking
      style of `tests/component/tradeFeeDisclosure.test.tsx` — mock `next/navigation`,
      `sonner`, and `@/lib/actions/watchlist` / `@/lib/actions/messages` if anything pulls
      them in). Cover:
      - `ListingFeeNote` with `priceCents={40_000_000}` `currency="aud"` renders
        "Includes $20,000.00 buyer fee" and the button named
        "Price includes the NoDitto fee. Show breakdown"; no element has class `text-trust`.
      - `ListingProtectionLine` renders "Buyer protection:", "your payment is held until you
        accept the card.", a link "How it works" with `href="/safety"`; `isShopfront`
        renders "the cards."; the text contains no "escrow".
      - `ListingSellerRow` with `rating={null}` renders "No ratings yet"; with an
        `identity` (`nameIsDocumentVerified: true`) renders "Real name"; renders the
        `action` node; the profile link targets `/sellers/{id}` (owner: `/profile`).
      - `ListingDesktopPane` (render with minimal props and a child): with
        `statusBadge={null}` there is no "Availability:" label; the meta line reads
        `Pokémon · Graded · Croydon, NSW, Australia`; there is no "Single item" text and
        no "Message seller" inside the children region when not passed. With
        `statusBadge={{label:'Sold',variant:'outline'}}` the badge "Sold" renders.
        If `ListingOverflowMenu` / `WatchButton` pull server actions, `vi.mock` them.
      Files: `tests/component/listingPane.test.tsx` (new)
      Verify: `npx vitest --run tests/component/listingPane.test.tsx` passes, then
      `npx vitest --run --project component` passes.

- [ ] 8. In-context visual check (the coder cannot see the render from reading). If a dev
      server is already running, open `/listings/<id>` at ≥1024px and at ~390px for: an
      available single listing (guest and signed-in buyer), a reserved/sold one, an open and a
      closed binder listing, and the owner view. Confirm: no chip row, only one purple control
      (Buy now), no green text, Message in the seller row, protection is one line, Details is
      unboxed, and the skeleton → page swap does not move the title/price. Do not start
      `npm run dev` from an agent turn; if no server is running, record this as unverified
      for the user. Also grep `tests/e2e` for "Availability: Available", "people saved this",
      "How buyer protection works" and "Includes the" and update any hits (none found at
      planning time).
      Files: none (or e2e specs if hits)
      Verify: `npx vitest --run --project component` still passes.

## Decisions recorded

- Shared `ListingSellerRow` instead of two hand-kept seller blocks: the two layouts had
  already drifted (link card vs `Card`), and the Message button needs the same slot in both.
- Popover moves from beside the price to the fee subline: the (i) explains the fee, so it
  belongs on the sentence that names the fee; the price stays a clean figure.
- Protection line sits under the actions on desktop (as requested) and under the price on
  the stack, because the stack's actions live in the sticky buyer bar / after the stack.
- "Multiple items" retained over "binder or bulk listing" (see discrepancy 3); flag to the
  user in the final summary so they can choose a copy change separately.
- Location label is shown as stored (e.g. "Croydon, NSW, Australia"); trimming the country
  would need new parsing for a cosmetic gain.
- No change to `ListingBuyerBar`, `ItemActions` branching, owner tools, or any action.


## AMENDMENT FROM THE USER (overrides anything above about the action stack)

The user wants the action buttons kept as the "old" stack, NOT the moved-Message design:

- Full-width primary "Buy now".
- Below it, one row of two outline buttons: "Make an offer" | "Propose trade" (as today).
- Below that, a full-width "Message seller" button that STAYS in the action stack (do NOT move it into the seller card), styled with the tinted iris look: `variant="secondary"` (light iris background, iris text and icon). Before commit 81ca4e8 `components/messages/MessageSellerButton.tsx` used `variant="secondary"`; 81ca4e8 changed it to `variant="outline"`. Restore `secondary` for the listing-page action stack. Check other call sites of MessageSellerButton (e.g. the seller profile page from commit 3a199b6) and leave them as they are, using a prop if needed.
- Keep the current button corner radius and height. Don't add pill or circular shapes.
- The seller card therefore has NO Message button. Drop that part of the plan.

All other decluttering in the plan still applies: the chip row goes, the fee subline replaces the green line, the protection strip replaces the 3-row card, and Details is restyled.
