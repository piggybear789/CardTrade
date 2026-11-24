# Implementation Plan: e2e-ux-audit-suite

## Overview

The suite grows out of the existing Playwright harness, in TypeScript, in this order:

1. Safety: schema guards, removal of the production override, and the safety preflight.
2. The pure decision modules in `tests/e2e/audit/core/`, with fast-check properties in the Vitest `domain` project.
3. Harness and config: servers, webhook forwarder, Masker, UX collectors, Pathway DSL, reporter, Stripe bindings, cleanup.
4. Pathways by functional area. The cash-sale and trade lifecycles come first because they lead the highlight reel.
5. The report generator, then retirement of superseded specs and probes, then the optional highlight reel.

Project rules apply to every task. Never start `npm run dev` from an agent turn. Do not run `npm run build`, `npm run typecheck`, lint or the Playwright suite as routine verification. The only test runs are the checkpoint tasks, and the user triggers those. Editor diagnostics cover type errors between checkpoints.

Three design decisions are still open, and the plan handles them this way:

- **`/api/health` fields (task 1.8).** `schema` and `paymentsMode` are exposed only when the server's schema is `cardtrade_dev`, so production's public response does not change. The user may veto this. The fallback is a preflight probe that reads the server-side env and the DB directly, described in task 1.8.
- **`@axe-core/playwright` (task 7.9).** It is installed only after the user explicitly approves.
- **One-off setup (tasks 7.22, 7.23).** These are MANUAL tasks for the user: provisioning the Stripe test fixture accounts, and adding the Supabase Auth redirect URL.

## Tasks

- [x] 1. Safety guards and preflight
  - [x] 1.1 Create the pure preflight and cleanup guards in `tests/e2e/audit/core/preflight.ts`
    - `decidePreflight`, `classifyStripeKey` (`sk_live_`, `rk_live_` and `pk_live_` count as live), `clientEnvFingerprint` (hash of the sorted `NEXT_PUBLIC_*` pairs), `maskEmail`, using the `PreflightInput` / `PreflightProblem` types from the design
    - Stripe key variables are names matching `^(NEXT_PUBLIC_)?STRIPE_.*(KEY|SECRET)` plus `STRIPE_IDENTITY_RESTRICTED_KEY*`. Problems carry variable names, never values
    - Also export `assertSandboxSchema(schema)`, which accepts only exactly `cardtrade_dev`, and `isDeletableSandboxUser({ email, app_metadata })`, which is true only for `^e2e-.+@example\.com$` with `app_metadata.sandbox === true`
    - No imports of Playwright, `node:fs` or the network
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.8, 4.2_

  - [x] 1.2 Make the harness DB helpers and cleanup refuse any schema other than `cardtrade_dev`
    - `tests/e2e/support/db.ts`: `e2eSchema()` throws unless the value is exactly `cardtrade_dev`. Remove the default to `cardtrade` and the `E2E_ALLOW_PRODUCTION_SCHEMA` override
    - `scripts/e2e/cleanup-test-data.ts`: call `assertSandboxSchema` before any client is created, remove the `cardtrade` default, and leave no code path that names the production schema
    - `tests/e2e/support/globalSetup.ts`: delete the `E2E_ALLOW_PRODUCTION_SCHEMA` handling and the `ux-review/captures` wipe
    - Auth-user deletion in cleanup goes through `isDeletableSandboxUser`
    - _Requirements: 1.1, 1.2, 1.6, 2.1, 2.8_

  - [ ]* 1.3 Write property test for preflight sandbox admission
    - **Property 1: Preflight admits only the sandbox**
    - File `tests/property/e2eAudit/preflight.test.ts`, `numRuns: 100`
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 2.2, 2.3**

  - [ ]* 1.4 Write property test for live-key refusal
    - **Property 2: Live keys are always refused and never printed**
    - **Validates: Requirements 1.3, 1.6**

  - [ ]* 1.5 Write property test for the client env fingerprint
    - **Property 3: Client env fingerprint tracks exactly the public values**
    - **Validates: Requirements 4.2**

  - [ ]* 1.6 Write property test for the cleanup guards
    - **Property 4: Cleanup guards never reach production**
    - Includes the check that every `markedEmail` output satisfies the deletion pattern
    - **Validates: Requirements 2.1, 2.8**

  - [x] 1.7 Run the static preflight when `playwright.config.ts` loads
    - Call `decidePreflight` with the harness schema and the full environment at module load, and throw with the problem list (names only) before any `webServer` starts
    - Offer no flag, env var or CLI option that skips the live-key check
    - _Requirements: 1.1, 1.2, 1.3, 1.6_

  - [x] 1.8 Add `schema` and `paymentsMode` to `/api/health`, on the sandbox only
    - Add both fields to the response only when `DB_SCHEMA` (from `lib/supabase/schema.ts`) is `cardtrade_dev`. On any other schema the response is byte-for-byte what it is today
    - `paymentsMode` is `mock`, `unconfigured`, `test` or `live`, derived with `isLiveSecretKey` from the configured key prefixes. Never return a key or any part of one
    - **User may veto.** If the user rejects the health change, skip this task. Task 7.17 then probes each server by launching a short `node` check with the server's own env file and reading the schema and key prefixes directly, and by checking the sandbox schema with a service-role `select` through `support/db.ts`
    - _Requirements: 1.4, 1.5_

  - [ ]* 1.9 Write unit tests for the health fields
    - With the schema `cardtrade_dev`, both fields are present and `paymentsMode` is correct for mock, test and live prefixes. With `cardtrade`, neither field is present
    - _Requirements: 1.4_

  - [x] 1.10 Stamp Stripe objects with the audit run on the sandbox only
    - `domain/services/stripe/config.ts` reads `E2E_RUN_ID` only when `NEXT_PUBLIC_SUPABASE_SCHEMA` is `cardtrade_dev`, next to the existing live-key-on-dev refusal
    - `domain/services/stripe/metadata.ts` adds `cardtrade_sandbox: 'true'` and `cardtrade_e2e_run: <id>` when the value is set, and never on the production schema
    - _Requirements: 2.7_

  - [ ]* 1.11 Write unit tests for the run stamp
    - The fields are present on the sandbox with a run id, and absent on `cardtrade` or without a run id
    - _Requirements: 2.7_

- [x] 2. Checkpoint: safety guards
  - Ask the user to run `npx vitest --run tests/property/e2eAudit tests/unit/e2eAudit` and the existing Stripe metadata/config unit tests. Ensure all tests pass, ask the user if questions arise.

- [x] 3. Coverage, aggregation and findings core
  - [x] 3.1 Implement `tests/e2e/audit/core/coverageMap.ts`
    - `Area`, `CoverageEntry` (automated / manual / not-automated / out-of-scope), `extractProductFunctions(productMd)`, and `checkCoverageMap(entries, productFunctions, definedPathwayIds)`. The checker reports uncovered functions, entries with no mapping, empty `happy` or `refusal` lists, manual entries without a check, unknown pathway ids and duplicate ids
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

  - [ ]* 3.2 Write property test for the coverage checker
    - **Property 6: Coverage checker reports exactly the defects**
    - **Validates: Requirements 5.1, 5.2, 5.4, 5.5**

  - [ ]* 3.3 Write property test for product function extraction
    - **Property 7: Product function extraction round trip**
    - **Validates: Requirements 5.1**

  - [x] 3.4 Implement `core/uxPolicy.ts` and `core/aggregate.ts`
    - `uxPolicy.ts`: `classifyObservation` (the blocking/advisory defaults from the design's UX checks table, including `BENIGN_CONSOLE` filtering) and `applySuppressions`, which annotates observations and never drops them
    - `aggregate.ts`: `pathwayStatus`, `coverageStatus`, `aggregateRun`, and a pure `buildStepRecords` that assigns dense 1-based indices and sets `simulated` only on simulated steps. Use the `PathwayRecord`, `RunManifest` and `AggregatedRun` types from the design
    - _Requirements: 4.7, 5.3, 5.6, 6.2, 6.4, 30.8, 30.9, 33.1, 33.3, 33.4, 33.6, 34.3_

  - [ ]* 3.5 Write property test for coverage status
    - **Property 8: Coverage status follows its pathways**
    - **Validates: Requirements 5.3, 5.6, 33.4**

  - [ ]* 3.6 Write property test for pathway status
    - **Property 9: Pathway status is determined by steps, observations and retries**
    - **Validates: Requirements 6.4, 30.8, 30.9, 34.3**

  - [ ]* 3.7 Write property test for step records
    - **Property 10: Step records are dense and ordered**
    - **Validates: Requirements 6.2, 4.7**

  - [ ]* 3.8 Write property test for run aggregation
    - **Property 11: Run aggregation is complete and consistent**
    - **Validates: Requirements 4.7, 33.1, 33.3, 33.6**

  - [x] 3.9 Implement `core/findings.ts`
    - `nextFindingNumber(findingsMd)` and `findingDraft(...)`, which writes in the existing `FINDINGS.md` format and severity scale
    - _Requirements: 3.5_

  - [ ]* 3.10 Write property test for finding numbers
    - **Property 27: Finding numbers continue the file**
    - **Validates: Requirements 3.5**

- [x] 4. Masking, artifact paths, copy rules and HTML core
  - [x] 4.1 Implement `core/mask.ts`
    - `secretValues` (names containing KEY, SECRET, TOKEN or PASSWORD, values of 8 or more characters), idempotent `scrubText` writing `[MASKED]`, `findLeaks` (returns names only), `PII_PATTERNS` (email, Stripe client secret, invite token), a legal-name matcher, and `isForbiddenArtifact` (`.env*`, `playwright/.auth/**`, storage-state files, either path separator)
    - _Requirements: 32.1, 32.2, 32.3, 32.4_

  - [ ]* 4.2 Write property test for secret scrubbing
    - **Property 15: Secrets are scrubbed and leaks are found**
    - **Validates: Requirements 32.1, 32.3**

  - [ ]* 4.3 Write property test for the PII matcher
    - **Property 16: On-screen PII matcher finds every sensitive value**
    - **Validates: Requirements 32.2**

  - [ ]* 4.4 Write property test for forbidden artifacts
    - **Property 17: Forbidden artifacts are always excluded**
    - **Validates: Requirements 32.4**

  - [x] 4.5 Implement `core/artifactPaths.ts`
    - `artifactPath`, `parseArtifactPath` and `supersededRuns`, following the design's path grammar and member-label pattern
    - Also `storageUploadUrl` / `parseStorageUploadUrl`, which give the ledger entry (bucket, path) for a `/storage/v1/object/<bucket>/<path>` write and nothing for any other URL
    - _Requirements: 2.4, 29.5, 29.6_

  - [ ]* 4.6 Write property test for artifact path round trip
    - **Property 13: Artifact paths round-trip**
    - **Validates: Requirements 29.5**

  - [ ]* 4.7 Write property test for superseded runs
    - **Property 14: Only superseded runs are removed**
    - **Validates: Requirements 29.6**

  - [ ]* 4.8 Write property test for upload URL parsing
    - **Property 5: Upload URLs round-trip to ledger entries**
    - **Validates: Requirements 2.4**

  - [x] 4.9 Implement `core/copyRules.ts`
    - `checkForbiddenTerms` (whole words, any case: shopfront, binder, DittoBond, Friction_Tax / friction tax, open beta, waived, Cannot coerce), `checkCurrencyCodes`, `checkShopfrontCopy`, `checkCollateralCopy` (one observation per sentence that puts "escrow" with collateral or a hold), and `checkFeeLabel(text, expectedLabel)`, which takes the expected label as an argument so the module does not import `lib/`
    - _Requirements: 9.5, 31.1, 31.2, 31.3, 31.4, 31.5_

  - [ ]* 4.10 Write property test for forbidden terms
    - **Property 18: Forbidden terms are found in any position and case**
    - **Validates: Requirements 31.4**

  - [ ]* 4.11 Write property test for currency codes
    - **Property 19: Money without an ISO code is flagged**
    - The test imports `formatMoney`. The core module does not
    - **Validates: Requirements 31.5, 9.5**

  - [ ]* 4.12 Write property test for fee labels
    - **Property 20: Fee labels must equal the domain rate**
    - The test computes labels with `processingFeeRateLabel` from `lib/fees/feeLabels.ts`
    - **Validates: Requirements 31.3**

  - [ ]* 4.13 Write property test for shopfront and collateral wording
    - **Property 21: Shopfront and collateral wording rules**
    - **Validates: Requirements 31.1, 31.2**

  - [x] 4.14 Implement `core/html.ts`
    - `escapeHtml`, `renderIndex` and `renderPathwayPage`, both pure string renderers over `AggregatedRun` / `PathwayRecord`. Every interpolated value goes through `escapeHtml`
    - _Requirements: 33.1, 33.2, 33.4, 33.7_

  - [ ]* 4.15 Write property test for HTML escaping
    - **Property 12: Report HTML escapes everything it interpolates**
    - **Validates: Requirements 33.2**

- [x] 5. UX classifiers, backend and reel core
  - [x] 5.1 Implement `core/motion.ts`, `core/cls.ts`, `core/dialogStability.ts` and `core/overflow.ts`
    - `classifyAnimation` with the design's allow-list (dialogs, sheets, menus, listboxes, popovers, tooltips, the sonner toaster, Radix popper, spinners, colour-only properties, `ref-*`)
    - `summariseShifts` (threshold 0.1, ignoring `hadRecentInput`), `shiftOutsideRegion`, `dialogResized` (2 px tolerance), `overflowFindings` (1 px tolerance)
    - _Requirements: 30.1, 30.2, 30.4, 30.7_

  - [ ]* 5.2 Write property test for the motion classifier
    - **Property 22: Motion classifier allows only functional motion**
    - **Validates: Requirements 30.4**

  - [ ]* 5.3 Write property test for the layout shift summary
    - **Property 23: Layout shift summary**
    - **Validates: Requirements 30.1**

  - [ ]* 5.4 Write property test for dialog stability
    - **Property 24: Dialog stability**
    - **Validates: Requirements 30.7**

  - [ ]* 5.5 Write unit tests for overflow and skeleton thresholds
    - Small fixed examples for `overflowFindings` and the skeleton selector list that the collector will use, exported as a constant from `core/overflow.ts`
    - _Requirements: 30.2, 30.3_

  - [x] 5.6 Implement `core/cron.ts` and `core/timeTravel.ts`
    - `CRON_ALLOW_LIST`, starting with `auto_complete_due_cash_sales`, `warn_expiring_holds`, `expire_lapsed_holds` and `enforce_trade_shipping_deadlines`. Before adding a name, confirm it against `cron.job` with a read-only query. `cronInvocationSql(name)` returns `select cardtrade_dev.<name>()` and throws for anything not on the list exactly
    - `rewindPatch(row, columns, durationMs)` moves only the named columns, and rejects a negative duration or an unknown column
    - _Requirements: 26.3, 26.4_

  - [ ]* 5.7 Write property test for cron invocations
    - **Property 25: Cron invocations are allow-listed and sandbox-qualified**
    - **Validates: Requirements 26.3**

  - [ ]* 5.8 Write property test for timestamp rewinds
    - **Property 26: Timestamp rewinds move only what they name**
    - **Validates: Requirements 26.4**

  - [x] 5.9 Implement `core/reel.ts`
    - `planReel(selection, results)` keeps the selection order, uses only passed and cleanly masked videos, carries each Pathway title, and keeps the total at or under 90 s
    - _Requirements: 36.1, 36.2, 36.3_

  - [ ]* 5.10 Write property test for the reel plan
    - **Property 28: Highlight reel plan**
    - **Validates: Requirements 36.1, 36.2, 36.3**

- [x] 6. Checkpoint: pure core
  - Ask the user to run `npx vitest --run tests/property/e2eAudit tests/unit/e2eAudit`. Ensure all tests pass, ask the user if questions arise.

- [x] 7. Harness, servers and the Pathway DSL
  - [x] 7.1 Add `--ready-port <n>` to `scripts/dev/stripeListen.mjs`
    - Serve `200` on `/ready` once every listener has printed `Ready!`. Keep the existing non-test-key refusal and secret check
    - _Requirements: 4.5, 4.6, 26.5_

  - [x] 7.2 Make `scripts/e2e/build-for-e2e.mjs` write `.next-e2e/e2e-client-env.json`
    - The file holds the `clientEnvFingerprint` of the build environment
    - _Requirements: 4.1, 4.2_

  - [x] 7.3 Rework `playwright.config.ts` servers and projects
    - `webServer` array: the main `next start` on 3100 with Stripe test keys, `AUTH_RATE_LIMIT_PER_MINUTE=100` and its own `WEBHOOK_URL`; the aux server on 3101 with `PAYMENTS_PROVIDER=mock`, `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true`, `ENABLE_PAYMENT_DEMO=true`, `WEBHOOK_SECRET`, the default auth limit and its own `WEBHOOK_URL`; the forwarder `node scripts/dev/stripeListen.mjs 3100 --ready-port 3199`. Pass `E2E_RUN_ID` to both app servers, and relay output through `scrubText`
    - Remove the `next dev` branch, `E2E_PRODUCTION_SERVER`, `E2E_MOBILE` and the forced `PAYMENTS_PROVIDER=mock`
    - Projects: `preflight`, `setup`, `desktop`, `phone` (iPhone 14, WebKit), `desktop-aux`, `phone-aux`, `isolated`, with the design's grep and dependency rules. Set `retries: 1` and add `audit/reporter.ts` to the reporters
    - _Requirements: 3.1, 4.1, 4.3, 4.4, 4.6, 29.1, 35.2_

  - [x] 7.4 Extend the support modules
    - `support/db.ts`: `generateAuthLink`, `setAppMetadata`, `getAuthUser`
    - `support/marker.ts`: `runId()`
    - `support/users.ts`: personas for the aux server and per-Pathway members, plus `HEIDI_SIGNOUT` in the seed checks
    - `auth.setup.ts`: also sign in the aux personas against port 3101
    - _Requirements: 2.1, 2.2, 3.1, 3.4_

  - [x] 7.5 Implement the test-mode Stripe helpers in `tests/e2e/audit/backend/`
    - `stripe.ts`: a client that refuses any key `classifyStripeKey` does not call `test`
    - `stripeEvents.ts`: builds `radar.early_fraud_warning.created` and `charge.dispute.created` / `.closed` fixtures naming a real test charge, signed with the SDK's test header helper
    - `ship24.ts`: posts Ship24-shaped events with `Authorization: Bearer <SHIP24_WEBHOOK_SECRET>`
    - _Requirements: 4.4, 14.7, 14.8, 26.5, 26.8_

  - [ ]* 7.6 Write unit test that a signed fixture verifies
    - `constructEvent` with the same secret accepts the fixture, and a tampered one is refused
    - _Requirements: 26.6_

  - [x] 7.7 Implement the remaining backend helpers
    - `jobs.ts`: `runJob(name, { auth })` posts to `http://localhost:3100/api/jobs/<name>`, with modes for a correct, missing or wrong bearer token
    - `cron.ts`: `runCron(name)` sends the SQL from `cronInvocationSql` through the Supabase management query transport in `scripts/dev/lib.mjs`
    - `timeTravel.ts`: `rewind(...)` applies `rewindPatch` with the service role
    - `authLinks.ts`: Admin API reset and confirmation links
    - `seed.ts`: `createPersona()` sets `app_metadata.sandbox = true` at creation, and `requireSeed(names)` fails with the record name and `npm run dev:db:reset`
    - _Requirements: 2.1, 7.6, 7.7, 26.1, 26.2, 26.3, 26.4, 34.5_

  - [x] 7.8 Extend `scripts/e2e/cleanup-test-data.ts` for Shared_Resources
    - Storage: delete the exact paths in `audit-artifacts/.uploads/<runId>.jsonl` and the paths named by marked rows. Never list a whole bucket
    - Auth: flag any marked account that lacks the sandbox flag, log it, and delete only through `isDeletableSandboxUser`
    - Stripe: search each test platform for `cardtrade_sandbox=true` objects, cancel PaymentIntents, keep `cardtrade_e2e_fixture` objects, and write anything Stripe will not remove into the run manifest's `leftInStripe`
    - Log each item cleanup cannot delete. Never retry with a broader filter
    - _Requirements: 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 7.9 USER APPROVAL REQUIRED: add `@axe-core/playwright` as a dev dependency
    - Before running `npm install -D @axe-core/playwright`, ask the user and wait for explicit approval. Do not install without it
    - If the user declines, record that the accessibility check (Req 30.5) is not automated: task 7.11 skips `ux/axe.ts`, and task 15.6 adds a `not-automated` reason to the Coverage_Map
    - _Requirements: 30.5_

  - [x] 7.10 Implement the Masker in `tests/e2e/audit/masker.ts`
    - An init script that draws opaque boxes over emails, client secrets, invite tokens, deal QR codes and the run's legal names. The boxes sit in a closed shadow-root overlay (`aria-hidden`, `pointer-events: none`) and re-measure on mutation, scroll and resize
    - A screenshot `mask` locator list, and an uncovered-match count that becomes a blocking `unmasked` observation
    - A trace scrubber that rewrites text entries in trace zips through `scrubText`, called from `globalTeardown` after cleanup
    - _Requirements: 32.1, 32.2_

  - [x] 7.11 Implement the in-page UX collectors and the copy checker
    - `audit/ux/cls.ts` (the observer moved from `specs/layout-shift.spec.ts`), `overflow.ts`, `skeleton.ts`, `motion.ts`, `runtime.ts` (console, `pageerror`, failed and 5xx requests, the moved `BENIGN_CONSOLE`, and the Storage upload ledger), and `axe.ts` (WCAG 2.1 A/AA, app origin only; only if 7.9 was approved)
    - `audit/copy.ts` reads visible text on app-origin pages and calls `core/copyRules.ts`, computing the expected fee label with `processingFeeRateLabel`
    - _Requirements: 2.4, 30.1, 30.2, 30.3, 30.4, 30.5, 30.6, 31.1, 31.2, 31.3, 31.4, 31.5_

  - [x] 7.12 Implement member contexts in `audit/members.ts` and extend `support/fixtures.ts`
    - For each member: `ensureFreshSession`, a context at the project device with `recordVideo`, a unique `203.0.113.x` `x-forwarded-for` on the aux server, then the Places stub, the Masker and the collectors before the first page loads. Label every context with its member
    - Extend the existing `browser.newContext` patch and the auto fixture to install the Masker, the collectors and `recordVideo`, so unmigrated specs keep working
    - _Requirements: 3.4, 6.6, 29.2, 29.3, 29.4_

  - [x] 7.13 Implement the Pathway DSL in `tests/e2e/audit/pathway.ts`
    - `pathway(declaration, body)` over `support/fixtures.ts` with `step`, `simulated`, `arrange`, `assertState` (whose type requires `ui` whenever `db` is given), `refusal` (asserts a code or the exact message, with an optional toast-in-dialog check), and `forced`
    - Validate the declaration: id pattern, a `mockReason` for `provider: 'mock'`, a reason for `viewports.only`. Generate the `@id:`, `@area:`, `@kind:`, `@aux` and `@isolated` tags
    - After each step, run the collectors and copy rules, take full-page screenshots per member, and raise blocking observations as soft assertions after the screenshot. On a throw, capture the screenshot, console and trace, and record later steps as skipped
    - At the end, close the contexts, save one video per page as `video.<member>.<n>.webm`, and attach the scrubbed `audit-pathway` record
    - _Requirements: 4.4, 4.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 29.1, 29.2, 29.3, 29.4, 29.5, 30.7, 30.8, 30.9, 34.4, 35.3_

  - [ ]* 7.14 Write unit tests for declaration validation
    - Refuse a mock Pathway with no `mockReason`, `viewports.only` with no reason, and a malformed id. Check that the tags are generated correctly
    - _Requirements: 4.4, 6.1, 29.1, 35.3_

  - [x] 7.15 Implement the Playwright reporter in `tests/e2e/audit/reporter.ts`
    - Collect each `audit-pathway` attachment with its Playwright status and retry count, and write `audit-artifacts/runs/<runId>/manifest.json` (run id, start time, `git rev-parse HEAD`, schema, servers and payments modes, duration, results). A pass on retry is `flaky`
    - _Requirements: 29.5, 33.3, 34.3_

  - [x] 7.16 Implement the Stripe bindings and real card entry
    - `audit/stripeFixtures.ts`: the fixture account ids (AU, US, and the existing DE account `acct_1UQ1EbDBt8PZ9Rx1`) and `BINDING_CARDS`, a different test card number per member
    - `scripts/e2e/provision-stripe-fixtures.ts`: refuses a non-test key, creates the AU and US test connected accounts, and prints their ids
    - `audit/stripe-bindings.setup.ts`: idempotently find or create tagged Customers, attach each member's card, write `payer_id`, `payment_source_id` and `payment_method_label`, point `merchant_ref` at the platform fixture account, align `identity_check_name`, and set a staff exposure override. If a fixture id is missing, fail with `npm run audit:stripe-fixtures`
    - `support/payments.ts`: real Payment Element entry through `frameLocator`, plus 3-D Secure complete and fail helpers. Keep the demo-card path for aux Pathways
    - _Requirements: 2.7, 4.3, 13.5, 13.6, 13.19, 24.2_

  - [x] 7.17 Create the initial Coverage_Map and the preflight project
    - `tests/e2e/audit/coverage.ts`: one entry for every function `extractProductFunctions` returns from `product.md`. Each entry starts as `not-automated` with the reason "pending migration (tasks 9 to 15)". Add `auth.google-oauth` as `out-of-scope` ("Excluded by the owner."), and SES emails as `manual` with a manual check
    - `tests/e2e/audit/preflight.setup.ts`: probe each server (through the gated `/api/health` fields, or the task 1.8 fallback if those were vetoed); compare the client env stamp; check every Sandbox_Account the run signs in as has `sandbox = true`; check required secrets (`JOBS_SECRET`, `SHIP24_WEBHOOK_SECRET`, aux `WEBHOOK_SECRET`, `E2E_SEED_PASSWORD`, `SUPABASE_PAT`) and the seed rows; run `checkCoverageMap` against `audit-artifacts/.pathways.json`
    - _Requirements: 1.4, 1.5, 2.3, 4.2, 5.1, 5.2, 5.4, 5.5, 5.6, 34.5_

  - [ ]* 7.18 Write unit tests over the real Coverage_Map
    - The real `coverage.ts` passes `checkCoverageMap` against the real `product.md` and the `pathway({ id: '…' })` literals in `tests/e2e/specs/**`. It contains the Google OAuth out-of-scope entry. Every `supersededProbes` name exists in `tests/e2e/debug/` or is recorded as deleted
    - _Requirements: 3.3, 5.4, 5.6_

  - [ ]* 7.19 Write the source-scan guard tests
    - No `force: true` or `dispatchEvent(` outside `forced()`; no `rewind`, Stripe fixture or Ship24 fixture call outside `simulated()`; no `waitForLoadState('networkidle')`; no `E2E_ALLOW_PRODUCTION_SCHEMA` or other override flag in the harness; no `@supabase/supabase-js` import in the Playwright process
    - _Requirements: 1.6, 4.7, 34.4_

  - [x] 7.20 Create the `scripts/e2e/audit.mjs` entry point and the npm scripts
    - Run the static preflight, then `build-for-e2e.mjs` (unless `--no-build`), the stamp check, `playwright test --list --reporter=json` into `audit-artifacts/.pathways.json`, `playwright test`, and the report. Translate `--area`, `--pathway` and `--viewport` into grep and project arguments, and pass anything after `--` through
    - `package.json`: add `audit`, `audit:clean` (keeping `test:e2e:clean` as an alias) and `audit:stripe-fixtures`
    - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 35.1, 35.3_

  - [ ]* 7.21 Write unit tests for `audit.mjs` argument translation
    - Cover `--area`, `--pathway`, `--viewport`, `--no-build` and passthrough
    - _Requirements: 35.3_

  - [x] 7.22 MANUAL (user): provision the Stripe test fixture accounts
    - User runs `npm run audit:stripe-fixtures` once with the TEST keys in `.env.local`, finishes each AU and US account's hosted onboarding in test mode, and pastes the printed ids into `tests/e2e/audit/stripeFixtures.ts` (or gives them to the agent)
    - The agent does not run this script
    - _Requirements: 4.3, 13.15_

  - [x] 7.23 MANUAL (user): add the Supabase Auth redirect URL
    - User adds `http://localhost:3100/**` to Supabase Dashboard → Authentication → URL Configuration → Redirect URLs, so the Admin-generated reset and confirmation links work
    - _Requirements: 7.6, 7.7_

- [x] 8. Checkpoint: harness ready
  - Ask the user to run `npx vitest --run tests/property/e2eAudit tests/unit/e2eAudit`, confirm tasks 7.22 and 7.23 are done, then run `npm run audit -- --area guards` as a smoke run of the servers, forwarder, preflight and reporter. Ensure all tests pass, ask the user if questions arise.

- [x] 9. Cash-sale and trade lifecycle Pathways
  - [x] 9.1 Migrate `tests/e2e/specs/cash-sale.spec.ts` onto the DSL
    - Pathways for: Buy Now without a card (`BUYER_NO_PAYMENT_METHOD`); Buy Now reserving a SINGLE listing; a Multiple items request with line items (price is the sum of the lines, a replaced line voids both acceptances, shopfront copy); fulfilment-only changes keeping acceptances; delivery through a Ship24 signed fixture to `INSPECTION` with a 7-day deadline; `TRACKING_PREDATES_PAYMENT` and the flagged already-delivered number; in-person handover with a 24-hour window and `HANDOVER_TOO_EARLY`; accept to `COMPLETED`; the payout job (transfer or `PAYOUT_HELD`); auto-complete through `runCron` after `rewind`; cancel in `AGREEMENT` and the refusal after payment; the unfinished payment cancelled after a 30-minute rewind
    - Every Pathway creates its own listings and contracts, and pairs each `assertState` DB check with a UI check
    - _Requirements: 3.2, 6.7, 13.1, 13.2, 13.3, 13.4, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17, 13.18, 31.1, 34.2_

  - [x] 9.2 Create `tests/e2e/specs/cash-sale-payments.spec.ts`
    - Card without authentication (`copy: { fee }` and the shown total equal to the charged `amount_cents`); 3-D Secure pass and fail; decline; each offered bank rail in its region and currency (moved from `tests/e2e/stripe/bank-rails.stripe.ts`, with bindings replacing its patch and restore); `CARD_REPRICED`; `BUYER_IDENTITY_REQUIRED`; `SELLER_NOT_PAYABLE` on a cross-border sale; `RELATED_ACCOUNTS` (a shared card, no reason shown); `SELLER_EXPOSURE_LIMIT`; `REGION_MISMATCH`
    - _Requirements: 3.2, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.19, 13.20, 13.21, 31.3_

  - [x] 9.3 Migrate `tests/e2e/specs/trade.spec.ts` onto the DSL
    - Pathways for: negotiation and counter (changing cash, value or goods voids acceptances); a meeting edit clearing the other trader's acceptance; `TERMS_AGREED` with frozen side values; refusals for no card and for unverified identity; a cash leg paid buyer-present before the holds, with the FX disclosure; an unpaid `pay_by` abandoning the trade after a rewind; `COLLATERAL_LOCKED` with one notification and a live room update; a declined hold voiding the other with no fee; meeting proposals before the cutoff and the refusal after; handover to `INSPECTION` with the clamped 72-hour window; completion by acceptance and by the job, with holds voided in Stripe; the offering-side and `short-reservation` refusals and binder side value; abandonment when the meeting passes; `region-mismatch`
    - Collateral steps declare `copy: { collateral: true }`
    - _Requirements: 3.2, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 15.12, 15.13, 15.14, 31.2_

  - [x] 9.4 Migrate `tests/e2e/specs/journeys.spec.ts` with the two lifecycle journeys
    - `journeys.cash-sale-lifecycle` (list, buy, pay by card, ship, deliver, accept, payout) and `journeys.trade-lifecycle` (propose, agree, collateral, handover, accept, holds voided), each with one video per member
    - _Requirements: 29.3, 36.5_

  - [x] 9.5 Wire the Coverage_Map for cash sales, trades and the transaction models
    - Change the matching `coverage.ts` entries to `automated` with their happy and refusal Pathway ids, and add `supersededProbes` (`guards-probe`, `hold-probe`, `trade`, `trade-collateral`, `trade-views`, `terms-panel` where they apply)
    - _Requirements: 3.3, 5.1, 5.2_

- [ ] 10. Checkpoint: lifecycle areas
  - Ask the user to run `npm run audit -- --area cash-sale`, `--area trades` and `--area journeys`, and review the generated report. Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Dispute Pathways
  - [ ] 11.1 Create `tests/e2e/specs/cash-sale-disputes.spec.ts`
    - Raise from each eligible status with evidence upload and notification, then withdraw; `REFUND_BUYER` to `RETURN_PENDING` with the return address and the item still `RESERVED`; the return shipment through a Ship24 fixture to the 72-hour window, then an automatic Stripe test refund after a rewind and the job; a seller contest holding the refund; refusals for a duplicate or outbound tracking number; a lapsed return; an early fraud warning before and after shipment (signed fixture); a chargeback opened and won (signed fixture) with the `CHARGE_DISPUTE` hold
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [ ] 11.2 Create `tests/e2e/specs/trade-disputes.spec.ts`
    - Raise `HANDOVER_FAILED`, `CONDITION_DISPUTE` and `FRAUD_CLAIMED` with nothing captured; staff outcomes `UNFOUNDED`, `CONDITION`, `FRAUD` (ban and disbursement; `isolated`) and `NO_EXCHANGE`, verified in Stripe test mode; the `NO_EXCHANGE` refusal after `INSPECTION`; custody capture after a rewind into the margin and the trade-inspections job
    - _Requirements: 16.1, 16.2, 16.3, 16.4_

  - [ ] 11.3 Wire the Coverage_Map for disputes and returns
    - _Requirements: 5.1, 5.2_

- [ ] 12. Account Pathways
  - [ ] 12.1 Migrate `tests/e2e/specs/auth-and-navigation.spec.ts`
    - Sign-up provisioning; `DUPLICATE_ACCOUNT`; `INVALID_CREDENTIALS`; `EMAIL_NOT_CONFIRMED`; a banned account (`isolated`); an enumeration-safe reset; reset and confirm through Admin links; the rate limit on the aux server (`@aux`); a pre-hydration submit leaving no password in the URL; sign-out redirects
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 7.10_

  - [ ] 12.2 Migrate `tests/e2e/specs/onboarding.spec.ts`
    - The buyer path; the seller path with a Stripe Identity test verification and Connect test onboarding read back; spoofed return markers; browsing while incomplete; trading-only regions and the region lock; a missing profile re-provisioned with no driver text; the exits on every step
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ] 12.3 Migrate `tests/e2e/specs/profile-and-payouts.spec.ts`
    - Profile edits shown live; card save read back from Stripe; the three tabs, including owed and landed amounts after a completed sale; verified but not yet payable
    - _Requirements: 24.1, 24.2, 24.3, 24.4_

  - [ ] 12.4 Wire the Coverage_Map for auth, onboarding and profile
    - Add `supersededProbes` (`session` and any others that apply). Do not automate Google OAuth
    - _Requirements: 3.3, 5.1, 5.2, 5.6_

- [ ] 13. Marketplace Pathways
  - [ ] 13.1 Migrate `routes.spec.ts` and `us-region.spec.ts`, and create `catalog.spec.ts`
    - Every filter and sort; the `/listings` redirect; card-game-only pickers with no hidden or excluded items; region precedence with the guess disclosed; ISO codes for AUD, USD, EUR and GBP; pagination to the last page
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ] 13.2 Migrate `tests/e2e/specs/listings.spec.ts`
    - Create SINGLE and Multiple items listings; the title fallback; the Identity_Gate refusal; field and image-count validation; live preview and gallery actions; `item-in-live-trade`; closing a Multiple items listing with its contracts continuing; the non-owner edit refusal
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 31.1_

  - [ ] 13.3 Create `tests/e2e/specs/watchlist-sellers.spec.ts`
    - The watch toggle and count; the seller page; a guest routed to sign-in
    - _Requirements: 11.1, 11.2, 11.3_

  - [ ] 13.4 Migrate `tests/e2e/specs/offers.spec.ts`
    - Chain and counter; accept with a card; accept without a card (`buyer-needs-card`); decline and withdraw with consistent Active and Past lists; refusals for Multiple items, a second pending offer and the wrong party
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [ ] 13.5 Migrate `tests/e2e/specs/private-deal.spec.ts`
    - Each invite kind with preview, link and host page; a signed-out draft with photos restored after sign-in; claim; quick onboarding; the self-open redirect and the self-join refusal; revoked, expired (rewind) and cross-region refusals; the Pay disclosure and in-room card; pending invites listed
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8_

  - [ ] 13.6 Wire the Coverage_Map for marketplace areas
    - Add `supersededProbes` (`watchlist-save`, `catalog-card-click`, `places`, `deal-open`, `header-and-edit`, `owner-slot-error` where they apply)
    - _Requirements: 3.3, 5.1, 5.2_

- [ ] 14. Community Pathways
  - [ ] 14.1 Migrate `tests/e2e/specs/messages.spec.ts`
    - Messaging from a listing; live delivery to the thread and inbox; an attachment-only message and the 4000-character refusal; the pane staying mounted; the unread count with no bell notification; an off-platform lure delivered and flagged
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [ ] 14.2 Migrate `tests/e2e/specs/notifications.spec.ts`
    - The live bell count; mark all read, live and after a reload
    - _Requirements: 19.1, 19.2_

  - [ ] 14.3 Create `tests/e2e/specs/reviews-reports.spec.ts`
    - A review after completion; refusals for a duplicate, an uncompleted contract and more than 1000 characters; a report reaching the admin queue with no notification to the target
    - _Requirements: 20.1, 20.2, 20.3_

  - [ ] 14.4 Create `tests/e2e/specs/scam-reports.spec.ts`
    - A submission with evidence; refusals for an unverified member and a fourth report in 30 days; a corroborated cluster seen by staff with nothing shown to the reporter; the notice and the member's response; the two-admin ban (`isolated`)
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

  - [ ] 14.5 Create `tests/e2e/specs/trusted-sellers.spec.ts`
    - Apply; approve, decline and revoke with badge and directory checks; the refusal for an unverified member; directory search and sort with no surname shown; a guest sign-up returning to apply with the intent step skipped
    - _Requirements: 22.1, 22.2, 22.3, 22.4, 22.5_

  - [ ] 14.6 Create `tests/e2e/specs/references.spec.ts`
    - A live reference and the people tally; the refusal with no sentiment; search and the "which one?" chooser; a screenshot claim, its approval and release; `noindex`; `GET /api/references/graph`; the published profile line's label, with no draft shown
    - _Requirements: 23.1, 23.2, 23.3, 23.4, 23.5, 23.6, 23.7_

  - [ ] 14.7 Wire the Coverage_Map for community areas
    - Add `supersededProbes` (`phone-message-send`, `inbox-pane-seam` where they apply)
    - _Requirements: 3.3, 5.1, 5.2_

- [ ] 15. Operations, guards and surfaces Pathways
  - [ ] 15.1 Migrate `tests/e2e/specs/admin.spec.ts`
    - Refusals for a non-staff member; support access to arbitration and refusal from admin tabs; assign, note and resolve a case; two-person proposals with same-person self-approval refused inside 24 h and a second approver applying them; each listed admin action
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5_

  - [ ] 15.2 Create `tests/e2e/specs/jobs-webhooks.spec.ts`
    - Job endpoints with a correct, missing and wrong bearer; a forwarded Stripe test event producing a `webhook_logs` row and its state change; the invalid-signature refusal with no state change; a duplicate delivery applied once; Ship24 setting `carrier_delivered_at` only on `DELIVERED`
    - _Requirements: 26.1, 26.2, 26.5, 26.6, 26.7, 26.8_

  - [ ] 15.3 Create `tests/e2e/specs/marketing-errors.spec.ts`
    - Public pages with a heading and no console errors; not-found; the error screen reference and "Report this problem"; the `/api/errors` anonymous no-`Origin` refusal
    - _Requirements: 27.1, 27.2, 27.3, 27.4_

  - [ ] 15.4 Migrate `tests/e2e/specs/guards.spec.ts`
    - Every protected prefix redirecting with a return path; non-party contract rooms refused with no detail shown; mobile API without a bearer refused; no demo panel when demo is disabled
    - _Requirements: 28.1, 28.2, 28.3, 28.4_

  - [ ] 15.5 Create `tests/e2e/specs/surfaces.spec.ts`
    - Read-only Pathways over the surface list from `specs/screenshots.spec.ts` and the soft-navigation measurements from `specs/layout-shift.spec.ts`, with the UX and copy checks on every step at both viewports
    - _Requirements: 29.1, 29.4, 30.1, 30.2, 30.3, 30.4, 30.5, 30.6, 31.4, 31.5_

  - [ ] 15.6 Wire the Coverage_Map for operations and finish it
    - No entry may still carry the "pending migration" reason
    - Add `supersededProbes` (`horizontal-overflow.probe`, `demo-tab` and any others). If 7.9 was declined, record the accessibility check as `not-automated` with that reason
    - _Requirements: 3.3, 5.1, 5.2, 5.4, 5.5_

- [ ] 16. Checkpoint: all areas
  - Ask the user to run `npx vitest --run tests/unit/e2eAudit` and then `npm run audit`. Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Audit_Report
  - [ ] 17.1 Implement `scripts/e2e/audit-report.ts` and the `audit:report` script
    - Read the newest manifest, the Coverage_Map and `.pathways.json`; call `aggregateRun`; copy media from `audit-artifacts/` into `audit-report/media/`, refusing any `isForbiddenArtifact` path; write `index.html`, `pathways/<id>.html` and `data.js` (`window.__AUDIT__`, loaded by `<script src>` so the report opens from `file://`), with plain-JS filters over `data-*`
    - Run `findLeaks` over every text file before publishing, and fail naming the file and the variable
    - Write `findings-draft.md` numbered from `nextFindingNumber`. Never edit `FINDINGS.md`
    - Delete only the directories `supersededRuns` names
    - _Requirements: 3.5, 4.7, 5.3, 5.6, 29.6, 32.3, 32.4, 33.1, 33.2, 33.3, 33.4, 33.5, 33.6, 33.7_

  - [ ] 17.2 Add `audit:pack`
    - Zip `audit-report/`, refusing forbidden paths
    - _Requirements: 32.4_

  - [ ] 17.3 Add `--compare-isolated <area>` to `scripts/e2e/audit.mjs`
    - Run each spec of the area alone, compare with the newest full run, and write the differences for the report
    - _Requirements: 34.1_

  - [ ]* 17.4 Write unit tests for report generation
    - Refusal on a leaked value; exclusion of forbidden paths; not-run marking; the findings draft format
    - _Requirements: 32.3, 32.4, 33.6, 3.5_

- [ ] 18. Retire superseded specs, configs and probes
  - [ ] 18.1 Retire the old specs, configs and scripts
    - Delete `specs/screenshots.spec.ts`, `specs/layout-shift.spec.ts`, `tests/e2e/stripe/bank-rails.stripe.ts`, `playwright.stripe.config.ts` and `scripts/e2e/run-prod.mjs`. Remove the `test:e2e:prod`, `test:e2e:stripe` and `ux-review:capture` scripts, and keep `test:e2e` and `test:e2e:desktop`
    - Ask the user to confirm the replacement Pathways passed in the task 16 run before deleting
    - _Requirements: 3.1, 3.2_

  - [ ] 18.2 Delete the superseded debug probes
    - Delete each `tests/e2e/debug/` probe named in `supersededProbes` whose replacing Pathway passed in the latest run. Keep `inspect`, `address-dom`, `address-hunt`, `canvas-*` and `yc-demo`. Keep `playwright.debug.config.ts`
    - _Requirements: 3.3_

  - [ ] 18.3 Update `tests/e2e/README.md`
    - In order: `npm run dev:db:reset` when the sandbox is stale, `npm run audit:stripe-fixtures` once, the Supabase redirect URL, `npm run audit`. Then the subset flags, `audit:report`, `audit:pack`, `audit:clean`, `audit:reel`. State that Playwright starts the servers and the webhook forwarder, and that `npm run dev` is never used
    - _Requirements: 4.5, 35.1, 35.2, 35.3_

- [ ] 19. Optional highlight reel
  - [ ] 19.1 Implement `tests/e2e/audit/highlights.ts`, `scripts/e2e/highlight-reel.ts` and `audit:reel`
    - The selection list opens with `journeys.cash-sale-lifecycle` and `journeys.trade-lifecycle`. The script reads the newest results, gets durations from `ffprobe`, calls `planReel`, and runs `ffmpeg` (trim, `drawtext` title, concat) into `audit-report/highlight-reel.mp4`. Without `ffmpeg` it prints the plan and exits 0. Nothing in `audit` depends on it
    - _Requirements: 36.1, 36.2, 36.3, 36.4, 36.5_

  - [ ]* 19.2 Write unit test for the selection list
    - The list starts with the two lifecycle Pathways, and every id exists in the Pathway universe
    - _Requirements: 36.5_

- [ ] 20. Final checkpoint
  - Ask the user to run `npm run test`, then `npm run audit` and optionally `npm run audit:reel`, and review the report. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- Tasks 7.9, 7.22 and 7.23 need the user. 7.9 is an approval gate. 7.22 and 7.23 are steps only the user can do.
- Task 1.8 keeps production's `/api/health` unchanged. If the user vetoes it, use the fallback described there.
- Area tasks add Pathways to specs. Each group's Coverage_Map task is the only task that edits `coverage.ts` in its wave.
- Defects the Pathways find go to `audit-report/findings-draft.md`. A maintainer moves real ones into `FINDINGS.md` (Req 3.5).
- Property tests live in `tests/property/e2eAudit/` with at least 100 runs each, tagged `// Feature: e2e-ux-audit-suite, Property <n>: <title>`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.10"] },
    { "id": 2, "tasks": ["1.9", "1.11"] },
    { "id": 3, "tasks": ["2"] },
    { "id": 4, "tasks": ["3.1", "3.9", "4.1", "4.5", "4.9", "4.14", "5.1", "5.6", "5.9"] },
    { "id": 5, "tasks": ["3.4", "3.2", "3.3", "3.10", "4.2", "4.3", "4.4", "4.6", "4.7", "4.8", "4.10", "4.11", "4.12", "4.13", "4.15", "5.2", "5.3", "5.4", "5.5", "5.7", "5.8", "5.10"] },
    { "id": 6, "tasks": ["3.5", "3.6", "3.7", "3.8"] },
    { "id": 7, "tasks": ["6"] },
    { "id": 8, "tasks": ["7.1", "7.2", "7.4", "7.5", "7.9", "7.10", "7.15"] },
    { "id": 9, "tasks": ["7.3", "7.6", "7.7", "7.8", "7.11", "7.16"] },
    { "id": 10, "tasks": ["7.12", "7.17"] },
    { "id": 11, "tasks": ["7.13", "7.18", "7.20"] },
    { "id": 12, "tasks": ["7.14", "7.19", "7.21", "7.22", "7.23"] },
    { "id": 13, "tasks": ["8"] },
    { "id": 14, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 15, "tasks": ["9.5"] },
    { "id": 16, "tasks": ["10"] },
    { "id": 17, "tasks": ["11.1", "11.2", "12.1", "12.2", "12.3", "13.1", "13.2", "13.3", "13.4", "13.5", "14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "15.1", "15.2", "15.3", "15.4", "15.5"] },
    { "id": 18, "tasks": ["11.3"] },
    { "id": 19, "tasks": ["12.4"] },
    { "id": 20, "tasks": ["13.6"] },
    { "id": 21, "tasks": ["14.7"] },
    { "id": 22, "tasks": ["15.6"] },
    { "id": 23, "tasks": ["16"] },
    { "id": 24, "tasks": ["17.1", "17.3"] },
    { "id": 25, "tasks": ["17.2", "17.4"] },
    { "id": 26, "tasks": ["18.1", "18.2", "18.3"] },
    { "id": 27, "tasks": ["19.1"] },
    { "id": 28, "tasks": ["19.2"] },
    { "id": 29, "tasks": ["20"] }
  ]
}
```
