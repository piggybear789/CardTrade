# Requirements Document

## Introduction

Today a seller becomes able to sell and get paid through two disconnected Stripe
journeys. First the **Identity_Gate**: a Stripe Identity document-plus-selfie check
run through a provider-hosted redirect, landing back on NoDitto once
`identity_check_status = 'VERIFIED'`. Then, separately, **Connect payout setup**: a
provider-hosted account-link form that re-asks the seller's legal name, date of birth
and address — data Stripe Identity has already collected and verified — before
`merchant_status = APPROVED` and `merchant_settlements_enabled` unlock
`canReceiveFunds`.

The seller experiences this as two visits to Stripe-owned pages, a bounce back to
NoDitto in between, and a second form that appears to have forgotten who they are. The
re-collection is not just friction: it invites a mismatch between the name a government
document proved and the name the payout form captured.

This spec replaces both hosted redirects with **ONE unified onboarding surface on a
single NoDitto page**. The Identity step renders inline via Stripe.js
(`stripe.verifyIdentity` with a client secret); the Connect step renders inline via
Connect embedded onboarding (`@stripe/connect-js` account sessions). Sensitive data —
document images, selfie, date of birth, address, bank details — still lives only inside
Stripe-owned iframes and never reaches the NoDitto server. Verified outputs from the
Identity step (name, DOB, address) prefill the Connect account **silently and
server-side**, so the seller is never asked again for what Stripe already holds.

### The facts that shape every decision below

**The two-gate model is not being merged.** This spec unifies the *user interface*, not
the two gates behind it. `identity_check_status = VERIFIED` gates listing, selling and
trade access and is evaluated ONLY through `domain/identity/identityGate.ts`.
`merchant_status = APPROVED` together with `merchant_settlements_enabled` gates payouts
via `canReceiveFunds`. The two remain independent in both directions: a member may hold
either without the other, and a verified member with no payout account is a normal,
valid state. `tests/property/identityGate.test.ts` throws if a Connect column
(`merchant_status`, `merchant_settlements_enabled`) ever appears in a gate expression,
and that guard stays true after this change.

**Prefill reintroduces DOB and address onto the seam, and that is the sharpest risk
here.** Only the verified NAME is persisted (`identity_check_name`, written
monotonically absent→present). Date of birth and address are read from the Identity
session and passed straight to Stripe as a transient, provider-sourced `prefill`
sub-object — never persisted, never logged, never returned to any client component.

**The Stripe server SDK stays boxed.** Client secrets for both the Identity session and
the Connect account session are minted server-side inside `domain/services/stripe/**`
and exposed through new seam methods. Embedded components consume browser SDKs
(`@stripe/stripe-js`, `@stripe/connect-js`) plus the publishable key. `MockService` and
`InMemoryService` are updated in the same pass so nothing depends on Stripe types
leaking into callers.

**Read-back is the reliable path; the webhook is the backstop.** For both Identity and
Connect, the authoritative "did this step finish" signal is the server read-back
(`refreshIdentityCheck` / `refreshPayoutStatus`), performed on every return from the
embedded step. The webhook reconciles as a backstop. `readIdentityCheck` must expand
`verified_outputs`, or the document-backed name and prefill are silently null.

**Provider fallback is required, not optional.** `MockService` and any non-Stripe
provider have no embedded components. The unified surface must degrade to a defined
fallback rather than rendering an empty step.

---

## Glossary

- **Unified_Onboarding_Surface**: the single NoDitto page that hosts both the identity
  step and the payout step inline, without redirecting to any Stripe-hosted page.
- **Identity_Step**: the embedded Stripe Identity verification rendered via
  `stripe.verifyIdentity` using a server-minted Identity session client secret.
- **Payout_Step**: the embedded Stripe Connect onboarding rendered via
  `@stripe/connect-js` using a server-minted Connect account session client secret.
- **Identity_Gate**: the predicate `identity_check_status = 'VERIFIED'`, evaluated only
  through `domain/identity/identityGate.ts`. Gates listing, selling, trade access and
  being a disclosed seller.
- **Payout_Gate**: `merchant_status = 'APPROVED'` and `merchant_settlements_enabled`,
  which feeds `canReceiveFunds`. Gates payout attempts only.
- **Verified_Outputs**: the document-verified fields returned by Stripe Identity
  (`first_name`, `last_name`, date of birth, address) after `readIdentityCheck` expands
  them.
- **Identity_Disclosure_Name**: `identity_check_name`, the only identity value
  persisted from Verified_Outputs, written monotonically absent→present.
- **Prefill_Object**: a transient, provider-sourced sub-object carrying name, date of
  birth and address from the Identity session to Stripe Connect account creation. Never
  persisted, never logged, never returned to a client component.
- **Client_Secret**: a short-lived credential (Identity session secret or Connect
  account session secret) minted server-side and passed to a browser SDK to render an
  embedded component.
- **Payment_Seam**: the `PaymentKycService` / `IdentityService` interfaces in
  `domain/services/types.ts` that all callers depend on. Concrete binding chosen only
  in `getPaymentService()`.
- **Embedded_Provider**: a payment provider that supplies embedded onboarding
  components (Stripe). A non-embedded provider (Mock) does not.
- **Seller**: an authenticated member completing onboarding to list, sell and receive
  funds.

---

## Requirements

### Requirement 1: The unified onboarding surface

**User Story:** As a Seller, I want a single NoDitto onboarding page that walks me
through identity and payout setup inline, so that I never bounce between Stripe-hosted
pages or re-enter details I have already provided.

#### Acceptance Criteria

1. THE Unified_Onboarding_Surface SHALL render the Identity_Step and the Payout_Step
   within one NoDitto page.
2. WHILE onboarding is in progress, THE Unified_Onboarding_Surface SHALL NOT redirect
   the Seller to any Stripe-hosted onboarding page.
3. THE Unified_Onboarding_Surface SHALL present the Identity_Step before the
   Payout_Step.
4. WHEN the Seller has satisfied the Identity_Gate, THE Unified_Onboarding_Surface
   SHALL present the Payout_Step without requiring the Seller to re-enter name, date of
   birth, or address that Stripe Identity already verified.
5. THE Unified_Onboarding_Surface SHALL display the current completion state of the
   Identity_Step and the Payout_Step independently.
6. WHERE the Seller has satisfied the Identity_Gate but not the Payout_Gate, THE
   Unified_Onboarding_Surface SHALL allow the Seller to leave and later resume at the
   Payout_Step.

### Requirement 2: Embedded identity step

**User Story:** As a Seller, I want to complete identity verification inline on NoDitto,
so that my document and selfie stay inside Stripe and I am not redirected away.

#### Acceptance Criteria

1. WHEN the Seller begins the Identity_Step, THE Payment_Seam SHALL mint an Identity
   session Client_Secret server-side.
2. THE Identity_Step SHALL render via the browser Stripe SDK using the Identity session
   Client_Secret and the publishable key.
3. THE Identity_Step SHALL collect document images and the selfie only within
   Stripe-owned iframes.
4. THE NoDitto server SHALL NOT receive document images, selfie images, or document
   numbers from the Identity_Step.
5. WHEN the Seller completes or dismisses the embedded Identity_Step, THE
   Unified_Onboarding_Surface SHALL invoke the server read-back
   (`refreshIdentityCheck`) to determine the authoritative identity status.
6. IF the Identity session Client_Secret cannot be minted, THEN THE Payment_Seam SHALL
   surface an error result and leave `identity_check_status` unchanged.

### Requirement 3: Read-back and webhook reconciliation for identity

**User Story:** As a Seller, I want my verified status to reflect Stripe reliably, so
that I am not told the app is broken while waiting for a delayed event.

#### Acceptance Criteria

1. WHEN the Seller returns from the embedded Identity_Step, THE Payment_Seam SHALL read
   the Identity session back from the provider as the reliable status signal.
2. THE `readIdentityCheck` operation SHALL expand `verified_outputs` when reading the
   Identity session.
3. WHEN a verified name is present in Verified_Outputs, THE Payment_Seam SHALL persist
   `identity_check_name` only if `identity_check_name` is currently absent.
4. THE Payment_Seam SHALL persist `identity_check_name` only from the provider's own
   report.
5. WHEN an `identity.verification_session.*` webhook event is received, THE webhook
   pipeline SHALL reconcile identity status as a backstop to the read-back.
6. IF a webhook event carries no Verified_Outputs, THEN THE Payment_Seam SHALL leave an
   already-persisted `identity_check_name` unchanged.

### Requirement 4: Silent server-side prefill into Connect

**User Story:** As a Seller, I want the payout step to already know the name, date of
birth and address my document proved, so that I am not asked for them a second time.

#### Acceptance Criteria

1. WHEN the Payout_Step account is created, THE Payment_Seam SHALL read name, date of
   birth and address from the Identity session Verified_Outputs into a Prefill_Object.
2. THE Payment_Seam SHALL pass the Prefill_Object to Stripe as `identity.individual`
   fields at Connect account creation.
3. THE Payment_Seam SHALL NOT persist date of birth or address from the Prefill_Object
   to any NoDitto table.
4. THE Payment_Seam SHALL NOT log date of birth or address from the Prefill_Object.
5. THE Payment_Seam SHALL NOT return date of birth or address from the Prefill_Object
   to any client component.
6. WHERE a field required by the Payout_Step is absent from Verified_Outputs, THE
   Payout_Step SHALL collect that field normally within Stripe-owned iframes.
7. THE Unified_Onboarding_Surface SHALL NOT present a confirm-or-edit screen for
   prefilled fields.

### Requirement 5: Embedded payout (Connect) step

**User Story:** As a Seller, I want to set up my payout account inline on NoDitto, so
that my bank details stay inside Stripe and I complete onboarding without leaving the
page.

#### Acceptance Criteria

1. WHEN the Seller begins the Payout_Step, THE Payment_Seam SHALL mint a Connect
   account session Client_Secret server-side.
2. THE Payout_Step SHALL render via `@stripe/connect-js` using the Connect account
   session Client_Secret and the publishable key.
3. THE Payout_Step SHALL collect bank and any remaining compliance details only within
   Stripe-owned iframes.
4. THE NoDitto server SHALL NOT receive bank account numbers from the Payout_Step.
5. WHEN the Payout_Step account is created, THE Payment_Seam SHALL create it via
   Accounts v2 with a `recipient` configuration requesting `stripe_transfers`.
6. WHEN the account shell is created, THE Payment_Seam SHALL derive `merchant_status`
   as `PENDING` and SHALL NOT set it to `APPROVED` on creation.

### Requirement 6: Read-back and webhook reconciliation for payouts

**User Story:** As a Seller, I want my payout readiness to reflect Stripe reliably, so
that returning from the embedded step shows my true status.

#### Acceptance Criteria

1. WHEN the Seller returns from the embedded Payout_Step, THE Payment_Seam SHALL read
   the connected account back from the provider (`refreshPayoutStatus`) as the reliable
   status signal.
2. THE Payment_Seam SHALL set `merchant_settlements_enabled` only from
   `stripe_transfers.status === 'active'`.
3. WHEN a Connect account webhook event is received, THE webhook pipeline SHALL
   reconcile payout status as a backstop to the read-back.
4. THE Payout_Gate SHALL NOT depend on the webhook alone.
5. THE Payment_Seam SHALL NOT write `merchant_status` to `APPROVED` on any signal other
   than a provider read-back or reconciliation reporting settlements active.

### Requirement 7: Client-secret minting on the seam

**User Story:** As a developer, I want client secrets minted only server-side behind the
seam, so that the Stripe server SDK never leaks into browser or caller code.

#### Acceptance Criteria

1. THE Payment_Seam SHALL expose a method that mints the Identity session Client_Secret
   and a method that mints the Connect account session Client_Secret.
2. THE Stripe server SDK SHALL be imported only within `domain/services/stripe/**` and
   `lib/webhook/webhookPipeline.ts`.
3. THE embedded components SHALL use only the browser SDKs and the publishable key.
4. WHEN the Payment_Seam interface gains the new client-secret methods, THE MockService
   and THE InMemoryService SHALL implement the same methods in the same change.
5. THE Payment_Seam SHALL expose only the publishable key to client components and SHALL
   NOT expose any secret key.

### Requirement 8: Two independent gates preserved

**User Story:** As the platform, I want the identity gate and the payout gate to stay
independent behind the unified UI, so that unifying the interface does not couple the
two verification facts.

#### Acceptance Criteria

1. THE Identity_Gate SHALL be evaluated only through `domain/identity/identityGate.ts`.
2. THE Identity_Gate expression SHALL NOT reference `merchant_status` or
   `merchant_settlements_enabled`.
3. WHERE a Seller has satisfied the Identity_Gate but not the Payout_Gate, THE platform
   SHALL allow listing, selling and trade access.
4. WHERE a Seller has satisfied the Payout_Gate but not the Identity_Gate, THE platform
   SHALL refuse listing, selling and trade access.
5. WHEN a payout is attempted, THE platform SHALL evaluate readiness only through
   `canReceiveFunds`.
6. THE `canReceiveFunds` predicate SHALL require the Payout_Gate and a non-null
   `merchant_ref`.

### Requirement 9: Sensitive-data handling

**User Story:** As a Seller, I want my sensitive identity and financial data to stay
inside Stripe, so that NoDitto never stores or exposes it.

#### Acceptance Criteria

1. THE NoDitto server SHALL persist only the verified name (`identity_check_name`) from
   identity verification.
2. THE Payment_Seam SHALL write `identity_check_name` monotonically absent→present.
3. THE NoDitto server SHALL NOT persist date of birth, address, document numbers, or
   bank details from either onboarding step.
4. THE NoDitto server SHALL NOT log date of birth, address, document numbers, or bank
   details.
5. THE Seller disclosure exposed to buyers SHALL contain the verified legal name only.
6. THE Seller disclosure SHALL NOT expose merchant refs, contact details, address, date
   of birth, document numbers, or bank details.

### Requirement 10: Provider fallback

**User Story:** As a Seller in a non-Stripe environment, I want onboarding to degrade
gracefully, so that a provider without embedded components does not present a broken
page.

#### Acceptance Criteria

1. IF the active provider is not an Embedded_Provider, THEN THE
   Unified_Onboarding_Surface SHALL present a defined fallback for the affected step
   rather than an empty embedded component.
2. WHERE the provider is MockService, THE Unified_Onboarding_Surface SHALL drive
   onboarding through the deterministic mock flow.
3. THE fallback SHALL preserve the two-gate model, driving `identity_check_status` and
   `merchant_status` through the same seam methods as the embedded flow.
4. WHEN a step cannot render its embedded component, THE Unified_Onboarding_Surface
   SHALL inform the Seller which step is unavailable and why.

### Requirement 11: Buyer-disclosure consent

**User Story:** As a Seller, I want to consent to disclosing my verified legal name to
buyers, so that the disclosure is authorised and buyer-safe.

#### Acceptance Criteria

1. THE Unified_Onboarding_Surface SHALL present the buyer-disclosure consent carried
   over from the prior flow (Req 4.8–4.12).
2. WHEN the Seller provides buyer-disclosure consent, THE platform SHALL record the
   consent.
3. THE buyer-disclosure consent SHALL apply to the verified legal name only.
4. THE buyer-disclosure consent SHALL NOT authorise disclosure of address, date of
   birth, document numbers, or bank details.

### Requirement 12: Region, currency and idempotency carryover

**User Story:** As the platform, I want the unified flow to keep the existing region,
currency and idempotency rules, so that unifying the UI does not regress money-path
correctness.

#### Acceptance Criteria

1. THE Payment_Seam SHALL resolve the Stripe platform account, currency and account
   country from the Seller's trading region as the prior flow does.
2. IF the Seller's trading region is absent or non-tradeable, THEN THE
   Unified_Onboarding_Surface SHALL refuse to create the Payout_Step account.
3. THE Payment_Seam SHALL carry the existing idempotency keys for account creation and
   related writes unchanged.
4. WHEN `setTradingRegion` is attempted after a `merchant_ref` exists, THE platform
   SHALL refuse to move the trading region.

### Requirement 13: Error, retry and resume states

**User Story:** As a Seller, I want clear handling when a step fails or is interrupted,
so that I can retry or resume without losing progress or corrupting state.

#### Acceptance Criteria

1. IF minting a Client_Secret fails, THEN THE Unified_Onboarding_Surface SHALL present
   a retry action for the affected step and leave gate state unchanged.
2. IF the read-back reports a step incomplete, THEN THE Unified_Onboarding_Surface SHALL
   keep the Seller on that step and allow re-entry.
3. WHEN the Seller reloads or resumes the Unified_Onboarding_Surface, THE surface SHALL
   restore each step's state from the authoritative provider read-back.
4. THE Payment_Seam SHALL reuse a single-use Client_Secret no more than once and SHALL
   mint a fresh Client_Secret on each retry.
5. IF a provider call for either step fails, THEN THE Payment_Seam SHALL return an error
   result and SHALL leave both `identity_check_status` and `merchant_status` unchanged.

### Requirement 14: Mobile handoff

**User Story:** As a mobile Seller, I want onboarding to hand off to the web surface as
today, so that the seam contract stays consistent across clients.

#### Acceptance Criteria

1. WHERE onboarding is initiated from the Flutter client, THE platform SHALL hand off to
   the web Unified_Onboarding_Surface via the existing web-handoff mechanism.
2. WHEN the Payment_Seam contract changes, THE mobile domain agreement
   (`mobileDomainAgreement`) SHALL remain consistent with the updated seam.
3. THE Flutter client SHALL NOT collect document, selfie, or bank data natively for the
   unified flow.
