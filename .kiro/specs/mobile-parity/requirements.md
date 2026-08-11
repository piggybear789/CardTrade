# Requirements Document

## Introduction

`flutter_app/` is a second client over the NoDitto Postgres schema. It looks
finished and is not: `flutter analyze` reports zero errors, `flutter test` passes 205,
and every one of its 23 write paths fails at the network boundary. One of the paths
that does work bypasses the Identity_Gate.

This spec reconciles the Flutter app with the website and finishes building it out. It
is ordered so that the mechanical checks come BEFORE the code they govern, because the
project's current state is what "green with no contract enforcement" produces, and
repeating that at larger scale is the main risk of the work.

### Established facts this spec is built on

Verified by `npm run audit:mobile` and by reading the migrations:

- 23 Dart RPC call sites, 23 distinct names. **22 name functions that do not exist.**
  One, `accept_trade_terms`, exists but EXECUTE is held by `service_role` alone.
- Of 57 `cardtrade` functions, exactly **2** are executable by a member JWT:
  `is_fraud_banned` and `member_sale_stats`.
- 11 direct table writes from Dart: `items` (insert, 2× update), `messages` (insert,
  update), `profiles` (2× update), `notifications` (2× update), `watchlist`
  (insert, delete).
- `items_owner_insert` is `with check (owner_id = auth.uid())`. Ownership only.
  `createItem` in `lib/actions/listings.ts` additionally requires the Identity_Gate and
  a non-null seller identity disclosure. **RLS does not.**
- `flutter_app/lib/domain/` contains 8 hand-ported domain modules; `core/money.dart`
  re-derives `minorUnitDigits`. As of now all of them agree with the TypeScript —
  16 of 17 assertions in `tests/unit/mobileDomainAgreement.test.ts` pass.
- The 17th fails: `features/deals/screens/deals_screen.dart` (20KB) is wired to
  `AppRoutes.trades`, and `Deal` was retired by migration 0055.

---

## Glossary

Terms carry their meaning from `.kiro/steering/product.md`; these are the ones this
spec leans on hardest.

- **Identity_Gate** — `profiles.identity_check_status = 'VERIFIED'`. Unlocks listing,
  selling and entering trade escrow. Evaluated only via `domain/identity/identityGate.ts`.
  Distinct from payout setup, which gates receiving money and nothing else.
- **`ActionResult`** — the discriminated union every Server Action returns:
  `{ ok: true, data }` or `{ ok: false, error, message, field? }`. Expected failures are
  values, never exceptions.
- **Mobile API tier** — the new `app/api/mobile/**` route handlers. Thin: authenticate,
  delegate to an existing Server Action, return its `ActionResult`.
- **Guard test** — a test that reads source and asserts two representations agree.
  `regionCurrencyAgreement.test.ts` is the original; `mobileRpcContract.test.ts` and
  `mobileDomainAgreement.test.ts` are the mobile ones.
- **Port** — a hand-written Dart copy of a `domain/` module. Advisory: decides which
  buttons render, never whether an action is permitted.
- **Shopfront / binder** — `items.listing_kind = 'SHOPFRONT'`. Internal name is
  shopfront; member-facing copy says binder or bulk listing.
- **Trade collateral** — an uncaptured card authorisation. Never called "escrow" in
  member-facing copy, because no money is held.
- **Terms version** — `terms_version` on a contract. Optimistic concurrency: an
  acceptance names the exact version it applies to.
- **WebHandoff** — `flutter_app/lib/core/web_handoff.dart`. Opens the website for flows
  the client cannot perform. A correct outcome, not debt.

---

## Requirements

### Requirement 1: Close the Identity_Gate bypass

**User Story:** As the platform, I want listing creation from mobile to be refused for
an unverified member, so that the mobile client cannot publish what the website
forbids.

This is first because it is the only finding that is currently exploitable rather than
merely broken. A listing is an offer to sell, the Seller receives proceeds, and
`product.md` states publishing requires the Identity_Gate. A dead-end listing with no
seller disclosure also blocks the entire buy path for whoever finds it.

#### Acceptance Criteria

1.1. WHEN the Flutter app creates a listing THEN it SHALL call the mobile API endpoint
that delegates to `createItem`, and SHALL NOT insert into `items` directly.

1.2. WHEN an unverified member attempts to create a listing from mobile THEN the
request SHALL be refused with the same `not-verified` error and message the website
returns, surfaced as an actionable prompt to complete verification.

1.3. WHEN a member with no seller identity disclosure attempts to create a listing THEN
the request SHALL be refused with `seller-not-verified`.

1.4. THE Flutter app SHALL NOT write `items.status`, `items.closed_at`, or any other
`items` column directly; updates go through `updateItem` and `closeShopfrontListing`.

1.5. `tests/unit/mobileRpcContract.test.ts` SHALL be extended so `items` is in the
refused-table list, and SHALL pass.

1.6. THE fix SHALL NOT be a new RLS policy that duplicates the gate. The gate is
evaluated in one place (`domain/identity/identityGate.ts`) via the action layer;
adding a SQL copy creates a second definition of it.

---

### Requirement 2: Build the endpoint-contract guard before the endpoints

**User Story:** As the agent doing this work, I want a red-to-green target that cannot
be satisfied by code merely existing, so that "done" is a machine's judgement rather
than mine.

#### Acceptance Criteria

2.1. `scripts/lib/mobileContract.ts` SHALL gain a parser for the HTTP endpoint paths
the Dart services call, and a parser for the route handlers present under
`app/api/mobile/**/route.ts`.

2.2. A new assertion in `tests/unit/mobileRpcContract.test.ts` SHALL fail when Dart
calls an endpoint path that has no route handler, and SHALL fail when it calls one with
an HTTP method the handler does not export.

2.3. THE parsers SHALL throw on source they cannot interpret rather than returning an
empty set, and the test SHALL assert a non-zero count of parsed endpoints, so it cannot
pass vacuously. This is not hypothetical: the first run of the union parser read a
semicolon inside a `//` comment as the end of a declaration, dropped five members, and
reported it as drift.

2.4. THIS requirement SHALL be completed and committed before any endpoint in
Requirement 3 is written.

---

### Requirement 3: A mobile API surface over the existing orchestrators

**User Story:** As a mobile member, I want every action in the app to actually work, so
that the app can transact.

The endpoints are thin: authenticate the Supabase JWT, delegate to the server action
the website already calls, return its `ActionResult` unchanged. No business logic is
written in this requirement. If mobile needs a rule the web app has, it needs the web
app's copy of it.

#### Acceptance Criteria

3.1. THE app SHALL expose route handlers under `app/api/mobile/` covering, at minimum,
the actions below. Each handler SHALL delegate to the named export and SHALL NOT
reimplement its guards.

| Area | Server actions to expose |
| --- | --- |
| Listings | `createItem`, `updateItem`, `deleteItem`, `closeShopfrontListing` |
| Cash sale | `initiateCashSale`, `acceptCashSaleTerms`, `updateCashSaleTerms`, `updateCashSaleItems`, `listCashSaleItems`, `proposeCashSalePrice`, `recordCashSaleShipment`, `recordCashSaleReceipt`, `acceptCashSaleInspection`, `confirmCashSaleHandover`, `cancelCashSaleAgreement`, `syncCashSaleTracking`, and the dispute action in `lib/actions/cashSale.ts` |
| Trade negotiation | `openTradeNegotiation`, `proposeTradeTerms`, `acceptTradeTerms`, `declineTradeOffer` |
| Trade lifecycle | `recordShipment`, `recordReceipt`, `recordAcceptance`, `confirmTradeHandover`, `reportTradeHandoverFailed`, `raiseDispute`, `reportFraud`, `updateTradeHandoverTerms`, `saveTradeDeliveryAddress`, `getTradeDeliveryAddresses`, `syncTradeTracking` |
| Offers | `makeOffer`, `counterOffer`, `respondToOffer`, `listMyOffers`, `listOffersForItem` |
| Messages | `getOrCreateConversation`, `sendMessage`, `markConversationRead`, `listMyConversations`, `getConversation` |
| Payments | `beginCardSetup`, `completeCardSetup`, `getPaymentMethodStatus` |

3.2. BEFORE wiring each endpoint the agent SHALL confirm the exact export name in
`lib/actions/`. WHERE this document names an action that does not exist under that
name, the agent SHALL find the real one and record the correction; it SHALL NOT create
a new server action to match this document.

3.3. EVERY handler SHALL authenticate via the cookie-or-bearer Supabase session and
SHALL return 401 without one. No handler SHALL accept a user id from the request body.

3.4. NO handler SHALL use `createAdminClient()` except where the server action it
delegates to already does so internally.

3.5. THE response body SHALL be the action's `ActionResult` discriminated union,
serialised unchanged, so the Dart client can switch on `error` codes that already
match the website's.

3.6. WHERE a flow requires provider secrets that cannot be brokered by an endpoint
(Stripe Identity, Connect onboarding), the existing `WebHandoff` SHALL be retained.
Handoff is a correct outcome, not debt.

---

### Requirement 4: Rewire the Dart services

**User Story:** As a mobile member, I want the app's buttons to hit endpoints that
exist, so that actions succeed or fail for real reasons.

#### Acceptance Criteria

4.1. EVERY `.rpc('…')` call in `flutter_app/lib/services/` SHALL be replaced by an HTTP
call to a mobile API endpoint, or removed along with the dead UI path.

4.2. `npm run audit:mobile` SHALL exit zero.

4.3. `ApiClient` SHALL map endpoint error codes to `Result` values, preserving the
`ActionResult` error code so screens can distinguish `not-verified` from
`REGION_MISMATCH` from a network failure.

4.4. THE existing retry-with-backoff behaviour SHALL NOT be applied to non-idempotent
writes. A retried `initiateCashSale` or `makeOffer` must not create two contracts or
two offers.

4.5. Direct table writes SHALL remain only for `watchlist`, `notifications.read_at`,
`messages.read_at`, and `profiles` columns the member owns. Everything else moves to an
endpoint.

---

### Requirement 5: Plumb terms versions through the mobile UI

**User Story:** As a trader, I want my acceptance to apply to the terms I was actually
shown, so that a counter-offer cannot be pushed into escrow on the strength of my
acceptance of the terms it replaced.

The current Dart call is `accept_trade_terms(p_trade_id)`. The real action is
`acceptTradeTerms(tradeId, termsVersion)`. The version is not optional and the mobile
client does not carry it today.

#### Acceptance Criteria

5.1. THE trade room and sale room SHALL read `terms_version` with the contract and send
it with every acceptance and every terms revision.

5.2. WHEN the server rejects an acceptance because the version is stale THEN the app
SHALL refresh the contract and tell the member the terms changed, rather than retrying.

5.3. THE app SHALL NOT default, infer, or increment a terms version locally.

---

### Requirement 6: Retire the retired vocabulary

**User Story:** As a member, I want the app not to name concepts the platform removed,
so that the mobile app and the website describe one product.

#### Acceptance Criteria

6.1. `features/deals/` SHALL be removed and `AppRoutes.trades` SHALL render a trades
screen built on `trades`, not on the retired Deal model.

6.2. NO Dart source SHALL contain `Deal`, `DittoBond`, `KYC_Status`, or
`Police_Evidence_Pack`, and the assertion in `tests/unit/mobileDomainAgreement.test.ts`
SHALL pass.

6.3. MEMBER-FACING copy SHALL say **trade collateral**, explained as a temporary card
hold, never "escrow" for a trade and never "DittoBond".

6.4. MEMBER-FACING copy SHALL say **binder or bulk listing**, never "shopfront", and
SHALL always state that nothing is held on a binder.

---

### Requirement 7: Generate the shared vocabulary instead of checking it

**User Story:** As a maintainer, I want the duplicated vocabulary to be impossible to
drift rather than merely checked, so that three agreement tests become unnecessary.

#### Acceptance Criteria

7.1. A script SHALL generate `flutter_app/lib/models/enums.dart`,
`flutter_app/lib/domain/region/regions.dart`, and the zero-decimal currency set in
`core/money.dart` from the TypeScript and SQL sources.

7.2. GENERATED files SHALL carry a header naming the generator and stating they must
not be hand-edited, and SHALL be committed.

7.3. THE corresponding assertions in `tests/unit/mobileDomainAgreement.test.ts` SHALL
be replaced by a check that regenerating produces no diff.

7.4. THE remaining hand-written ports — the transition table, `bondPolicy`,
`identityGate`, `tradeFee`, `tradeSideValues`, the fulfilment validator — SHALL stay
pinned by the existing agreement assertions. NO NINTH PORT SHALL be added.

---

### Requirement 8: Screen parity with the website

**User Story:** As a member, I want the app to cover what the website covers, so that
switching between them does not lose a capability.

#### Acceptance Criteria

8.1. A parity check SHALL build the website's route inventory and the Flutter route
inventory from source and report routes present on the web and absent on mobile. The
pattern to extend is `tests/unit/navigationGraph.test.ts`, which already builds the web
link graph and asserts resolution and reachability.

8.2. THE check SHALL carry an explicit, commented allowlist for routes that are
deliberately web-only — the admin console and arbitration workspace at minimum — so
absence is a recorded decision rather than an oversight.

8.3. EVERY route not allowlisted SHALL have a Flutter screen, reachable by navigation
and not only by deep link.

8.4. THE contract rooms SHALL surface, for both flows: the progress rail, the terms and
what the contract covers, the money breakdown including the disclosed fee, the
fulfilment controls for the agreed method, the timeline, and the conversation.

8.5. A binder contract SHALL show its line items (cash) or
`counterpart_goods_description` (trade), because arbitration reads the contract and
never the listing.

8.6. THE disclosed trade fee SHALL be read from the same resolved side values the
charge uses, never re-derived by summing `fmv_cents`.

---

### Requirement 9: Prove it works against a real backend

**User Story:** As the person who has to trust this, I want evidence beyond "it
compiles", because the current broken state already compiles.

#### Acceptance Criteria

9.1. A smoke script SHALL sign in as a seeded member and call every mobile API endpoint
against a running instance, asserting a real response. `scripts/smoke-stripe-test.ts`
is the precedent for shape and for refusing to run against live credentials.

9.2. THE script SHALL fail on any 404, 401 for a legitimately authenticated call, or
500.

9.3. THE script SHALL be listed in `.kiro/steering/flutter.md` alongside
`npm run audit:mobile`.

9.4. WHERE an endpoint cannot be exercised without moving money, the script SHALL
assert the guard refusal rather than skipping the endpoint.

---

### Requirement 10: Work through the UX audit

**User Story:** As a member, I want the app to be usable, so that the parts that do
work are not painful.

`flutter_app/AUDIT.md` holds a severity-rated list; `ux-audit-findings.md` covers the
website.

#### Acceptance Criteria

10.1. EVERY severity 4 and severity 3 finding in `flutter_app/AUDIT.md` SHALL be fixed
or explicitly deferred with a stated reason.

10.2. Touch targets SHALL be at least 48dp; custom interactive widgets SHALL carry
`Semantics`; destructive actions SHALL confirm before acting.

10.3. THE float-precision finding in the FMV/price input SHALL be fixed such that money
is integer minor units end to end, with no float arithmetic on a money path.

10.4. NO control SHALL report success it did not achieve. The report button's fake
success is called out in the audit and is the pattern to eliminate everywhere.

---

### Non-goals and prohibitions

These are failure modes, not preferences. Each has a cheaper wrong answer that a guard
test would accept.

- **Do not grant EXECUTE to `authenticated`** to make a call reachable. Those functions
  are the tail of an orchestration that also places Stripe holds and runs the
  Identity_Gate, region and ownership guards. A grant exposes the last step with the
  guards skipped.
- **Do not write new SQL** that reimplements orchestrator logic, and do not add an RPC
  to match a name already typed into Dart.
- **Do not weaken, skip, delete, or add an allowlist entry to a guard test** to make it
  green. A red guard is a finding. If a guard is genuinely wrong, say so in the task
  notes and explain why before changing it.
- **Do not add a ninth Dart domain port.** If mobile needs a new rule locally, first ask
  whether the answer can come down with the data.
- **Do not remove a `WebHandoff` path** without a real endpoint replacing it.
- **Do not ship `SUPABASE_SERVICE_ROLE_KEY` or `STRIPE_SECRET_KEY`** into the Flutter
  app, its config files, or its build flavours.
- **Do not add card, CVC, expiry, BSB or account-number fields** to any Dart model,
  form, or request. Card data is collected by Stripe inside its own surface.
- **Do not reserve a shopfront** to solve concurrent binder contracts. That risk is
  accepted and recorded in `product.md`.
- **Do not run `flutter run` or `npm run dev`** from an agent turn; they block.
- **Do not run `npm run build` or `npm run typecheck`** as routine verification. Use
  `npm run test`, targeted Vitest projects, `flutter test`, and `flutter analyze`. Run
  `npx tsc --noEmit` only after changing `domain/services/types.ts`.
