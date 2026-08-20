# Implementation Plan: unified-seller-onboarding

## Overview

Replace the two provider-hosted redirects (Stripe Identity hosted session, then a
Connect account-link form) with ONE NoDitto page hosting both steps inline. The work
lands in the design's staged order so the sharpest-risk changes settle first and each
step builds on the last:

1. Seam types (`domain/services/types.ts`) — transient verified DOB/address on
   `IdentityCheck`, transient `prefill` on `ManagedMerchantDetails`, the two optional
   mint methods, `EmbeddedClientSecret`. Verified with `npx tsc --noEmit`.
2. Stripe binding (`StripeService.ts`) — `readIdentityCheck` expand, prefill →
   `identity.individual` mapping, `createConnectAccountSession`,
   `createIdentitySessionSecret`.
3. Mock + InMemory updated in the SAME pass so no Stripe types leak into callers.
4. Server actions (`beginEmbeddedIdentity`, `beginEmbeddedPayout`; read-backs
   unchanged; hosted paths KEPT as fallback).
5. Browser components (`UnifiedOnboardingSurface`, `EmbeddedIdentityStep`,
   `EmbeddedPayoutStep`, `ProviderFallbackStep`).
6. Wiring (`app/onboarding` route, `PayoutOnboarding` refactor).

The Stripe server SDK stays boxed in `domain/services/stripe/**`. Only the verified
NAME is persisted; DOB/address travel transiently as prefill and are never persisted,
logged, or returned to a client. The two gates stay independent. Hosted-redirect paths
are retained as the provider fallback, never retired.

## Tasks

- [ ] 1. Extend the payment seam with embedded-onboarding contract
  - [ ] 1.1 Add transient fields, mint methods, and `EmbeddedClientSecret` to `domain/services/types.ts`
    - Add `verifiedDob` and `verifiedAddress` to `IdentityCheck`, each `?`/nullable and JSDoc-marked TRANSIENT, SERVER-ONLY (never persisted/logged/returned)
    - Add the transient `prefill` sub-object (`firstName`, `lastName`, `dob`, `address`) to `ManagedMerchantDetails` only — do NOT widen `MerchantRecord` or any persisted `MerchantUpdate`, so "never persisted" stays a structural fact
    - Add `EmbeddedClientSecret` (`clientSecret`, `publishableKey`, optional `expiresAt`)
    - Add optional `createIdentitySessionSecret?(sessionId): Promise<EmbeddedClientSecret>` to `IdentityService` and optional `createConnectAccountSession?(merchantRef): Promise<EmbeddedClientSecret>` to `PaymentService`; keep both optional so `PaymentService`-only fakes and non-embedded providers compile (undefined = fallback signal)
    - _Requirements: 2.1, 4.1, 4.3, 5.1, 7.1, 7.4, 9.3_

  - [ ] 1.2 Verify the seam types against the installed SDK
    - Run `npx tsc --noEmit` after the `types.ts` edit (editor diagnostics are not sufficient; the SDK ships types under `node_modules/stripe/esm/`)
    - Confirm `verified_outputs.dob`/`.address`, `identity.individual.*` and `accountSessions.create` field paths resolve
    - _Requirements: 7.1, 7.4_

- [ ] 2. Implement the Stripe binding changes (boxed in `domain/services/stripe/**`)
  - [ ] 2.1 Expand `verified_outputs` and project transient DOB/address in `StripeService.readIdentityCheck`
    - Add `expand: ['verified_outputs']` to `verificationSessions.retrieve`
    - Extend `toIdentityCheck` to project `verified_outputs.dob` (`{day,month,year}`) and `.address` onto the transient fields, guarded to `outcome === 'VERIFIED'` (matching the name)
    - Extract the `fromV2Account` capability projection into a pure, exportable helper (no SDK import) so Property 5 can be tested in the Node `domain` project
    - _Requirements: 2.5, 3.1, 3.2, 4.1_

  - [ ]* 2.2 Write property test for the prefill builder
    - **Property 9: Prefill is built from verified outputs**
    - **Validates: Requirements 4.1, 4.6**
    - fast-check, `tests/property/**`, ≥100 iterations; tag `Feature: unified-seller-onboarding, Property 9`

  - [ ] 2.3 Map `prefill` onto `identity.individual` in `StripeService.createManagedMerchant`
    - Add `identity.individual` from `details.prefill` via a pure builder/mapper (`given_name`, `surname`, `date_of_birth`, `address`), pruning absent fields so Stripe collects them (Req 4.6)
    - Do NOT fold `prefill` into the idempotency-key `fingerprint(body)` in a way that deadlocks a retry, and do NOT write it to the `metadata` block (metadata is persisted/readable at Stripe)
    - Keep existing metadata (profile id, stated/trading name) unchanged
    - _Requirements: 4.2, 4.3, 4.4, 4.6, 12.3_

  - [ ]* 2.4 Write property test for the prefill mapper
    - **Property 10: Prefill projects onto `identity.individual`**
    - **Validates: Requirements 4.2, 4.6**

  - [ ] 2.5 Implement `createConnectAccountSession` (embedded onboarding)
    - `accountSessions.create({ account: merchantRef, components: { account_onboarding: { enabled: true } } })`; return `{ clientSecret, publishableKey, expiresAt }`; throw if the publishable key is missing
    - Confirm the account shell is created via Accounts v2 with a `recipient` config requesting `stripe_transfers` (unchanged create path)
    - _Requirements: 5.1, 5.2, 5.5, 7.5_

  - [ ] 2.6 Implement `createIdentitySessionSecret` (embedded modal)
    - Retrieve the session and return only `{ clientSecret, publishableKey }`; throw when `client_secret` is absent (a consumed/terminal session), which is the "mint fresh on retry" contract
    - Do not widen the always-returned `IdentityCheck` with the sensitive secret
    - _Requirements: 2.1, 2.2, 7.1, 7.5, 13.4_

  - [ ]* 2.7 Write property test for the connected-account projection
    - **Property 5: Settlements-enabled iff transfers active** (pure `fromV2Account` projection)
    - **Validates: Requirements 6.2**

  - [ ]* 2.8 Write example tests for the binding wiring
    - `readIdentityCheck` includes `verified_outputs` in its expand; the v2 account body requests `recipient` + `stripe_transfers`; `createConnectAccountSession`/`createIdentitySessionSecret` return a secret against a fake
    - _Requirements: 2.5, 3.2, 5.5_

- [ ] 3. Update Mock and InMemory services in the same pass (no leaked Stripe types)
  - [ ] 3.1 Update `domain/services/mock/MockService.ts`
    - Leave `createConnectAccountSession`/`createIdentitySessionSecret` UNDEFINED so the fallback path is the default local experience; drive the gates through the existing seam methods
    - Have `readIdentityCheck` return `verifiedDob`/`verifiedAddress` as `null` (Mock has no document), exercising the prefill-omits-absent-field path (Req 4.6)
    - _Requirements: 7.4, 10.2, 10.3, 4.6_

  - [ ] 3.2 Update `domain/services/testing/InMemoryService.ts`
    - Implement the new seam surface consistently for unit tests (deterministic secrets where a test needs the embedded path; nullable transient fields otherwise)
    - _Requirements: 7.4_

  - [ ]* 3.3 Write unit tests for Mock/InMemory seam conformance
    - Assert both satisfy the updated interface and that the Mock signals fallback (mint methods undefined)
    - _Requirements: 7.4, 10.1_

- [ ] 4. Checkpoint - seam and binding complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement the server actions (thin; gate state untouched on any failure)
  - [ ] 5.1 Add `beginEmbeddedIdentity` to `lib/actions/identity.ts`
    - Resume/create the session (persist PENDING as today), then call `createIdentitySessionSecret`; return `{ clientSecret, publishableKey, sessionId }`
    - Return `NOT_SUPPORTED` when the binding lacks `createIdentitySessionSecret` (surface falls back); on any provider failure return an error and leave `identity_check_status` unchanged
    - Keep `beginIdentityCheck` (hosted) as fallback — do NOT delete; `refreshIdentityCheck` read-back unchanged (writes `identity_check_name` monotonically, never DOB/address)
    - _Requirements: 2.1, 2.5, 2.6, 3.1, 3.3, 3.4, 7.1, 10.1, 13.1, 13.4_

  - [ ] 5.2 Add `beginEmbeddedPayout` to `lib/actions/merchant.ts`
    - Ensure the account shell exists (reuse `submitMerchantOnboarding` with `buyerDisclosureConsent: true`), build the `Prefill_Object` from a fresh server-only `readIdentityCheck`, pass it to `createManagedMerchant`, then mint via `createConnectAccountSession`; return only `{ clientSecret, publishableKey }` (structurally cannot leak DOB/address)
    - Refuse when trading region is absent/non-tradeable (Req 12.2); refuse a region move once `merchant_ref` exists via `setTradingRegion` unchanged (Req 12.4)
    - Keep `createPayoutOnboardingLink`/`startIdentityVerification` as fallback; `refreshPayoutStatus` read-back unchanged
    - _Requirements: 4.1, 4.2, 4.5, 4.7, 5.1, 6.1, 6.2, 7.1, 7.5, 10.1, 12.1, 12.2, 12.3, 12.4, 13.5_

  - [ ]* 5.3 Write property test for failure atomicity across both actions
    - **Property 1: Provider failure leaves both gate statuses unchanged**
    - **Validates: Requirements 2.6, 13.1, 13.5**

  - [ ]* 5.4 Write property test for client-secret key hygiene
    - **Property 11: Client secrets never carry secret keys**
    - **Validates: Requirements 7.5**

  - [ ]* 5.5 Write property test for region refusal
    - **Property 13: Non-operational region refuses payout account creation**
    - **Validates: Requirements 12.2**

  - [ ]* 5.6 Write property test for region freeze
    - **Property 14: Trading region is frozen once a payout account exists**
    - **Validates: Requirements 12.4**

  - [ ]* 5.7 Write property test for monotonic name persistence
    - **Property 2: The verified name is written monotonically**
    - **Validates: Requirements 3.3, 3.6, 9.2**

  - [ ]* 5.8 Write integration tests for the read-back paths
    - `refreshIdentityCheck`/`refreshPayoutStatus` exercised with 1–2 representative fakes (provider wiring, not input-varying logic); read-back is the reliable path, webhook the backstop
    - _Requirements: 3.1, 3.5, 6.1, 6.3, 6.4_

- [ ] 6. Property tests for the preserved gate invariants (pure functions)
  - [ ]* 6.1 Write property test for gate independence
    - **Property 3: The two gates are independent** (`satisfiesIdentityGate` depends only on `identity_check_status`)
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [ ]* 6.2 Write property test for Connect-column absence in gate expressions
    - **Property 4: No Connect column appears in a gate expression** (keep the existing `tests/property/identityGate.test.ts` guard green)
    - **Validates: Requirements 8.1, 8.2**

  - [ ]* 6.3 Write property test for APPROVED derivation
    - **Property 6: APPROVED implies settlements active** (`deriveMerchantStatus`)
    - **Validates: Requirements 5.6, 6.5**

  - [ ]* 6.4 Write property test for fresh-account status
    - **Property 7: A freshly created account is never APPROVED**
    - **Validates: Requirements 5.6**

  - [ ]* 6.5 Write property test for payout composition
    - **Property 8: `canReceiveFunds` composition**
    - **Validates: Requirements 8.5, 8.6**

  - [ ]* 6.6 Write property test for seller disclosure
    - **Property 12: The seller disclosure exposes the legal name only** (`sellerIdentityDisclosure`)
    - **Validates: Requirements 9.5, 9.6, 11.3, 11.4**

- [ ] 7. Checkpoint - server actions and invariants complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Install browser onboarding dependencies
  - [ ] 8.1 Add `@stripe/connect-js` and `@stripe/react-connect-js`
    - Browser-only deps; `@stripe/stripe-js` (`9.12.1`) and `@stripe/react-stripe-js` (`6.8.0`) already present; server SDK `stripe@22.4.0` unchanged
    - Pin to explicit versions per repo convention; no new env variables (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY[_REGION]` already exists)
    - Note: although listed last in the request narrative, this precedes the browser components because they import these packages
    - _Requirements: 5.2, 7.3_

- [ ] 9. Build the browser components (`components/onboarding/**`, browser SDKs only)
  - [ ] 9.1 Implement `UnifiedOnboardingSurface.tsx`
    - `'use client'`; orchestrate both steps, render independent completion state, present Identity before Payout, never navigate to a stripe.com host; resume each step from a read-back on mount / return marker
    - Carry over the buyer-disclosure consent from the prior flow (name only); no confirm/edit screen for prefilled fields
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.7, 11.1, 11.2, 11.3, 13.2, 13.3_

  - [ ] 9.2 Implement `EmbeddedIdentityStep.tsx`
    - Call `beginEmbeddedIdentity`, load Stripe.js with the publishable key, invoke `stripe.verifyIdentity(clientSecret)`; on resolve/dismiss call `refreshIdentityCheck`
    - Document/selfie collected only inside Stripe-owned iframes; server never receives images or document numbers
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 7.3, 13.1_

  - [ ] 9.3 Implement `EmbeddedPayoutStep.tsx`
    - Call `beginEmbeddedPayout`, `loadConnectAndInitialize({ publishableKey, fetchClientSecret })`, render `<ConnectAccountOnboarding onExit={...}>`; on exit call `refreshPayoutStatus`
    - Bank/compliance details collected only inside Stripe-owned iframes; server never receives bank account numbers
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 7.3, 13.1_

  - [ ] 9.4 Implement `ProviderFallbackStep.tsx`
    - Rendered when the mint action returns `NOT_SUPPORTED`; drive the hosted/mock flow through the existing seam methods and state which step is embedded-unavailable and why; never render an empty embedded component
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 9.5 Write component tests for the surface and fallback
    - Renders both steps with independent state, no stripe.com redirect, no prefill confirm screen; fallback renders for a non-embedded provider; Mock drives the deterministic flow
    - _Requirements: 1.2, 1.5, 4.7, 10.1, 10.4_

- [ ] 10. Wire the surface into the app and refactor the payout card
  - [ ] 10.1 Route `app/onboarding/page.tsx` to the unified surface
    - Seller "intent" branch stops redirecting to a hosted Identity URL and mounts `UnifiedOnboardingSurface`; retain welcome/username/region/buyer-card steps
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ] 10.2 Refactor `components/profile/PayoutOnboarding.tsx`
    - Prefer the embedded payout path; demote its hosted-redirect action to the fallback path invoked by `ProviderFallbackStep`; retain the compact "payout destination" card for `/profile/payouts`
    - _Requirements: 1.6, 5.1, 6.1, 10.1_

- [ ] 11. Structural guards (keep boxed-SDK and data-handling invariants honest)
  - [ ]* 11.1 Guard: Stripe server SDK imported only under `domain/services/stripe/**` (+ `lib/webhook/webhookPipeline.ts`)
    - _Requirements: 7.2_

  - [ ]* 11.2 Guard: no DOB/address/document/bank column or field on any persisted model or action return type
    - Assert the `mobileDomainAgreement` refused-vocabulary set and the seam DTOs keep the transient fields off persisted shapes
    - _Requirements: 4.3, 4.4, 4.5, 9.1, 9.3, 9.4_

  - [ ]* 11.3 Guard: `mobileDomainAgreement` stays consistent with the updated seam
    - Run `npx vitest --run tests/unit/mobileDomainAgreement.test.ts` and reconcile any drift after the `types.ts` change
    - _Requirements: 14.1, 14.2, 14.3_

- [ ] 12. Final checkpoint - ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests and structural guards) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements/properties for traceability; property-test sub-tasks name the exact design property and the requirements clause it validates.
- Property tests use `fast-check` in the Node `domain` project (`tests/property/**`, ≥100 iterations) and target only pure functions (`satisfiesIdentityGate`, `deriveMerchantStatus`, `canReceiveFunds`, the extracted `fromV2Account` projection, the prefill builder/mapper, `sellerIdentityDisclosure`) so they run without a database or provider.
- Read-backs (`refreshIdentityCheck`/`refreshPayoutStatus`) are unchanged and remain the reliable path; the webhook is the backstop only.
- Hosted-redirect paths (`beginIdentityCheck`, `createPayoutOnboardingLink`/`startIdentityVerification`, `hostedUrl`, account links) are KEPT as the provider fallback — never retired — because Req 10 requires a defined fallback and the Mock has no embedded components.
- Run `npx tsc --noEmit` after task 1.1 (the SDK ships types under `node_modules/stripe/esm/`; editor diagnostics have been observed passing where `tsc` fails). No schema migration is required.
- The dependency install (8.1) is scheduled ahead of the browser components because they import `@stripe/connect-js` / `@stripe/react-connect-js`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "8.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.3"] },
    { "id": 3, "tasks": ["2.5"] },
    { "id": 4, "tasks": ["2.6", "3.1", "3.2"] },
    { "id": 5, "tasks": ["2.2", "2.4", "2.7", "2.8", "3.3"] },
    { "id": 6, "tasks": ["5.1", "5.2"] },
    { "id": 7, "tasks": ["5.3", "5.4", "5.5", "5.6", "5.7", "5.8", "6.1", "6.2", "6.3", "6.4", "6.5", "6.6"] },
    { "id": 8, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 9, "tasks": ["9.5", "10.1", "10.2"] },
    { "id": 10, "tasks": ["11.1", "11.2", "11.3"] }
  ]
}
```
