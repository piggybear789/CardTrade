# Implementation Plan: CardTrade

## Overview

This plan builds the CardTrade frontend-first MVP incrementally, starting from an empty workspace. It scaffolds the Next.js App Router project, provisions the Supabase schema, then builds the **pure domain core first** (state machine + validators, both property-tested) before any layer that depends on it. The service interface + deterministic MockService follow, then the orchestrators (tested against an in-memory fake), the webhook handler, thin server-action wrappers, and finally the UI — prioritizing the flagship listings catalog and real-time Trade Contract view. Payment/KYC/webhook behavior is entirely provided by the MockService; real Pinch integration is deferred.

Ordering rule honored throughout: the pure state machine and zod validators (with their property tests) are implemented and green before the orchestrators, server actions, webhook handler, or UI consume them.

## Tasks

- [x] 1. Scaffold Next.js App Router project and tooling
  - [x] 1.1 Initialize the Next.js App Router + TypeScript project
    - Create the project in `c:\dev\Marketplace` with Next.js App Router, TypeScript (strict), and the `app/`, `components/`, `domain/`, `lib/`, `supabase/`, `tests/` directory skeleton from the design's project structure
    - Configure `tsconfig.json` path aliases (`@/domain/*`, `@/lib/*`, `@/components/*`) and add base `app/layout.tsx` and a placeholder home page
    - Add `.env.local.example` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENTS_PROVIDER`, `WEBHOOK_SECRET`, `WEBHOOK_URL`
    - _Requirements: 3.8, 11.1_

  - [x] 1.2 Configure Tailwind CSS and shadcn/ui
    - Install and configure Tailwind, global stylesheet, and shadcn/ui with the base primitives used across the app (button, input, card, badge, dialog, form, select, textarea, toast/sonner)
    - Place primitives under `components/ui/`
    - _Requirements: 3.8, 11.1_

  - [x] 1.3 Set up test tooling (Vitest + fast-check + React Testing Library)
    - Configure Vitest with `jsdom` for component tests and a Node environment project for domain/property tests
    - Install and wire `fast-check` and `@testing-library/react` + `@testing-library/jest-dom`
    - Add `tests/unit`, `tests/property`, `tests/component` folders and a `test` script that runs once (`vitest --run`); add a trivial passing sanity test
    - _Requirements: 9.1_

  - [x] 1.4 Create the three Supabase clients
    - Implement `lib/supabase/browser.ts` (Client Components), `lib/supabase/server.ts` (cookie-bound Server Components/Actions), and `lib/supabase/admin.ts` (service-role, RLS-bypassing) per the design's three-client pattern
    - _Requirements: 1.7, 9.6, 10.1_

- [x] 2. Database schema, RLS, and seed data
  - [x] 2.1 Write migration for enums and tables
    - Create `supabase/migrations/0001_schema.sql` defining the enums (`kyc_status`, `item_status`, `trade_state`, `cash_sale_status`, `hold_status`, `webhook_outcome`) and tables (`profiles`, `items`, `trades`, `cash_sales`, `pre_auth_holds`, `trade_state_transitions`, `webhook_logs`) with the check constraints, foreign keys, `version` column, and monetary `bigint` cents columns from the design
    - _Requirements: 1.1, 3.1, 4.1, 5.1, 6.1, 9.5, 10.3_

  - [x] 2.2 Write migration for RLS policies
    - Create `supabase/migrations/0002_rls.sql` enabling RLS and adding the profile owner policies, item catalog/owner policies, trade participant-read policy, and webhook_logs no-access policy from the design
    - _Requirements: 1.6, 1.7, 3.7, 3.8, 9.6, 9.7_

  - [x] 2.3 Enable Realtime and add seed data
    - Add the `trades` and `pre_auth_holds` tables to the `supabase_realtime` publication in a migration
    - Create `supabase/seed.sql` with sample verified profiles, available items of equal FMV pairs (to exercise trades), and mixed-status items (to exercise catalog filtering)
    - _Requirements: 3.8, 11.2_

  - [x] 2.4 Generate database types
    - Generate TypeScript types from the Supabase schema into `lib/supabase/database.types.ts` and export a typed helper alias used by the clients
    - _Requirements: 1.1, 3.1, 5.1_

- [x] 3. Domain core — pure Trade State Machine (test-driven)
  - [x] 3.1 Implement state machine types and transition table
    - Create `domain/state-machine/types.ts` (`TradeState`, `TradeEvent`, `TERMINAL_STATES`, `TradeFacts`, `TradeViewerContext`, `TradeAction`) and `domain/state-machine/machine.ts` with the `TRANSITIONS` table, `canTransition`, and `transition` (returning `TransitionResult`) — no Supabase/React/service imports
    - _Requirements: 9.1, 9.2, 5.5, 6.2, 6.4, 6.6, 7.1, 8.1_

  - [ ]* 3.2 Write property test for transition integrity
    - **Property 1: Transition integrity**
    - **Validates: Requirements 9.1, 9.2, 5.5, 6.2, 6.4, 6.6, 7.1, 8.1**
    - Quantify over every `(state, event)` pair; assert success iff table-defined, error + unchanged state otherwise

  - [ ]* 3.3 Write property test for canonical lifecycle reachability
    - **Property 2: Canonical lifecycle reachability**
    - **Validates: Requirements 5.5, 6.2, 6.4, 6.6**
    - Use fast-check model-based (stateful) testing for the happy-path event sequence

  - [ ]* 3.4 Write property test for terminal states being absorbing
    - **Property 3: Terminal states are absorbing**
    - **Validates: Requirements 9.1**

  - [x] 3.5 Implement guards, deriveEvent, and availableActions
    - Create `domain/state-machine/guards.ts` (pure predicates over `TradeFacts` for shipped/received/accepted/holds, plus once-only checks) and `deriveEvent(state, facts)`, and `domain/state-machine/actions.ts` exporting `availableActions(state, viewer)`
    - _Requirements: 6.1, 6.3, 6.5, 6.8, 11.3, 11.4_

  - [ ]* 3.6 Write property test for once-only, state-guarded lifecycle actions
    - **Property 4: Lifecycle actions are once-only and state-guarded**
    - **Validates: Requirements 6.1, 6.3, 6.5, 6.8**

  - [ ]* 3.7 Write unit tests for availableActions mapping
    - Assert `availableActions` returns the correct control set per state/viewer and empty when none permitted (basis for Property 7 at the UI layer)
    - _Requirements: 11.3, 11.4_

- [x] 4. Domain core — validation schemas (test-driven)
  - [x] 4.1 Implement zod validation schemas
    - Create `domain/validation/` with schemas for registration credentials (email `local-part@domain`, password 8–128), profile update (required non-empty, text ≤255), and item submission (title 1–120, description 1–2000, category/condition present, FMV 1–99,999,999,999 cents, 1–10 images); each returns a discriminated `{ ok: false, field, message }` on failure
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.1, 3.2, 3.3_

  - [ ]* 4.2 Write property test for credential validation
    - **Property 10: Credential validation**
    - **Validates: Requirements 1.1, 1.3**

  - [ ]* 4.3 Write property test for profile update validation
    - **Property 11: Profile update validation preserves prior values on rejection**
    - **Validates: Requirements 1.4, 1.5**

  - [ ]* 4.4 Write property test for item validation
    - **Property 12: Item validation**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 5. Checkpoint — domain core green
  - Ensure all state machine and validation unit/property tests pass, ask the user if questions arise.

- [x] 6. Service layer — interface, MockService, factory
  - [x] 6.1 Define the PaymentService/KycService interface and types
    - Create `domain/services/types.ts` with `Cents`, `Payer`, `PreAuthHold`, `CaptureResult`, `TransferResult`, `KycResult`, `VerifiedIdentity`, `WebhookEvent`, `PaymentService`, `KycService`, and `WebhookEmitter`
    - _Requirements: 2.1, 2.2, 2.5, 4.2, 5.4, 7.2, 8.2, 8.4_

  - [x] 6.2 Implement the deterministic MockService
    - Create `domain/services/mock/MockService.ts` implementing `PaymentService`, `KycService`, and `WebhookEmitter`: deterministic outcomes driven by an explicit `scenario`/force-failure control (no randomness), payer creation, hold placement/void/partial+full capture, transfer, KYC verify, and verified-identity retrieval; enqueue/emit the corresponding `WebhookEvent` (auto timer or manual) and sign payloads with the shared secret using the real header contract
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 4.2, 4.3, 4.4, 5.4, 5.5, 5.6, 6.7, 7.2, 7.5, 8.2, 8.3, 8.5, 10.1_

  - [ ]* 6.3 Write unit tests for MockService determinism and webhook emission
    - Assert same inputs → same outputs, forced-failure scenarios, and that signed `WebhookEvent`s are emitted with the expected type/signature
    - _Requirements: 2.2, 2.3, 4.4, 5.6, 8.2, 10.1_

  - [x] 6.4 Implement the service factory and an in-memory fake
    - Create `domain/services/index.ts` with `getPaymentService()` selecting Mock vs future Pinch by `PAYMENTS_PROVIDER`, and add `domain/services/testing/InMemoryService.ts` implementing the same interface for fast orchestrator tests
    - _Requirements: 2.1, 4.2, 5.4_

- [x] 7. Orchestrators
  - [x] 7.1 Implement the guarded transition core of the trade orchestrator
    - Create `domain/orchestrator/tradeOrchestrator.ts` with `applyEvent`: load trade+version, validate via `transition()`, run payment side effects via the service interface, commit with optimistic version lock (`.eq('version', v)`), and insert an audit row; map losing writers to `CONCURRENT_MODIFICATION`
    - _Requirements: 9.2, 9.3, 9.4, 9.5_

  - [ ]* 7.2 Write property test for concurrent transitions
    - **Property 5: Concurrent transitions have exactly one winner**
    - **Validates: Requirements 9.3, 9.4**
    - Use the in-memory fake to simulate N attempts against the same version

  - [ ]* 7.3 Write property test for audit completeness
    - **Property 6: Audit completeness**
    - **Validates: Requirements 9.5**

  - [x] 7.4 Implement trade proposal, collateral, and hold sizing
    - Add trade proposal logic (equal-FMV-to-the-cent + both AVAILABLE guard, create trade `COLLATERAL_PENDING`, reserve items), pre-auth hold placement sized at 100% of each trader's FMV, and the KYC-VERIFIED gate; handle hold failure/timeout cancellation (void holds, restore items)
    - _Requirements: 2.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 7.5 Write property test for trade proposal guards
    - **Property 17: Trade proposal guards**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 7.6 Write property test for pre-auth hold sizing
    - **Property 18: Pre-auth hold sizing**
    - **Validates: Requirements 5.4**

  - [ ]* 7.7 Write property test for unverified-user transaction guard
    - **Property 9: Unverified users cannot transact**
    - **Validates: Requirements 2.4**

  - [x] 7.8 Implement dispute and fraud resolution in the orchestrator
    - Add condition-dispute handling ($20.00 friction-tax partial capture, $10/$10 allocation, holds remain locked until return, DISPUTE_RESOLVED void), objective-fraud handling (full capture 100%, transfer to victim, victim hold void, evidence-pack generation via `getVerifiedIdentity`), bounded full-capture retry (max 3) with manual-reconciliation flag, and incomplete-evidence handling
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [ ]* 7.9 Write property test for friction tax allocation
    - **Property 19: Friction tax is fixed and fully allocated**
    - **Validates: Requirements 7.2, 7.3**

  - [ ]* 7.10 Write property test for disputed holds remaining locked
    - **Property 20: Disputed holds remain locked until resolution**
    - **Validates: Requirements 7.4**

  - [ ]* 7.11 Write property test for fraud capture fund conservation
    - **Property 21: Fraud capture conserves funds to the victim**
    - **Validates: Requirements 8.2, 8.3**

  - [ ]* 7.12 Write edge-case unit tests for dispute/fraud failure paths
    - Friction-tax capture failure (7.6), return-overdue (7.7), full-capture retry exhaustion (8.6), missing identity data (8.7), COMPLETED voids holds (6.7), fraud victim void (8.5)
    - _Requirements: 6.7, 7.6, 7.7, 8.5, 8.6, 8.7_

  - [x] 7.13 Implement the cash sale orchestrator
    - Create `domain/orchestrator/cashSaleOrchestrator.ts`: VERIFIED-gate + AVAILABLE guard, create `PENDING` sale + reserve item, request transfer of FMV + flat platform fee, mark COMPLETED/SOLD on settle or FAILED/AVAILABLE on failure, and single-winner concurrent-initiation handling
    - _Requirements: 2.4, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 7.14 Write property test for cash sale amount composition
    - **Property 15: Cash sale amount composition**
    - **Validates: Requirements 4.2, 4.7**

  - [ ]* 7.15 Write property test for cash sale availability guard
    - **Property 16: Cash sale availability guard**
    - **Validates: Requirements 4.5**

  - [x] 7.16 Implement KYC and item-update orchestration
    - Add KYC initiation (payer creation, UNVERIFIED/REJECTED-only guard, PENDING/VERIFIED rejection, payer-create-failure handling) and item-update guard (only AVAILABLE items mutable; FMV immutable when reserved)
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 2.7, 3.4, 3.5, 3.6_

  - [ ]* 7.17 Write property tests for KYC initiation and item immutability guards
    - **Property 8: KYC initiation guard** — **Validates: Requirements 2.1, 2.7**
    - **Property 14: Non-available items are immutable in the guarded fields** — **Validates: Requirements 3.5, 3.6**

- [x] 8. Checkpoint — orchestrators green
  - Ensure all orchestrator property/unit/edge tests pass against the in-memory fake, ask the user if questions arise.

- [x] 9. Webhook route handler
  - [x] 9.1 Implement the webhook Route Handler pipeline
    - Create `app/api/webhooks/pinch/route.ts` (POST, admin client): recompute HMAC over the raw body and compare to the signature header (401 on mismatch, no side effect), idempotency lookup on `event_id`, map event → `TradeEvent`/cash-sale update, dispatch through the orchestrator, and record `SUCCESS`/`FAILURE`/`NO_OP` in `webhook_logs`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.7, 10.8_

  - [ ]* 9.2 Write property test for webhook idempotency
    - **Property 22: Webhook processing is idempotent**
    - **Validates: Requirements 10.3, 10.5**

  - [ ]* 9.3 Write property test for rejected webhook transitions preserving state
    - **Property 23: Rejected webhook transitions preserve state**
    - **Validates: Requirements 10.8**

  - [ ]* 9.4 Write unit and edge tests for webhook dispatch and auth ordering
    - Auth-first ordering (10.1), dispatch mapping (10.4), tampered webhook rejected (10.2), unknown event NO_OP (10.7)
    - _Requirements: 10.1, 10.2, 10.4, 10.7_

- [ ] 10. Server actions (thin wrappers over orchestrators)
  - [x] 10.1 Implement auth, profile, and KYC server actions
    - Create `lib/actions/` wrappers for sign-up/sign-in (Supabase Auth + credential validation + profile creation with UNVERIFIED), profile update (validation + persist), and KYC initiate/verify (delegates to the KYC orchestration)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.6, 2.7_

  - [x] 10.2 Implement listing and cash sale server actions
    - Wrappers for item create/update/delete (validation + Storage image upload + owner authorization), catalog read of AVAILABLE items, and cash-sale initiate/advance delegating to `cashSaleOrchestrator`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.5, 4.6_

  - [x] 10.3 Implement trade server actions
    - Wrappers for trade proposal, record shipment/receipt/acceptance, raise dispute, report fraud, and download evidence pack — each delegating to `tradeOrchestrator` and returning typed results
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.3, 6.5, 6.8, 7.1, 8.1_

  - [ ]* 10.4 Write property test for catalog availability filtering
    - **Property 13: Catalog returns only available items**
    - **Validates: Requirements 3.8**

- [x] 11. Authentication, profile, and KYC UI
  - [x] 11.1 Build sign-in / sign-up pages
    - Create `app/(auth)/sign-in/page.tsx` and `app/(auth)/sign-up/page.tsx` with forms wired to the auth actions, inline field-level validation errors, and redirect handling for protected routes
    - _Requirements: 1.1, 1.2, 1.3, 1.7_

  - [x] 11.2 Build profile page
    - Create `app/profile/page.tsx` showing/editing profile fields and displaying KYC_Status, wired to the profile update action with inline validation
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 11.3 Build the KYC flow
    - Create `app/kyc/page.tsx` + `components/kyc/KycFlow.tsx` rendering initiate → PENDING → VERIFIED/REJECTED states (with reason) and Mock demo controls to trigger simulated verification
    - _Requirements: 2.1, 2.2, 2.3, 2.7_

  - [ ]* 11.4 Write component tests for the KYC flow states
    - Assert each KYC state renders correctly and demo controls fire the expected action
    - _Requirements: 2.1, 2.2, 2.3, 2.7_

- [x] 12. Listings UI (priority deliverable)
  - [x] 12.1 Build the listings catalog
    - Create `app/listings/page.tsx` (Server Component) + `components/listings/Catalog.tsx` and `ItemCard.tsx` rendering only AVAILABLE items
    - _Requirements: 3.8_

  - [x] 12.2 Build item create/edit form
    - Create `app/listings/new/page.tsx`, `app/listings/[id]/edit/page.tsx`, and `components/listings/ItemForm.tsx` with image upload to Storage, wired to the listing actions with field-level validation and the VERIFIED gate
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7_

  - [x] 12.3 Build item detail page
    - Create `app/listings/[id]/page.tsx` with item details plus "Buy" (cash sale) and "Propose Trade" entry points gated on KYC status
    - _Requirements: 3.8, 4.1, 5.1_

  - [ ]* 12.4 Write component tests for catalog and item form
    - Assert catalog renders available items and the form surfaces validation errors and blocks unverified users
    - _Requirements: 3.1, 3.2, 3.3, 3.8_

- [x] 13. Cash sale UI flow
  - [x] 13.1 Build the cash sale page
    - Create `app/sales/[id]/page.tsx` (realtime) rendering PENDING → COMPLETED/FAILED with the amount breakdown (FMV + flat fee) and Mock demo controls to simulate settlement/failure
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7_

  - [ ]* 13.2 Write component tests for cash sale flow states
    - Assert PENDING/COMPLETED/FAILED render correctly and demo controls trigger the expected actions
    - _Requirements: 4.3, 4.4_

- [x] 14. Trade proposal UI
  - [x] 14.1 Build the trade proposal page
    - Create `app/trades/new/page.tsx` for equal-value item pairing selection, wired to the trade proposal action with unequal-value / unavailable error messaging
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 15. Real-time Trade Contract view (flagship deliverable)
  - [x] 15.1 Implement the realtime subscription hook
    - Create `lib/realtime/useTradeRealtime.ts` subscribing to Postgres Changes on the `trades` row and its `pre_auth_holds`, exposing live trade/hold data plus a channel connection status with auto-reconnect
    - _Requirements: 11.2, 11.5_

  - [x] 15.2 Build the trade contract view and sub-components
    - Create `app/trades/[id]/page.tsx` (Client) + `components/trade/TradeContract.tsx`, `StateBadge.tsx`, `HoldStatus.tsx`, `ActionBar.tsx` (driven by `availableActions`), and a connection indicator; render current state and each hold's status, and update live via the hook
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 6.1, 6.3, 6.5, 7.1, 8.1_

  - [x] 15.3 Build the Demo panel for mock webhooks
    - Create `components/trade/DemoPanel.tsx` (collapsible) with controls that call the MockService to fire simulated webhooks (confirm holds, settle, dispute, fraud) into `/api/webhooks/pinch`
    - _Requirements: 5.5, 6.2, 6.4, 6.6, 7.1, 8.1, 10.1_

  - [ ]* 15.4 Write component test for action controls matching permitted actions
    - **Property 7: UI actions match permitted actions**
    - **Validates: Requirements 11.3, 11.4**

  - [ ]* 15.5 Write component tests for state/hold rendering and connection indicator
    - Assert the view renders state + hold status (11.1) and shows the non-live indicator on connection loss (11.5)
    - _Requirements: 11.1, 11.5_

- [ ] 16. Integration and smoke tests
  - [ ]* 16.1 Write RLS integration tests
    - Against a local Supabase instance, assert per-owner profile access, item catalog visibility + owner-only writes, and participant-only trade reads
    - _Requirements: 1.6, 1.7, 3.7, 9.6, 9.7_

  - [ ]* 16.2 Write realtime and KYC-storage integration tests
    - Assert trade/hold changes propagate to a subscriber within the budget (11.2) and that verified identity data is stored for evidence-pack use (2.5)
    - _Requirements: 2.5, 11.2_

  - [ ]* 16.3 Write webhook latency smoke test
    - Assert the webhook handler returns a success acknowledgment within the 5s budget
    - _Requirements: 10.6_

- [x] 17. Final checkpoint — full suite green
  - Ensure all unit, property, component, integration, and smoke tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- The pure domain core (state machine + validators) and its property tests are completed before any dependent layer (orchestrators, server actions, webhook handler, UI).
- Each property-based test task references its design Property number and the requirement clauses it validates; use fast-check with `numRuns: 100`+ and model-based testing for Properties 1–6.
- Orchestrator property/unit tests run against the in-memory fake implementing the `PaymentService`/`KycService` interface, keeping them fast and deterministic.
- RLS, realtime, KYC-storage, and webhook-latency behaviors are covered by integration/smoke tests rather than property tests, per the design's Testing Strategy.
- All monetary values are integer AUD cents end-to-end.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.1", "3.2", "3.3", "3.4", "3.5", "4.2", "4.3", "4.4", "6.1"] },
    { "id": 3, "tasks": ["2.2", "3.6", "3.7", "6.2", "6.4"] },
    { "id": 4, "tasks": ["2.3", "6.3", "7.1", "7.13", "7.16"] },
    { "id": 5, "tasks": ["2.4", "7.2", "7.3", "7.4", "7.14", "7.15", "7.17"] },
    { "id": 6, "tasks": ["7.5", "7.6", "7.7", "7.8"] },
    { "id": 7, "tasks": ["7.9", "7.10", "7.11", "7.12", "9.1"] },
    { "id": 8, "tasks": ["9.2", "9.3", "9.4", "10.1", "10.2", "10.3"] },
    { "id": 9, "tasks": ["10.4", "11.1", "11.2", "11.3", "12.1", "12.2", "12.3", "13.1", "14.1", "15.1"] },
    { "id": 10, "tasks": ["11.4", "12.4", "13.2", "15.2"] },
    { "id": 11, "tasks": ["15.3", "15.4", "15.5"] },
    { "id": 12, "tasks": ["16.1", "16.2", "16.3"] }
  ]
}
```
