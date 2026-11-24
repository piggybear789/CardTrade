# Requirements Document

## Introduction

NoDitto is about to open to outside testers, who will use the PRODUCTION deployment. Before that, the owner needs evidence that every member-facing function works, and needs to be able to look at that evidence rather than take it on trust.

This feature is a Playwright end-to-end suite that is also a UI/UX audit. It runs real scenarios against the dev sandbox: Supabase schema `cardtrade_dev`, seeded from `supabase/seed.sql`, and Stripe TEST keys for both the AU and US platform accounts. It covers essentially every function listed in the product steering (`.kiro/steering/product.md`), with happy paths and refusal paths. Every pathway records step screenshots and a video at a desktop and a phone viewport, runs automated UX checks drawn from the project's own UI rules, and feeds one HTML report that the owner can review pathway by pathway.

The suite extends the existing harness (`playwright.config.ts`, `tests/e2e/auth.setup.ts`, `tests/e2e/support/*`, `tests/e2e/specs/*`, `tests/e2e/stripe/*`, `tests/e2e/FINDINGS.md`) instead of building a second one. One secondary deliverable is included: an optional highlight reel cut from the recorded pathway videos (the owner referenced the `/brag-slim` skill).

Where Stripe test mode cannot produce an event on demand (early fraud warnings, chargeback and dispute outcomes, carrier and Ship24 delivery events, hold expiry timing), the suite uses the mock provider or a simulated event, and labels every such step in the report.

The suite must not touch production data or live Stripe keys. Some resources are shared between the sandbox and production (`auth.users`, Storage buckets, the Stripe test dashboards), so the suite must create, flag and clean up what it puts there.

## Out of scope

- **Production.** The suite never runs against the production deployment or the `cardtrade` schema. It runs only on the `cardtrade_dev` sandbox with Stripe test keys. There is no production smoke subset.
- **Google OAuth.** Sign-in with Google is neither automated nor a required manual check. The Coverage_Map records it as out of scope.

## Glossary

- **Audit_Suite**: The Playwright end-to-end and UI/UX audit suite this document specifies, including its configuration, support modules, specs and report generator.
- **Harness**: The existing e2e infrastructure under `tests/e2e/` and `playwright.config.ts` (global setup and teardown, auth setup, support helpers, specs, cleanup script `scripts/e2e/cleanup-test-data.ts`, `FINDINGS.md`).
- **Sandbox**: The dev environment the Audit_Suite runs on: Supabase schema `cardtrade_dev` in the shared Supabase project, plus Stripe test-mode keys (`sk_test_`) for the AU and US platform accounts.
- **Production_Schema**: The Supabase schema `cardtrade`, which holds real members' data.
- **Live_Key**: Any Stripe secret, restricted or publishable key whose prefix is `sk_live_`, `rk_live_` or `pk_live_`.
- **Shared_Resource**: A resource used by both the Sandbox and production: `auth.users`, Supabase Storage buckets, and the Stripe test-mode account dashboards.
- **Sandbox_Account**: An `auth.users` row the Audit_Suite created or seeded, carrying `app_metadata.sandbox = true` and authenticated with `E2E_SEED_PASSWORD` or a per-run generated password.
- **Run_Marker**: The text marker the Harness writes into rows and objects it creates (see `tests/e2e/support/marker.ts`), used by cleanup to find them.
- **App_Server**: The Next.js server the Audit_Suite drives, started by Playwright's `webServer` setting.
- **Pathway**: One named member journey through one function, for example "buyer pays a cash sale by card with 3-D Secure". A Pathway is either a Happy_Path or a Refusal_Path.
- **Happy_Path**: A Pathway in which the member completes the function as intended.
- **Refusal_Path**: A Pathway in which the application refuses, validates or guards an action, identified by the error code or validation message it returns.
- **Step**: One named member action or assertion inside a Pathway, such as "click Pay" or "sale shows In transit".
- **Viewport_Profile**: One of two browser configurations: Desktop (Desktop Chrome) and Phone (iPhone 14 on WebKit).
- **Step_Screenshot**: A full-page PNG captured at the end of a Step.
- **Pathway_Video**: The Playwright video recording of one Pathway on one Viewport_Profile, covering every browser context the Pathway uses.
- **UX_Check**: An automated check run on every page a Pathway visits, as listed in Requirement 30.
- **UX_Observation**: A recorded result of a failed or warning-level UX_Check, or a note a reviewer adds, attached to the Step where it arose.
- **Copy_Rule**: A member-facing wording rule from the steering documents, as listed in Requirement 31.
- **Audit_Report**: The generated HTML report that indexes every Pathway with its Steps, Step_Screenshots, Pathway_Videos, pass/fail result and UX_Observations.
- **Coverage_Map**: A checked-in file that lists every function in `product.md` and maps each one to the Pathways that exercise it, or to a recorded reason it is not automated.
- **Masker**: The Audit_Suite component that hides secrets and personal data in screenshots, videos, traces and logs.
- **Highlight_Reel**: An optional short video compiled from selected Pathway_Videos.
- **Simulated_Step**: A Step whose outcome depends on the mock provider, a locally signed event fixture, or Sandbox timestamps moved back to stand in for elapsed time, instead of an event produced by Stripe test mode or a real carrier.
- **Out_Of_Scope_Entry**: A Coverage_Map entry for a function the owner has excluded from the Audit_Suite, carrying a written reason and needing no Pathway and no manual check.
- **Job_Endpoint**: A scheduled route under `app/api/jobs/` (`cash-sale-payouts`, `trade-inspections`), authenticated with a bearer `JOBS_SECRET`.
- **Cron_Function**: A pg_cron job body in the Sandbox schema, such as `cardtrade_dev.auto_complete_due_cash_sales()`.
- **Webhook_Source**: A delivery of provider events to the App_Server: Stripe test events forwarded by `stripe listen` (`npm run dev:stripe`), or locally signed event fixtures.

## Requirements

### Requirement 1: Refuse to run outside the Sandbox

**User Story:** As the owner, I want the suite to stop before it does anything if it is pointed at production, so that a test run can never alter real members' data or move real money.

#### Acceptance Criteria

1. WHEN a Sandbox run starts, THE Audit_Suite SHALL verify that the schema read by the App_Server and by the Harness database helpers is `cardtrade_dev` before any test executes.
2. IF the resolved schema is the Production_Schema, THEN THE Audit_Suite SHALL abort the run before any test executes and report the resolved schema name.
3. IF any configured Stripe key for any region is a Live_Key, THEN THE Audit_Suite SHALL abort the run before any test executes and report which variable name holds the Live_Key without printing the key value.
4. WHEN a Sandbox run starts, THE Audit_Suite SHALL verify that the App_Server's `/api/health` response or an equivalent server-side probe reports the Sandbox schema and a test-mode payments provider before the first Pathway executes.
5. IF the App_Server's reported schema or payments mode differs from the Harness's own resolution, THEN THE Audit_Suite SHALL abort the run and report both values.
6. THE Audit_Suite SHALL offer no option that disables the Live_Key check for a Sandbox run.

### Requirement 2: Handle Shared_Resources safely

**User Story:** As the owner, I want anything the suite creates in shared resources to be marked and removed, so that production auth, storage and Stripe dashboards are not polluted by tests.

#### Acceptance Criteria

1. WHEN the Audit_Suite creates an `auth.users` row, THE Audit_Suite SHALL set `app_metadata.sandbox = true` on that row and use an email address on a reserved test domain.
2. THE Audit_Suite SHALL sign in only as Sandbox_Accounts.
3. IF a Sandbox_Account the Audit_Suite expects to use lacks `app_metadata.sandbox = true`, THEN THE Audit_Suite SHALL abort the run and report the account's email in masked form.
4. WHEN the Audit_Suite uploads an object to a Storage bucket, THE Audit_Suite SHALL record the bucket and path so that cleanup can delete the object.
5. WHEN a run ends, THE Audit_Suite SHALL delete every Storage object recorded under Acceptance Criterion 4 and every Sandbox row carrying the Run_Marker.
6. WHEN a run starts, THE Audit_Suite SHALL delete objects and rows left by an earlier interrupted run, matched by the Run_Marker or the recorded upload list.
7. WHEN the Audit_Suite creates Stripe test-mode objects (customers, PaymentIntents, connected accounts, Identity sessions), THE Audit_Suite SHALL stamp each object with metadata identifying it as an Audit_Suite object and the run that created it.
8. WHEN cleanup removes Sandbox rows, THE Audit_Suite SHALL leave rows in the Production_Schema unchanged.

### Requirement 3: Build on the existing Harness

**User Story:** As the owner, I want one e2e suite rather than two, so that fixes and findings accumulate in one place.

#### Acceptance Criteria

1. THE Audit_Suite SHALL use `playwright.config.ts`, `tests/e2e/auth.setup.ts`, the global setup and teardown, and the support modules in `tests/e2e/support/` as its foundation, extending them where the Audit_Suite needs new behaviour.
2. WHEN an existing spec in `tests/e2e/specs/` covers a Pathway, THE Audit_Suite SHALL extend or migrate that spec instead of adding a second spec for the same Pathway.
3. WHEN a probe in `tests/e2e/debug/` duplicates a Pathway the Audit_Suite covers, THE Audit_Suite SHALL record that probe as superseded in the Coverage_Map.
4. THE Audit_Suite SHALL keep the session-freshness behaviour that guards against refresh-token rotation (FINDINGS F14) and the Places interception (`tests/e2e/support/places.ts`) available to every Pathway.
5. WHEN the Audit_Suite discovers an application defect, THE Audit_Suite's maintainers SHALL record the defect in `tests/e2e/FINDINGS.md` using that file's existing numbering and severity scale.

### Requirement 4: Start the App_Server deterministically

**User Story:** As the owner, I want the server the suite drives to be built and started the same way every time, so that results reflect the code and not a dev compiler.

#### Acceptance Criteria

1. THE Audit_Suite SHALL drive a production build of the application served by `next start` through Playwright's `webServer` setting, built into the Harness's own build directory.
2. WHEN the Audit_Suite runs, THE Audit_Suite SHALL build the application with the same client environment the App_Server serves, so that `NEXT_PUBLIC_*` values in the bundle match the run (FINDINGS F18).
3. THE Audit_Suite SHALL use Stripe test mode as the payments provider for every Pathway that collects, holds, refunds or transfers money.
4. WHERE a Pathway requires an event that Stripe test mode cannot produce on demand (an early fraud warning, a chargeback or dispute outcome, a carrier or Ship24 delivery event, or a hold reaching its expiry), THE Audit_Suite SHALL use the mock provider or a locally signed event fixture for that Pathway only, and set `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true` only on the server instance that serves mock-backed Pathways.
7. THE Audit_Suite SHALL label every Simulated_Step in the Audit_Report with the mechanism used (mock provider, signed event fixture or moved timestamp), and SHALL label every Pathway that contains a Simulated_Step as simulated on the Pathway's index row.
5. THE Audit_Suite documentation SHALL state the commands that build the application, start the App_Server, start the Webhook_Source and run each subset of the Audit_Suite.
6. THE Audit_Suite SHALL direct simulated and forwarded webhook deliveries to the App_Server's own port (FINDINGS F20).

### Requirement 5: Maintain a Coverage_Map

**User Story:** As the owner, I want a list of every function and the pathways that test it, so that I can see what is covered and what is not.

#### Acceptance Criteria

1. THE Audit_Suite SHALL maintain a Coverage_Map listing every function described in `.kiro/steering/product.md` under "Features and functionality" and "Transaction models".
2. THE Coverage_Map SHALL map each function to one or more Happy_Path Pathways and one or more Refusal_Path Pathways, to a written reason the function is not automated, or to an Out_Of_Scope_Entry.
3. WHEN a run completes, THE Audit_Report SHALL show for each Coverage_Map entry whether every mapped Pathway passed on each Viewport_Profile.
4. IF a Coverage_Map entry has no mapped Pathway, no written reason and is not an Out_Of_Scope_Entry, THEN THE Audit_Suite SHALL fail the run with a message naming that entry.
5. WHERE a function cannot be automated (for example reading a real email inbox), THE Coverage_Map SHALL describe the manual check that replaces the automated Pathway.
6. THE Coverage_Map SHALL record Google OAuth sign-in as an Out_Of_Scope_Entry with the reason that the owner excluded it, and THE Audit_Report SHALL show Out_Of_Scope_Entries as out of scope rather than as failed or uncovered.

### Requirement 6: Structure every Pathway as named Steps

**User Story:** As the owner, I want each pathway broken into named steps, so that I can follow what happened and where it went wrong.

#### Acceptance Criteria

1. THE Audit_Suite SHALL give every Pathway a unique identifier, a title, the functional area it belongs to and its kind (Happy_Path or Refusal_Path).
2. THE Audit_Suite SHALL record every Pathway as an ordered list of named Steps.
3. WHEN a Step completes, THE Audit_Suite SHALL capture a Step_Screenshot of every browser page the Step acted on.
4. WHEN a Step fails, THE Audit_Suite SHALL capture a Step_Screenshot, the Playwright trace and the page's console output, and mark that Step and its Pathway as failed.
5. THE Audit_Suite SHALL assert each Refusal_Path on the error code or the exact member-facing message the application returns.
6. WHEN a Pathway involves two members, THE Audit_Suite SHALL drive each member in a separate browser context and label each Step_Screenshot with the member who saw it.
7. WHEN a Pathway asserts a database state, THE Audit_Suite SHALL also assert the corresponding state as the member sees it in the UI.

### Requirement 7: Auth

**User Story:** As a new or returning member, I want sign-up, sign-in and password recovery to work and to refuse clearly, so that I can get into my account.

#### Acceptance Criteria

1. WHEN a visitor signs up with a valid email and password, THE Audit_Suite SHALL verify that a profile is provisioned and the member reaches onboarding or the confirm-email notice.
2. WHEN a visitor signs up with an email that already has an account, THE Audit_Suite SHALL verify that the application refuses with `DUPLICATE_ACCOUNT`.
3. WHEN a member signs in with a wrong password, THE Audit_Suite SHALL verify the `INVALID_CREDENTIALS` refusal, and WHEN a member with an unconfirmed email signs in, THE Audit_Suite SHALL verify the `EMAIL_NOT_CONFIRMED` refusal.
4. WHEN a fraud-banned Sandbox_Account signs in or visits a protected route, THE Audit_Suite SHALL verify the `ACCOUNT_BANNED` refusal or the redirect to `/account-suspended`.
5. WHEN a member requests a password reset, THE Audit_Suite SHALL verify that the response does not reveal whether the email has an account.
6. WHEN a member completes a password reset through a reset link generated with the Supabase Admin API, THE Audit_Suite SHALL verify that the new password signs in and the old one is refused.
7. WHEN a member confirms an email through a confirmation link generated with the Supabase Admin API, THE Audit_Suite SHALL verify that `/auth/confirm` signs the member in.
8. WHEN sign-in attempts exceed the auth rate limit, THE Audit_Suite SHALL verify the rate-limit refusal message.
9. WHEN a visitor submits the sign-in form before client hydration, THE Audit_Suite SHALL verify that no password appears in the URL (FINDINGS F15).
10. WHEN a member signs out, THE Audit_Suite SHALL verify that protected routes redirect to `/sign-in`.

### Requirement 8: Onboarding

**User Story:** As a new member, I want the onboarding wizard to take me through the buyer or seller path, so that I can start transacting.

#### Acceptance Criteria

1. WHEN a new member completes the wizard on the buyer path, THE Audit_Suite SHALL verify each step (welcome, alias, region, intent, optional card setup) and that `onboarding_completed_at` is set.
2. WHEN a new member chooses the seller path, THE Audit_Suite SHALL complete a Stripe Identity test-mode verification and verify that `identity_check_status` becomes `VERIFIED` through the read-back on return.
3. WHEN a new member completes Stripe Connect onboarding in test mode, THE Audit_Suite SHALL verify that the payout status is re-read from Stripe and becomes payable.
4. WHEN a member returns with `?identity=complete` or `?payouts=complete` without completing the provider flow, THE Audit_Suite SHALL verify that the status shown is the provider's status and not the query string's.
5. WHILE onboarding is incomplete, THE Audit_Suite SHALL verify that the catalog and `/` stay browsable and that protected routes redirect to `/onboarding`.
6. THE Audit_Suite SHALL verify that the region step offers only trading-enabled regions and that a region cannot be changed once a payout account exists.
7. WHEN a signed-in member's profile row is missing, THE Audit_Suite SHALL verify that the onboarding page re-provisions it and that no driver error text is shown (FINDINGS F25).
8. THE Audit_Suite SHALL verify the browse-listings exit and the sign-out control on every wizard step.

### Requirement 9: Catalog, region and currency display

**User Story:** As a visitor, I want to browse, filter and sort listings in my region with prices in the right currency, so that I find cards I can buy.

#### Acceptance Criteria

1. THE Audit_Suite SHALL verify each catalog filter (`q`, `category` multi-select, `condition` multi-select, `min`, `max`, `sold=1`, `region`) and each sort (`newest`, `price-asc`, `price-desc`, `rating`), and verify that the result list reflects each one.
2. WHEN `/listings` is requested, THE Audit_Suite SHALL verify the permanent redirect to `/`.
3. THE Audit_Suite SHALL verify that only card-game categories appear in pickers and that hidden private-deal items and excluded categories are absent from the catalog.
4. WHEN the browse region is set by `?region=`, by the picker cookie, by profile and by the default, THE Audit_Suite SHALL verify that the catalog is scoped by the highest-precedence source and that a guessed region is disclosed.
5. THE Audit_Suite SHALL verify that every displayed amount carries its ISO currency code, for AUD listings and for at least one USD, EUR and GBP listing in the US platform group.
6. WHEN results span several pages, THE Audit_Suite SHALL verify that pagination reaches the last page.

### Requirement 10: Listings

**User Story:** As a verified seller, I want to create, edit and close single and multiple-item listings, so that buyers can find what I sell.

#### Acceptance Criteria

1. WHEN a verified seller creates a SINGLE listing with a title, description, game, condition, price, location and 1 to 10 images, THE Audit_Suite SHALL verify that the listing is published and shown on `/listings/[id]`, in `/listings/mine` and in the catalog.
2. WHEN a verified seller creates a Multiple items listing, THE Audit_Suite SHALL verify that the listing shows the indicative "from" price and states that nothing is held.
3. WHEN a seller leaves the title blank, THE Audit_Suite SHALL verify that the title falls back to the description's leading sentence.
4. WHEN a member without a verified identity opens `/listings/new`, THE Audit_Suite SHALL verify the Identity_Gate refusal and its route to verification.
5. THE Audit_Suite SHALL verify field validation for each required field, for zero images and for more than 10 images.
6. WHILE a seller edits a listing, THE Audit_Suite SHALL verify that the live preview reflects text changes and the gallery actions (add, remove, reorder, make cover).
7. WHEN a seller edits a listing's price while the item is in a live trade, THE Audit_Suite SHALL verify the `item-in-live-trade` refusal.
8. WHEN a seller closes a Multiple items listing, THE Audit_Suite SHALL verify that the listing leaves the catalog and its open contracts continue.
9. WHEN a member who is not the owner opens `/listings/[id]/edit`, THE Audit_Suite SHALL verify the refusal.

### Requirement 11: Watchlist and seller pages

**User Story:** As a member, I want to save listings and look at sellers, so that I can come back to them and judge who I deal with.

#### Acceptance Criteria

1. WHEN a member toggles watch on a listing, THE Audit_Suite SHALL verify that the listing appears on and disappears from `/saved` and that the watch count changes by one.
2. WHEN a visitor opens `/sellers/[id]`, THE Audit_Suite SHALL verify the seller's listings, rating, reviews, social links, badges and the report control.
3. WHEN a guest uses the watch control, THE Audit_Suite SHALL verify the route to sign-in.

### Requirement 12: Offers

**User Story:** As a buyer or seller, I want to make, counter, accept, decline and withdraw offers, so that we can agree a price.

#### Acceptance Criteria

1. WHEN a buyer offers on a SINGLE listing and the seller counters, THE Audit_Suite SHALL verify the chained offers and the `COUNTERED` status.
2. WHEN the recipient accepts an offer from a buyer with a saved card, THE Audit_Suite SHALL verify that a cash sale opens at the offer price, the offer becomes `ACCEPTED`, and other `PENDING` offers on the item become `DECLINED`.
3. WHEN the seller accepts an offer from a buyer with no saved card, THE Audit_Suite SHALL verify that the offer stays `PENDING`, the seller is told, and the buyer receives the add-a-card notification.
4. WHEN the recipient declines through the confirm dialog, or the offerer withdraws, THE Audit_Suite SHALL verify the status change and that each member's Active and Past lists partition the offer the same way (FINDINGS F72).
5. WHEN a member offers on a Multiple items listing, THE Audit_Suite SHALL verify the `item-not-available` refusal.
6. WHEN a buyer makes a second offer while one is `PENDING` on the same item, THE Audit_Suite SHALL verify the refusal.
7. WHEN a member other than the permitted party tries to accept, decline or withdraw, THE Audit_Suite SHALL verify the refusal.

### Requirement 13: Cash sale lifecycle

**User Story:** As a buyer and a seller, I want a cash sale to run from agreement to payout, so that money and goods change hands safely.

#### Acceptance Criteria

1. WHEN a buyer with no saved card presses Buy Now, THE Audit_Suite SHALL verify the `BUYER_NO_PAYMENT_METHOD` refusal and the "Add a card to continue" control.
2. WHEN a buyer with a saved card presses Buy Now on a SINGLE listing, THE Audit_Suite SHALL verify that a sale in `AGREEMENT` opens and that the item leaves the catalog for other members.
3. WHEN a buyer opens a request on a Multiple items listing with line items, THE Audit_Suite SHALL verify that the price equals the sum of the lines and that replacing a line voids both acceptances.
4. WHEN the seller changes only fulfilment terms, THE Audit_Suite SHALL verify that acceptances are kept, and WHEN the price or line items change, THE Audit_Suite SHALL verify that both acceptances are voided.
5. WHEN the buyer pays by a Stripe test card that requires no authentication, THE Audit_Suite SHALL verify the shown service fee rate and total, and that the sale reaches `ESCROW_HELD`.
6. WHEN the buyer pays by a Stripe test card that requires 3-D Secure, THE Audit_Suite SHALL complete the challenge in the browser and verify `ESCROW_HELD`, and WHEN the buyer fails the challenge, THE Audit_Suite SHALL verify that a failed 3-D Secure check sends the sale to `FAILED`, returns the listing to the catalog and charges nothing.
7. WHEN the buyer pays by a declined Stripe test card, THE Audit_Suite SHALL verify the decline message and that a declined card sends the sale to `FAILED` and returns the listing to the catalog.
8. WHEN the buyer pays by each offered bank rail (iDEAL, Bancontact, EPS, Przelewy24, PayTo) in its eligible region and currency, THE Audit_Suite SHALL complete the test-mode approval, return to `/sales/<id>?payment=return` and verify `ESCROW_HELD`.
9. WHEN the buyer's saved card is issued in a different card tier from the one priced, THE Audit_Suite SHALL verify the `CARD_REPRICED` refusal with the sale unchanged.
10. WHEN a purchase is priced above the unverified-buyer limit, THE Audit_Suite SHALL verify the `BUYER_IDENTITY_REQUIRED` refusal and the in-room identity check.
11. WHEN a cross-border sale's seller cannot receive funds, THE Audit_Suite SHALL verify the `SELLER_NOT_PAYABLE` refusal with the sale unchanged.
12. WHEN the seller records a shipment on a `DELIVERY` sale and carrier delivery is reported through a Webhook_Source, THE Audit_Suite SHALL verify `IN_TRANSIT` then `INSPECTION` with a 7-day deadline.
13. WHEN a tracking number's first scan predates payment, THE Audit_Suite SHALL verify the `TRACKING_PREDATES_PAYMENT` refusal, and WHEN a number is already delivered when entered, THE Audit_Suite SHALL verify that the sale is flagged and no inspection clock starts.
14. WHEN both parties confirm an `IN_PERSON` handover, THE Audit_Suite SHALL verify `INSPECTION` with a 24-hour deadline, and WHEN a party confirms more than an hour before the meeting, THE Audit_Suite SHALL verify the `HANDOVER_TOO_EARLY` refusal.
15. WHEN the buyer accepts the goods, THE Audit_Suite SHALL verify `COMPLETED`, and WHEN the payout Job_Endpoint runs, THE Audit_Suite SHALL verify a Stripe test transfer to the seller of price plus postage, or `PAYOUT_HELD` while the holdback applies.
16. WHEN the inspection deadline passes and the Cron_Function `auto_complete_due_cash_sales` is invoked, THE Audit_Suite SHALL verify `COMPLETED`.
17. WHEN either party cancels in `AGREEMENT`, THE Audit_Suite SHALL verify `CANCELLED` and that the item returns to the catalog, and WHEN a party tries to cancel after payment, THE Audit_Suite SHALL verify the refusal.
18. WHEN a payment check is left unfinished and the payout Job_Endpoint runs after 30 minutes of simulated time, THE Audit_Suite SHALL verify the sale returns to `AGREEMENT` with nothing charged.
19. WHEN two members whose accounts are related try to deal, THE Audit_Suite SHALL verify the `RELATED_ACCOUNTS` refusal without the reason being shown.
20. WHEN a new seller's open sales would exceed the exposure limit, THE Audit_Suite SHALL verify the `SELLER_EXPOSURE_LIMIT` refusal.
21. WHEN a buyer and seller are in incompatible regions, THE Audit_Suite SHALL verify the `REGION_MISMATCH` refusal.

### Requirement 14: Cash sale disputes, returns and refunds

**User Story:** As a buyer with a problem, I want to dispute, return the goods and be refunded, so that I am protected when something goes wrong.

#### Acceptance Criteria

1. WHEN the buyer raises a dispute from `ESCROW_HELD`, `IN_TRANSIT`, `HANDOVER` or `INSPECTION`, THE Audit_Suite SHALL verify `DISPUTED`, the evidence upload, and the dispute email or notification, and WHEN the raiser withdraws, THE Audit_Suite SHALL verify the sale resumes.
2. WHEN staff award `REFUND_BUYER` with the goods held by the buyer, THE Audit_Suite SHALL verify `RETURN_PENDING`, the return address shown to the buyer, and the item still `RESERVED`.
3. WHEN the buyer records a return shipment and carrier delivery is reported, THE Audit_Suite SHALL verify `RETURN_IN_TRANSIT`, the 72-hour seller window, and the automatic Stripe test refund when the window closes uncontested.
4. WHEN the seller contests inside the window, THE Audit_Suite SHALL verify that the refund is held for staff.
5. WHEN a return tracking number equals the outbound number or belongs to another live contract, THE Audit_Suite SHALL verify the refusal.
6. WHEN the buyer misses the return deadline, THE Audit_Suite SHALL verify the lapse handling.
7. WHEN an early fraud warning arrives for a sale that has not shipped, THE Audit_Suite SHALL verify `REFUNDED` with neutral copy, and for a shipped sale, THE Audit_Suite SHALL verify that the payout is held.
8. WHEN a chargeback opens on a completed sale with an unreleased payout, THE Audit_Suite SHALL verify the `CHARGE_DISPUTE` hold, and WHEN the chargeback is won, THE Audit_Suite SHALL verify the hold clears.

### Requirement 15: Trades

**User Story:** As a trader, I want to negotiate, secure and complete a swap, so that both of us receive the card we agreed.

#### Acceptance Criteria

1. WHEN a trader proposes a trade and the other counters, THE Audit_Suite SHALL verify `NEGOTIATING`, the counter, and that changing cash, declared value or goods description voids both acceptances.
2. WHILE a trade is `NEGOTIATING`, WHEN one trader edits the meeting terms, THE Audit_Suite SHALL verify that the other trader's acceptance is cleared.
3. WHEN both traders accept the same terms version, THE Audit_Suite SHALL verify `TERMS_AGREED` and that side values are frozen.
4. WHEN a trader without a saved card or without a verified identity accepts terms, THE Audit_Suite SHALL verify the actionable refusal.
5. WHEN a trade has a cash leg, THE Audit_Suite SHALL verify that the payer pays buyer-present in the room before any hold is placed, and that the Currency_Conversion fee is disclosed for a converted currency.
6. WHEN the cash leg is unpaid at `pay_by`, THE Audit_Suite SHALL verify that the trade is abandoned and any fees are refunded.
7. WHEN both traders' Stripe test holds are authorised, THE Audit_Suite SHALL verify `COLLATERAL_LOCKED`, the single "collateral locked" notification, and the room updating without a reload (FINDINGS F21).
8. WHEN one trader's hold is declined, THE Audit_Suite SHALL verify that no fee is charged and the successful hold is voided.
9. WHILE a trade is `COLLATERAL_PENDING` before the placement cutoff, WHEN a trader proposes new meeting terms, THE Audit_Suite SHALL verify that the change is a proposal the other trader must accept, and after the cutoff, THE Audit_Suite SHALL verify the refusal.
10. WHEN both traders confirm the in-person handover, THE Audit_Suite SHALL verify `INSPECTION` with the 72-hour window clamped to the earliest hold expiry.
11. WHEN both traders accept or the trade-inspections Job_Endpoint runs after the deadline, THE Audit_Suite SHALL verify `COMPLETED`, both holds voided in Stripe test mode, and the cash leg released.
12. WHEN a trader offers a Multiple items listing as the offering side, or an item already held by another contract, THE Audit_Suite SHALL verify the `short-reservation` or offering-side refusal, and WHEN a Multiple items listing is the side traded for, THE Audit_Suite SHALL verify that its value equals what is offered against it.
13. WHEN the meeting passes without collateral locking, THE Audit_Suite SHALL verify that abandonment voids holds and restores the items.
14. WHEN traders are in incompatible regions, THE Audit_Suite SHALL verify the `region-mismatch` refusal.

### Requirement 16: Trade disputes

**User Story:** As a trader with a problem, I want to raise it and have staff decide, so that collateral protects whoever was wronged.

#### Acceptance Criteria

1. WHEN a trader raises `HANDOVER_FAILED`, `CONDITION_DISPUTE` or `FRAUD_CLAIMED`, THE Audit_Suite SHALL verify `DISPUTED` and that nothing is captured at raise.
2. WHEN staff resolve each outcome (`UNFOUNDED`, `CONDITION`, `FRAUD`, `NO_EXCHANGE`), THE Audit_Suite SHALL verify the money movement in Stripe test mode, the trade's final state, and for `FRAUD` the offender's ban and the victim's disbursement.
3. WHEN staff choose `NO_EXCHANGE` on a trade that reached `INSPECTION`, THE Audit_Suite SHALL verify the refusal.
4. WHEN a disputed trade's hold is within the custody margin of expiry and the trade-inspections Job_Endpoint runs, THE Audit_Suite SHALL verify the full capture into custody.

### Requirement 17: Private deals

**User Story:** As a host, I want to share a deal link that opens a sale or swap, so that I can deal with someone I already know.

#### Acceptance Criteria

1. WHEN a host composes each invite kind (cash sale as seller, cash sale as buyer, trade) on `/deals`, THE Audit_Suite SHALL verify the live preview, the link with Copy, Share and QR, and the host's editable page at `/deals?link=<token>`.
2. WHEN a signed-out visitor composes a draft with photos and signs in, THE Audit_Suite SHALL verify that `/deals?resume=1` restores the draft including photos.
3. WHEN a joiner claims an invite at `/t/[token]`, THE Audit_Suite SHALL verify that the matching cash sale or trade opens and that the hidden item is absent from the catalog.
4. WHEN a new account joins, THE Audit_Suite SHALL verify the two-question quick onboarding.
5. WHEN the host opens their own invite link, THE Audit_Suite SHALL verify the redirect to the host page, and WHEN the host tries to claim it, THE Audit_Suite SHALL verify the self-join refusal.
6. WHEN an invite is revoked, expired after 14 days of simulated time, or claimed across incompatible regions, THE Audit_Suite SHALL verify the refusal.
7. WHEN a private-deal cash sale reaches Pay, THE Audit_Suite SHALL verify the seller name disclosure step, the buyer's confirmation, and card collection in the room.
8. THE Audit_Suite SHALL verify that pending invites are listed on `/sales`, `/purchases` and `/trades`.

### Requirement 18: Messaging

**User Story:** As a member, I want to message other members with attachments in real time, so that we can arrange deals.

#### Acceptance Criteria

1. WHEN a member messages a seller from a listing, THE Audit_Suite SHALL verify that a conversation is created or reused and the browser navigates to it.
2. WHEN one member sends a message, THE Audit_Suite SHALL verify that it appears in the other member's open thread and inbox without a reload.
3. WHEN a member sends an attachment-only message, THE Audit_Suite SHALL verify the upload and display, and WHEN a body exceeds 4000 characters, THE Audit_Suite SHALL verify the refusal.
4. WHEN a member switches between threads, THE Audit_Suite SHALL verify that the inbox pane stays mounted.
5. WHEN a member opens a thread, THE Audit_Suite SHALL verify the unread count falls, and THE Audit_Suite SHALL verify that a message creates no bell notification.
6. WHEN a member sends an off-platform payment lure in chat, THE Audit_Suite SHALL verify that the message is delivered and flagged.

### Requirement 19: Notifications

**User Story:** As a member, I want notifications for contract events, so that I know when to act.

#### Acceptance Criteria

1. WHEN a contract event creates a notification, THE Audit_Suite SHALL verify that the bell's accessible name shows the unread count without a reload.
2. WHEN a member marks all read, THE Audit_Suite SHALL verify that the bell updates without a reload and stays correct after a reload (FINDINGS F7).

### Requirement 20: Reviews and reports

**User Story:** As a member, I want to rate counterparties after a deal and report bad listings or users, so that the community stays trustworthy.

#### Acceptance Criteria

1. WHEN a party to a `COMPLETED` cash sale or trade leaves a 1–5 rating with an optional comment, THE Audit_Suite SHALL verify the review on `/sellers/[id]` and the updated rating.
2. WHEN a party reviews twice, reviews an uncompleted contract or writes more than 1000 characters, THE Audit_Suite SHALL verify the refusal.
3. WHEN a member reports a listing or a user, THE Audit_Suite SHALL verify the report reaches the admin queue and the target receives no notification.

### Requirement 21: Off-platform scam reports

**User Story:** As a verified member who was scammed elsewhere, I want to report it, so that staff can protect others.

#### Acceptance Criteria

1. WHEN a verified member submits a scam report with screenshots, THE Audit_Suite SHALL verify the report on the reporter's status list and the evidence in the private bucket.
2. WHEN an unverified member opens `/report-scam`, or a member submits a fourth report within 30 days, THE Audit_Suite SHALL verify the refusal.
3. WHEN reports from two independent reporters share an identifier, THE Audit_Suite SHALL verify that staff see a corroborated cluster and the reporter sees no match information.
4. WHEN staff notify a matched member, THE Audit_Suite SHALL verify the generic notice on `/report-scam/response/[id]` and the member's response.
5. WHEN staff attempt a fraud ban, THE Audit_Suite SHALL verify that the ban requires a second admin's approval.

### Requirement 22: Trusted Sellers

**User Story:** As a seller, I want to apply to be a Trusted Seller, and as a buyer I want to browse the directory, so that reputations carry over.

#### Acceptance Criteria

1. WHEN a verified member submits an application with details and photos, THE Audit_Suite SHALL verify the pending status on `/trusted-sellers/apply` and the entry in `/admin?tab=trusted`.
2. WHEN staff approve, decline or revoke, THE Audit_Suite SHALL verify the badge and the directory entry on `/trusted-sellers`.
3. WHEN staff approve an unverified member, THE Audit_Suite SHALL verify the refusal.
4. WHEN a visitor searches and sorts the directory, THE Audit_Suite SHALL verify the results and that no surname appears.
5. WHEN a guest signs up from the public page, THE Audit_Suite SHALL verify the return to `/trusted-sellers/apply` and the skipped intent question.

### Requirement 23: References

**User Story:** As a member, I want to record and look up references for handles on other platforms, so that I can judge people before dealing.

#### Acceptance Criteria

1. WHEN a verified member records a reference with a sentiment, THE Audit_Suite SHALL verify that it goes live on `/references/[handle]` and that the people tally counts the author once per sentiment.
2. WHEN a member submits a reference without a sentiment, THE Audit_Suite SHALL verify the refusal.
3. WHEN a visitor searches `/references` and opens a bare handle shared by several platforms, THE Audit_Suite SHALL verify the "which one?" chooser.
4. WHEN a member claims a handle by staff-checked screenshot, THE Audit_Suite SHALL verify the claim in `/admin?tab=references` and its approval, and WHEN staff release it, THE Audit_Suite SHALL verify the references return to the handle.
5. WHEN a handle has no references, THE Audit_Suite SHALL verify that the page is `noindex`.
6. WHEN `GET /api/references/graph` is requested, THE Audit_Suite SHALL verify a well-formed response for a referenced handle.
7. WHERE a handle has a published profile line, THE Audit_Suite SHALL verify the "AI-written from public information" label, and THE Audit_Suite SHALL verify that a draft profile line is absent from the public page.

### Requirement 24: Profile, verification and payouts

**User Story:** As a member, I want to manage my profile, card, identity and payouts, so that my account is ready to deal.

#### Acceptance Criteria

1. WHEN a member edits display name, bio, avatar and social links, THE Audit_Suite SHALL verify the change in the rail and on the seller page without a reload (FINDINGS F1).
2. WHEN a member saves a card through Stripe Payment Element in test mode, THE Audit_Suite SHALL verify the brand and last four digits read back from Stripe.
3. THE Audit_Suite SHALL verify the `profile`, `verification` and `payouts` tabs of `/profile`, including the owed and landed amounts on the payouts tab after a completed sale.
4. THE Audit_Suite SHALL verify that a verified member with no payout account is shown as verified and not yet payable.

### Requirement 25: Admin console and arbitration

**User Story:** As staff, I want to work cases and operations from the console, so that disputes and payouts are handled.

#### Acceptance Criteria

1. WHEN a member who is neither staff nor admin opens `/admin` or `/admin/arbitration`, THE Audit_Suite SHALL verify the refusal.
2. WHEN a support member opens `/admin/arbitration`, THE Audit_Suite SHALL verify access, and WHEN that member opens the admin-only `/admin` tabs, THE Audit_Suite SHALL verify the refusal.
3. WHEN staff assign, note and resolve a case on `/admin/arbitration/[kind]/[ref]`, THE Audit_Suite SHALL verify the case state and the contract outcome.
4. WHEN a staff decision is at or above the two-person threshold or is a fraud finding, THE Audit_Suite SHALL verify that it becomes a proposal, that the same staff member cannot approve it inside 24 hours, and that a second staff member's approval applies it.
5. THE Audit_Suite SHALL verify the admin actions hide and unhide item, clear avatar, set report status, retry payout, resolve tracking flag, override seller exposure limit, view custody position, drain payouts, and mark an error group resolved.

### Requirement 26: Background jobs and webhooks

**User Story:** As the owner, I want scheduled jobs and provider webhooks exercised, so that the parts that run without a member are proven too.

#### Acceptance Criteria

1. WHEN a Pathway depends on a Job_Endpoint, THE Audit_Suite SHALL call that Job_Endpoint with the Sandbox `JOBS_SECRET` as a bearer token and verify the outcome.
2. WHEN a Job_Endpoint is called without the bearer secret or with a wrong one, THE Audit_Suite SHALL verify the refusal.
3. WHEN a Pathway depends on a Cron_Function, THE Audit_Suite SHALL invoke that function in the Sandbox schema and verify the outcome.
4. WHERE a Pathway depends on elapsed time, THE Audit_Suite SHALL move the relevant Sandbox timestamps back instead of waiting, and record the Step that does so as a Simulated_Step.
5. WHEN Stripe test events reach the App_Server through a Webhook_Source, THE Audit_Suite SHALL verify the `webhook_logs` row and the resulting state change.
6. WHEN a webhook arrives with an invalid signature, THE Audit_Suite SHALL verify the refusal and that no state changes.
7. WHEN the same webhook event is delivered twice, THE Audit_Suite SHALL verify that it is applied once.
8. WHEN a Ship24 delivery event arrives with the bearer secret, THE Audit_Suite SHALL verify `carrier_delivered_at` is set only on `DELIVERED`.

### Requirement 27: Marketing pages, error screen and error reporting

**User Story:** As a visitor, I want public pages to load and errors to be reportable, so that I can learn about the product and tell you when something breaks.

#### Acceptance Criteria

1. THE Audit_Suite SHALL verify that `/help`, `/terms`, `/privacy`, `/safety`, `/trusted-sellers`, `/report-scam` and `/references` load for a guest with a heading and no console errors.
2. WHEN an unknown route is requested, THE Audit_Suite SHALL verify the not-found page.
3. WHEN a render error occurs, THE Audit_Suite SHALL verify the error screen shows a reference and that "Report this problem" saves a member report.
4. WHEN `/api/errors` receives an anonymous post with no `Origin`, THE Audit_Suite SHALL verify the refusal.

### Requirement 28: Access guards and protected routes

**User Story:** As the owner, I want every protected route to refuse visitors who should not reach it, so that guarded actions stay guarded.

#### Acceptance Criteria

1. WHEN a guest requests each protected prefix listed in `product.md`, THE Audit_Suite SHALL verify the redirect to `/sign-in` with a return path.
2. WHEN a member requests a contract room (`/sales/[id]`, `/trades/[id]`) they are not party to, THE Audit_Suite SHALL verify the refusal and that no contract detail is shown.
3. WHEN a member calls a mobile API endpoint under `app/api/mobile/**` without a valid bearer token, THE Audit_Suite SHALL verify the refusal.
4. WHILE the demo payment controls are disabled, THE Audit_Suite SHALL verify that no demo panel renders.

### Requirement 29: Capture screenshots and video at two viewports

**User Story:** As the owner, I want screenshots and a video of every pathway on desktop and phone, so that I can see exactly what testers will see.

#### Acceptance Criteria

1. THE Audit_Suite SHALL run every Pathway on both Viewport_Profiles, unless the Coverage_Map records a reason a Pathway is viewport-specific.
2. THE Audit_Suite SHALL record a Pathway_Video for every Pathway on every Viewport_Profile, whether the Pathway passes or fails.
3. WHEN a Pathway uses several browser contexts, THE Audit_Suite SHALL record one Pathway_Video per member on each Viewport_Profile and present the videos together in the Audit_Report, labelled by member.
4. THE Audit_Suite SHALL capture Step_Screenshots at the Viewport_Profile's native size and as full pages.
5. THE Audit_Suite SHALL write each artifact to a path that identifies the run, the Pathway identifier, the Viewport_Profile, the Step index and the member.
6. THE Audit_Suite SHALL keep artifacts from earlier runs until the owner deletes them or a newer run of the same Pathway and Viewport_Profile replaces them.

### Requirement 30: Run automated UX checks on every visited page

**User Story:** As the owner, I want UI rules checked automatically, so that regressions in layout and feel show up in the report.

#### Acceptance Criteria

1. WHEN a Step finishes on a page, THE Audit_Suite SHALL record the page's cumulative layout shift and record a UX_Observation when it exceeds 0.1, or when an element outside the arriving data's own region moves.
2. WHEN a Step finishes on a page, THE Audit_Suite SHALL record a UX_Observation when the document is wider than the viewport.
3. WHEN a Step finishes on a page, THE Audit_Suite SHALL record a UX_Observation when a skeleton, shimmer or placeholder shape is present.
4. WHEN a Step finishes on a page, THE Audit_Suite SHALL record a UX_Observation when an element other than a dialog, sheet, menu, popover, tooltip or spinner runs an entrance, stagger, lift or zoom animation.
5. WHEN a Step finishes on a page, THE Audit_Suite SHALL run an automated accessibility scan and record each violation as a UX_Observation, including interactive controls without accessible names.
6. WHILE a Pathway runs, THE Audit_Suite SHALL record every console error, uncaught exception and failed or 5xx network request as a UX_Observation on the Step where it occurred.
7. WHEN a request failure is reported to a member, THE Audit_Suite SHALL verify that it appears as a toast and does not resize the surrounding dialog.
8. THE Audit_Suite SHALL classify each UX_Observation as blocking or advisory, and WHEN a blocking UX_Observation is recorded, THE Audit_Suite SHALL mark the Pathway as failed.
9. WHEN a UX_Check is suppressed for a page, THE Audit_Suite SHALL show the suppression and its written reason in the Audit_Report.

### Requirement 31: Check member-facing copy rules

**User Story:** As the owner, I want wording rules checked, so that testers are not misled about money or holds.

#### Acceptance Criteria

1. WHEN a page shows a SHOPFRONT listing or contract, THE Audit_Suite SHALL verify the label "Multiple items" or the phrase "a listing with multiple items", and the statement that nothing is held.
2. WHEN a page shows trade collateral, THE Audit_Suite SHALL verify the term "trade collateral" with an explanation that it is a temporary card hold, and record a UX_Observation when the word "escrow" describes collateral.
3. WHEN a page shows a service fee, THE Audit_Suite SHALL verify that the rate label matches the rate the domain fee tables give for that currency and payment method, and that the shown total equals the charged total.
4. WHEN a page is visible to members, THE Audit_Suite SHALL record a UX_Observation on any occurrence of the words "shopfront", "binder", "DittoBond", "Friction_Tax", "open beta" or "waived", or of a raw driver error such as "Cannot coerce".
5. THE Audit_Suite SHALL verify that displayed money amounts carry an ISO currency code.

### Requirement 32: Mask secrets and personal data in artifacts

**User Story:** As the owner, I want screenshots, videos and logs free of secrets, so that I can share the report safely.

#### Acceptance Criteria

1. THE Masker SHALL replace every environment value whose name contains `KEY`, `SECRET`, `TOKEN` or `PASSWORD` with a fixed placeholder in logs, traces and the Audit_Report.
2. WHEN a Step_Screenshot or Pathway_Video is captured, THE Masker SHALL cover on-screen elements that show email addresses, Stripe client secrets, invite tokens and full legal names.
3. WHEN the Audit_Report is generated, THE Audit_Suite SHALL scan every text artifact for the values covered by Acceptance Criterion 1 and fail report generation if any is found.
4. THE Audit_Suite SHALL exclude `.env.local` and storage-state cookie files from the Audit_Report and from any archive of it.

### Requirement 33: Generate the Audit_Report

**User Story:** As the owner, I want one report I can click through, so that I can review the whole app before testers arrive.

#### Acceptance Criteria

1. WHEN a run completes, THE Audit_Suite SHALL generate an Audit_Report with an index page grouping Pathways by functional area and showing each Pathway's pass/fail status per Viewport_Profile.
2. THE Audit_Report SHALL give each Pathway a page with its title, kind, ordered Steps with their Step_Screenshots, its Pathway_Videos, its UX_Observations by Step, and its trace link when it failed.
3. THE Audit_Report SHALL show the run's date, git commit, schema, payments mode per Pathway (Stripe test or mock), duration and totals of passed, failed and skipped Pathways.
4. THE Audit_Report SHALL show the Coverage_Map with each function's status, the manual checks and the Out_Of_Scope_Entries listed under Requirement 5.
5. THE Audit_Report SHALL open from the local file system in a browser with no server.
6. WHEN a run includes only some Pathways, THE Audit_Report SHALL mark the remaining Pathways as not run in this run.
7. THE Audit_Report SHALL allow the reviewer to filter Pathways by status, functional area, Viewport_Profile and presence of UX_Observations.

### Requirement 34: Produce trustworthy, repeatable results

**User Story:** As the owner, I want a full run to give the same answer as running each file alone, so that a green report means the app works.

#### Acceptance Criteria

1. WHEN the whole Audit_Suite runs in one invocation, THE Audit_Suite SHALL produce the same pass/fail result per Pathway as running each spec file alone against the same commit (FINDINGS F70).
2. THE Audit_Suite SHALL create the listings, contracts and accounts each Pathway consumes and scope assertions to those records.
3. THE Audit_Suite SHALL report a Pathway that passed only on retry as flaky in the Audit_Report.
4. THE Audit_Suite SHALL make interactions through the controls a member would use, and THE Audit_Suite SHALL list any forced click or synthetic event in the Audit_Report with its written reason.
5. IF the Sandbox seed state required by a Pathway is missing, THEN THE Audit_Suite SHALL fail that Pathway with a message naming the missing seed record and the reset command.

### Requirement 35: Respect operational rules

**User Story:** As the owner, I want the suite run on my say-so, so that slow builds and tests do not run without my instruction.

#### Acceptance Criteria

1. THE Audit_Suite SHALL run only when invoked by an explicit command.
2. THE Audit_Suite SHALL start the App_Server through Playwright's `webServer` setting with `next start`, and the documentation SHALL state that `npm run dev` is not used by the Audit_Suite.
3. THE Audit_Suite SHALL provide commands that run the whole suite, one functional area, one Pathway, one Viewport_Profile, and report generation alone.

### Requirement 36: Optional highlight reel

**User Story:** As the owner, I want a short highlight video of the main journeys, so that I can share what the product does.

#### Acceptance Criteria

1. WHERE the highlight reel option is enabled, THE Audit_Suite SHALL compile a Highlight_Reel of at most 90 seconds from passing Pathway_Videos chosen in a checked-in selection list.
2. WHERE the highlight reel option is enabled, THE Audit_Suite SHALL build the Highlight_Reel only from Pathway_Videos that passed the Masker's checks.
3. WHERE the highlight reel option is enabled, THE Audit_Suite SHALL label each segment with the Pathway title.
4. THE Audit_Suite SHALL produce the Audit_Report and the Pathway_Videos whether or not the highlight reel option is enabled.
5. THE Highlight_Reel selection list SHALL open with the cash-sale lifecycle and trade lifecycle Happy_Path Pathways, followed by further Pathways the implementer chooses.
