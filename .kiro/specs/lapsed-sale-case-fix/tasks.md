# Implementation Plan

## Overview

Every verification step below is a targeted Vitest run. Do not run `npm run build`, `npm run typecheck` or `npm run lint`; the user runs those on their own cadence, and editor diagnostics cover types in between. New suites name their `describe` blocks `Property N: …` after the design's Correctness Properties, so an exploration block (fails on F) and a preservation block (passes on F) can share a file and each runs alone with `-t "Property N"`.

Throughout: no migration, no edit to `lib/supabase/database.types.ts`, no new path that moves money, `ship_lapsed_at` is never cleared, and no Server Action is renamed or unwrapped. F is the code at HEAD `e65f1a8`, F′ the fixed code.

## Tasks

- [x] 1. Extend FakeAdmin with scripted answers
  - In `tests/unit/fakes/supabaseChain.ts`, per design → Changes Required, item 9. Every addition is optional, so the existing suites run unchanged
    - `QueuedResult.error` gains an optional `code`
    - New `RecordedCall` (`table`, `op`, `columns`, `match`, `payload`); `RecordedWrite` extends it with `op` narrowed to the four writes
    - `FakeAdminConfig.respond?: (call: RecordedCall) => QueuedResult | undefined`
  - Builder: `select(columns?)` records its argument without changing the operation (a bare call records `'*'`), and `eq(column, value)` records into `match`. Every other filter stays a no-op: recorded, never enforced
  - `resolve()`: push to `calls` first, as today. A select consults `respond`, then the queue, then the default, then throws the existing error. A write runs `throwOnWrite` (still throwing before recording), records the write, then returns `respond(write) ?? { data: null, error: null }`
  - Update the header comment: the fake now serves more than the two modules it names, and `respond` is how a test represents a won stamp or routes a read by `columns` and `match`
  - Re-run the five suites that already use the fake. They must pass with no edits, which shows the default behavior is unchanged:
    `npx vitest --run tests/unit/tradeInspectionSweep.test.ts tests/unit/staleCollateralTrades.test.ts tests/unit/tradeFeeDrain.test.ts tests/unit/settlementWebhookNotify.test.ts tests/unit/webhookAuthentication.test.ts`
  - _Requirements: 2.1, 2.7, 3.5, 3.11, 3.12_

- [x] 2. Write the Bug 1 exploration test
  - **Property 1: Bug Condition** - A marker outside its own flow opens no case
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Bug 1 is deterministic, so scope the property to the concrete C1 and C1′ rows below (`isBugCondition_1` in design → Bug Details)
  - Create `tests/unit/arbitrationQueue.test.ts` (domain project) driving the real `getArbitrationQueue` and `getArbitrationCase`, with the mock-then-import pattern of `tests/unit/tradeInspectionSweep.test.ts`. Mock only `@/lib/staffGate`, `@/lib/supabase/admin` (FakeAdmin), `@/lib/actions/disputeEvidence` and `next/cache`. Error logging is off under test, so `withActionLog` returns each result as is
  - Route every read through `respond` by table plus `match` and `columns`: the DISPUTED read by `match.status`, the candidate read by having no `match.id`, the shipment and resolution reads by `match.id` and their columns. The candidate read returns the test's rows filtered by a transcription of its unchanged `.in('status', …).or(…)`, because the database never returns any other row
  - Assert `expectedBehavior_1` on:
    - RETURN_PENDING with only `ship_lapsed_at`, 8 days old: absent from `cases`, and `summariseQueue(cases)` counts nothing
    - RETURN_IN_TRANSIT whose `return_lapsed_at` was cleared when the return was posted, `ship_lapsed_at` still set: absent
    - `getArbitrationCase('CASH_SALE', ref)` for the first row: `not-found` with "That case is not open, or does not exist."
    - C1′, ESCROW_HELD with `return_lapsed_at` and `ship_lapsed_at`: listed as `SHIP_LAPSED` with `openedAt` = `ship_lapsed_at`. ESCROW_HELD with only `return_disputed_at`: absent
  - Run on UNFIXED code: `npx vitest --run tests/unit/arbitrationQueue.test.ts`
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists). Expected counterexamples: the RETURN_PENDING row listed as `SHIP_LAPSED`, aged from the old marker, HIGH for PAST_SLA and counted overdue; the case opening with resolution status RETURN_PENDING and `returnLapsed: false`, which is what made its card read as contested; the C1′ rows listed as RETURN_LAPSED and RETURN_CONTESTED
  - Record the counterexamples in the suite's header comment. If any case passes on F, stop: Bug 1 causes 1 and 2 in design → Hypothesized Root Cause are wrong and must be revisited before fixing
  - Mark complete when the test is written, run, and the failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 3. Write the Bug 2 exploration test
  - **Property 3: Bug Condition** - A "Not shipped" case shows guidance instead of refused outcomes, and the buyer has a way in
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: the staff view is deterministic for a given resolution status, so the property ranges over the 13 Cash_Sale statuses the resolution read can return (the two-read race) and nothing else (`isBugCondition_2` with viewer STAFF)
  - Create `tests/component/arbitrationCaseView.test.tsx` (component project). Mock `@/lib/actions/admin`, `@/lib/actions/arbitration` and `sonner`; the view itself has no hooks. Build `ArbitrationCaseDetail` fixtures through one helper. On F the two new shipment fields are not on the type yet; Vitest does not type-check, so leave that fixture unannotated (or cast it) until 8.4 adds them
  - For a `SHIP_LAPSED` case and every resolution status (`fc.constantFrom` over the 13, `numRuns` about 25, unmounting each render, because RTL cleans up per test rather than per run):
    - no money control: none of "Refund buyer in full", "Release to seller", "Partially refund" (DisputeActions), "Refund the buyer" or "Release to the seller" (ReturnCaseActions)
    - the 2.5 guidance, by the key phrases of the proposed copy in design → Changes Required, item 3, with both dates as `formatContractDateTime` renders them (compute the expected strings with it, so the test does not depend on locale)
    - the refund clause present only when `buyerHasGoods` is false
    - a "Ship-by date passed · {flag time}" evidence entry that names the ship-by date, and drops that sentence when `shipByAt` is null
  - A `CONDITION_DISPUTE` case whose sale carries the marker also shows the evidence entry: once the buyer reports a problem, it is the only place staff see the missed date
  - In `tests/unit/arbitrationQueue.test.ts`, add a `Property 3` block: `getArbitrationCase` on an open ESCROW_HELD "Not shipped" case returns `shipment.shipByAt` and `shipment.shipLapsedAt` equal to the row's `ship_by_at` and `ship_lapsed_at`
  - Buyer half, by reading only, because `CashSaleView` has no harness and `canReportUnpostedSale` does not exist yet: confirm all three "Report a problem" triggers (dock ⋯ menu, the phone Status panel's `dockActions`, the Protection tab's `reportAction`) are gated on `sale.status === 'INSPECTION' && iAmBuyer`, "Not received" on IN_TRANSIT, "Handover failed" on HANDOVER, and that the dialog asks "What is wrong with the item?"
  - Run on UNFIXED code:
    `npx vitest --run tests/component/arbitrationCaseView.test.tsx`
    `npx vitest --run tests/unit/arbitrationQueue.test.ts -t "Property 3"`
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - they prove the bug exists). Expected counterexamples: an ESCROW_HELD resolution rendering DisputeActions' three buttons, whose confirmation says the outcome moves real money; a RETURN_PENDING resolution rendering ReturnCaseActions; Shipment evidence reading "Not recorded." with no lapse entry; `shipment.shipByAt` undefined
  - Record the counterexamples and the gates read in `CashSaleView` in the component suite's header. If a staff case passes on F, stop and revisit Bug 2 causes 1 and 2
  - Mark complete when the tests are written, run, and the failures are documented
  - _Requirements: 1.4, 1.5, 1.6, 2.4, 2.5, 2.6_

- [x] 4. Write the Bug 3 exploration test
  - **Property 5: Bug Condition** - A lost return-lapse stamp is silent
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: the defect is deterministic per stamp outcome (`isBugCondition_3`: the stamp matched no row and reported no error). Scope it to one lost stamp, then to short sequences so a lost stamp between two won ones is exercised
  - Create `tests/unit/cashSaleInspectionSweep.test.ts` (domain project). Mock `@/lib/supabase/admin` (FakeAdmin), `@/lib/notifications/createNotification`, `@/lib/email` and `@/lib/errors/errorLog`, so recipients, titles and log arguments can be asserted. Queue the six `cash_sales` reads in step order. `respond` answers only the step-4 stamps, keyed on `match.id`: WON `{ data: { id }, error: null }`, LOST `{ data: null, error: null }`, ERROR `{ data: null, error: { message, code? } }`; everything else falls through
  - Concrete case: one step-4 row whose stamp is LOST. Assert no `createNotification` for it, `returnLapsed: 0`, and no `logBackgroundFailure` (`expectedBehavior_3`)
  - Property: `fc.array` of 1 to 8 step-4 outcomes from `WON | LOST | ERROR(code?)`. Assert notices only for WON rows (seller, then buyer), `returnLapsed` equal to the WON count, and one log per ERROR row
  - Run on UNFIXED code: `npx vitest --run tests/unit/cashSaleInspectionSweep.test.ts`
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - they prove the bug exists). Expected counterexample: the lost stamp still sends "Return not posted — we are reviewing it" to the seller and "Return deadline passed" to the buyer and reports `returnLapsed: 1`; the property shrinks to `[LOST]`
  - Record the counterexample in the suite's header. If it passes on F, stop and revisit Bug 3 cause 1
  - Mark complete when the test is written, run, and the failure is documented
  - _Requirements: 1.7, 2.7_

- [x] 5. Write the Bug 1 preservation tests (BEFORE implementing the fix)
  - **Property 2: Preservation** - In-flow markers keep today's situation and clock
  - **IMPORTANT**: Follow observation-first methodology. Observe F on rows outside C1 ∪ C1′ and assert what it does
  - Add `tests/unit/helpers/lapsedSaleOracle.ts` with `legacySituationOf` (a transcription of F's candidate query and loop, `situationOf` in design → Bug Details, truthiness included), `isBugCondition_1`, and the 13 Cash_Sale statuses. The queue suite and the property suite (8.2) import this one copy, so the oracle checked against F here is the one F′ is held to later
  - In `tests/unit/arbitrationQueue.test.ts`, add a `Property 2` block. Observe on F (design → Preservation Checking, test cases 1 and 2), then assert:
    - ESCROW_HELD with `ship_lapsed_at`: `SHIP_LAPSED`, clock `ship_lapsed_at`, the "has not posted the item by the ship-by date" claim, `raisedById: null`, Buyer and Seller with today's stakes, priority by age. The row left by a withdrawn dispute (3.7) is this same row
    - RETURN_PENDING or RETURN_IN_TRANSIT contested, with and without an old ship marker: `RETURN_CONTESTED`, clock `return_disputed_at`, raised by the seller, claim `return_dispute_reason`. Contested and lapsed: contested wins
    - lapsed, with and without an old ship marker: `RETURN_LAPSED`, clock `return_lapsed_at`, the "did not post the return" claim
    - a DISPUTED sale carrying `ship_lapsed_at`: listed once, as a condition dispute
    - a chargeback against a C1 sale in a non-fallback currency: the chargeback keeps that currency (on F′ the sale itself is no longer listed)
    - an IN_TRANSIT sale carrying `ship_lapsed_at` (tracking recorded): absent
    - every listed cash sale opens through `getArbitrationCase`, and an unlisted ref returns `not-found` with "That case is not open, or does not exist."
    - `summariseQueue` totals over rows with no C1 or C1′ among them
  - Property on F: for generated candidate rows outside C1 ∪ C1′ (status RETURN_PENDING, RETURN_IN_TRANSIT or ESCROW_HELD with at least one marker), the real queue lists each with `situation` and `openedAt` equal to `legacySituationOf(row)`. `numRuns` about 50. This is what validates the transcription against F
  - Run on UNFIXED code: `npx vitest --run tests/unit/arbitrationQueue.test.ts -t "Property 2"`
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 6. Write the Bug 2 preservation tests (BEFORE implementing the fix)
  - **Property 4: Preservation** - Every other Decision card, room control and dispute rule is unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - In `tests/component/arbitrationCaseView.test.tsx`, add a `Property 4` block. Observe on F, then assert:
    - for every cash-sale situation except `SHIP_LAPSED`, every resolution status and both values of `returnLapsed` (`numRuns` about 25): RETURN_PENDING and RETURN_IN_TRANSIT render ReturnCaseActions with the LAPSED copy when `returnLapsed` is true and the CONTESTED copy otherwise; every other status renders DisputeActions
    - contested-and-lapsed keeps the LAPSED copy (design → Known limits)
    - a trade case renders TradeDisputeActions, and a chargeback renders "Not ours to decide"
    - the refund-failed banner and the "already refunded" line still render above the branch
    - with no ship-lapse marker, Shipment evidence renders exactly today's entries and no ship-by entry
  - Pin, on F, the server path the new buyer control will use. Not named in the design; task 11 walks the same path by hand. In `tests/unit/cashSaleDispute.test.ts`, on a DELIVERY sale settled into ESCROW_HELD with nothing posted (export the walk up to `settleCashSale` from `tests/unit/helpers/disputedCashSale.ts` and build `disputedCashSale` on it, rather than copying it):
    - a blank reason and a 1001-character reason are refused
    - a valid buyer dispute lands DISPUTED and moves no money
    - a full REFUND_BUYER with no `requireReturn` refunds at once rather than waiting on a return
    - If any of these fails on F, stop: the guidance would promise an outcome the money path does not take
  - Buyer room, by reading on F: record the ship-by note's three forms and every dispute control's gate. They are preserved by construction (the new predicate is OR'ed onto the INSPECTION gate and is false outside C2), pinned in 9.2 and walked by hand in task 11
  - Run on UNFIXED code:
    `npx vitest --run tests/component/arbitrationCaseView.test.tsx -t "Property 4"`
    `npx vitest --run tests/unit/cashSaleDispute.test.ts tests/unit/cashSaleDisputeWithdrawal.test.ts tests/unit/cashSaleRefundDrain.test.ts tests/unit/cashSaleReturnFlow.test.ts tests/unit/cashSaleReturnLapse.test.ts`
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve). The second command covers every suite that uses the shared helper, so the extraction is shown to change nothing
  - Mark complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 2.6, 3.1, 3.3, 3.4, 3.8, 3.9, 3.10_

- [x] 7. Write the Bug 3 preservation tests (BEFORE implementing the fix)
  - **Property 6: Preservation** - Won stamps, failed writes and every other sweep step behave as before
  - **IMPORTANT**: Follow observation-first methodology
  - In `tests/unit/cashSaleInspectionSweep.test.ts`, add a `Property 6` block. Observe on F, then assert:
    - one row per step, with the step-4 and step-6 stamps WON: `{ completionNotified: 1, warned: 1, returnWarned: 1, returnLapsed: 1, shipWarned: 1, shipLapsed: 1 }`, today's titles and recipients in order, both warning emails, and the five stamp payloads
    - step 6: a lost stamp sends nothing (so a relisted sale is not notified again), and a failed write logs `cash-sale.ship-lapse` with `error.code || 'UPDATE_ERROR'` and `{ cashSaleId }`
    - step 4: a won stamp notifies the seller then the buyer with today's copy and counts once; a failed write logs `cash-sale.return-lapse` with its code, or `UPDATE_ERROR` without one, context `{ cashSaleId }`, and sends nothing; a throwing notice logs `THREW` and the next row still runs
    - property: `fc.array` of 1 to 8 step-4 outcomes from `WON | ERROR(code?)` (LOST excluded) gives notices only for WON rows, `returnLapsed` equal to the WON count and one log per ERROR with its code. Every `cash_sales` write sets exactly one of the five stamp columns to the pass's single timestamp, so nothing is cleared, cancelled or refunded
  - Run on UNFIXED code: `npx vitest --run tests/unit/cashSaleInspectionSweep.test.ts -t "Property 6"`
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark complete when the tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.7, 3.11, 3.12_

- [x] 8. Fix Bug 1: status scopes every marker
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 2.5, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.13_

  - [x] 8.1 Add `cashSaleMarkerCase` to `domain/arbitration/arbitrationCase.ts`
    - `CashSaleCaseMarkers`, `CashSaleMarkerCase` and the function exactly as design → Changes Required, item 1. Pure, no new imports
    - JSDoc states the rule as "status scopes every marker", records why the ship marker is scoped rather than cleared (step 6 de-duplicates on it, and 3.7 needs it to survive a withdrawn dispute), and keeps the note that contested wins because a person has already said something is wrong
    - Give each `ArbitrationCaseSituation` doc bullet its statuses, and point the `priorityOf` "caller must set `openedAt`" note at this function
    - _Bug_Condition: isBugCondition_1(s) from design: a return-flow sale with only the ship marker (C1), or an ESCROW_HELD sale with a return marker (C1′)_
    - _Expected_Behavior: expectedBehavior_1(s, r) from design: no case in the return flow without a return marker; ESCROW_HELD ignores return markers_
    - _Preservation: every mapping-table row outside C1 and C1′ keeps F's situation and `openedAt`_
    - _Requirements: 2.2, 3.2, 3.3, 3.7_

  - [x] 8.2 Pin the rule in `tests/property/lapsedSaleCase.test.ts`
    - New domain-project suite importing the oracle from `tests/unit/helpers/lapsedSaleOracle.ts`. It is written here rather than in tasks 2 and 5 because it imports a function F does not have; its oracle was checked against F in task 5
    - `Property 1` block: dedicated C1 and C1′ arbitraries (the general one hits C1 about 2% of the time) satisfy `expectedBehavior_1`
    - `Property 2` block: the 13 statuses plus arbitrary strings, each marker `fc.option(isoTimestamp, { nil: null, freq: 2 })`, filtered by `!isBugCondition_1`, equal `legacySituationOf`. Build `isoTimestamp` from an integer offset, as `tests/property/payoutReadModel.test.ts` does
    - Invariants from 2.2: `SHIP_LAPSED` implies ESCROW_HELD, a return situation implies the return flow, and `openedAt` is the marker the situation names. Metamorphic: replacing the markers outside a row's flow never changes the result
    - One example per mapping-table row, including contested over lapsed and an unknown status string
    - Run: `npx vitest --run tests/property/lapsedSaleCase.test.ts` (PASS)
    - _Requirements: 2.1, 2.2, 3.2, 3.3, 3.6, 3.7_

  - [x] 8.3 Apply the rule in `getArbitrationQueue` (`lib/actions/arbitration.ts`)
    - In the return-case loop, call `cashSaleMarkerCase` on each candidate row and `continue` on `null`. Take `situation` and `openedAt` from its result; claim, raised-by, parties, amounts, assignee, note count and deadline fields stay exactly as they are, derived from the returned situation
    - Keep the candidate query unchanged as a superset, and rewrite the comment beside it to say the rule decides. Do not restate the rule as a nested PostgREST filter
    - Keep `currencyOfContract` and the name lookup on the UNFILTERED rows, so a chargeback against a C1 sale keeps its currency
    - `getArbitrationCase` follows by re-deriving the queue. It, `readResolution`, the `not-found` path and both action names stay as they are
    - _Bug_Condition: isBugCondition_1(s) at the action level_
    - _Expected_Behavior: a C1 sale is absent from `cases` and `summariseQueue`, and `getArbitrationCase` returns `not-found`_
    - _Preservation: Property 2 (in-flow cases, DISPUTED sales, trades, chargebacks and openability unchanged)_
    - _Requirements: 2.1, 2.3, 3.4, 3.5, 3.6, 3.13_

  - [x] 8.4 Carry the ship-by dates on the case payload
    - Add `shipByAt: string | null` and `shipLapsedAt: string | null`, each with JSDoc, to `ArbitrationShipmentEvidence`
    - Append `, ship_by_at, ship_lapsed_at` to the `shipRow` select inside the SAME single string literal (splitting it collapses the inferred row type, as the note on `readResolution` explains), and map both
    - Both columns are already in `lib/supabase/database.types.ts` and `lib/supabase/cashSaleProjection.ts`; confirm by reading and edit neither. Remove any cast added to the task 3 fixture
    - This makes the action-level half of task 3 pass; the component half waits for 9.4
    - _Bug_Condition: isBugCondition_2 with viewer STAFF_
    - _Expected_Behavior: the case payload carries the ship-by date and the flag time the page must show_
    - _Preservation: every existing shipment field maps as before_
    - _Requirements: 1.5, 2.5_

  - [x] 8.5 Verify the Bug 1 exploration test now passes
    - **Property 1: Expected Behavior** - A marker outside its own flow opens no case
    - **IMPORTANT**: Re-run the SAME tests from task 2 (with the `Property 1` block from 8.2) - do NOT write new tests
    - `npx vitest --run tests/unit/arbitrationQueue.test.ts tests/property/lapsedSaleCase.test.ts -t "Property 1"`
    - **EXPECTED OUTCOME**: Tests PASS (confirms Bug 1 is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 8.6 Verify the Bug 1 preservation tests still pass
    - **Property 2: Preservation** - In-flow markers keep today's situation and clock
    - **IMPORTANT**: Re-run the SAME tests from task 5 (with the `Property 2` block from 8.2) - do NOT write new tests
    - `npx vitest --run tests/unit/arbitrationQueue.test.ts tests/property/lapsedSaleCase.test.ts -t "Property 2"`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

- [x] 9. Fix Bug 2: guidance for staff, and a way in for the buyer
  - _Requirements: 1.4, 1.5, 1.6, 2.4, 2.5, 2.6, 3.1, 3.3, 3.4, 3.8, 3.9, 3.10_

  - [x] 9.1 Add `canReportUnpostedSale` to `domain/contract/cashSaleStatus.ts`
    - As design → Changes Required, item 5, with its JSDoc: true only for the buyer of an ESCROW_HELD DELIVERY sale whose ship-by date lapsed; never for the seller, whose remedy is to post it
    - _Bug_Condition: isBugCondition_2({ sale, viewer: BUYER })_
    - _Expected_Behavior: true exactly on C2 for the buyer_
    - _Preservation: false for the seller and for every sale outside C2, so the room reduces to today's conditions_
    - _Requirements: 2.6, 3.9_

  - [x] 9.2 Pin the buyer predicate in `tests/property/lapsedSaleCase.test.ts`
    - `Property 3` block: a C2 arbitrary gives true for BUYER. For every DELIVERY sale, `canReportUnpostedSale(sale, 'BUYER')` is true exactly when `cashSaleMarkerCase(sale)?.situation === 'SHIP_LAPSED'`, so the guidance's "the buyer can report a problem" holds for every listed "Not shipped" case
    - `Property 4` block: any sale gives false for SELLER, and any sale outside C2 gives false for both roles
    - Examples: buyer and seller on a lapsed ESCROW_HELD delivery sale; buyer on IN_PERSON, unlapsed, IN_TRANSIT and DISPUTED sales
    - Run: `npx vitest --run tests/property/lapsedSaleCase.test.ts` (PASS)
    - _Requirements: 2.5, 2.6, 3.9_

  - [x] 9.3 Create `components/arbitration/NotShippedGuidance.tsx`
    - Header comment, then a presentational component with no hooks, no actions and no `'use client'`, so it renders on the server. Props `shipByAt`, `shipLapsedAt`, `buyerHasGoods`
    - The chargeback panel's "Not ours to decide" idiom: a medium-weight line, muted body, and a `dl` of both dates through `formatContractDateTime`, falling back to "Not recorded"
    - Copy per design → Changes Required, item 3. The clause from "and because no delivery is recorded" renders only when `buyerHasGoods` is false, because `buyerHasGoods` comes from `returnRequiredForRefund`, the rule the orchestrator applies
    - No "escrow" in the copy, no `formatAud`, and Hugeicons only if an icon is wanted
    - _Bug_Condition: isBugCondition_2 with viewer STAFF_
    - _Expected_Behavior: the 2.5 points with both dates, and no money control_
    - _Preservation: nothing is cancelled, refunded or released by this panel (3.1)_
    - _Requirements: 2.4, 2.5, 3.1_

  - [x] 9.4 Key the Decision card on the situation, and add the ship-by evidence entry (`components/arbitration/ArbitrationCaseView.tsx`)
    - In the CASH_SALE branch, check `c.situation === 'SHIP_LAPSED'` first and render `NotShippedGuidance` with `shipByAt={shipment?.shipByAt ?? null}`, `shipLapsedAt={shipment?.shipLapsedAt ?? c.openedAt}` and `buyerHasGoods={resolution.buyerHasGoods}`. Then the existing RETURN_PENDING / RETURN_IN_TRANSIT → `ReturnCaseActions` (props and `returnLapsed ? 'LAPSED' : 'CONTESTED'` unchanged), else `DisputeActions` (unchanged)
    - Key on the listed situation, not the resolution status: they are two reads, and a seller adding tracking between them must still land on guidance
    - Leave the refund-failed banner and the "already refunded" line above the branch untouched
    - Shipment evidence: directly under the outbound leg, whenever `shipment.shipLapsedAt` is set, an entry in the "Return lapsed" markup reading "Ship-by date passed · {ship_lapsed_at}", then "The seller was due to post by {ship_by_at}." (omitted when `shipByAt` is null) and "This is a triage signal only. Nothing is cancelled or refunded because of it." Shown on every case whose sale carries the marker
    - _Bug_Condition: isBugCondition_2 with viewer STAFF, whatever status the resolution read returns_
    - _Expected_Behavior: expectedBehavior_2 for STAFF: no control that calls `resolveCashSaleDispute` or `resolveCashSaleReturnCase`, the guidance, both dates, and the dated evidence entry_
    - _Preservation: Property 4 (every other situation renders the card F renders)_
    - _Requirements: 2.4, 2.5, 3.3, 3.4_

  - [x] 9.5 Give the buyer "Report a problem" on an unposted sale (`components/sales/CashSaleView.tsx`)
    - Derive `buyerMayReportUnposted` with `canReportUnpostedSale` next to `shipByNote` (design → Changes Required, item 6)
    - Dock ⋯ menu: the existing INSPECTION item renders when `(sale.status === 'INSPECTION' && iAmBuyer) || buyerMayReportUnposted`; same button, same `setConfirming('dispute')`
    - Protection tab: `reportAction` renders whenever a hint exists: "Raise it before the payment is released." at INSPECTION (unchanged), or "The ship-by date passed without tracking." for an unposted sale, with the button markup shared
    - Dispute dialog: label, placeholder and hint come from one `disputePrompt` value; the not-posted prompt per design, everything else unchanged ("What is wrong with the item?"). Title, description, confirm label and `disputeCashSale(sale.id, disputeReason)` are unchanged, and no copy says "escrow"
    - Not added to the phone Status panel's `dockActions`. `shipByNote`, the steps, the Status panel, `HandoverFailedDialog` and every server call stay as they are, and no server call is added
    - A lapse arriving over Realtime moves nothing outside its region: the ⋯ item sits in a popover and the Protection row in a tab closed by default
    - _Bug_Condition: isBugCondition_2({ sale, viewer: BUYER })_
    - _Expected_Behavior: expectedBehavior_2 for BUYER: "Report a problem" in the ⋯ menu and the Protection tab, the not-posted prompt, `disputeCashSale` on confirm, ship-by note unchanged_
    - _Preservation: with `buyerMayReportUnposted` false, every control, note and prompt reduces to today's conditions, and the seller never gets a dispute control at ESCROW_HELD_
    - _Requirements: 2.6, 3.8, 3.9, 3.10_

  - [x] 9.6 Update the `reportAction` JSDoc in `components/contract/DittoBondExplainer.tsx`
    - JSDoc of `CashSaleProtectionExplainer`'s `reportAction` only: mention the unposted case beside the inspection window. Leave the file's existing `formatAud` call alone; it is on the ratchet list in `tests/unit/moneyCurrencyRendering.test.ts`
    - _Bug_Condition: isBugCondition_2({ sale, viewer: BUYER })_
    - _Expected_Behavior: the prop's documentation matches when the room now passes it_
    - _Preservation: no behavior change_
    - _Requirements: 2.6_

  - [x] 9.7 Verify the Bug 2 exploration test now passes
    - **Property 3: Expected Behavior** - A "Not shipped" case shows guidance instead of refused outcomes, and the buyer has a way in
    - **IMPORTANT**: Re-run the SAME tests from task 3 (with the `Property 3` block from 9.2) - do NOT write new tests
    - `npx vitest --run tests/component/arbitrationCaseView.test.tsx -t "Property 3"`
    - `npx vitest --run tests/unit/arbitrationQueue.test.ts tests/property/lapsedSaleCase.test.ts -t "Property 3"`
    - **EXPECTED OUTCOME**: Tests PASS (confirms Bug 2 is fixed)
    - _Requirements: 2.4, 2.5, 2.6_

  - [x] 9.8 Verify the Bug 2 preservation tests still pass
    - **Property 4: Preservation** - Every other Decision card, room control and dispute rule is unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 6 (with the `Property 4` block from 9.2) - do NOT write new tests
    - `npx vitest --run tests/component/arbitrationCaseView.test.tsx -t "Property 4"`
    - `npx vitest --run tests/property/lapsedSaleCase.test.ts -t "Property 4"`
    - `npx vitest --run tests/unit/cashSaleDispute.test.ts tests/unit/cashSaleDisputeWithdrawal.test.ts tests/unit/cashSaleRefundDrain.test.ts tests/unit/cashSaleReturnFlow.test.ts tests/unit/cashSaleReturnLapse.test.ts`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1, 3.3, 3.4, 3.8, 3.9, 3.10_

- [x] 10. Fix Bug 3: step 4 notifies only after winning its stamp
  - _Requirements: 1.7, 2.7, 3.1, 3.7, 3.11, 3.12_

  - [x] 10.1 Add the winner check to step 4 of `sweepCashSaleInspections` (`lib/trades/cashSaleInspectionSweep.ts`)
    - Chain `.select('id').maybeSingle()` onto the step-4 stamp and read `{ data: won, error }`; keep the error branch exactly as it is
    - After it, add `if (!won) continue;` and move the misplaced "Only notify if THIS pass won" comment to it: only the pass that won the stamp notifies and counts, and a lost race matches no row and reports no error
    - This is step 6's shape. Notifications, copy, the count, the `THREW` catch and every other step are untouched, and nothing clears a stamp
    - _Bug_Condition: isBugCondition_3: the stamp matched no row and reported no error_
    - _Expected_Behavior: expectedBehavior_3: no notice, no count and no log for that row_
    - _Preservation: Property 6 (won stamps, failed writes, throwing notices and steps 1, 2, 3, 5 and 6 unchanged)_
    - _Requirements: 2.7, 3.11, 3.12_

  - [x] 10.2 Verify the Bug 3 exploration test now passes
    - **Property 5: Expected Behavior** - A lost return-lapse stamp is silent
    - **IMPORTANT**: Re-run the SAME tests from task 4 - do NOT write new tests
    - `npx vitest --run tests/unit/cashSaleInspectionSweep.test.ts -t "Property 5"`
    - **EXPECTED OUTCOME**: Tests PASS (confirms Bug 3 is fixed)
    - _Requirements: 2.7_

  - [x] 10.3 Verify the Bug 3 preservation tests still pass
    - **Property 6: Preservation** - Won stamps, failed writes and every other sweep step behave as before
    - **IMPORTANT**: Re-run the SAME tests from task 7 - do NOT write new tests
    - `npx vitest --run tests/unit/cashSaleInspectionSweep.test.ts -t "Property 6"`
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - _Requirements: 3.1, 3.7, 3.11, 3.12_

- [ ] 11. Hand over the manual check of the `CashSaleView` wiring (user-run)
  - The only coverage for the room wiring itself, since `CashSaleView` has no harness. The user runs it on a development database on their own cadence. Do not perform these writes from an agent turn, and never against production
  - Steps (design → Integration Tests):
    - set `ship_lapsed_at` on an ESCROW_HELD delivery sale. As the buyer, confirm "Report a problem" in the dock ⋯ menu and the Protection tab, the not-posted prompt, and the unchanged ship-by note. As the seller, confirm there is no dispute control
    - open the staff case: guidance with both dates, no money controls, and the dated ship-by evidence entry
    - raise the dispute: the queue lists one condition dispute, and a full refund from staff goes out at once
    - on a second such sale, raise and then withdraw a dispute: it relists as "Not shipped" with its original clock, and neither member is notified again
  - _Requirements: 2.4, 2.5, 2.6, 3.7, 3.8, 3.9, 3.10_

- [ ] 12. Checkpoint - Ensure all tests pass
  - Run the final targeted regression. It includes `tests/unit/actionLogCoverage.test.ts` because `lib/actions/arbitration.ts` is a `'use server'` module, and `tests/unit/moneyCurrencyRendering.test.ts` because it scans `components/` and lists `DittoBondExplainer.tsx` on its `formatAud` ratchet:
    `npx vitest --run tests/property/lapsedSaleCase.test.ts tests/unit/arbitrationQueue.test.ts tests/unit/cashSaleInspectionSweep.test.ts`
    `npx vitest --run tests/component/arbitrationCaseView.test.tsx`
    `npx vitest --run tests/unit/arbitrationCase.test.ts tests/unit/tradeInspectionSweep.test.ts tests/unit/staleCollateralTrades.test.ts tests/unit/tradeFeeDrain.test.ts tests/unit/settlementWebhookNotify.test.ts tests/unit/webhookAuthentication.test.ts tests/unit/actionLogCoverage.test.ts tests/unit/moneyCurrencyRendering.test.ts`
    `npx vitest --run tests/unit/cashSaleDispute.test.ts tests/unit/cashSaleDisputeWithdrawal.test.ts tests/unit/cashSaleRefundDrain.test.ts tests/unit/cashSaleReturnFlow.test.ts tests/unit/cashSaleReturnLapse.test.ts`
  - Confirm the scope guard by reading and search, not by building: `git status --short` shows no new file under `supabase/migrations/` and no change to `lib/supabase/database.types.ts`; no touched file adds a call that moves money (`NotShippedGuidance` imports no action, and `CashSaleView` reuses `disputeCashSale`); the only write of `ship_lapsed_at` in `lib/`, `domain/`, `app/` and `components/` is step 6's stamp; and the five action names in 3.13 are unchanged and still exported through `withActionLog`
  - Ensure all tests pass, and ask the user if questions arise. Remind them of task 11, and that the two follow-ups recorded in bugfix.md (a staff action that cancels and refunds an ESCROW_HELD sale, and Flutter parity for the buyer's dispute control) are out of scope here
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13_

## Notes

- Task 11, the manual check of the `CashSaleView` wiring, is the user's to run on a development database. It is never performed from an agent turn, and never against production.
- `tests/property/lapsedSaleCase.test.ts` is written in 8.2 and extended in 9.2, after the exploration and preservation tasks, because it imports functions the unfixed code lacks (`cashSaleMarkerCase` from 8.1, `canReportUnpostedSale` from 9.1). Its oracle, `tests/unit/helpers/lapsedSaleOracle.ts`, is first checked against the unfixed queue in task 5.
- The two follow-ups recorded in bugfix.md are out of scope: a staff action that cancels an ESCROW_HELD sale and refunds the buyer, and Flutter parity for the buyer's dispute control on a sale that was never posted.
