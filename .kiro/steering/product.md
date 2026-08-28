# Product

**NoDitto** (`NoDitto.app`) is the member-facing product. **CardTrade** is the repo, Flutter package, Postgres schema (`cardtrade`), and older domain comments — not the name members see.

NoDitto is a safety-first, peer-to-peer clearinghouse and marketplace for trading cards (TCGs and sports cards). Its differentiator is a trustless escrow engine built to run on Stripe. The product is deliberately cards-only for now — user-facing copy and category pickers expose only card games to concentrate liquidity — but the domain model, contracts, and DB taxonomy remain category-agnostic so adjacent collectibles (comics, coins, memorabilia) can open later without rework. Comics, stamps, coins and memorabilia rows are excluded from the public catalog (0104).

## Surfaces

| Surface | Path | Role |
|---|---|---|
| Web | Next.js App Router (`app/`) | Primary, complete MVP |
| Flutter | `flutter_app/` | Second client. Writes go through `app/api/mobile/**`. Partial parity — see Mobile. |
| Backend | Supabase (`cardtrade`) + Next server actions + Stripe + Ship24 + AWS SES | Working |

`GET /api/health` is uptime only. It does not check Stripe, Supabase or Ship24.

## Features and functionality

This section is the inventory of what is **built**. Transaction-model invariants live under [Transaction models](#transaction-models); do not re-derive a money or gate rule from this list.

### Auth

| Route | What |
|---|---|
| `/sign-up` | Email + password. Rate-limited. Stricter email validation than sign-in (the address becomes Connect `contact_email`). Provisions `profiles`. Duplicate → `DUPLICATE_ACCOUNT`. Email confirmation may be required. |
| `/sign-in` | Email/password. Distinct `EMAIL_NOT_CONFIRMED` vs `INVALID_CREDENTIALS`. `ACCOUNT_BANNED` for fraud-banned. |
| `/forgot-password` | Enumeration-safe reset email |
| `/reset-password`, `/auth/update-password` | Set new password |
| `/auth/callback` | OAuth PKCE complete + profile provision |
| `/auth/confirm` | Email confirmation |

Google OAuth is live (`signInWithGoogle`). Guests may browse the catalog. Signed-in members without `onboarding_completed_at` are sent to `/onboarding` from catalog and every protected route (`proxy.ts`). `/` stays open. Fraud-banned members land on `/account-suspended`.

Protected prefixes: `/profile`, `/listings/new`, `/listings/mine`, `/listings/[id]/edit`, `/trades`, `/messages`, `/notifications`, `/purchases`, `/sales`, `/offers`, `/saved`, `/account`, `/onboarding`, `/deals`, `/admin`.

### Onboarding

Route: `/onboarding`. Required to transact, not to look. The footer links to the catalog on every step.

Wizard (`OnboardingWizard`):

1. **Welcome** — how cash sales and trades work
2. **Alias** — public display name and optional avatar
3. **Region** — trading region (only `tradingEnabled` regions; AU today)
4. **Intent** — buyer or seller
5. **Seller path** — Identity + Connect on `UnifiedOnboardingSurface`
6. **Buyer path** — optional saved-card setup, skippable

Return markers `?identity=complete` and `?payouts=complete`/`refresh` pick the seller step only. Status is re-read from Stripe, never trusted from the query string.

The unified surface hosts Stripe Identity and Connect embedded on one NoDitto page. Mock and non-Stripe providers fall back to a hosted or demo step. The two **gates** stay independent — unifying the UI does not merge Identity_Gate with payouts. See [Identity and payouts](#identity-and-payouts).

### Identity and payouts

Two sequential steps, gating different things:

| Gate | Predicate | Unlocks |
|---|---|---|
| **Identity_Gate** | `identity_check_status = 'VERIFIED'` (Stripe Identity document + selfie) | List, sell, enter trade escrow, be a disclosed seller |
| **Payout / Connect** | `merchant_status = APPROVED` **and** `merchant_settlements_enabled` (`canReceiveFunds`) | Receive money |

A verified member with no payout account is a normal, valid state. Cash buyers do **not** need Identity. Legal name is `identity_check_name`, falling back to `merchant_legal_entity_name` for members grandfathered before 0069. Full legal name is disclosed only to counterparties on a live contract.

Profile tabs (`/profile?tab=`): `profile` | `verification` | `payouts`. Connect onboarding lives under Verification. `/profile/payouts` is reporting.

### Catalog and listings

| Route | What |
|---|---|
| `/` | Catalog (region-scoped). There is no marketing landing page. |
| `/listings` | Permanent redirect to `/` (`next.config.ts`) |
| `/listings/[id]` | Public detail: buy, offer, trade, watch, message, report |
| `/listings/[id]/edit` | Owner edit |
| `/listings/new` | Create (Identity_Gate required) |
| `/listings/mine` | Owner inventory |
| `/saved` | Watchlist |
| `/sellers/[id]` | Public seller: listings, rating, reviews, socials, report |

**Listing kinds** (`items.listing_kind`, immutable after create):

- **SINGLE** — one object. Opening a cash sale reserves it. One live cash sale (`cash_sales_one_active_per_item`). May be offered.
- **SHOPFRONT** — member copy: **binder or bulk listing**. Inventory. Never reserved, never `SOLD`. Closed via `closed_at`. `fmv_cents` is an indicative "from" price. Several concurrent cash sales and trades are allowed. **Cannot be offered. Cannot be the offering side of a trade.** Copy must always say **nothing is held**.

Create requires Identity_Gate and a seller identity disclosure. Title is **derived** from the description (`deriveItemTitle`), not typed. Images: 1–10. Location is suburb-level.

**Category is the card game**, not a collectible type (0104): Pokémon, One Piece, Yu-Gi-Oh!, Magic: The Gathering, Riftbound, Disney Lorcana, Gundam, Flesh and Blood, Star Wars: Unlimited, Digimon, Dragon Ball Super, Weiss Schwarz, Cardfight!! Vanguard, Union Arena, Sports Cards, Other TCG (`lib/catalog/cardGames.ts`).

Conditions: Graded, Unopened, Mint, Near Mint, Lightly Played, Heavily Played, Damaged.

Catalog filters: `q`, `category` (multi), `condition` (multi), `min`/`max` dollars, `sold=1`, `sort`, `page`, `region`. Sort: `newest` | `price-asc` | `price-desc` | `rating`. Browse region is a display scope. Contracts still run `checkRegionCompatibility`.

Watchlist: toggle, `items.watch_count`, `/saved`.

Hidden items exist for private-deal invites only (`createPrivateTradeItem`) and must never appear in the catalog.

### Offers

Route: `/offers`. Price negotiation on a **SINGLE** listing only. A shopfront offer is refused (`item-not-available`) — one amount against a whole binder says nothing about which cards, and the cash-sale request flow already asks for a written request and a price.

- Buyer must be authenticated; seller must have identity disclosure; buyer confirms the seller identity version.
- One live `PENDING` offer per buyer per item.
- Chain via `parent_offer_id`. Counter → `COUNTERED`.
- Statuses: `PENDING` | `ACCEPTED` | `DECLINED` | `COUNTERED` | `WITHDRAWN`.
- **Accept** (recipient only) opens a Cash_Sale at the offer price, then marks the offer `ACCEPTED`. If the sale fails, the offer stays `PENDING`. Other `PENDING` offers on that item are declined.
- Withdraw = offerer only. Decline = recipient only.

### Cash sales

Routes: `/sales`, `/sales/[id]`, `/purchases`.

**Cash_Sale statuses** (13, `domain/orchestrator/cashSaleOrchestrator.ts`):

`AGREEMENT` → `PAYMENT_PENDING` → `ESCROW_HELD` → (`IN_TRANSIT` \| `HANDOVER`) → `INSPECTION` → `COMPLETED`

Terminal: `CANCELLED` | `FAILED` | `REFUNDED`. Mid-flight returns: `RETURN_PENDING` | `RETURN_IN_TRANSIT` (not terminal). Also: `DISPUTED`.

Lifecycle:

1. Buyer opens agreement. SINGLE is reserved. Shopfront needs line items (`cash_sale_items`). Region + seller Identity_Gate + seller-identity confirmation snapshot. Buyer does not need Identity.
2. Negotiate price, line items, fulfilment (`DELIVERY` / `IN_PERSON`), shipping cost, meeting place/time.
3. **Payment is the commitment.** There is no mutual confirm-to-pay (0099). The seller sets handover details; the buyer pays. Card is collected into the platform balance. Fee = **5% of item price** (`PLATFORM_FEE_BPS = 500`). Shipping is pass-through.
4. Fulfil:
   - `DELIVERY`: seller records shipment → `IN_TRANSIT` → carrier or buyer receipt → `INSPECTION`. The inspection clock starts on **carrier-confirmed delivery**, not the buyer's word.
   - `IN_PERSON`: both confirm handover → the sale **completes on the second confirmation** (unlike trades).
5. Inspect — **7 days**. Auto-complete via pg_cron `auto_complete_due_cash_sales` (`:07` hourly). Warning emails from the Vercel job.
6. Payout — queued, drained by `/api/jobs/cash-sale-payouts` (`:47` hourly). Needs `canReceiveFunds`, else `SELLER_NOT_PAYABLE`.
7. Cancel — only from `AGREEMENT` (pre-payment). Item returns to the catalog.
8. Dispute — from `ESCROW_HELD` | `IN_TRANSIT` | `HANDOVER` | `INSPECTION`. Withdrawal exists (0084).
9. Returns — see [Return-conditional refunds](#return-conditional-refunds).

`proposeCashSalePrice` refuses on a shopfront; the price **is** the sum of the lines.

Changing **what is bought or the cash** voids both acceptances. Changing **fulfilment only does not** (0101): meeting place, postage and handover method are coordination, not a new deal.

### Trades

Routes: `/trades`, `/trades/new`, `/trades/[id]`.

A Trade row is created on the first offer and lives in `NEGOTIATING` until `TERMS_AGREED`. Either party can counter. The same `terms_version` must be accepted by both. Saved card is a hard prerequisite for escrow.

Fulfilment: `DELIVERY` or `IN_PERSON`. Handover-only edits do **not** void acceptances (0101). Cash, declared value, or `counterpart_goods_description` **do**.

See [2-Way Trade Escrow](#2-way-trade-escrow) for collateral, inspection, shopfront trades, and the in-person vs delivery split.

### Private deals

A shareable invite (`deal_invites`, 0103) that opens a normal Cash_Sale or Trade. This is **not** the retired `deals` / `deal_holds` / `deal_payments` ledger (0055). Do not resurrect that ledger.

| Route | What |
|---|---|
| `/deals/new` | Redirects to the homepage Start Deal dialog |
| `/t/[token]` | Public join. Signed-out preview + sign-in. Claim opens a Cash_Sale or a Trade |

Invite kinds:

- `CASH_SALE` + host `SELLER` — host puts up a **hidden** card and a price
- `CASH_SALE` + host `BUYER` — host states a wanted description and a price; the joiner puts up the card
- `TRADE` — host hidden card + wanted description + optional cash-to-even

TTL **14 days**. Host can revoke. Self-join refused. Region + Identity (seller side) enforced on claim. A catalog listing cannot be attached (`privateItemProblem`). Pending invites are listed on `/sales`, `/purchases` and `/trades`.

### Messaging

Routes: `/messages`, `/messages/[id]`.

1:1 conversations, deduped by ordered `(participant_a, participant_b)` plus optional `item_id`. Body 1–4000 characters. Attachment-only messages are allowed (0102). Attachments (0100) use a signed upload; the path is verified against the caller prefix.

Contract rooms embed chat. Listing pages open or reuse a conversation via `getOrCreateConversation`. Sending creates an in-app notification. Mark-read is supported.

### Notifications and email

Route: `/notifications`. Types: `OFFER` | `MESSAGE` | `TRADE` | `SALE` | `SYSTEM`. Header bell: `NotificationBell` / `NotificationCenter`.

Email via AWS SES (`lib/email/notify.ts`), fire-and-forget, threaded per contract: inspection deadline warning, return deadline warning, dispute raised, payout settled, new purchase request, trade offer received, item shipped.

### Reviews

After a `COMPLETED` cash sale or trade, either party may rate the counterparty 1–5 with an optional comment ≤ 1000 characters. Unique per `(reviewer, source_type, source_id)`. A trigger updates `profiles.rating` / `rating_count`. Shown on `/sellers/[id]`. Flutter can read reviews; it cannot leave them.

### Reports

Any authenticated member can report a listing or a user (`lib/actions/reports.ts`). Reports enter the admin queue. They never move money and never notify the target.

### Profile and account

`/profile`: avatar, display name, bio, social links, saved card. Verification tab: Identity + Connect + trading region. Payouts tab: owed / landed (`domain/payouts/*`). Custody reconciliation **excludes** trade collateral (uncaptured authorisations).

`/account-suspended` — permanent, fraud only. Confirmed objective fraud sets `fraud_banned_at`, removes listings from the catalog (0091), blocks sign-in, and copies Stripe Identity person keys (HMAC of the government ID, never the raw number) onto a blocklist. A later account that verifies as the same person is refused `VERIFIED` and banned. Cash buyers never verify, so a banned scammer can still browse and buy under a new email until they hit Identity.

### Admin

| Route | Who | What |
|---|---|---|
| `/admin/arbitration` | `is_staff` | Cases. Frozen money. Evidence, notes, assign, resolve. |
| `/admin/arbitration/[kind]/[ref]` | staff | Case view |
| `/admin` | `is_admin` | Operations: payouts stuck, reports, reconciliation flags, custody |

`requireStaff()` (`is_support` OR `is_admin`) may arbitrate. `requireAdmin()` may moderate. Two capabilities, not a hierarchy.

Staff actions: hide/unhide item, clear avatar, report status, clear trade recon flag, retry cash-sale payout, resolve cash-sale return, resolve cash-sale dispute, resolve trade condition dispute, resolve trade fraud, custody position, drain payouts.

There is deliberately **no identity dossier**. The Police Evidence Pack stays retired.

### Marketing and policy

`/help`, `/terms`, `/privacy`. Terms and privacy are product policy, not counsel-reviewed — say so. `/deals` is disallowed in `robots.ts`.

### Background jobs

**Vercel** (`vercel.json`):

| Path | Schedule | Does |
|---|---|---|
| `/api/jobs/cash-sale-payouts` | `:47` hourly | Drain queued seller payouts and refunds. Bearer `CRON_SECRET` / `JOBS_SECRET`. Fail-closed. |
| `/api/jobs/trade-inspections` | `:17` hourly | Auto-complete expired trade inspections (void holds); cash-sale inspection emails; retry failed trade fees; flag stale `COLLATERAL_PENDING` |

**pg_cron** (Supabase):

| Job | Minute | Does |
|---|---|---|
| `cardtrade_auto_complete_cash_sales` | `:07` | Complete lapsed 7-day cash-sale inspections |
| `cardtrade_warn_expiring_holds` | `:17` | Warn on trade hold expiry |
| `cardtrade_expire_lapsed_holds` | `:27` | Expire lapsed holds |
| `cardtrade_enforce_trade_shipping_deadlines` | `:37` | Nudge / mark `SHIPPING_OVERDUE` — never cancels, never moves money |

### Payments and tracking

Provider: `PAYMENTS_PROVIDER` = `mock` | `stripe` | unset (Stripe if configured, else mock). Currency is integer minor units. Presentment from region (AU → AUD). One global `STRIPE_CURRENCY` is why only AU can trade.

**Card** is the live rail. PayTo is documented intent, not implemented. BECS is rejected — its dispute window is 7 years, no-questions-asked, and unappealable.

Saved cards: Stripe SetupIntent. Required for trade collateral. Cash sale: PaymentIntent collected into the platform balance, then Connect transfer. Trade collateral: uncaptured authorisation. Voided on success. Not counted in custody.

Webhooks: `POST /api/webhooks/stripe` (mock HMAC or Stripe signature, idempotent). Ship24: `POST /api/webhooks/ship24`. `carrier_delivered_at` is set only on `DELIVERED`. Manual tracking is the no-carrier fallback.

Demo panels (`lib/actions/demo.ts`) confirm/fail holds, settle cash payment, and fire identity webhooks. **Off when Stripe is live.** In production, `ENABLE_PAYMENT_DEMO` must be explicit.

### Mobile

Flutter screens exist for auth, catalog, listing CRUD, saved, seller profile, trades, sales, purchase UI, messages, offers, notifications, profile, and identity/payout explainers.

The mobile write API (`app/api/mobile/**`) delegates to the same server actions as the web. Reads mostly go direct to Supabase under RLS.

**Web-only or WebHandoff today:** starting a cash sale still opens the website (`WebHandoff.buyListing`) even though `cash-sale/initiate` exists; Identity and Connect hand off to `/profile`; no unified onboarding wizard; no private-deal invites; no return shipping; reviews are read-only; no admin; no help/terms/privacy; no report flow. Catalog filters are thinner.

Treat Flutter as **partial parity**, not a second complete product. `.kiro/specs/mobile-parity/` is the remaining gap list. `flutter_app/SPEC.md` is a Flutter design spec, not this product spec.

---

## Transaction models

1. **Cash Sale** — Buyer pays, the platform holds the funds, and the Seller is paid their net once the Buyer accepts the goods. The platform fee is **5% of the agreed item price** (`PLATFORM_FEE_BPS = 500`), charged on the item price only — shipping is a pass-through to the carrier, not revenue.

   **Do not describe the fee as flat.** It is percentage-based in code, and no Australian rail Stripe offers makes a flat fee viable: cards cost 1.7% + $0.30 and PayTo costs 1% + $0.30, both percentages. Card is the current rail; PayTo is the intended addition, worth 0.7 points and a materially better chargeback profile, with card retained as a fallback because PayTo needs the payer's bank to have enabled it. BECS is rejected outright — its dispute window is 7 years, "no questions asked", and unappealable, which is untenable for a platform that is merchant of record and owns loss liability.

   **A listing is either a SINGLE object or a SHOPFRONT** (`items.listing_kind`, migration 0064). Sellers list a whole binder and sell individual cards out of it, which a one-object listing cannot express: opening a contract flipped `items.status` to RESERVED, and because `items_catalog_select` treats availability as VISIBILITY, the binder vanished from the catalog for every other buyer.

   A shopfront is a browsable inventory, not a thing for sale. It is **never reserved and never sold**, several Buyers hold their own Cash_Sale against it concurrently, and its `fmv_cents` is an indicative "from" price only. `cash_sales_one_active_per_item` still forbids two live contracts on a SINGLE listing — dropping it would let two Buyers race onto one card — and shopfronts opt out via the `cash_sales.from_shopfront` snapshot. A shopfront ends by being **closed** (`items.closed_at`), which leaves its open contracts running; it never reaches SOLD, so it would otherwise live forever.

   **Contract line items are what make a shopfront safe** (`cash_sale_items`). The listing cannot say what any one contract covers, so the contract says it: description, condition, quantity and unit price per line, authored during negotiation and frozen at the Commitment_Point. `agreed_price_cents` for a shopfront contract IS the sum of its lines and is set no other way — `proposeCashSalePrice` refuses on a shopfront so there is one source of truth for the number being charged. Replacing the lines writes the price, which fires the existing `cash_sales_reset_acceptances` trigger, so **swapping one card for another of identical value still voids both acceptances**. That is the point: what is being bought changed.

   These lines are not presentational. Arbitration reads the contract and never the listing, so before them a disputed binder sale gave staff one shared title and a dollar figure with no way to adjudicate "he sent the wrong card".

   **ACCEPTED RISK, RECORDED DELIBERATELY.** `RESERVED` is what makes double-selling one physical object structurally impossible, and a shopfront has none, so a Seller CAN agree to sell the same card to three Buyers. Escrow contains it — every Buyer's money sits in the platform balance until they accept, so the ones who get nothing dispute and are refunded — and because contents are rows rather than chat messages, "three live contracts naming the same card" is queryable, surfaceable to the Seller and admissible to an arbitrator. This is a reputation and friction problem, not a stolen-money problem. Do not "fix" it by reserving a shopfront: that reinstates exactly the behaviour 0064 exists to remove.

   **A shopfront can be BOUGHT from and TRADED FOR, but never OFFERED, and never made the subject of an Offer** (0081, superseding 0064's blanket cash-only refusal).

2. **2-Way Trade Escrow** — Two users swap goods of equal Fair Market Value with $0 cash. A pre-authorization hold for 100% of FMV is placed on both parties and voided once both receive and accept. The platform fee is 5% of Trade_Side_Value, charged symmetrically to both traders (`domain/trade/tradeFee.ts`).

   **Trade negotiation** follows `PROPOSED → NEGOTIATING → ACCEPTED`. Either party can counter-offer until terms are agreed: items, fulfilment method (delivery or in-person), meeting place/time, and shipping cost. The negotiation panel (`components/trade/TradeNegotiationPanel.tsx`) and server actions (`lib/actions/tradeNegotiation.ts`) handle this flow.

   **Trade fulfilment reaches INSPECTION by two routes, one per method, and they converge deliberately.** A `DELIVERY` trade goes `COLLATERAL_LOCKED --BOTH_SHIPPED--> IN_TRANSIT --BOTH_RECEIVED--> INSPECTION`; an `IN_PERSON` trade goes `COLLATERAL_LOCKED --BOTH_HANDOVER_CONFIRMED--> INSPECTION` in one step. The capitalised names on the arrows are events, not intermediate states. Confirming a face-to-face handover says "we met and swapped", NOT "I am satisfied", so it must never complete the trade: a trader who has just been robbed, coerced, or handed a convincing fake at a meeting point needs a remedy afterwards. This is the one place trade fulfilment deliberately differs from the Cash_Sale, whose in-person path completes on the second confirmation.

   `HANDOVER_FAILED` freezes a trade from `COLLATERAL_LOCKED` or `IN_TRANSIT` and captures **nothing**. It is not `CONDITION_DISPUTE`, which settles a $20 Friction_Tax against the other trader — a no-show has not been proven to be anyone's fault and a lost parcel is nobody's. Before it existed, an `IN_TRANSIT` trade had no exit at all: both traders' collateral sat until the authorisation lapsed, which removes the guarantee rather than resolving anything.

   **The trade inspection window is 72 hours, not the Cash_Sale's 7 days**, measured from the agreed meeting instant (`IN_PERSON`) or from the LATER carrier-confirmed delivery (`DELIVERY`), with a 24-hour floor so a late confirmation still leaves room to dispute. This is a consequence, not a tuning knob: collateral is an uncaptured authorisation that lapses about 7 days after it was PLACED, and a trade's clock starts at collateral rather than at delivery, so postage both ways plus 7 days of inspection would routinely outlive the thing backing it. A carrier-confirmed delivery is the only thing that starts the clock; a trader's own word records receipt but never starts a clock that can end in a payout against them.

   A posted trade has a **postal address of record for each trader** in `trade_delivery_details` — two rows, because a swap posts in both directions — readable by the other trader only from `COLLATERAL_LOCKED`. It is deliberately not on `trades`, which is Realtime-published.

   **Verified traders are NOT bond-exempt.** Entering trade escrow gates BOTH parties on the Identity_Gate (because a fraud finding can pay either side). `resolveTradeBonds` bonds both traders regardless of verification. A Stripe authorisation moves no funds and costs nothing to void, so there is no justification for exempting verified traders from collateral — doing so would disable the safety machinery. `requiredBondCents` KEEPS the exemption only for Cash_Sale seller bonds, where the Buyer's money is already collected and a verified Seller has nothing left to guarantee.

   A saved card is a hard prerequisite for trade escrow — `acceptTradeTerms` surfaces that as an actionable message rather than a generic failure. The default policy is 100% of FMV with `ceilingCents: null`, so a high-value swap asks for an authorisation most cards will decline; `BondPolicy.ceilingCents` is the knob for that and is covered by a test.

   **Trade collateral is NOT the same thing as Cash_Sale proceeds.** Trade collateral is an *uncaptured card authorisation*: no money moves, and none of it enters the platform balance — the platform holds a claim, not funds. Cash_Sale proceeds are genuinely *collected* into the platform balance. Custody reconciliation counts the second and excludes the first (`domain/payouts/custodyReconciliation.ts`); counting collateral would invent a shortfall on every open trade. Member-facing copy calls it **trade collateral** and always explains that it is a temporary card hold — never "escrow", which would imply the platform holds money it does not.

   0064 refused trade escrow on a shopfront for two stated reasons, and both are now answered rather than waived. Value: a binder side is worth **whatever is offered against it**, because a 2-Way Trade is an equal-value swap by construction and "some cards out of a binder" has no determinate price — its `fmv_cents` is the whole inventory's indicative "from" figure. That rule is `resolveTradeSideValues` in `domain/trade/tradeSideValues.ts` and it is the ONE definition: the collateral sizing, the charged Trade_Fee and the fee the contract room DISCLOSES all read it, so a binder trade cannot authorise one figure while showing another. Availability: a binder is permanently AVAILABLE and is open for business until it is **closed**, so every guard tests `closed_at` for a shopfront and `status` for a single listing — testing status alone is what made a binder untradeable.

   **The trade states what comes out of the binder**, in `trades.counterpart_goods_description`. This is the trade-side equivalent of `cash_sale_items` and exists for the same reason: arbitration reads the contract and never the listing, so without it a disputed binder trade hands staff an inventory title and no way to adjudicate "she sent the wrong card". It is part of the TERMS — revising it voids both acceptances, exactly as changing the cash does — and it is on the arbitration case view.

   Two things stay refused. A shopfront may not be the **offering** side: the offering side is what the binder side derives its value FROM, so a binder there would leave both sides inheriting from each other and nothing valued. `requiredBondCents` returning 0 for a zero side would then confirm escrow with no collateral behind it, which is why `tradeSidesAreValued` refuses a zero side rather than reading it as "no bond needed". And **Offers** stay refused: one `amount_cents` against a whole binder says nothing about which cards, and the buy flow already asks for a written request *and* a price, so an Offer control would be a second, worse version of it.

   The 0064 accepted risk above now spans trades as well: with no per-card reservation, a binder's owner can promise the same card to a cash Buyer and a Trader at once. The containment is unchanged — the goods are recorded on each contract rather than in chat, so the overlap is queryable and admissible, and collateral means the wronged party has a remedy. Do not "fix" it by reserving the binder.

   **The marketplace is regional: one deployment, listings scoped to a jurisdiction, deals completed inside one** (migration 0065). Browsing crosses regions; contracts do not.

   **There are TWO region values and merging them is the mistake to avoid.** `items.location_country_code` is where the GOODS are and scopes the catalog. `profiles.region_code` is where the MEMBER trades: it is read by the contract guards and must agree with the country on their Stripe Connect account, because a transfer to an account registered elsewhere fails. They are not redundant — a member can post a listing while travelling, and the parcel's origin is not the payee's jurisdiction.

   **`profiles.region_code` must NEVER come from an IP address.** A VPN, a corporate proxy or a holiday would assign a member a jurisdiction they cannot settle in, discovered only when a payout fails after goods shipped. IP (`x-vercel-ip-country`, read only in `lib/location/resolveRegion.ts`) decides what a first-time visitor SEES and nothing more. The trading region is stated at onboarding and, once a `merchant_ref` exists, `setTradingRegion` refuses to move it — Stripe fixes an account's country at creation.

   **The region check is a contract guard, not a browse filter, and a filter alone would be cosmetic.** A shared link, a watchlist entry, a saved search or `/listings/[id]` direct all bypass the catalog. Evaluate compatibility only through `checkRegionCompatibility` in `domain/region/regions.ts` — the same rule the Identity_Gate follows. `initiateCashSale` returns `REGION_MISMATCH` and `openTradeNegotiation` returns `region-mismatch`; the listing page warns earlier via `public_profiles.region_code`, but that copy is advisory and the orchestrator refuses regardless.

   An ABSENT region is refused, not waved through. "We do not know where either party is" is not a basis for taking their money, and a permissive default would let every pre-0065 Profile bypass the guard.

   A region in `REGIONS` is **browsable**; only `tradingEnabled` makes it **tradeable**. Today that is AU alone. Do not let a member select a browse-only region as their own: badging them ready and then refusing every contract they open is the shape of the 0060 mistake. What still blocks enabling a second region is not the region model — it is that `STRIPE_CURRENCY` is one global value and no money column records its own denomination, so a platform balance holding AUD and GBP at once has no way to say which is which.

3. **Dispute & Fraud Resolution** — A state machine handling condition disputes (a fixed $20 partial capture "friction tax") and objective fraud (full capture of collateral, paid out to the victim). A staff-confirmed Objective_Fraud finding permanently bans the responsible account. There is deliberately **no identity dossier**: the "Police Evidence Pack" was withdrawn because the platform has no basis to hand a person's identity documents to a private individual on the strength of an in-app fraud determination.

   Condition dispute on a trade captures `FRICTION_TAX_CENTS` ($20), capped at the hold: $10 return shipping to the counterpart, $10 platform (`domain/dispute/frictionTax.ts`). Those amounts are AU-only constants; a second trading region makes them a per-currency lookup.

   Members upload dispute evidence (0082). Cash-sale disputes may be withdrawn by the raiser (0084).

### Return-conditional refunds

Implemented (0088–0092). When a full `REFUND_BUYER` is awarded and the goods are with the Buyer:

1. Sale → `RETURN_PENDING`. Item stays `RESERVED`. Seller return address lives in `cash_sale_return_details`.
2. Buyer ships by `return_deadline_at` (7 days to hand the parcel to a carrier).
3. `RETURN_IN_TRANSIT`. Carrier-confirmed delivery to the Seller **automatically refunds**.
4. Buyer can `disputeCashSaleReturn`. Staff `resolveCashSaleReturnCase`.
5. Lapse marker (0089), bounce on a returned sale (0092), queue fix (0090).

**Goods first, then money.** The platform already holds the funds, so this ordering costs the Buyer nothing they have not already accepted. Refunding first and trusting the return would put the entire loss on the Seller. The Buyer's protection is that the refund is automatic on carrier confirmation — the Seller cannot sit on it.

`RETURN_PENDING` and `RETURN_IN_TRANSIT` are **not terminal**. Relisting before the return lands would advertise goods that are in transit.

This flow is web-only today.

---

## Current phase

The platform is a **functional MVP**. Web has both transaction models, private-deal invites, return-conditional refunds, onboarding, identity, listings, offers, messaging, reviews, reports, admin, and real-time contract rooms end-to-end.

- The payment seam supports both `MockService` (deterministic simulation for local dev) and real Stripe (`sk_test_` keys for integration testing, `sk_live_` for production). Provider is selected by `PAYMENTS_PROVIDER`.
- Webhook pipeline handles both mock and real Stripe deliveries with signature verification.
- Vercel cron jobs run the cash-sale payout sweep and trade-inspection timeout hourly. pg_cron completes lapsed cash-sale inspections and nudges trade shipping.
- Flutter is a second client with a mobile write API; purchase initiate, identity, Connect, private deals, returns, leaving reviews, reports and admin are not at parity.

In-progress specs that are **not** greenfield: `.kiro/specs/unified-seller-onboarding/` (UI is in the tree), `.kiro/specs/mobile-parity/` (remaining Flutter gaps), `.kiro/specs/return-refunds/` (implemented on web).

---

## Domain vocabulary

Use these terms consistently in code and docs: Profile, Identity_Gate, Payout_Gate, Item, Listing_Kind, Shopfront, Contract_Line_Item, Trade_Side_Value, Fair_Market_Value, Cash_Sale, Trade, Trade_State, Trade_Event, Cash_Sale_Status, Pre_Auth_Hold, Hold_Void, Partial_Capture, Full_Capture, Friction_Tax, Verified_Identity, Identity_Disclosure, Commitment_Point, Webhook_Event, Trade_Collateral, Trading_Region, Browse_Region, Deal_Invite, Return_Pending, Return_In_Transit.

**Trade_Side_Value is not Fair_Market_Value.** FMV is a property of an Item (`items.fmv_cents`). A Trade_Side_Value is what one SIDE of a Trade is worth for collateral and fees, and on a binder it is deliberately not the sum of its items' FMV — see the shopfront note under Transaction models and `domain/trade/tradeSideValues.ts`. Never size collateral or a fee from FMV directly.

**Trading_Region and Browse_Region are different things** — see the regional note under Transaction models. Trading_Region is `profiles.region_code`, gates contracts, and never comes from an IP. Browse_Region is a display preference and may be guessed. Member-facing copy says **region**; say what it governs rather than which of the two it is.

Member-facing copy says **binder or bulk listing**, never "shopfront" — that is the internal name (`listing_kind = 'SHOPFRONT'`). And it must always state that **nothing is held**: on every other listing opening a contract reserves the goods, so leaving that implicit is the difference between a disappointed buyer and a misled one.

**Trade_State and Trade_Event are different sets — do not merge them.** This document previously listed one flat union containing both, which reads as a state list and is not one.

- **Trade_State** (9 values, `domain/state-machine/types.ts`, and byte-for-byte the `cardtrade.trade_state` enum): `NEGOTIATING | COLLATERAL_PENDING | COLLATERAL_LOCKED | IN_TRANSIT | INSPECTION | COMPLETED | DISPUTED | FRAUD_RESOLVED | CANCELLED`. `COMPLETED`, `FRAUD_RESOLVED` and `CANCELLED` are terminal.
- **Trade_Event** — what drives a transition. `BOTH_SHIPPED`, `BOTH_RECEIVED`, `BOTH_HANDOVER_CONFIRMED` and `HANDOVER_FAILED` are events, not states: `BOTH_SHIPPED` takes `COLLATERAL_LOCKED → IN_TRANSIT`, `BOTH_RECEIVED` takes `IN_TRANSIT → INSPECTION`, `BOTH_HANDOVER_CONFIRMED` takes `COLLATERAL_LOCKED → INSPECTION` directly, and `HANDOVER_FAILED` takes either of those to `DISPUTED`. `PROPOSED` and `ACCEPTED` are not states either — a Trade row is created at the first offer and lives in `NEGOTIATING` until `TERMS_AGREED`.

`TRANSITIONS` in `domain/state-machine/machine.ts` is the source of truth; read it rather than this summary when the distinction matters.

**Cash_Sale_Status is its own set.** Do not reuse Trade_State names as if they were the same machine. The return pair (`RETURN_PENDING`, `RETURN_IN_TRANSIT`) exists only on cash sales.

`Police_Evidence_Pack` is **retired vocabulary** — do not reintroduce it. `KYC_Status` is retired too: there was never an enforced gate behind it, and the flow that wrote it has been removed. Deal *tables* (`deals`, `deal_holds`, `deal_payments`) stay retired from migration 0055 — do not resurrect that ledger. A **private deal** is an invite (`deal_invites`) that opens a Cash_Sale or a Trade: cash-for-a-card uses `CashSaleView`, a swap uses `TradeContract`. Member copy may say Deal for that link. `DittoBond` is retired member-facing terminology: say **trade collateral** and explain it as a **temporary card hold**. Internal `bondPolicy` / `requiredBondCents` names remain implementation vocabulary.

**Verification is TWO SEQUENTIAL STEPS, and they gate different things.** Step one is the **Identity_Gate**: a Stripe Identity document-plus-selfie check, `profiles.identity_check_status = 'VERIFIED'`. That alone unlocks listing, selling, entering trade escrow, and being a disclosed counterparty — it needs no bank details. Step two is **Connect payout setup**, `merchant_status = APPROVED` **and** `merchant_settlements_enabled`, which unlocks actually RECEIVING money via `canReceiveFunds`.

Evaluate step one only through `satisfiesIdentityGate` / `verificationState` in `domain/identity/identityGate.ts`; the SQL equivalent is `public_profiles.is_verified`, and its denormalised form is `items.seller_identity_verified`. All three expressions are pinned against each other by the denormalisation-agreement property in `tests/property/identityGate.test.ts` (Req 21.6), which additionally **throws if a Connect column ever reappears in a gate expression**.

**Why sequential rather than one combined step.** Asking for a bank account before a member has listed anything is friction with no purpose — eBay-style deferral verifies who you are quickly and collects payout details only when money has to move. It also closes an assurance gap that both steering docs previously recorded as accepted: Connect can defer document collection, so "transfers active" never proved a government document or selfie was checked. It now is checked, so member-facing copy may finally say photo ID.

**`merchant_settlements_enabled` is no longer any part of the Identity_Gate.** It is written only from `stripe_transfers.status === 'active'` and gates payouts alone. `canReceiveFunds` additionally needs a `merchant_ref` — a mechanical precondition, not a second opinion about identity.

**A verified member with no payout account is a normal, valid state.** They may list, sell and trade; a payout attempt refuses with `SELLER_NOT_PAYABLE` until Connect is set up. The two-step property in the gate test asserts both directions of this independence, so do not "fix" a payable-but-unverified or verified-but-unpayable member by re-coupling the two.

**Do not reintroduce the 0060 shortcut.** Migration 0060 briefly made the mere CREATION of a Connect recipient account the verification milestone, and 0061 reversed it. Creating that account is one server call that fires before the member has typed anything into Stripe's pages, so under 0060 a member was badged verified, could publish listings, could enter trade escrow, and could front a cash sale as a disclosed payee having completed no onboarding at all — and the payouts card read "Verified Account" beside "Payouts incomplete" because both were true of the same row. 0060 named its own exit condition as Stripe granting Connect Additional Document Verification; it was withdrawn early because the policy was wrong on its own terms, not because that condition arrived. If account creation ever needs to unlock something by itself, give that thing its own predicate rather than widening this one.

**The assurance gap this doc recorded as accepted is now CLOSED, and the record is kept deliberately.** For as long as the gate was Connect, satisfying it meant only that Stripe enabled transfers — it did not prove a government document or selfie was checked, because Connect can defer document collection. The exit condition written down at the time was "when Stripe grants Connect Additional Document Verification, add its accepted document status on top of transfers active". That is not how it was met: Stripe **Identity** supplies the document and selfie check directly, so the gate moved to it rather than waiting on a Connect capability. Member-facing copy may now say photo ID — but only about the identity check, never about Connect.

**The name fallback is still load-bearing.** `sellerIdentityDisclosure` prefers `identity_check_name` and falls back to `merchant_legal_entity_name`, because members verified before 0069 were grandfathered from Connect state and have no document-backed name on file. A null disclosure blocks the entire buy path (migration 0041 records that shipping), so removing the fallback would break every pre-0069 seller. Both names are provider-reported and both are written monotonically, absent to present.

**There is exactly ONE of each of those columns, and exactly one TypeScript field.** Migration 0049 removed `public_profiles.identity_verified` and `items.seller_verified`, which were byte-identical duplicates maintained by their own triggers, along with the `identityVerified` / `creatorIdentityVerified` fields that read them. Do not reintroduce a second column, field, or badge for this fact: two answers to one question is what broke buying once already.

The gate is scoped by whether a role can RECEIVE money. Publishing a listing, selling for cash, and entering trade escrow all require it. A cash Buyer does **not**: a Buyer is only ever refunded to their original card, so demanding payout onboarding of them would be friction with no purpose. A buy-only Member therefore holds no verified identity, and sellers see their display name and trading history instead of a legal name — a deliberate, recorded trade-off.

The only identity the platform holds is a provider-verified legal name: `identity_check_name` from Stripe Identity's `verified_outputs`, falling back to the `merchant_legal_entity_name` Connect reports for members grandfathered in by 0069. Both are written monotonically so a later provider report cannot blank a name already disclosed. Never source it from anything a Member typed.

Currency is AUD and is always represented as **integer cents** end-to-end (e.g. `fmvCents`, `fmv_cents`, `cash_amount_cents`). Never use floats for money.

Code comments reference requirement numbers (e.g. `Req 3.2`); keep that practice when adding behavior tied to a requirement.
