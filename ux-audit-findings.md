# UX Audit Findings — Backlog

Running list of usability findings to address in one pass. Severity is the standard
0–4 scale: 4 = users cannot complete tasks, 3 = users struggle significantly,
2 = users notice but work around it, 1 = cosmetic.

IDs are stable and never reused. Append new findings at the end with the next number,
regardless of severity — do not renumber to group.

Two ID series:
- **F#** — usability findings, rated on the severity scale, counted in the table below.
- **R#** — feature requests and spec changes. Not rated, not counted: a severity score
  measures a defect against intended behaviour, and these change the intent. They live in
  their own section at the end.

## Status

| Severity | Open | Done |
|----------|------|------|
| 4 — Catastrophe | 0 | 0 |
| 3 — Major | 0 | 10 |
| 2 — Minor | 0 | 23 |
| 1 — Cosmetic | 0 | 5 |
| **Total** | **0** | **38** |

F1–F18 implemented. Verified with `npx tsc --noEmit` (clean),
`npx eslint app components lib domain` (clean), and `npm run test` (267 passed, 24 files).
F6 is partial by design — see its entry. R1 is **not** built and track C is blocked; see R1.

F19–F32 are the Round 4 mobile pass and are **open**.

Not yet verified by anyone: how any of this looks rendered, on a phone or otherwise. That was
outstanding after Round 1 and Round 4 did not change it — Round 4 is a code audit too. Several
of its findings (F19, F20, F24) are about behaviour that only a device exercises, so a handset
pass is now the highest-value verification available.

Sources so far:
- Round 1 — code audit of app shell + buyer-facing discovery flow (F1–F11)
- Round 2 — user-reported, screenshots (F12–F17)
- Round 3 — user-reported (F18)
- Round 4 — code audit scoped to mobile: touch, scroll, keyboard, visual weight (F19–F32)
- Round 5 — user-reported, contract details scroll (F33–F37). F33/F34 fixed, F35 partial.

---

## F1 — Trust signals may be announced as nothing to screen readers

- [x] Addressed
- **Severity:** 3
- **Principle:** Accessibility, Perceptibility
- **Source:** Round 1 (code)
- **Location:** `components/listings/StarRating.tsx:52`, `components/identity/IdentityBadge.tsx:71`, `components/listings/ItemCard.tsx:157` and `:249`
- **Issue:** Three components put `aria-label` on an element with no ARIA role. `StarRating` labels a `<span>` and marks every star `aria-hidden`. `IdentityBadge` labels a `<span>`. `ItemCard` labels a bare lucide `<svg>` for "Unverified seller". Per ARIA, `aria-label` on a role-less generic element is not required to be exposed, and screen readers vary on whether they honour it.
- **User impact:** A screen reader user browsing the catalog may hear seller name and price but nothing for the star rating or verification shield — the two signals the product is built on. No text fallback exists, because the visible label is suppressed (`hideLabel`, `iconOnly`) and the stars are `aria-hidden`.
- **Fix:** Add `role="img"` alongside each `aria-label`, or replace with an `sr-only` sibling span. `role="img"` is the smaller change.

## F2 — No pressed state on any button in the app

- [x] Addressed
- **Severity:** 2
- **Principle:** Visibility of System Status, Affordances and Signifiers
- **Source:** Round 1 (code)
- **Location:** `components/ui/button.tsx:10-40`
- **Issue:** `buttonVariants` defines `hover:`, `focus-visible:` and `disabled:` treatments but no `active:` state on any of the six variants. Every button routes through this cva, so nothing in the app gives pressed feedback.
- **User impact:** On a slow connection users click and see no change until navigation completes; the usual reaction is a second click. `ghost` is worst affected — its resting state has no background at all.
- **Fix:** Add `active:` to the base string (e.g. `active:translate-y-px`) plus a per-variant darkened background (`active:bg-primary/80` etc.). Already covered by the `prefers-reduced-motion` block in `globals.css`.

## F3 — Primary navigation has no current-page indicator

- [x] Addressed
- **Severity:** 2
- **Principle:** Visibility of System Status, Recognition Over Recall
- **Source:** Round 1 (code)
- **Location:** `components/layout/SiteHeader.tsx:78-90`
- **Issue:** Marketplace / Sell / Deals render as identical ghost buttons with no `aria-current` and no active styling. `SiteHeader` is a Server Component, so it has no access to `usePathname`.
- **User impact:** Users cannot tell where they are from the top bar. The nav reads as three equivalent offers rather than a position.
- **Fix:** Extract the three links into a small client island that reads `usePathname()` and sets `aria-current="page"` plus a visible treatment (gold underline via the existing `after:` gradient pattern, or `bg-white/10`). Semantic attribute and visible style must ship together.

## F4 — Carousel arrows are dead controls at the scroll extremes, with no other scroll affordance

- [x] Addressed
- **Severity:** 2
- **Principle:** Visibility of System Status, Affordances and Signifiers
- **Source:** Round 1 (code)
- **Location:** `components/listings/ListingCarousel.tsx:20-24`, `:41-58`, `:72`
- **Issue:** `scroll()` calls `scrollBy` with no scroll-position state, so both buttons stay enabled permanently — on first paint "Previous listings" does nothing. The native scrollbar is also removed (`[scrollbar-width:none]`, `[&::-webkit-scrollbar]:hidden`) with no edge fade, so the arrows are the only signifier that more content exists.
- **User impact:** Clicking a visibly-enabled button with no response reads as a broken page. Users who miss the small top-right arrows may not realise the row scrolls, and skip the rest of the listings.
- **Fix:** Track `scrollLeft` in state on a `scroll` handler, set `disabled` at each extreme (`disabled:opacity-45` is already in the button base), and add a right-edge `mask-image` fade while more content remains.

## F5 — `aria-live` regions will not announce, because the subtree is replaced on navigation

- [x] Addressed
- **Severity:** 2
- **Principle:** Visibility of System Status
- **Source:** Round 1 (code)
- **Location:** `app/listings/page.tsx:203` (result count), `:268` (page indicator)
- **Issue:** Both carry `aria-live="polite"`, but filtering and paging are URL-driven full server re-renders. A live region must exist in the DOM before its content changes to be announced; a freshly-inserted node with `aria-live` generally announces nothing.
- **User impact:** A screen reader user applies a filter and gets no confirmation of the result count — they must navigate to the heading manually to learn whether the filter did anything.
- **Fix:** Either drop the attributes (the count is reachable as static text) or move a persistent `role="status"` container into `MarketplaceShell` so it survives navigation and receives the count as a prop.

## F6 — No type or spacing scale, and one-off bracket values bypass what exists

- [x] Addressed — **partially. Tokens exist and the cited violations are fixed; no codebase-wide sweep.**
- **Severity:** 2
- **Principle:** Consistency and Standards, Aesthetic and Minimalist Design
- **Source:** Round 1 (code)
- **Location:** `app/globals.css:8-33`, `components/listings/ItemCard.tsx:127-152`, `app/page.tsx:176`, `:295`, `:302`
- **Issue:** The token layer defines colour and `--radius` but no type or spacing scale. `ItemCard`'s catalog variant alone uses four arbitrary sizes: `text-[0.8125rem]`, `text-[0.9375rem]`, `text-[0.625rem]`, `text-[0.6875rem]`. `app/page.tsx` re-inlines `text-[0.6875rem] font-semibold uppercase tracking-[0.12em]` three times — character-for-character what `.market-label` already encapsulates. Vertical rhythm runs `mt-0.5 / mt-1 / mt-1.5 / mt-2 / mt-2.5 / mt-3 / mt-5 / mt-7 / mt-9` with no discernible step.
- **User impact:** Indirect but real. Without a scale each new component picks its own sizes, so the same object type looks slightly different across surfaces and the interface reads as assembled rather than designed.
- **Fix:** Add `--text-*` and `--space-*` custom properties to `:root`, map them into `tailwind.config` `fontSize`/`spacing`, then replace the bracket values. Apply `.market-label` where the eyebrow style is re-typed.

> **What shipped, and what deliberately did not.**
> Done: intent-named `spacing` (`tight`/`snug`/`group`/`section`/`region`) and a five-level
> `fontSize` scale (`meta`/`body`/`subhead`/`head`/`display`) in `tailwind.config.ts`, both
> commented with why they exist; `ItemCard`'s four bracket sizes replaced with scale values;
> the three re-inlined eyebrow styles in `app/page.tsx` replaced with `.market-label`.
>
> Not done, on purpose: a sweep replacing every arbitrary value across all 181 UI files. That
> is a large mechanical diff with real regression risk and no way to verify visually without
> reviewing every surface. The scale now exists for new work to reach for, and existing
> surfaces can migrate as they are touched. `meta` is floored at 0.75rem so F7 cannot silently
> come back.

## F7 — Catalog metadata at 10px

- [x] Addressed
- **Severity:** 2
- **Principle:** Perceptibility, Accessibility
- **Source:** Round 1 (code)
- **Location:** `components/listings/ItemCard.tsx:135`, `:146`, `:151`
- **Issue:** Location, seller name and rating use `text-[0.625rem]` (10px) in the catalog variant, rising only to 11px at `sm`. Contrast is fine — `--muted-foreground` at 40% lightness on the near-white card sits comfortably above the 4.5:1 floor — so this is purely a size problem.
- **User impact:** Seller name and rating are the trust signals a buyer scans before clicking. At 10px they are effortful to read, in the densest grid in the app where scanning matters most.
- **Fix:** Floor metadata at `0.75rem` (12px). The card has room; the title can absorb the difference by tightening `line-clamp`.

## F8 — `aria-labelledby` on a role-less div is discarded

- [x] Addressed
- **Severity:** 2
- **Principle:** Accessibility, Structure
- **Source:** Round 1 (code)
- **Location:** `app/listings/page.tsx:189`
- **Issue:** `<div aria-labelledby="catalog-heading">` has no role, so no region is created and the accessible name is dropped. The surrounding `<section>` in `MarketplaceShell` is also unlabelled, so it is generic too.
- **User impact:** Screen reader users get no navigable landmark for the results area and must walk the heading list instead.
- **Fix:** Add `role="region"`, or move the label onto the `<section>` in `MarketplaceShell` where a real landmark already exists.

## F9 — `ReviewList` hardcodes `bg-white`, off-palette

- [x] Addressed
- **Severity:** 1
- **Principle:** Consistency and Standards
- **Source:** Round 1 (code)
- **Location:** `components/reviews/ReviewList.tsx:38`
- **Issue:** Uses `bg-white` where every other surface uses `bg-card` (`40 30% 99%`, a warm off-white). Pure white is not in the palette.
- **User impact:** The review list reads slightly colder than the cards around it on a seller profile. Subtle, but it is the visual tell of an inconsistent system.
- **Fix:** `bg-white` → `bg-card`.

## F10 — `ReviewList` empty state bypasses the shared `EmptyState` component

- [x] Addressed
- **Severity:** 1
- **Principle:** Consistency and Standards, Recognition Over Recall
- **Source:** Round 1 (code)
- **Location:** `components/reviews/ReviewList.tsx:29-33`
- **Issue:** Returns bare muted text, "No reviews yet." The app has a well-built `EmptyState` with icon, title, description and action, used with genuinely distinct copy elsewhere.
- **User impact:** A seller with no reviews yet gets a dead end. A visitor cannot tell whether reviews are unsupported or just absent.
- **Fix:** Use `EmptyState` with `compact` and `titleAs="h4"`, describing when reviews appear.

## F11 — Hero card fan mixes descriptive and empty alt text

- [x] Addressed
- **Severity:** 1
- **Principle:** Accessibility
- **Source:** Round 1 (code)
- **Location:** `app/page.tsx:35-48`
- **Issue:** Of three cards in one decorative composition, `umbreon` carries a full alt description while `pikachu` and `mew` have `alt=""`. Empty alt is correct for decoration; the inconsistency is the issue.
- **User impact:** A screen reader announces exactly one card from a fan of three, describing the image inaccurately.
- **Fix:** Pick one strategy. Since the fan illustrates rather than informs, `alt=""` on all three is cleaner — the adjacent copy already carries the message.

## F12 — Move the counterparty identity panel out of the deal room action card into Parties

- [x] Addressed
- **Severity:** 2
- **Principle:** Aesthetic and Minimalist Design, Structure
- **Source:** Round 2 (user-reported, screenshot). **Decision made:** relocate, do not remove.
- **Location:** `components/deals/DealRoom.tsx` (new Parties row); `components/sales/CashSaleView.tsx` (same relocation after the attached screenshot showed the disclosure above its tabs). Component is `components/identity/CounterpartyIdentity.tsx` and is unchanged. The trade-room mount remains in `components/trade/TradeContract.tsx`.
- **Issue:** The "You are dealing with {legal name} / {handle} had this name verified by our payment provider on {date}" note rendered inside `ContractActionCard` — the top-bar action area — for the whole life of the room, including after completion, when that space should carry the next thing to do.
- **User impact:** The action card leads with a fact that doesn't change instead of the action that does. It's reference information sitting in the one region users go to for "what now?".
- **Fix:** Move the disclosure into the room's Parties section, next to the corresponding trading history. Keeps the disclosure (so clause 12 stays satisfied) and clears the action card. Both DealRoom and CashSaleView now follow that structure.

> **Blocker: the deal room has no Parties section yet.**
> `DEAL_SECTIONS` in `domain/contract/dealSteps.ts:26-34` is `summary · items · terms · money · collateral · share`. There is no `parties` key, so one has to be added before the panel has anywhere to go.
>
> The cash sale room is the template to copy — it already has the exact structure:
> - `CASH_SALE_SECTIONS.parties` in `domain/contract/cashSaleSteps.ts`
> - the `ContractDetailRow label="Parties"` at `components/sales/CashSaleView.tsx:776-780`, which pairs `ContractPartyDetails` with `CounterpartyIdentity`
>
> So the work is: add `parties` to `DEAL_SECTIONS`, add a matching `ContractDetailRow` in `DealRoom.tsx`, and move the existing `CounterpartyIdentity` mount into it. Worth checking whether the deal room should also pick up `ContractPartyDetails` (trading history / trust stats) while a Parties tab is being created — the cash sale room shows both there, and a Parties tab holding only one line would look thin.
>
> **Spec check: satisfied.** `.kiro/specs/cardtrade/requirements.md:51` defines Commitment_Point to include accepting a Deal, and clause 12 (line 98) requires the counterparty's legal name and verification date to be displayed there. Relocating within the room keeps that true. Outright removal would not have — see the rationale comment at `DealRoom.tsx:483-487`: a private deal is invite-by-token with no connected account, so the room is the only place a joiner learns who they're locking money with.

## F13 — Contract room Item panel wastes its space on a single-column row

- [x] Addressed
- **Severity:** 2
- **Principle:** Structure, Aesthetic and Minimalist Design
- **Source:** Round 2 (user-reported, screenshot)
- **Location:** `components/contract/ContractExchangePanel.tsx` — `SideColumn` item row (the `<li className="flex items-center gap-2.5">` block) and the one-sided branch of `ContractExchangePanel`. Screenshot taken from the cash sale room, `components/sales/CashSaleView.tsx:743`.
- **Issue:** For a one-sided contract the panel renders a single `SideColumn` that inherits `h-full min-h-0 flex-1`, so the card stretches to the full inspector height while its content is one thin horizontal row — `size="sm"` thumbnail, title, condition, price — leaving roughly two thirds of the card empty. The item's photo, the thing a buyer most wants to look at, gets the smallest element on the panel.
- **User impact:** The item under contract is presented as a list row rather than the subject of the page. Buyers reviewing what they've committed to can't see the photo at a useful size without leaving for the listing page.
- **Fix:** Give the one-sided case an inner two-column layout matching the listing detail page — image left at a real size, details (title, condition, price, description) right. Keep the two-sided (trade/deal) branch as is: it already needs `1fr auto 1fr` for the goods-swap arrow, so gate the new layout on `sides.length === 1 && !compact`.
- **Also visible in the screenshot, cause not yet verified:** the item thumbnail rendered as a broken-image icon. Could be a stale seed path, a Storage permission, or `itemImageUrl` returning a bad URL — needs checking against `supabase/seeds/demo_kitsunearia.sql` before assuming it's a UI bug.

## F14 — Location autocomplete feels laggy, and the spinner drops out of position and can spin forever

- [x] Addressed
- **Severity:** 3
- **Principle:** Visibility of System Status, Error Recovery
- **Source:** Round 2 (user-reported, screenshot context: Terms tab)
- **Location:** `components/location/PlaceSearch.tsx:49-81` (search effect), `:113-118` (spinner)
- **Issue:** Four separate causes compound:
  1. **Spinner loses its vertical centring.** The `Loader2` carries both `-translate-y-1/2` and `animate-spin`. Tailwind's `spin` keyframes set `transform: rotate(...)`, which replaces the element's `translateY(-50%)` for the whole animation, so the icon is displaced downward by half its height the moment it starts spinning. This matches the reported "loading circle slowly falls down". The displacement mechanism is certain from the CSS; the exact perceived timing is not something I reproduced.
  2. **Spinner can never clear after an abort.** The `.finally()` callback is guarded by `if (!controller.signal.aborted) setLoading(false)`. When a request is aborted — which happens on every keystroke — that branch is skipped, so `loading` stays `true`. Any aborted-then-settled sequence leaves the spinner running indefinitely.
  3. **No immediate feedback.** `setLoading(true)` is inside the `setTimeout`, so nothing acknowledges the keystroke for the first 250ms. The control feels dead, then a spinner appears.
  4. **Debounce is resettable by unrelated renders.** The effect depends on `value`, an object, not `value.placeId`. Any parent re-render passing a fresh object aborts the in-flight request and restarts the 250ms timer, so results can be perpetually deferred while the user types.
- **User impact:** Typing an address produces a control that lags, then shows a spinner that has visibly slipped out of the field and may never stop. Users conclude the field is broken and stop trusting the form — on the step where they set a physical meetup location.
- **Fix:** Wrap the spinner in a positioned `<span>` and put `animate-spin` on the inner icon so rotation and translation don't share a transform. Move `setLoading(false)` out of the aborted guard (or use a request-id check instead of the abort signal). Set `loading` synchronously in the change handler. Narrow the effect dependency to `value?.placeId`.

## F15 — Location search is hardcoded to Australia; international support wanted

- [x] Addressed
- **Severity:** 3
- **Principle:** Flexibility and Efficiency, Match Between System and Real World
- **Source:** Round 2 (user-reported)
- **Location:** `lib/location/geoapify.ts:88` (`filter: 'countrycode:au'`), `:89` (`bias: proximity` on `AU_DEFAULT_CENTER`), `:34-38` (`stateShort` strips an `AU-` prefix), `components/location/PlaceSearch.tsx:30` (placeholder "Search for a place in Australia"), `components/location/PlacePicker.tsx:78-80` (no-key fallback plants free text at `AU_DEFAULT_CENTER`), `app/listings/page.tsx:205` ("available in Australia")
- **Issue:** The autocomplete request hard-filters to `countrycode:au`, so a non-Australian address returns zero results with no explanation — the field looks broken rather than restricted. The AU assumption is then repeated in the proximity bias, the state-code formatter, the placeholder copy, the no-key fallback coordinates, and the catalog result counter.
- **User impact:** A user outside Australia cannot enter their location at all. They type a valid address, get an empty dropdown, and have no way to tell whether the service is down or their country is unsupported.
- **Fix:** Replace the hard `filter` with a configurable country list (default open, or biased by the member's own profile country), drop or parameterise the proximity bias, generalise `stateShort` to stop assuming an `AU-` prefix, and make the placeholder and count copy country-neutral. If the restriction is meant to stay for now, say so in the UI instead of returning silence.

> **Scope: this entry is the geocoding fix only.** The wider marketplace internationalisation
> — currency, Connect country support, catalog filtering by country — is **R1** below.
> F15 is worth doing on its own regardless of how R1 lands: the field currently returns
> silence for a valid overseas address, which is a defect under any product direction.

## F16 — A selected location cannot be changed

- [x] Addressed
- **Severity:** 3
- **Principle:** User Control and Freedom, Tolerance and Forgiveness
- **Source:** Round 2 (user-reported)
- **Location:** `components/location/PlaceSearch.tsx:45-47` and `:55-58`; `components/location/PlacePicker.tsx:120-122`
- **Issue:** Once a place is selected the field locks itself three ways. The sync effect `setQuery(value?.label ?? '')` runs on every change of `value?.label`/`value?.placeId`, overwriting whatever the user has typed. The search effect early-returns when the query matches the selected label, so results stay empty. And `onTextFallback` in `PlacePicker` only clears `value` when the text is *empty* — editing it to something else leaves `value` set, so the sync effect restores the old label. There is no clear or reset control anywhere.
- **User impact:** A user who picks the wrong suburb cannot correct it. Their only route is to clear the field completely — if they work out that empty text is the reset — or abandon and restart the form. On the meetup-location step of a binding deal, that is a serious dead end.
- **Fix:** Add a visible clear button (X in the field) that calls `onChange(null)` and empties the query. Treat any edit that diverges from the selected label as intent to re-search: drop the early-return, and have `onTextFallback` clear `value` whenever the text no longer matches it, not only when empty.

## F17 — No mini-map shown after selecting a location

- [x] Addressed
- **Severity:** 2
- **Principle:** Visibility of System Status, Error Prevention
- **Source:** Round 2 (user-reported)
- **Location:** `components/location/PlacePicker.tsx:120-124` (currently a text-only "Selected:" line)
- **Issue:** On selection the picker confirms with a line of text and nothing else, even though `value` carries `lat`/`lng` and `components/location/PlaceMap.tsx` already renders a Geoapify static map from exactly those fields. The map appears only later, read-only, in the deal room (`components/deals/DealRoom.tsx:906`).
- **User impact:** Users commit to a meetup point without seeing where it is. Two suburbs with the same name, or a street match in the wrong city, are invisible until the deal room — by which point the terms are set. A map at selection time is the cheapest available error-prevention here, and it's what every comparable address picker does.
- **Fix:** Render `<PlaceMap lat={value.lat} lng={value.lng} label={value.label} heightClassName="h-40" />` in `PlacePicker` whenever `value` has finite coordinates. The component already handles the missing-key and image-error cases, so no new failure states. Note the free-text fallback path plants coordinates at `AU_DEFAULT_CENTER` (`PlacePicker.tsx:78-80`) — suppress the map for `text:`-prefixed `placeId`s, or it will confidently show the wrong place.

---

# Feature requests and spec changes

Not severity-rated — these change intended behaviour rather than failing it.

## R1 — Genuinely international marketplace, with a country filter defaulted from IP

- [ ] Addressed — **NOT built. Track C is blocked by the provider; see the box below.**
- **Source:** Round 2 (user-reported). User is undecided on the mechanism — "detects your location from IP? so what you see is filtered to your country unless you turn it off…? Idk"

> **BLOCKED — verified against the Stripe API and docs, 2026-08-04.**
> International *sellers* cannot be paid on this integration. Two independent blockers,
> either one sufficient on its own:
>
> 1. **The platform is in the wrong country.** Self-serve cross-border payouts require the
>    platform to be based in the **US, UK, EEA, Canada, or Switzerland**. `GetAccount` on
>    `acct_1U0H0FKEPlyX260L` returns `country: "AU"`, `default_currency: "aud"`. Australia is
>    not on that list, and outside those regions Stripe requires the platform and the
>    connected account to be in the same region.
> 2. **Recipient accounts are excluded regardless.** Stripe's cross-border payouts page
>    states you cannot make cross-border payouts to connected accounts under a **recipient
>    service agreement**. Our accounts are created with `configuration.recipient` (see
>    `.kiro/steering/stripe-payments.md`), so even from a supported platform country this
>    funds flow is unavailable. The documented alternative, Global payouts, needs a US or UK
>    platform.
>
> International **buyers** are fine — a buyer pays by card and is only ever refunded to that
> card, so no transfer and no connected account is involved. That asymmetry is already the
> shape of the Identity_Gate, which is scoped by whether a role can RECEIVE money.
>
> So the buildable version is **international buyers, Australian sellers.** Going further
> needs one of: an AU→overseas payout rail Stripe does not self-serve (contact sales), a
> second platform entity in a supported country, or a separate payouts provider. All three
> are business decisions, not implementation work.
>
> Sources: [Cross-border payouts](https://docs.stripe.com/connect/cross-border-payouts),
> [Connect charge types](https://docs.stripe.com/connect/charges). Content was rephrased for
> compliance with licensing restrictions.

### Track status

| Track | Contents | Status |
| --- | --- | --- |
| A | Un-hardcode the geocoding so overseas addresses resolve | **Done** — see F15 |
| B | `ships_to` on listings + visible, removable country filter defaulted from `x-vercel-ip-country` | Not started. Needs a migration. No provider blocker. |
| C | Multi-currency + international sellers | **Blocked** — see above |
- **Goal:** Sellers and buyers in any country, and a catalog that opens on something locally relevant instead of a global dump, without trapping anyone behind an invisible filter.
- **Related:** F15 (location autocomplete is AU-hardcoded) is the entry-field half of this and can ship independently.

### The instinct is right, but the axis is wrong

Filtering by *viewer country* hides listings the viewer can actually buy. A card in Japan
can ship to Australia. The question a buyer is really asking is **"can I get this?"**, which
is a property of the listing (does the seller ship to my country), not of the viewer's IP.

Recommended: model a `ships_to` capability on the listing — at minimum a
`ships_internationally` boolean, better a country list — and default the catalog to
"ships to {my country}". That answers the buyer's real question, and it degrades sensibly:
a seller who ships worldwide stays visible to everyone.

### IP is a default, never a truth

VPNs, mobile carriers routing through another region, corporate proxies, and travellers all
land in the wrong bucket. So: derive once, persist as an editable preference, never
silently re-derive.

- **Source it from Vercel, not a third-party service.** The `x-vercel-ip-country` request
  header is available in `middleware.ts` at no cost and no added latency. `.vercel/repo.json`
  confirms the deployment target. No geo-IP dependency needed.
- **Write it to a cookie on first visit only**, then treat the cookie as the user's
  preference. Once a member has a profile country, prefer that over the header.
- **Do not store the IP.** The derived country code is fine; the address is personal data.

### Make the filter visible and removable — the app already has the pattern

An invisible filter that hides listings is the "why can't I find anything" bug. The catalog
is already URL-driven with an active-filter display, so the country filter should behave like
every other filter and needs no new mechanism:

- `app/listings/page.tsx` already parses filters from `searchParams` and renders
  `CatalogActiveFilters` — add country as another URL param with a removable chip.
- Being in the URL also makes a filtered catalog shareable and back-button-correct.
- `app/listings/page.tsx` is already `force-dynamic`, so a per-viewer default does **not**
  newly break caching. Not a blocker.
- Copy at `app/listings/page.tsx:205` currently hardcodes "available in Australia" — that
  becomes the filter's label rather than a fixed string.

### What makes this a spec change, not a UI change

1. **Currency.** `.kiro/steering/product.md` and `.kiro/steering/stripe-payments.md` both
   state currency is AUD in integer cents end to end. It runs through `fmv_cents`,
   `cash_amount_cents`, `formatAud`, and Stripe's `aud`. Multi-currency touches the payment
   seam, every money display, and the Platform_Fee arithmetic. Decide explicitly whether
   international means multi-currency or just multi-country-with-AUD-pricing — they are very
   different amounts of work.
2. **Connect country support.** A seller who receives money needs a connected account
   supported in their country for a `recipient` configuration with `stripe_transfers`. That
   list is the provider's, not ours, so "international sellers" is gated upstream of any UI.
   Check it before promising coverage.
3. **The Identity_Gate travels with the account.** Verification burden and the
   provider-verified legal name both come from Connect, so their behaviour per country is
   the provider's too.
4. **Tax, consumer law, and shipping/customs** vary by country. Out of scope for a UX pass,
   flagged so it isn't discovered late.

### Suggested split

| Track | Contents | Size |
| --- | --- | --- |
| A | F15 — un-hardcode the geocoding so overseas addresses resolve | small, do now |
| B | `ships_to` on listings + visible, removable country filter defaulted from `x-vercel-ip-country` | medium, no spec conflict |
| C | Multi-currency + Connect country coverage | spec change, contradicts current steering |

Track B delivers what was actually asked for — a locally relevant catalog you can switch
off — without touching the AUD invariant. Confirm whether C is in scope before anyone
starts on it.

---

## Checked and dismissed

Recorded so they are not re-raised.

- **No `main` landmark on shell pages** — false alarm. `MarketplaceShell` renders `PageShell`, which renders `<main>`. The skip link target `#main-content` is a wrapper div outside `<main>`, but focus lands correctly and the landmark exists.


---

## F18 — Closed contracts collapsed their timeline and used a success tick for cancellation

- [x] Addressed
- **Severity:** 2
- **Principle:** Visibility of System Status, Match Between System and Real World
- **Source:** Round 3 (user-reported)
- **Location:** `domain/contract/steps.ts`, `domain/contract/cashSaleSteps.ts`, `domain/contract/dealSteps.ts`, `components/contract/ContractProgressRail.tsx`
- **Issue:** Terminal Cash_Sales and Deals collapsed to one completed `Closed` step. This erased the contract's lifecycle, so members could not see whether it stopped during terms, payment, handover, or inspection. Worse, `ContractProgressRail` treated the terminal step as `done` and rendered a green checkmark — a success symbol on a cancelled contract.
- **User impact:** A cancellation tells a member only that something ended, not what had happened before it ended. The successful checkmark is misleading and makes cancelled, refunded, and completed outcomes visually indistinguishable.
- **Fix:** Added a `halted` step state. Closed Cash_Sales and Deals now retain their full ordered timeline: completed steps remain checks, the exact first unfinished step is marked with a destructive X and copy such as `Cancelled here`, and later steps remain unreached. The halt point is read from the closing event's `from_status` / `from_state` when the audit trail has it, with conservative fallbacks for legacy records. Deal dispute outcomes retain correct outcome-specific copy — a `SPLIT` never says that nobody was charged.
- **Scope:** Trade fraud remains intentionally unchanged. Trades have no cancellation state and fraud resolution has materially different semantics; it should receive its own review rather than borrow the cancellation presentation.

---

# Round 4 — mobile pass (F19–F32)

Code audit scoped to the phone: touch, scrolling, on-screen keyboard, interactivity
feedback, and visual weight below `lg`. Read the app shell (`app/layout.tsx`,
`app/globals.css`, `tailwind.config.ts`), all of `components/layout/`, every `components/ui/`
primitive, the landing page, the catalog card and carousel, the item detail page, the image
gallery, both chat panels, and the contract inspector / progress rail.

**Nothing here was verified on a device.** Every finding is derived from the code, and each
entry states the mechanism rather than a perceived symptom. Two claims were checked against
build output rather than reasoned about, and are marked where they appear.

Round 3 was a single user-reported finding (F18), so these continue the same series.

## R4 — What was NOT checked

- Rendered appearance on a real handset. Still outstanding from Round 1's closing note.
- Android Chrome specifics beyond the standard viewport/keyboard model.
- Realtime behaviour on a flaky mobile connection (reconnect copy exists; its timing was
  not exercised).

---

## F19 — Every form field is 14px, so iOS Safari zooms the page on focus

- [x] Addressed
- **Severity:** 3
- **Principle:** Error Prevention, Tolerance and Forgiveness, Perceptibility
- **Source:** Round 4 (code)
- **Location:** `components/ui/input.tsx:12`, `components/ui/textarea.tsx:12`, `components/ui/select.tsx:22` — all three carry `text-sm` (0.875rem / 14px)
- **Issue:** iOS Safari auto-zooms the layout viewport when a focused form control's computed
  `font-size` is below 16px. Every text input, textarea and select trigger in the app routes
  through these three primitives, so every field in every form is below the threshold. The
  viewport export correctly omits `maximumScale` / `userScalable` (suppressing zoom would be
  an accessibility regression), which means nothing zooms the page back out afterwards.
- **User impact:** Tapping any field on an iPhone zooms and horizontally offsets the page, and
  it stays that way — the member has to pinch out by hand before they can see the rest of the
  form. It fires on sign-in, sign-up, listing creation, offers, chat composers, the location
  picker and every money field, i.e. every task on the platform. Compounding: after the zoom
  the fixed bottom nav and any sticky dialog footer sit off-screen.
- **Fix:** Floor the three primitives at 16px on touch viewports and keep 14px from `sm` up
  (`text-base sm:text-sm`), which is the standard resolution and costs nothing on desktop.
  Applying it at the primitive level covers the app in one change; check `CatalogControls`,
  `ItemForm` and `AddPaymentMethodForm` for any field that sets its own `text-*` and would
  override the floor. The Stripe Payment Element renders in its own iframe and is unaffected.

## F20 — The layout viewport ignores the on-screen keyboard, and 20 files size themselves off it

- [x] Addressed
- **Severity:** 3
- **Principle:** Visibility of System Status, Structure
- **Source:** Round 4 (code)
- **Location:** `app/layout.tsx:56-64` (the `viewport` export sets `themeColor`, `colorScheme`
  and `viewportFit` but not `interactiveWidget`)
- **Issue:** `dvh` tracks retracting *browser* chrome, not the virtual keyboard. With the
  default `interactiveWidget: 'resizes-visual'` the keyboard overlays the layout viewport
  without shrinking it, so a `100dvh`-derived height stays at full height while the bottom
  ~40% of the screen is covered. 20 files compute a height from `dvh`, including
  `components/ui/dialog.tsx` (the bottom-sheet cap and the sticky `DialogFooter`),
  `components/ui/sheet.tsx`, `ChatThread.tsx`, `ImageGallery.tsx`'s `FRAME_HEIGHT`,
  `MarketplaceShell.tsx`, `SiteMenu.tsx` and `ContractImageLightbox.tsx`.
- **User impact:** Focusing a composer or a field inside a bottom sheet puts the thing being
  typed into, and the button that submits it, behind the keyboard. The member types blind, or
  scrolls a container that has no room to scroll. Worst in a contract room, where the covered
  control is the one that moves money.
- **Fix:** Add `interactiveWidget: 'resizes-content'` to the `viewport` export. Next 15.1.6's
  `Viewport` type accepts it (`'resizes-visual' | 'resizes-content' | 'overlays-content'` —
  confirmed in `node_modules/next/dist/lib/metadata/types/extra-types.d.ts`), so this is one
  line and every `dvh` consumer starts measuring a viewport the keyboard has shrunk. Re-check
  `ChatThread`'s `min-h-[min(36rem,...)]` afterwards: a 36rem floor can outlive the shrunken
  viewport and reintroduce the same overlap on a short phone.

## F21 — Nothing outside `<Button>` acknowledges a tap, and the tap highlight is suppressed globally

- [x] Addressed
- **Severity:** 3
- **Principle:** Visibility of System Status, Affordances and Signifiers
- **Source:** Round 4 (code)
- **Location:** `app/globals.css:47` (`-webkit-tap-highlight-color: transparent` on `html`);
  `components/listings/ItemCard.tsx:56` and `:171` (whole-card overlay `Link`, styled only via
  `group-hover:`); `components/layout/MobileBottomNav.tsx:105` and `:135`;
  `components/layout/SectionFilter.tsx:118`; `components/account/AccountTabs.tsx:52`;
  `components/listings/ListingActionIcon.tsx` (`group-hover:` only)
- **Issue:** F2 added `active:` to `buttonVariants` and fixed pressed feedback for everything
  that routes through `<Button>`. It never reached anything that doesn't. A grep for `active:`
  across `app/` and `components/` returns `components/ui/button.tsx` and nothing else — every
  other hit is a variable name or an object key (`const active: T[]`, `holdsActive:`,
  `ACTIVE:`). Meanwhile `globals.css` removes the platform's own fallback, on the stated
  reasoning that "focus rings already communicate the tap" — but a focus ring is not painted
  on a touch tap, and the elements above have no `active:` to take its place. Every remaining
  cue is `hover:`, which on a touch device either does not fire or sticks after the tap.
- **User impact:** Tapping a listing card — the single most repeated gesture in the product —
  produces literally no visual change until the next page paints. On a slow connection that is
  indistinguishable from a dead tile, and the reaction is a second tap. This is precisely the
  failure F2 identified for buttons, still live on the card grid, the bottom nav, both tab
  strips and the item page's action chips.
- **Fix:** Give each of these an `active:` treatment in the same language `buttonVariants`
  already uses (`active:translate-y-px` plus a background or opacity shift). For `ItemCard` the
  overlay `Link` cannot show it directly — it has no visible box — so put it on the artwork via
  the existing `group` (`group-active:scale-[0.99]`, or a brightness shift on `.auction-stage`).
  The global `prefers-reduced-motion` block already neutralises the transform.

## F22 — The contract inspector's plain-language explainers cannot be opened on a phone

- [x] Addressed
- **Severity:** 3
- **Principle:** Help and Documentation, Accessibility, Affordances and Signifiers
- **Source:** Round 4 (code)
- **Location:** `components/contract/ContractDetailList.tsx:184-217` (the `(i)` button inside
  `Tooltip` / `TooltipTrigger`)
- **Issue:** Radix Tooltip opens on `pointerenter` and on focus, but deliberately suppresses
  the focus path when the focus followed a `pointerdown` — which is exactly what a tap is. It
  has no tap-to-open behaviour. These are the *only* tooltips in the app (grep: `TooltipTrigger`
  appears in `ContractDetailList.tsx` and `components/ui/tooltip.tsx`, nowhere else), and what
  they carry is the `explainer` copy for Item / Terms / Money / Collateral — the plain-language
  answer to "what is this?" on the surface where a member is being asked to lock collateral.
  The button's own `onClick` only calls `stopPropagation()` and re-selects the tab, so on touch
  it is inert. Secondary problem in the same control: the trigger is `size-5` (20px) sitting
  `gap-0.5` (2px) from the tab label button, so both are hard to hit and easy to confuse.
- **User impact:** On a phone the only in-product explanation of what a card hold is, and what
  the Money tab is showing, is unreachable — the member taps a help affordance and nothing
  happens, which also teaches them the control is broken. Desktop users get the explanation;
  phone users are asked to authorise collateral without it.
- **Fix:** Tooltips are the wrong primitive for content that must be reachable by touch. Swap
  these for a `Popover` (already in `components/ui/`), which opens on click and therefore works
  on both input types with one code path — and keep `TooltipProvider` only if something else
  later needs hover-only affordance. Give the trigger a 44px hit area the way
  `ContractProgressRail` does (see F29 before copying that pattern) and widen the gap from the
  tab label.

## F23 — The item page's primary action is an icon chip ranked equal with "Report listing"

- [x] Addressed
- **Severity:** 3
- **Principle:** Aesthetic and Minimalist Design, Affordances and Signifiers, Structure
- **Source:** Round 4 (code)
- **Location:** `app/listings/[id]/page.tsx:596-616` (`grid grid-cols-5 justify-items-center
  gap-1 sm:gap-2`), `components/listings/ListingActionIcon.tsx:29-57`
- **Issue:** Buy, Propose Trade, Make Offer, Save and Report render as five identical
  `ListingActionIcon` chips — same `size-12` circle, same 11px label, same row, same gap. The
  only differentiation available is the `default` / `outline` chip variant. Three of the five
  are transaction entry points and two are utilities; one of them is a moderation report. The
  grid is `grid-cols-5` at every width: inside the content column's `px-4`, a 375px phone gives
  each cell ~65px and a 320px phone ~54px, against a 48px chip — so the inter-target gap falls
  to ~6px, under the 8px minimum, and labels as long as "Report listing" wrap to two lines
  while "Buy" does not, leaving the row's baselines ragged. The same page also uses
  `grid-cols-3` and `grid-cols-2` for the other two viewer states, so the action row's shape
  changes between branches.
- **User impact:** On the page where the marketplace actually converts, the primary action has
  no more visual weight than reporting the listing, and on a small phone the two sit ~6px
  apart. A buyer scanning for "how do I buy this" finds five equal circles and has to read
  11px labels to rank them; a mis-tap between adjacent chips can open a moderation report
  instead of a purchase.
- **Fix:** Stop treating these as one set. Promote Buy to a full-width primary `<Button>` with
  its label visible, keep Trade and Offer as secondary buttons beside or beneath it, and demote
  Save and Report to a separate, quieter row (or move Report to the end of the page — it is not
  a peer of Buy). If the chip row survives for the secondary group, drop to `grid-cols-3` below
  `sm` so the targets clear 44px with an 8px gap, and settle the three viewer-state branches on
  one layout.

## F24 — "Tap to zoom" is broken on touch, and the class meant to protect the pan generates no CSS

- [x] Addressed
- **Severity:** 3
- **Principle:** Affordances and Signifiers, Visibility of System Status, User Control and Freedom
- **Source:** Round 4 (code)
- **Location:** `components/listings/ImageGallery.tsx:196` (`touch-action-none`), `:199`
  (`onPointerLeave={resetZoom}`), `:251-252` (the `[@media(hover:none)]` "Tap to zoom" label),
  `:257-283` (the arrow controls)
- **Issue:** Three defects in the item page's only image viewer.
  1. **The magnifier resets in the same gesture that engages it.** `onPointerLeave` calls
     `resetZoom`. For touch, the browser dispatches `pointerleave` immediately after
     `pointerup` — the pointer ceases to exist — so a tap sets `zoomPoint` and then clears it.
     The component advertises the feature specifically to these devices: the hint renders
     "Tap to zoom" under `[@media(hover:none)]`.
  2. **The pan guard is not a Tailwind class.** Line 196 applies `touch-action-none`; the
     utility is `touch-none`. **Verified against build output**, not inferred: `.touch-none` is
     present in `.next/.../layout.css` and `.touch-action-none` is absent. So the stated intent
     directly above it — "While zoomed, touch drags must pan the image, not scroll the page" —
     does not happen.
  3. **No swipe between images, and the arrows are undersized.** Paging is arrows only, at
     `size-9` (36px) with `gap-0.5` (2px) between them, in the top-right corner. Swiping a
     photo gallery is the default mobile expectation, and it is what the catalog carousel
     already does natively.
- **User impact:** A buyer inspecting a graded collectible on a phone — checking a slab label,
  which is the whole reason the gallery uses `object-contain` and a 2.5× magnifier — cannot
  zoom at all, is told they can, and has to hit two 36px arrows 2px apart to change image
  instead of swiping.
- **Fix:** Gate `onPointerLeave={resetZoom}` on `event.pointerType === 'mouse'` so a touch tap
  keeps the magnifier engaged, and give touch an explicit way out (tap again already toggles;
  the arrows and a close affordance should also reset). Change `touch-action-none` to
  `touch-none`. Add swipe paging on the frame — a horizontal-drag threshold on the existing
  pointer handlers, guarded to not fire while zoomed — and take the arrows to 44px with a
  wider gap. Consider whether pinch-to-zoom should replace the tap magnifier on touch
  entirely; the native gesture is what a phone user will try first.

## F25 — Scroll padding is shorter than the header, so anchored content lands underneath it

- [x] Addressed
- **Severity:** 2
- **Principle:** Structure, Visibility of System Status
- **Source:** Round 4 (code)
- **Location:** `app/globals.css:45` (`scroll-padding-top: 5rem`), against
  `components/layout/SiteHeader.tsx:57` (`sticky top-0 ... pt-[env(safe-area-inset-top)]`) and
  `:58` (`h-16`); same shortfall at `components/contract/ContractDetailList.tsx:226`
  (`scroll-mt-20`)
- **Issue:** `scroll-padding-top` is a fixed 5rem (80px). The header is 4rem of content plus
  `env(safe-area-inset-top)` plus a 1px bottom border. `app/layout.tsx` sets
  `viewportFit: 'cover'` precisely so that inset is non-zero, and on a notched iPhone in Safari
  it is roughly 47–59px — putting the header at ~112–124px against 80px of scroll padding. The
  reserve is also missing at the other end: the fixed `MobileBottomNav` is 56px plus its own
  inset, and nothing sets `scroll-padding-bottom`.
- **User impact:** Any in-page anchor or programmatic `scrollIntoView` on an affected iPhone
  lands the target 30–45px under an opaque header — including `/sellers/[id]#reviews` (linked
  from the item page's star rating) and `/profile#payouts` (linked from the footer). Keyboard
  and screen-reader users hit the same thing when focus moves to an element near the top of a
  scroll. At the bottom, content scrolled to the last screenful sits behind the hub bar.
- **Fix:** Make the scroll padding express the same terms the header does:
  `scroll-padding-top: calc(4rem + 1px + env(safe-area-inset-top))`. `MarketplaceShell` already
  states the geometry this way at `:165` for the desktop rail, and its comment records what
  happens when a term is dropped — reuse that expression rather than a second literal. Add
  `scroll-padding-bottom: calc(3.5rem + env(safe-area-inset-bottom))`, and update
  `ContractDetailList`'s `scroll-mt-20` to match.

## F26 — Enter sends in both chat composers, and one of them collapses the keyboard on every send

- [x] Addressed
- **Severity:** 2
- **Principle:** Flexibility and Efficiency, Tolerance and Forgiveness, Consistency and Standards
- **Source:** Round 4 (code)
- **Location:** `components/messages/ContractChat.tsx:213-221` (Enter submits) and `:227`
  (`disabled={isPending}` on the `Textarea`); `components/messages/ChatThread.tsx:110-115`
  (same Enter behaviour, no `disabled`)
- **Issue:** Both composers bind Enter to submit and reserve Shift+Enter for a newline. A soft
  keyboard has no usable Shift+Enter, so on a phone the newline is unreachable and the return
  key becomes an unlabelled send — neither composer sets `enterKeyHint`, so the key still reads
  "return" (or "go") while doing something else. Separately, `ContractChat` disables the
  textarea while the send transition is pending: a disabled element cannot hold focus, so
  focus is dropped and iOS dismisses the keyboard on every message. `ChatThread` does not
  disable, so the two panels behave differently in the same product.
- **User impact:** A phone user cannot write a two-line message anywhere in the app, and will
  send half-written ones by reaching for what looks like a return key. In a contract room they
  additionally lose the keyboard after every single message and must tap back into the field —
  on the surface where coordinating a handover means several messages in a row.
- **Fix:** Only submit on Enter when a pointer/keyboard device is likely — or better, keep
  Enter-to-send on `sm` and up and let Enter insert a newline below it, where the visible Send
  button is already full-height and adjacent. Set `enterKeyHint="send"` (or `"enter"`, matching
  whichever behaviour ships) so the key is labelled honestly. Drop `disabled={isPending}` in
  `ContractChat` and use `readOnly` or just leave it editable — the submit guard already blocks
  a double send — so focus and the keyboard survive. Settle both composers on one behaviour.

## F27 — Hidden-scrollbar strips have no edge affordance, except the one carousel that got fixed

- [x] Addressed
- **Severity:** 2
- **Principle:** Affordances and Signifiers, Recognition Over Recall, Consistency and Standards
- **Source:** Round 4 (code)
- **Location:** `components/layout/SectionFilter.tsx:95-102` (`SectionTabs`),
  `components/contract/ContractDetailList.tsx:150-153` (the tablist),
  `components/location/PlaceSearch.tsx:229`, `components/trade/UnlistedItemDialog.tsx:254`
- **Issue:** F4 established the pattern for a scrollable row whose scrollbar is suppressed:
  track scroll position, disable the controls at each extreme, and fade the edge while more
  content remains. It was applied to `ListingCarousel` and nowhere else. Every other
  `overflow-x-auto` in the app pairs `[scrollbar-width:none]` +
  `[&::-webkit-scrollbar]:hidden` with no fade, no arrows and no other signal. `SectionTabs`
  is the sharpest case because its own comment states the problem it does not solve — "three
  tabs with counts overflow a 320px viewport, and a clipped tab is an unreachable one" — and
  then removes the only affordance a phone has left. `ContractDetailList` reasons that "the
  clipped next tab is the affordance", which holds only when a tab happens to be clipped
  mid-label rather than falling entirely outside the box.
- **User impact:** On a 320–375px phone the arbitration queue's third tab, and a contract
  inspector's later tabs, can sit off-screen with nothing indicating they exist. A member
  concludes the tab is missing rather than scrolled — the "why can't I find anything" failure,
  in navigation rather than filtering.
- **Fix:** Apply F4's `mask-image` edge fade to these strips, on whichever side still has
  overflow. It needs no scroll-position state to be useful in the common case (fade the right
  edge whenever the content overflows), and `ListingCarousel:110-124` already has the exact
  expression to copy. Worth extracting as a small shared wrapper so the next strip inherits it
  instead of re-deciding.

## F28 — Sub-44px targets, three of them stacked over another target

- [x] Addressed
- **Severity:** 2
- **Principle:** Affordances and Signifiers, Error Prevention, Accessibility
- **Source:** Round 4 (code)
- **Location:** `components/listings/WatchButton.tsx:111` (`size-10`, mounted at
  `ItemCard.tsx:98` / `:158` as `absolute right-2.5 top-2.5` over the card's full-bleed link);
  `components/listings/ImageGallery.tsx:262` and `:277` (`size-9`, `gap-0.5`);
  `components/ui/select.tsx:135` (`SelectItem`, `py-1.5` ≈ 32px);
  `components/ui/slider.tsx:70` (thumb `size-5` = 20px)
- **Issue:** Four controls below the 44px minimum, and the first one is the worst because of
  what it sits on. The save heart is 40px, inset 10px from the corner of artwork whose entire
  area is an overlay `<Link>` to the listing — so the 4px of miss around it navigates away
  instead. `SelectItem` rows at ~32px are the category, condition and sort pickers.
  The 20px slider thumb is the catalog price range.
- **User impact:** A member trying to save a listing from the grid opens it instead and has to
  come back — a wrong-outcome mis-tap, not just a fiddly one. Setting a price range on a phone
  means grabbing a 20px handle; choosing a condition means hitting a 32px row in a list of
  them, where the neighbouring value is a plausible answer and the mistake is quiet.
- **Fix:** Take `WatchButton`'s icon variant to `size-11` and widen its inset so the miss
  margin lands on the button rather than the link — or give it a transparent 44px hit box over
  a 40px visible chip, the technique `ContractProgressRail` uses. Bump the gallery arrows (see
  F24). Raise `SelectItem` to `min-h-11` below `sm`. Take the slider thumb to `size-6` with a
  44px pseudo-element hit area, mirroring the rail.

## F29 — Progress-rail hit areas overlap each other on a phone, so the tap lands on the wrong step

- [x] Addressed
- **Severity:** 2
- **Principle:** Error Prevention, Affordances and Signifiers
- **Source:** Round 4 (code)
- **Location:** `components/contract/ContractProgressRail.tsx:76-79` (`before:-inset-3` over a
  `size-5` tick), `:53` (`li` is `min-w-0 flex-1`)
- **Issue:** The component correctly extends each 20px tick to a 44px touch target with an
  invisible `before:` overlay — and says so. But the steps are `flex-1` in a single row, so
  their width is the container divided by the step count, not 44px. In a phone-width contract
  room (~288px of content at 320px, ~343px at 375px) a 7-step lifecycle gives each step 41–49px
  and a 9-step one gives 32–38px. Once the step is narrower than 44px the neighbouring overlays
  intersect, and in the overlap the later sibling paints on top and receives the tap.
- **User impact:** Tapping a step in the contract timeline can open the *next* step's detail
  line instead. The member reads a description of the wrong stage of their own contract and has
  no way to tell it was a mis-hit, because both taps produce a plausible-looking result.
- **Fix:** The row cannot hold nine 44px targets at 320px, so the layout has to give rather than
  the target. Either scroll the rail horizontally below `sm` with fixed-width steps (and F27's
  edge fade), or clamp the overlay to the available step width and instead grow the tick itself
  so the visible target matches the hit area. If the overlay stays, cap it at half the step
  width so adjacent areas meet without overlapping.

## F30 — The bottom-sheet grabber is a signifier for a gesture that does not exist, and Dialog and Sheet disagree

- [x] Addressed
- **Severity:** 2
- **Principle:** Affordances and Signifiers, Consistency and Standards
- **Source:** Round 4 (code)
- **Location:** `components/ui/dialog.tsx:88-93` (the grabber, rendered for
  `mobile="sheet"` below `sm`); `components/ui/sheet.tsx:35-46` (`side="bottom"`, no grabber)
- **Issue:** `DialogContent`'s mobile sheet paints a 40×4px rounded bar at the top — the
  platform convention for "drag me down to dismiss". Neither primitive implements a drag
  gesture; both dismiss only via the close button, the overlay and Escape. So the grabber
  promises an interaction that is not there. `SheetContent side="bottom"` — which is what the
  mobile hub menus in `MobileBottomNav` use — has no grabber at all, so the app's two
  bottom-sheet presentations look different for no reason a member can perceive.
- **User impact:** A phone user drags the handle, nothing moves, and the sheet stays open until
  they find the close button. The handle is a false affordance in the strict sense — it
  signifies a capability the object does not have. And because half the app's bottom sheets
  omit it, the presentation reads as two different components rather than one.
- **Fix:** Pick one and apply it to both. Cheapest honest option: drop the grabber from
  `DialogContent` so nothing is promised. Better: implement drag-to-dismiss once (a
  pointer-drag threshold on the content that calls `onOpenChange(false)`) and give both
  primitives the same grabber, since it is the gesture a phone user tries first on a bottom
  sheet. Either way the two should stop diverging.

## F31 — `aria-controls` on the mobile hub buttons names an element that does not exist while closed

- [x] Addressed
- **Severity:** 1
- **Principle:** Accessibility
- **Source:** Round 4 (code)
- **Location:** `components/layout/MobileBottomNav.tsx:140` (`aria-controls={`mobile-hub-${hub.id}`}`)
  against `:167` (the id lives on `SheetContent`)
- **Issue:** `SheetContent` is a Radix portal that only mounts while open, so the id is absent
  in exactly the state the attribute is read in — a closed, collapsed hub button. An
  `aria-controls` whose IDREF does not resolve is invalid and is dropped.
- **User impact:** Small. `aria-expanded` still conveys the collapsed state and the sheet takes
  focus when it opens, so a screen reader user is not stranded — they just lose the
  relationship between the button and the panel it opens.
- **Fix:** Drop `aria-controls` and rely on `aria-expanded` plus focus moving into the sheet,
  which is the honest description of a portal-mounted dialog. Keep the id on `SheetContent` for
  labelling.

## F32 — 11px text survives in permanent mobile chrome, below the floor this project set for itself

- [x] Addressed
- **Severity:** 1
- **Principle:** Perceptibility, Consistency and Standards
- **Source:** Round 4 (code)
- **Location:** `components/layout/MobileBottomNav.tsx:105`; `components/listings/ListingActionIcon.tsx:53`
  (`text-[0.6875rem] sm:text-xs`); `app/listings/[id]/page.tsx:302` and `:315` (`StarRating`),
  `:329` (the identity `<dl>`)
- **Issue:** F7 established that catalog metadata at 10px was too small, and F6 encoded the
  conclusion as a token: `fontSize.meta` is floored at 0.75rem in `tailwind.config.ts` with a
  comment stating that the floor exists so F7 "cannot silently come back". These five sites are
  `text-[0.6875rem]` (11px) bracket values that bypass it — and unlike the surfaces F6 chose not
  to sweep, three of them are mobile-only or mobile-worst: the bottom nav labels are permanent
  chrome on every signed-in page, the action chip labels only reach 12px at `sm`, and the item
  page's seller rating and identity disclosure lines never do.
- **User impact:** The five labels a phone user navigates by, and the seller identity block a
  buyer is meant to read before committing, sit below the size this project already decided was
  the comfort floor. Legible, but effortful — and it is the trust block.
- **Fix:** Replace these with `text-meta` (or `text-xs`). The bottom nav has room at 12px:
  five `h-14` cells at 320px are ~64px wide and the labels already `truncate`. This is small
  enough to fold into whichever finding touches each file — F21 for the nav and the chips, F23
  for the item page.

---

# Round 5 — contract details scroll (F33–F37)

User-reported: "scroll is a bit weird in the contract details". Traced through the height
and scroll chain: `ContractDetailList` → `ContractLiveRow` → `CashSaleView` /
`TradeContract` → `MarketplaceShell` → `PageShell` → `body`, plus `ContractFocus`.

Five distinct causes, which is why it reads as vague weirdness rather than one bug. F33 is
the one most likely to be what was actually noticed. F33, F34 and half of F35 are fixed;
F36 and F37 are structural and are left open.

The shared root cause of F35 and F36: `ContractFocus` was written for a page of collapsible
`<ContractSection>` blocks. That component no longer exists anywhere in the codebase — the
only surviving occurrence of the name was its own header comment — and the scroll mechanism
was never revisited when the design became a fixed-height tab inspector.

---

## F33 — Switching a contract detail tab keeps the previous tab's scroll position

- [x] Addressed
- **Severity:** 2
- **Principle:** Visibility of System Status, Structure
- **Source:** Round 5 (user-reported: "scroll is a bit weird")
- **Location:** `components/contract/ContractDetailList.tsx:248` (the panel body)
- **Issue:** The panel body is one persistent element that swaps its children when the tab
  changes. React reconciles it by position and type, so the same DOM node is reused — and
  `scrollTop` is state on the node, not in React. Nothing reset it. Reading the History tab
  half way down and then tapping Money rendered Money already scrolled to that offset
  (clamped to its own height).
- **User impact:** Tapping a tab lands the reader mid-content, or in whitespace past the end
  of a shorter panel, with nothing indicating there is content above. On a phone, where the
  panel is most of the screen and the tabs are the primary way around the room, it reads as
  the panel scrolling on its own.
- **Fix:** Added a ref to the panel body and an effect that scrolls it to top on
  `activeIndex` change. Keyed off the index rather than a `key` on the element, so a heavy
  panel (the Item tab and its images) is not torn down and remounted just to move a scroll
  offset.

## F34 — `overscroll-contain` dead-ends the swipe below `lg`, where the page is the scroller

- [x] Addressed
- **Severity:** 2
- **Principle:** User Control and Freedom, Consistency and Standards
- **Source:** Round 5 (user-reported, same symptom)
- **Location:** `components/contract/ContractDetailList.tsx:248`
- **Issue:** The panel body carried `overscroll-contain` at every width. That is correct from
  `lg`, where the panel sits in `ContractLiveRow`'s bounded split and the page behind it does
  not scroll. Below `lg` the room stacks and the page IS the scroller, so containment stopped
  scroll chaining: a swipe that reached the bottom of the panel ended there instead of
  carrying on down the page.
- **User impact:** On a phone the reader has to lift their thumb and start a second swipe
  outside the panel to keep moving down the room. A scroll that stops mid-gesture for no
  visible reason is the single most common way an embedded scroll container feels broken.
- **Fix:** `overscroll-contain` → `lg:overscroll-contain`. Containment where the panel is a
  bounded pane; normal chaining where it is part of a scrolling page.

## F35 — The focus scroll centred the panel, pushing the action card off the top

- [~] Partially addressed — **alignment fixed; it still targets the wrong element on desktop. See F36.**
- **Severity:** 2
- **Principle:** Visibility of System Status, User Control and Freedom
- **Source:** Round 5 (code, while tracing the reported symptom)
- **Location:** `components/contract/ContractFocus.tsx:55` (was `block: 'center'`); one live
  call site, `components/sales/CashSaleView.tsx:590` ("Choose a method")
- **Issue:** `focusSection` scrolled the target with `block: 'center'`. The target is now a
  tab panel with `min-h-[min(28rem,60dvh)]`, not a collapsible block — centring it on a phone
  scrolls the action card, which holds the button just pressed and the copy saying what to do
  next, off the top of the screen. `center` also silently ignores the panel's `scroll-mt-20`:
  `scroll-margin` is honoured for `start` / `end` / `nearest` alignment only.
- **User impact:** Pressing "Choose a method" jumps the page and takes the context away with
  it. The member is moved somewhere they did not ask to go, and the thing that explains why
  they are there is now off screen.
- **Fix applied:** `block: 'nearest'`. The panel is usually already visible and should not
  move at all; when partly off screen, the smallest scroll that reveals it is the least
  surprising outcome. `nearest` also makes `scroll-mt-20` live — which ties this to **F25**,
  since that offset is shorter than the header on a notched iPhone.
- **Still wrong:** on desktop this scrolls nothing at all, because `getElementById` returns
  the hidden mobile copy of the panel. That is F36, and it has to be fixed there.

## F36 — `ContractLiveRow` mounts both panels twice, so ids collide and `getElementById` finds the hidden copy

- [x] Addressed
- **Severity:** 2
- **Principle:** Structure, Accessibility, Consistency and Standards
- **Source:** Round 5 (code)
- **Location:** `components/contract/ContractLiveRow.tsx:90-127` — `{children}` and
  `{conversation}` are each rendered in both the `lg:hidden` mobile block and the
  `hidden lg:grid` desktop block; mounted by `CashSaleView.tsx:556` and `TradeContract.tsx:790`
- **Issue:** The two layouts are switched with CSS, not by conditional mounting, so both
  copies are always in the DOM. Consequences, in order of severity:
  1. **Duplicate DOM ids.** `ContractDetailList` puts `activeRow.props.id` (e.g.
     `contract-terms`) on the active tab panel. Both copies have the same active tab — they
     share `focusedId` through context and start from the same `defaultOpen` — so the id is
     duplicated essentially always. Invalid HTML, and it breaks any IDREF that resolves to it.
  2. **`focusSection` scrolls the wrong element.** `document.getElementById` returns the
     first match in document order, which is the mobile copy. On desktop that copy is inside
     `display: none`, where `scrollIntoView` is a no-op — so the one live focus link switches
     the tab but never scrolls, and has presumably never appeared to work there.
  3. **Two chat panels for one conversation.** `ContractChat` mounts twice, so
     `useConversationRealtime` opens two channels and `markConversationRead` fires twice per
     change. **Not a correctness bug** — `uniqueRealtimeTopic` already anticipates exactly
     this ("ChatThread + ContractChat sharing one conversationId") and gives each instance a
     UUID topic — but it is double the subscriptions and double the initial history fetch, on
     mobile connections, for a panel the viewer cannot see.
- **User impact:** Mostly indirect. Directly: the desktop focus link is dead, and every
  contract room pays for a duplicate realtime subscription and history fetch. For screen
  reader users the duplicated ids mean the panel's accessible name can resolve to a hidden
  element.
- **Fix:** Mount one copy. The clean version is to render `children` / `conversation` once
  and move the layout decision to `MobileOnly` / `DesktopOnly` from
  `components/layout/Breakpoint.tsx`, which is the pattern `MarketplaceShell` already uses
  for exactly this reason — its comment on `filters` says "they mount exactly once … so field
  ids stay stable", which is the same problem. That swaps a CSS switch for a JS one, so check
  the first-paint behaviour: `Breakpoint` assumes mobile on the server, so a desktop reader
  briefly gets the stacked layout. If that flash is unacceptable, the alternative is to keep
  the CSS switch and namespace the ids per copy, which fixes 1 and 2 but not 3.

## F37 — The panel's scroll model flips between internal and page scroll depending on how much content the tab has

- [x] Addressed
- **Severity:** 2
- **Principle:** Consistency and Standards, Visibility of System Status
- **Source:** Round 5 (code) — **mechanism read from the code; the exact tipping point was not
  reproduced in a browser**
- **Location:** `components/contract/ContractLiveRow.tsx:100` and `:113`
  (`min-h-[min(28rem,60dvh)]` with `[&>*]:h-full`); `components/contract/ContractDetailList.tsx:126`
  (`h-full min-h-0`); the chain above it — `app/layout.tsx:76` (`body` is `min-h-dvh`),
  `MarketplaceShell.tsx:186-206` (`flex-1 min-h-0` throughout)
- **Issue:** `[&>*]:h-full` gives the inspector `height: 100%` against a parent that sets only
  `min-height`. Whether that resolves to a definite height depends on whether the flex chain
  above is itself bounded — and it is not, consistently: `body` is `min-h-dvh`, a floor rather
  than a cap, so the chain grows to fit content. When the active tab is short the chain has a
  definite height and the panel scrolls internally while the page stays put. When it is long
  the chain grows, the panel takes content height, its `overflow-y-auto` never engages, and
  the page scrolls instead.
- **User impact:** The same swipe does two different things in the same room, and which one it
  does changes as you switch tabs. Nothing on screen indicates which mode you are in. This is
  the most likely source of the residual "weird" after F33 and F34, and it is the hardest to
  describe precisely, which fits how it was reported.
- **Fix:** Decide which model the room has and state it once, rather than letting it fall out
  of the chain. The listing detail page already does this deliberately and documents why —
  `app/listings/[id]/page.tsx:213` declares
  `lg:h-[calc(100dvh-7.5rem-1px-env(safe-area-inset-top))]` with a comment explaining that the
  bound "has to be declared somewhere" because `min-h-dvh` is a floor. The contract room wants
  the same treatment: a declared height at `lg` so the split panes scroll internally, and
  auto-height below `lg` so the page scrolls and the panels do not — which also means dropping
  the internal `overflow-y-auto` below `lg` rather than leaving a scroller that may or may not
  engage. Verify on a device, and after **F20**: `dvh` currently ignores the keyboard, so any
  declared height here is measured against a viewport that is wrong whenever the composer has
  focus.
