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
| 3 — Major | 0 | 4 |
| 2 — Minor | 0 | 11 |
| 1 — Cosmetic | 0 | 3 |
| **Total** | **0** | **18** |

All 18 findings implemented. Verified with `npx tsc --noEmit` (clean),
`npx eslint app components lib domain` (clean), and `npm run test` (267 passed, 24 files).
F6 is partial by design — see its entry. R1 is **not** built and track C is blocked; see R1.

Not yet verified by anyone: how these look rendered. Worth a pass over the home page,
catalog, a cash sale room, and a deal room's Terms tab before this is called finished.

Sources so far:
- Round 1 — code audit of app shell + buyer-facing discovery flow (F1–F11)
- Round 2 — user-reported, screenshots (F12–F17)

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
