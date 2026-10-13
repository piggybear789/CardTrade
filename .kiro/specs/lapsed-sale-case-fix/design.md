# Lapsed Sale Case Fix Bugfix Design

## Overview

Three defects sit between the ship-by work (0132) and the staff case queue.

1. **Return-flow sales listed as "Not shipped".** The return-case read in `getArbitrationQueue` admits any of three markers in any of three statuses, and its loop labels everything without a return marker `SHIP_LAPSED`. `ship_lapsed_at` is never cleared, so a sale that was late, then shipped, disputed and sent back is listed for the whole return as a seller who has not posted, aged from the old flag, and impossible to clear.
2. **"Not shipped" cases have no working decision and no exit.** The Decision card picks its controls from the sale's status alone, so an ESCROW_HELD case falls into `DisputeActions`. Every outcome there calls `resolveCashSaleDispute`, which refuses a sale that is not DISPUTED. The page never says what can actually happen, and the buyer's room has no control for the dispute the server already accepts from ESCROW_HELD.
3. **Step 4 of the sweep notifies after losing a race.** Its stamp asks for no row back, so a pass whose conditional update matched nothing cannot tell, and it notifies and counts anyway.

The fix:

- One pure rule, `cashSaleMarkerCase`, decides from status and markers together whether a cash sale is a marker case and which one. Status scopes every marker. The queue keeps its query as a superset and drops what the rule rejects. `getArbitrationCase` re-derives the queue, so it follows without its own change.
- The Decision card gets a third branch for `SHIP_LAPSED`: guidance and dates, no money controls. Shipment evidence gains a dated ship-by entry. The buyer's room offers "Report a problem" on a posted ESCROW_HELD sale with a lapsed ship-by date, through the room's existing dispute dialog and `disputeCashSale`.
- Step 4 copies step 6's winner check.
- The shared Supabase test fake learns to answer a call with a scripted result, so a won stamp can be represented at all.

The fix moves no money and adds no money path. It does not widen `resolveCashSaleDispute`, does not clear `ship_lapsed_at` (3.7 relies on it), renames no action, and needs no change to `lib/supabase/database.types.ts`. **No migration is needed:** every column it reads has existed since 0132, the reads it changes run on the service-role client, and the sweep change is the shape of a client-side query chain.

## Glossary

- **Bug_Condition (C)**: the inputs that trigger a defect. C1 for Bug 1 (with its mirror C1′), C2 for Bug 2, C3 for Bug 3. Each is specified as `isBugCondition` below.
- **Property (P)**: the behavior the fixed code must show for every input in C (`expectedBehavior` below).
- **Preservation**: for every input outside C, the fixed code behaves exactly as the original.
- **F / F′**: the original code at HEAD `e65f1a8`, and the fixed code.
- **Marker**: one of three timestamps on `cash_sales` that can open a case.
  - `ship_lapsed_at` (0132): stamped by sweep step 6 when the ship-by date passes unposted, never cleared.
  - `return_disputed_at` (0088): the seller contested the return.
  - `return_lapsed_at` (0089): stamped by sweep step 4 when the return dispatch deadline passes unposted, cleared by `recordReturnShipment` and `recordReturnCaseResolution`.
- **Flow**: the statuses a marker belongs to. The ship-by marker belongs to `ESCROW_HELD`. The return markers belong to `RETURN_PENDING` and `RETURN_IN_TRANSIT`.
- **Marker case**: a case opened by a marker rather than by a DISPUTED status: `SHIP_LAPSED` ("Not shipped"), `RETURN_CONTESTED`, `RETURN_LAPSED`.
- **`cashSaleMarkerCase`**: new pure function in `domain/arbitration/arbitrationCase.ts`. The single rule required by 2.2.
- **`getArbitrationQueue` / `getArbitrationCase`**: in `lib/actions/arbitration.ts`. The second opens a case by re-deriving the first.
- **Decision card**: the right-hand card of `/admin/arbitration/[kind]/[ref]`, rendered by `components/arbitration/ArbitrationCaseView.tsx`.
- **`NotShippedGuidance`**: new presentational component that fills the Decision card for a `SHIP_LAPSED` case.
- **`canReportUnpostedSale`**: new pure predicate in `domain/contract/cashSaleStatus.ts`. C2 for a member viewer.
- **Step 4 / step 6**: the return-lapse and ship-lapse blocks of `sweepCashSaleInspections` in `lib/trades/cashSaleInspectionSweep.ts`.
- **Stamp, won, lost**: the conditional `update({ col: now }).is(col, null)` that claims a marker. Won means it matched the row. Lost means another pass claimed it first, so it matched nothing and reported no error.
- **FakeAdmin**: the Supabase admin-client stand-in in `tests/unit/fakes/supabaseChain.ts`.

## Bug Details

### Bug Condition

#### Bug 1: a marker outside its own flow opens a case

Today the situation of a candidate row is the return-case query plus the loop that follows it:

```
FUNCTION situationOf(s)            -- F: .in(status,[RP,RIT,EH]).or(rd,rl,sl) + loop
  IF s.status NOT IN {RETURN_PENDING, RETURN_IN_TRANSIT, ESCROW_HELD} THEN RETURN NONE
  IF s.return_disputed_at = null AND s.return_lapsed_at = null AND s.ship_lapsed_at = null
    THEN RETURN NONE
  IF s.return_disputed_at ≠ null THEN RETURN RETURN_CONTESTED @ s.return_disputed_at
  IF s.return_lapsed_at ≠ null THEN RETURN RETURN_LAPSED @ s.return_lapsed_at
  RETURN SHIP_LAPSED @ s.ship_lapsed_at                  -- reached without checking status
END FUNCTION
```

**Formal Specification:**

```
FUNCTION isBugCondition(s)
  INPUT: s of type { status, ship_lapsed_at, return_disputed_at, return_lapsed_at }
         (one cash_sales row)
  OUTPUT: boolean

  RETURN ( s.status IN {RETURN_PENDING, RETURN_IN_TRANSIT}
           AND s.ship_lapsed_at ≠ null
           AND s.return_disputed_at = null
           AND s.return_lapsed_at = null )                            -- C1: the reported bug
      OR ( s.status = ESCROW_HELD
           AND (s.return_disputed_at ≠ null OR s.return_lapsed_at ≠ null) )  -- C1′: its mirror
END FUNCTION
```

C1′ is the same defect pointing the other way: F labels an ESCROW_HELD sale as a return case because it carries a return marker, where 2.2 ("no case for any other combination") and 3.2 (an unlapsed ESCROW_HELD sale is absent) require otherwise. It is not expected in data. Return markers are written only inside the return flow, and no ordinary path takes a sale from there back to ESCROW_HELD. It is included so that preservation can be stated over every combination of status and markers with no exceptions. Without it, "outside C1, F′ = F" would be false on exactly these rows, and a property test over arbitrary rows would find them.

```
FUNCTION expectedBehavior(s, r)         -- r = cashSaleMarkerCase(s)
  IF s.status IN {RETURN_PENDING, RETURN_IN_TRANSIT} THEN
    RETURN r = NONE                       -- neither return marker is set for C1
  -- s.status = ESCROW_HELD (C1′): the return markers are ignored
  RETURN r = (IF s.ship_lapsed_at ≠ null THEN SHIP_LAPSED @ s.ship_lapsed_at ELSE NONE)
END FUNCTION
```

At the action level, `r = NONE` means the sale is absent from `cases` and from `summariseQueue`, and `getArbitrationCase('CASH_SALE', s.id)` returns `not-found` with "That case is not open, or does not exist."

The full mapping, before and after:

| Status | Return contested | Return lapsed | Ship lapsed | F | F′ | |
|---|---|---|---|---|---|---|
| RETURN_PENDING, RETURN_IN_TRANSIT | set | any | any | RETURN_CONTESTED @ contest | same | preserved |
| RETURN_PENDING, RETURN_IN_TRANSIT | – | set | any | RETURN_LAPSED @ lapse | same | preserved |
| RETURN_PENDING, RETURN_IN_TRANSIT | – | – | set | SHIP_LAPSED @ ship lapse | none | C1, fixed |
| RETURN_PENDING, RETURN_IN_TRANSIT | – | – | – | none | none | preserved |
| ESCROW_HELD | – | – | set | SHIP_LAPSED @ ship lapse | same | preserved |
| ESCROW_HELD | – | – | – | none | none | preserved |
| ESCROW_HELD | set | any | any | RETURN_CONTESTED @ contest | SHIP_LAPSED @ ship lapse if set, else none | C1′, fixed |
| ESCROW_HELD | – | set | any | RETURN_LAPSED @ lapse | SHIP_LAPSED @ ship lapse if set, else none | C1′, fixed |
| any other status | any | any | any | none | none | preserved |

#### Bug 2: a "Not shipped" case has no working decision and no way in for the buyer

The bug manifests on two views of a sale that is ESCROW_HELD with its ship-by date lapsed. The staff case page offers only outcomes that will be refused and omits what can actually happen, and the buyer's room offers no dispute control.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { sale, viewer }, viewer IN {STAFF, BUYER, SELLER}
  OUTPUT: boolean

  RETURN input.sale.status = ESCROW_HELD
     AND input.sale.ship_lapsed_at ≠ null
     AND ( input.viewer = STAFF
           OR (input.viewer = BUYER AND input.sale.fulfillment_method = DELIVERY) )
END FUNCTION
```

For staff this is exactly a case whose situation is `SHIP_LAPSED`. The delivery term is redundant in data, because `set_cash_sale_ship_by` fills `ship_by_at` only for DELIVERY sales and step 6 only flags rows that have one. It is kept for the buyer because the room's ship-by note is gated the same way. The seller's view is outside C2 on purpose: 3.9 keeps them without a dispute control.

```
FUNCTION expectedBehavior(input, rendered)
  IF input.viewer = STAFF THEN
    RETURN rendered.decisionCard has no control that calls
             resolveCashSaleDispute or resolveCashSaleReturnCase
       AND rendered.decisionCard states the points of 2.5
       AND rendered.decisionCard shows ship_by_at and ship_lapsed_at
       AND rendered.shipmentEvidence has a dated "Ship-by date passed" entry
  -- input.viewer = BUYER
  RETURN rendered.room offers "Report a problem"
     AND its prompt is the not-posted prompt
     AND confirming calls disputeCashSale(sale.id, reason)
     AND the ship-by note is unchanged
END FUNCTION
```

#### Bug 3: step 4 notifies after a lost stamp

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { row, stamp }: one step-4 iteration and the result of its
         conditional update of return_lapsed_at
  OUTPUT: boolean

  RETURN input.stamp.matchedRows = 0 AND input.stamp.error = null   -- another pass stamped first
END FUNCTION

FUNCTION expectedBehavior(run, input)
  RETURN no createNotification call for input.row
     AND run.returnLapsed does not count input.row
     AND no logBackgroundFailure call for input.row
END FUNCTION
```

### Examples

Day numbers count from the day the buyer paid.

- **Bug 1, late post then a refund with return.** The ship-by date passes on day 3 and step 6 flags the sale. The seller posts on day 5, the parcel arrives, the buyer disputes at inspection, and on day 11 staff refund in full. The buyer has the goods, so the sale goes to RETURN_PENDING. F lists it as "Not shipped", opened 8 days ago, HIGH for PAST_SLA, counted overdue, claiming the seller has not posted. Expected: not listed.
- **Bug 1, a lapsed return that is then posted.** Same sale, but the buyer misses the return deadline. F correctly lists RETURN_LAPSED. The buyer then posts, and `recordReturnShipment` clears `return_lapsed_at`, leaving RETURN_IN_TRANSIT with only the ship marker. F relists it as "Not shipped" until the carrier confirms. Expected: not listed. This second way in means the status-blind fallback catches a running return even after its lapse was handled correctly.
- **Bug 1, opening such a case.** F's Decision card shows `ReturnCaseActions` with the contested intro ("The seller says the return did not arrive as expected. Decide whether it counts."), because `returnLapsed` is false. Both outcomes fail with "That return is not waiting on a decision." Expected: the "Case closed" page.
- **Bug 2, staff.** An ESCROW_HELD delivery sale is flagged on day 3. F offers "Refund buyer in full", "Release to seller" and "Partially refund". The confirmation says "This moves real money and cannot be undone from here." The result is "This sale is ESCROW_HELD, so it cannot be resolved." Shipment evidence reads "Not recorded." twice with no lapse entry. Expected: guidance, both dates, no money controls, a dated ship-by entry.
- **Bug 2, buyer.** The dock reads "Ship-by date passed (…) · our team is checking in". Its ⋯ menu holds only "Report {seller}", and the Protection tab's "If you report a problem" row has no button. Expected: "Report a problem" in both places, opening a prompt that asks what has happened with the purchase.
- **Bug 3.** A cron delivery and a manual trigger of the jobs route overlap. Both select sale S. Pass A stamps it. Pass B's update matches no row and reports no error, and B sends "Return not posted — we are reviewing it" and "Return deadline passed" a second time, and both passes report `returnLapsed: 1`. Expected: B sends nothing and reports 0.
- **Edge, preserved (3.7).** The buyer from the Bug 2 example reports a problem. The sale becomes DISPUTED and is listed once, as a condition dispute. The buyer withdraws. `disputeOriginStatus` restores ESCROW_HELD. `ship_by_at` is untouched (the 0132 trigger only fills a null one) and `ship_lapsed_at` is still set, so step 6 skips the row. The sale is listed as "Not shipped" again with its original clock, and nobody is notified again.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

Queue and case page (Bug 1 area):

- An ESCROW_HELD sale with a lapsed ship-by date is listed as "Not shipped" with the same claim, parties and clock (`ship_lapsed_at`) under the same priority rules. An ESCROW_HELD sale that has not lapsed is absent (3.2).
- A RETURN_PENDING or RETURN_IN_TRANSIT sale with a contested or lapsed return is listed as "Return contested" (which wins) or "Return lapsed", with the same claim, clock and raised-by, whether or not it also carries an old ship marker. Its Decision card is unchanged, including the existing reason mapping `returnLapsed ? 'LAPSED' : 'CONTESTED'` (3.3).
- DISPUTED cash sales (whatever their ship-by history), disputed trades and open chargebacks are listed once with their existing Decision cards. A chargeback keeps the currency of the sale it reverses, even when that sale is a C1 row that is no longer listed (3.4).
- Every case page is still resolved by re-deriving the queue. A sale is openable exactly when it is listed, and a case that has left reports "That case is not open, or does not exist." (3.5).
- Recording a shipment still takes a "Not shipped" sale out of ESCROW_HELD and out of the queue with no staff action (3.6).
- A withdrawn dispute on a lapsed ESCROW_HELD sale relists it as "Not shipped" without flagging or notifying again (3.7).

Contract room and money paths (Bug 2 area):

- Missing a ship-by date or a return deadline still cancels, refunds and releases nothing, and every refund or release still goes through the existing dispute and return decisions (3.1).
- The ship-by note keeps its three forms: "Post by …" (seller), "The seller posts by …" (buyer), "Ship-by date passed (…) · our team is checking in" once lapsed (3.8).
- "Report a problem" at INSPECTION (buyer: dock ⋯, Status panel on phones, Protection tab), "Not received" at IN_TRANSIT (buyer) and "Handover failed" at HANDOVER keep their parties, placement and copy, including the INSPECTION prompt "What is wrong with the item?". At ESCROW_HELD the seller still gets no dispute control, and the buyer gets none outside C2 (3.9).
- `disputeCashSale` still accepts only ESCROW_HELD, IN_TRANSIT, HANDOVER or INSPECTION with a non-empty reason of at most 1000 characters. `resolveCashSaleDispute` still refuses a sale that is not DISPUTED, still returns success without refunding again on a decided sale, and still refunds a full REFUND_BUYER immediately when no delivery is recorded, unless an operator overrides (3.10).

Sweep (Bug 3 area):

- Steps 1, 2, 3, 5 and 6 select, stamp, notify, count and log exactly as today (3.11).
- A won step-4 stamp sends both notices with their current copy and counts once. A failed write logs `cash-sale.return-lapse` with `error.code || 'UPDATE_ERROR'` and `{ cashSaleId }` and skips the sale. A throwing notice logs `cash-sale.return-lapse` with `THREW` and the pass continues (3.12).

Everywhere:

- `arbitration.getArbitrationQueue`, `arbitration.getArbitrationCase`, `admin.resolveCashSaleDispute`, `admin.resolveCashSaleReturnCase` and `cashSale.disputeCashSale` keep their names, exports and `withActionLog` wrapping (3.13).

**Scope:**

Every input outside C1 ∪ C1′, C2 and C3 is untouched. That includes:

- every non-cash-sale case, and every cash sale whose markers sit in their own flow
- the seller's view of any sale, and the buyer's view of any sale that is not a posted ESCROW_HELD sale with a lapsed ship-by date
- every sweep step other than step 4, and every step-4 iteration whose stamp is won or fails

## Hypothesized Root Cause

Each cause below was read in the code at HEAD. The exploratory tests confirm them by failing on F. If one passes on F instead, the matching hypothesis is wrong and is revisited before fixing.

**Bug 1**

1. **The candidate read is not scoped per marker.** `.in('status', ['RETURN_PENDING', 'RETURN_IN_TRANSIT', 'ESCROW_HELD']).or('return_disputed_at…,return_lapsed_at…,ship_lapsed_at…')` admits any marker in any of the three statuses. The 0132 comment beside it ("It leaves the queue by itself once tracking is recorded, because the sale leaves ESCROW_HELD") is true only while the status list does not also include the return flow, which it does.
2. **The loop falls through to `SHIP_LAPSED` without checking status.** Its ternary is `returnDisputedAt ? RETURN_CONTESTED : returnLapsedAt ? RETURN_LAPSED : SHIP_LAPSED`. A return-flow row with neither return marker can only be there because of its ship marker, and lands on the last branch. Its `openedAt` is the old `ship_lapsed_at`, which is what ranks it HIGH and overdue.
3. **The marker is permanent by design, so the fix cannot be to clear it.** Step 6 de-duplicates on `ship_lapsed_at is null`, and 3.7 relies on the marker surviving a withdrawn dispute so the sale relists without a second flag. `return_lapsed_at` is cleared on posting because a posted return ends that case. A posted parcel ends the ship-by case too, but the marker also has to outlive a dispute, so the status has to scope it instead.
4. **Two ways in.** C1 is reached by a refund-with-return after a late post, and again whenever a lapsed return is posted (the repository clears `return_lapsed_at`, exposing the ship marker).
5. **Why the case could not be cleared (1.3).** The Decision card chooses `ReturnCaseActions` from the RETURN_* status and defaults its reason to CONTESTED when `returnLapsed` is false. `resolveCashSaleReturnCase` then refuses with "Return is not stalled", and the action maps every INVALID_STATE to "That return is not waiting on a decision." Both guards are correct. The case should never have been listed.

**Bug 2**

1. **The Decision card branches on status alone.** RETURN_* gets `ReturnCaseActions` and everything else gets `DisputeActions`. `SHIP_LAPSED` arrived with 0132 and no branch of its own, so it inherited the dispute controls whose every outcome `resolveCashSaleDispute` refuses before DISPUTED.
2. **The evidence projection predates 0132.** The `shipRow` select and `ArbitrationShipmentEvidence` carry neither `ship_by_at` nor `ship_lapsed_at`, so the page cannot show the missed date or a dated lapse entry the way it shows "Return lapsed".
3. **The buyer room's dispute triggers are all gated elsewhere.** All three "Report a problem" triggers check `sale.status === 'INSPECTION' && iAmBuyer`, "Not received" checks IN_TRANSIT and "Handover failed" checks HANDOVER. The dialog's prompt assumes goods in hand.
4. **The server is not the gap.** Both `DISPUTABLE_STATUSES` (orchestrator) and `DISPUTABLE` (repository) include ESCROW_HELD. A dispute raised there lands as DISPUTED, and `returnRequiredForRefund` is false for a sale with no delivery, receipt, acceptance or handover recorded, so a full refund goes out immediately. The fix is UI and read-side only.

**Bug 3**

1. **Step 4 asks for no row back.** `update(...).eq('id').is('return_lapsed_at', null)` without `.select().maybeSingle()` answers `{ data: null, error: null }` whether it matched the row or not. The comment beside it says a lost race "matches no row and reports no error", but the code only branches on `error`. Step 6, written later, does it correctly.
2. **Nothing could have caught it.** `cashSaleInspectionSweep.ts` has no test file, and FakeAdmin answers every write with `{ data: null, error: null }`, so a won stamp cannot be represented. A test written against it would have seen every stamp as lost.

## Correctness Properties

Property 1: Bug Condition - A marker outside its own flow opens no case

_For any_ cash sale where isBugCondition (Bug 1) holds, the fixed `cashSaleMarkerCase` SHALL return no case for a RETURN_PENDING or RETURN_IN_TRANSIT sale, and SHALL return `SHIP_LAPSED` at `ship_lapsed_at` (or no case when that is unset) for an ESCROW_HELD sale, ignoring its return markers. The fixed `getArbitrationQueue` SHALL then leave a C1 sale out of the queue and out of `summariseQueue`, and `getArbitrationCase` SHALL return `not-found` with "That case is not open, or does not exist.", so every return case staff can open is contested or lapsed and is never refused as "not waiting on a decision".

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - In-flow markers keep today's situation and clock

_For any_ cash sale where isBugCondition (Bug 1) does not hold, the fixed `cashSaleMarkerCase` SHALL return the same situation and `openedAt` as the original query and loop, including no case, so every `SHIP_LAPSED`, `RETURN_CONTESTED` and `RETURN_LAPSED` case keeps its claim, raised-by, parties, priority, position and openability, and DISPUTED sales, disputed trades and open chargebacks are listed exactly once as before, with a chargeback keeping the currency of a sale that is no longer listed.

**Validates: Requirements 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

Property 3: Bug Condition - A "Not shipped" case shows guidance instead of refused outcomes, and the buyer has a way in

_For any_ input where isBugCondition (Bug 2) holds, the fixed system SHALL render for staff a Decision card with no control that calls `resolveCashSaleDispute` or `resolveCashSaleReturnCase`, carrying the guidance of 2.5 with the ship-by date and the flag time, plus a dated "Ship-by date passed" entry in Shipment evidence, whatever status the resolution read returns. For the buyer, `canReportUnpostedSale(sale, 'BUYER')` SHALL be true, so the room offers "Report a problem" with the not-posted prompt and raises the dispute through `disputeCashSale`. For every DELIVERY sale, `canReportUnpostedSale(sale, 'BUYER')` SHALL be true exactly when `cashSaleMarkerCase(sale)` is `SHIP_LAPSED`, so the guidance's statement that the buyer can report a problem holds for every listed "Not shipped" case.

**Validates: Requirements 2.4, 2.5, 2.6**

Property 4: Preservation - Every other Decision card, room control and dispute rule is unchanged

_For any_ input where isBugCondition (Bug 2) does not hold, the fixed system SHALL render the Decision card the original rendered for that case: `ReturnCaseActions` with reason `returnLapsed ? 'LAPSED' : 'CONTESTED'` for a RETURN_PENDING or RETURN_IN_TRANSIT sale, `DisputeActions` for any other cash sale, and the trade and chargeback panels untouched. `canReportUnpostedSale` SHALL be false, so the room's ship-by note, dispute controls and item prompt reduce to the original conditions. `disputeCashSale`, `resolveCashSaleDispute` and `resolveCashSaleReturnCase` SHALL keep their status sets, reason bounds, DISPUTED and idempotency guards, immediate-refund rule and `withActionLog` names, with no new path that moves money.

**Validates: Requirements 3.1, 3.8, 3.9, 3.10, 3.13**

Property 5: Bug Condition - A lost return-lapse stamp is silent

_For any_ sweep pass and any step-4 row whose stamp matches no row and reports no error, the fixed `sweepCashSaleInspections` SHALL send no notification for that row, SHALL NOT count it in `returnLapsed`, and SHALL NOT call `logBackgroundFailure` for it.

**Validates: Requirements 2.7**

Property 6: Preservation - Won stamps, failed writes and every other sweep step behave as before

_For any_ sweep pass in which no step-4 stamp is lost, the fixed `sweepCashSaleInspections` SHALL produce the same notifications (recipient, title, body and order), stamp writes, counts and `logBackgroundFailure` calls as the original. A won stamp notifies the seller then the buyer and counts once. A failed write logs `cash-sale.return-lapse` with `error.code || 'UPDATE_ERROR'` and `{ cashSaleId }` and skips. A throwing notice logs `THREW` and the pass continues. Steps 1, 2, 3, 5 and 6 are unaffected, and no write in the pass touches any column other than the five stamp columns.

**Validates: Requirements 3.1, 3.11, 3.12**

## Fix Implementation

### Changes Required

**1. `domain/arbitration/arbitrationCase.ts`: the rule**

Add the input and output types and the function. Pure, no new imports:

```ts
/** The `cash_sales` fields a marker case is derived from. */
export interface CashSaleCaseMarkers {
  /** `cash_sales.status`. Any value outside the two flows opens no case. */
  status: string;
  shipLapsedAt: string | null;
  returnDisputedAt: string | null;
  returnLapsedAt: string | null;
}

/** Why a marker case is open, and when it started waiting (its SLA clock). */
export interface CashSaleMarkerCase {
  situation: Extract<ArbitrationCaseSituation, 'SHIP_LAPSED' | 'RETURN_CONTESTED' | 'RETURN_LAPSED'>;
  openedAt: string;
}

export function cashSaleMarkerCase(m: CashSaleCaseMarkers): CashSaleMarkerCase | null {
  if (m.status === 'ESCROW_HELD') {
    return m.shipLapsedAt ? { situation: 'SHIP_LAPSED', openedAt: m.shipLapsedAt } : null;
  }
  if (m.status === 'RETURN_PENDING' || m.status === 'RETURN_IN_TRANSIT') {
    if (m.returnDisputedAt) return { situation: 'RETURN_CONTESTED', openedAt: m.returnDisputedAt };
    if (m.returnLapsedAt) return { situation: 'RETURN_LAPSED', openedAt: m.returnLapsedAt };
  }
  return null;
}
```

Its JSDoc states the rule as "status scopes every marker", records why the ship marker is scoped rather than cleared (cause 3 above), and keeps the existing precedence note (contested wins because a person has already said something is wrong). The `ArbitrationCaseSituation` doc bullets gain their statuses, and the `priorityOf` note that "the caller must set `openedAt`" points at this function. Truthiness matches the original loop, so an empty string reads as unset in both.

**2. `lib/actions/arbitration.ts`: the queue and the case payload**

- In the return-case loop, call `cashSaleMarkerCase` on each candidate row and `continue` on `null`. Take `situation` and `openedAt` from its result. Claim, raised-by, parties, amounts, assignee, note count and deadline fields stay exactly as they are, derived from the returned situation.
- Keep the query as it is, as a candidate read, and update its comment to say the rule decides. It is not tightened into a nested PostgREST `or(and(…))` filter: a second copy of the rule inside a filter string is the drift the pure rule exists to prevent, and the extra rows are a handful.
- Keep `currencyOfContract` and the name lookup reading the unfiltered rows. A chargeback against a C1 sale takes its currency from that row today, and filtering first would drop it to `FALLBACK_CURRENCY`, a 3.4 regression.
- Add two fields to `ArbitrationShipmentEvidence`, each with JSDoc: `shipByAt: string | null` and `shipLapsedAt: string | null`.
- Append `, ship_by_at, ship_lapsed_at` to the `shipRow` select inside the same single string literal (the file's own note on `readResolution` explains why splitting the literal breaks row-type inference), and map both. Both columns are already in `lib/supabase/database.types.ts`.
- `readResolution`, the `not-found` path and every action name stay as they are.

**3. `components/arbitration/NotShippedGuidance.tsx` (new)**

A header comment, then a presentational component with no hooks and no actions, so it renders on the server. Props: `shipByAt`, `shipLapsedAt`, `buyerHasGoods`. It uses the chargeback panel's idiom ("Not ours to decide"): a medium-weight line, muted body, and a `dl` of dates through `formatContractDateTime`, falling back to "Not recorded". Proposed copy:

- **Nothing to decide yet**
- The seller has not posted by the ship-by date, and the buyer's payment is still held.
- Ship by: {ship_by_at} · Flagged: {ship_lapsed_at}
- Nothing has been cancelled or refunded, and nothing happens automatically.
- The parcel may be in the post without tracking. Check in with the seller and keep a record in the staff notes.
- When the seller adds tracking, the sale moves on and this case closes by itself.
- The buyer can report a problem from their contract room. That turns this into a dispute you can resolve here, and because no delivery is recorded, a full refund goes straight back to the buyer.

The final clause, from "and because no delivery is recorded", renders only when `buyerHasGoods` is false. `buyerHasGoods` is already on the resolution payload and is computed by `returnRequiredForRefund`, the rule the orchestrator applies, so the page never promises an outcome the money path would not take.

**4. `components/arbitration/ArbitrationCaseView.tsx`: the Decision card and the evidence**

The CASH_SALE branch checks the situation first:

```tsx
{c.situation === 'SHIP_LAPSED' ? (
  <NotShippedGuidance
    shipByAt={shipment?.shipByAt ?? null}
    shipLapsedAt={shipment?.shipLapsedAt ?? c.openedAt}
    buyerHasGoods={resolution.buyerHasGoods}
  />
) : resolution.status === 'RETURN_PENDING' || resolution.status === 'RETURN_IN_TRANSIT' ? (
  <ReturnCaseActions /* unchanged props */ />
) : (
  <DisputeActions /* unchanged props */ />
)}
```

It is keyed on the situation the case was listed under, not on the status from the resolution read. Those are two reads, and a seller adding tracking between them must still land on guidance rather than on outcomes that would be refused. The refund-failed banner and the already-refunded line above the branch are untouched.

Shipment evidence gains an entry directly under the outbound leg whenever `shipment.shipLapsedAt` is set, using the "Return lapsed" box's markup:

- **Ship-by date passed · {ship_lapsed_at}**
- The seller was due to post by {ship_by_at}. This is a triage signal only. Nothing is cancelled or refunded because of it.

The first sentence is omitted when `shipByAt` is null. The entry is shown on every case whose sale carries the marker, as "Return lapsed" is. This is deliberate: once the buyer reports a problem the case becomes a condition dispute, and this entry is then the only place staff see the missed date.

**5. `domain/contract/cashSaleStatus.ts`: the buyer's condition**

```ts
/**
 * Whether this viewer may report a problem on a posted sale that was never posted (0132).
 * True only for the buyer, only while it still waits to be posted after its ship-by
 * date lapsed. The seller never may: their remedy is to post it.
 */
export function canReportUnpostedSale(
  sale: { status: string; fulfillmentMethod: string | null; shipLapsedAt: string | null },
  viewerRole: 'BUYER' | 'SELLER',
): boolean {
  return (
    viewerRole === 'BUYER' &&
    sale.status === 'ESCROW_HELD' &&
    sale.fulfillmentMethod === 'DELIVERY' &&
    Boolean(sale.shipLapsedAt)
  );
}
```

It lives in `domain/` so it can be property-tested. `CashSaleView` has no component harness: it pulls in Realtime, maps, Stripe and about thirty modules.

**6. `components/sales/CashSaleView.tsx`: the buyer's control**

- Derive `buyerMayReportUnposted = canReportUnpostedSale({ status: sale.status, fulfillmentMethod: sale.fulfillment_method, shipLapsedAt: sale.ship_lapsed_at }, iAmBuyer ? 'BUYER' : 'SELLER')` next to `shipByNote`.
- **Dock ⋯ menu**: the existing INSPECTION "Report a problem" item renders when `(sale.status === 'INSPECTION' && iAmBuyer) || buyerMayReportUnposted`. Same button, same `setConfirming('dispute')`.
- **Protection tab**: `reportAction` renders when a hint exists. The hint is "Raise it before the payment is released." at INSPECTION (unchanged) and "The ship-by date passed without tracking." for an unposted sale. The button markup is shared.
- **Dispute dialog**: label, placeholder and hint come from one `disputePrompt` value.
  - Unposted: "What has happened with this purchase?" / "e.g. The seller has not posted it or replied to my messages…" / "You can add screenshots as evidence after opening the dispute."
  - Otherwise, unchanged: "What is wrong with the item?" / "e.g. The card arrived with a crease not shown in the photos…" / "You can add photos as evidence after opening the dispute."
  - Title, description, confirm label and the `disputeCashSale(sale.id, disputeReason)` call are unchanged. No copy says "escrow".
- **Not added** to the Status panel's phone-only `dockActions`. That step reads "Waiting for {seller} to post it" and asks the buyer for nothing, and on phones the dock and its ⋯ menu stay on screen.
- **Layout**: the ⋯ item sits in a popover, and the Protection button sits inside its own row of a tab that is closed by default. A lapse arriving over Realtime therefore moves nothing outside its region. The dock's note line is already rendered before the lapse.
- `shipByNote`, the steps, the Status panel, `HandoverFailedDialog` and every server call are unchanged.

**7. `components/contract/DittoBondExplainer.tsx`**: JSDoc of `CashSaleProtectionExplainer`'s `reportAction` only, to mention the unposted case. No behavior change.

**8. `lib/trades/cashSaleInspectionSweep.ts`: step 4**

```ts
const { data: won, error } = await admin
  .from('cash_sales')
  .update({ return_lapsed_at: nowIso })
  .eq('id', sale.id)
  .is('return_lapsed_at', null)
  .select('id')
  .maybeSingle();
if (error) {
  // unchanged: logBackgroundFailure('cash-sale.return-lapse', error.code || 'UPDATE_ERROR', { cashSaleId }); continue;
}
// Only the pass that won the stamp notifies and counts. A lost race matches no row
// and reports no error.
if (!won) continue;
```

This is step 6's shape exactly. The misplaced "Only notify if THIS pass won" comment moves to the new guard. Notifications, copy, count, the `THREW` catch and every other step are untouched.

**9. `tests/unit/fakes/supabaseChain.ts`: scripted answers**

All additions are optional, so the five existing suites run unchanged:

```ts
export interface QueuedResult {
  data?: unknown;
  count?: number;
  error?: { message: string; code?: string } | null;   // `code` added
}

/** One awaited chain, as the fake saw it. */
export interface RecordedCall {
  table: string;
  op: 'select' | 'update' | 'insert' | 'upsert' | 'delete';
  /** Argument to `.select()`, or null when it was not called. On a write: "return the row". */
  columns: string | null;
  /** `.eq(column, value)` pairs, so a test can tell rows apart. Recorded, never enforced. */
  match: Readonly<Record<string, unknown>>;
  payload: unknown;
}

export interface RecordedWrite extends RecordedCall {
  op: 'update' | 'insert' | 'upsert' | 'delete';
}

export interface FakeAdminConfig {
  // selects, defaults, throwOnWrite: unchanged
  /**
   * Scripted answer, consulted first. `undefined` falls through to today's behavior:
   * the select queue or default (which still throws when empty), or
   * `{ data: null, error: null }` for a write.
   */
  respond?: (call: RecordedCall) => QueuedResult | undefined;
}
```

The builder's `select(columns?)` records the column list without changing the operation, and `eq(column, value)` records into `match`. In `resolve()`, `calls` is pushed first as today. A select consults `respond`, then the queue, then the default, then throws. A write runs `throwOnWrite` (throwing before recording, as today), records the write, then returns `respond(write) ?? { data: null, error: null }`. The existing suites only read `table` and `payload` from writes, so the extra fields are invisible to them. Routing by `columns` and `match` also spares the new action tests from depending on microtask order: `getArbitrationCase` resolves its own `cash_sales` read synchronously, before the queue's two reads.

### Deliberately unchanged

`supabase/migrations` (no new file), `lib/supabase/database.types.ts`, `lib/supabase/cashSaleProjection.ts` (both ship-by columns already listed), `lib/actions/cashSale.ts`, `lib/actions/admin.ts`, the orchestrator and repository (including both `DISPUTABLE` sets and every resolution guard), `components/admin/DisputeActions.tsx`, `components/admin/ReturnCaseActions.tsx`, `domain/contract/cashSaleSteps.ts` (its DISPUTED step renders the same whatever status a dispute came from), and `flutter_app/` (parity is a recorded follow-up).

### Known limits, not addressed here

- `getArbitrationQueue` reads DISPUTED sales and marker candidates as two separate snapshots. A dispute that commits between them can list a sale twice or not at all for one page load. This is pre-existing for every dispute raised while the queue loads and corrects itself on the next load. The new buyer control makes ESCROW_HELD → DISPUTED one more such path.
- Step 4's stamp does not re-check `status` or `return_shipped_at`, so a return posted between the select and the stamp can still be stamped lapsed. That is a different race from C3 and is left as it is.
- For a return that is both contested and lapsed, the queue says "Return contested" while the Decision card keeps its LAPSED copy, because `reason` reads `returnLapsed` first. 3.3 requires that card to stay as it is.

## Testing Strategy

### Validation Approach

Two phases. First, exploratory tests run against F and must fail, which confirms each root cause with a concrete counterexample. Then the fix lands, and the fix-checking and preservation tests must pass on F′. Preservation tests are written and run against F first, where they must already pass, so they record observed behavior rather than intended behavior.

The FakeAdmin extension lands before either phase, because both need it. Re-running the five suites that already use it shows its default behavior is unchanged.

Every run is a targeted Vitest command, never `npm run build` or `npm run typecheck`:

```cmd
npx vitest --run tests/property/lapsedSaleCase.test.ts
npx vitest --run tests/unit/arbitrationQueue.test.ts tests/unit/cashSaleInspectionSweep.test.ts
npx vitest --run tests/component/arbitrationCaseView.test.tsx
npx vitest --run tests/unit/arbitrationCase.test.ts tests/unit/tradeInspectionSweep.test.ts tests/unit/staleCollateralTrades.test.ts tests/unit/tradeFeeDrain.test.ts tests/unit/settlementWebhookNotify.test.ts tests/unit/webhookAuthentication.test.ts tests/unit/actionLogCoverage.test.ts
```

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples on F, before the fix, and confirm or refute each root cause.

**Test Plan**: Drive the real action, sweep and view modules with C inputs, with only the database client, the staff gate, evidence reads, notifications, email and the error log replaced. These are the same suites that later carry fix checking, so each exploratory assertion becomes a fix check unchanged.

**Test Cases**:

1. **Return-flow sale listed** (`tests/unit/arbitrationQueue.test.ts`): a RETURN_PENDING candidate row with only `ship_lapsed_at`, 8 days old. Assert it is absent from `cases`. Will fail on F: listed as `SHIP_LAPSED`, `openedAt` the old marker, HIGH for PAST_SLA, counted overdue.
2. **Posted lapsed return** (same file): RETURN_IN_TRANSIT, `return_lapsed_at` null (cleared on posting), `ship_lapsed_at` set. Will fail on F the same way.
3. **Opening it** (same file): `getArbitrationCase('CASH_SALE', ref)` for case 1. Assert `not-found`. Will fail on F: `ok`, with resolution status RETURN_PENDING and `returnLapsed: false`, which is what made the card read as contested.
4. **"Not shipped" Decision card** (`tests/component/arbitrationCaseView.test.tsx`): a `SHIP_LAPSED` case with resolution status ESCROW_HELD. Assert no button named "Refund buyer in full", "Release to seller" or "Partially refund", and a "Ship-by date passed" entry. Will fail on F: `DisputeActions` renders, and there is no entry.
5. **Lost stamp** (`tests/unit/cashSaleInspectionSweep.test.ts`): one step-4 row whose stamp `respond`s `{ data: null, error: null }`. Assert no notification, `returnLapsed: 0`, no `logBackgroundFailure`. Will fail on F: two notifications and `returnLapsed: 1`.
6. **Buyer control**: no automated exploratory test, because `CashSaleView` has no harness and the predicate is new. Confirmed by reading instead: every "Report a problem" trigger is gated on `sale.status === 'INSPECTION' && iAmBuyer`.

**Expected Counterexamples**:

- `{ status: 'RETURN_PENDING', ship_lapsed_at: <8 days ago>, return_disputed_at: null, return_lapsed_at: null }` listed as `SHIP_LAPSED`, HIGH, overdue.
- A `SHIP_LAPSED` detail rendering three money buttons that call `resolveCashSaleDispute`.
- A sweep pass whose single step-4 stamp was lost reporting `returnLapsed: 1` with "Return not posted — we are reviewing it" and "Return deadline passed" sent.
- Possible causes if any of these does not appear: the query or loop already differs from HEAD, the case view's branch is keyed differently than read, or the client resolves a chain differently than the fake assumes.

Optionally, current impact can be sized with a read-only count. This is not part of verification:

```sql
select count(*) from cardtrade.cash_sales
where status in ('RETURN_PENDING', 'RETURN_IN_TRANSIT')
  and ship_lapsed_at is not null
  and return_disputed_at is null
  and return_lapsed_at is null;
```

### Fix Checking

**Goal**: For every input in C, the fixed code shows the expected behavior.

A suffix names the bug whose `isBugCondition` / `expectedBehavior` from Bug Details is meant.

**Pseudocode:**

```
-- Bug 1
FOR ALL s WHERE isBugCondition_1(s) DO
  r := cashSaleMarkerCase(s)
  ASSERT expectedBehavior_1(s, r)
END FOR
-- and, at the action level, for C1 rows: absent from cases and summariseQueue,
-- getArbitrationCase('CASH_SALE', s.id) = not-found

-- Bug 2
FOR ALL resolutionStatus IN CashSaleStatus DO            -- covers the two-read race
  view := render(ArbitrationCaseView, SHIP_LAPSED case, resolution.status = resolutionStatus)
  ASSERT no money control AND guidance AND both dates AND ship-by evidence entry
END FOR
FOR ALL sale WHERE isBugCondition_2({ sale, viewer: BUYER }) DO
  ASSERT canReportUnpostedSale(sale, 'BUYER')
END FOR
FOR ALL sale WHERE sale.fulfillment_method = DELIVERY DO
  ASSERT canReportUnpostedSale(sale, 'BUYER') = (cashSaleMarkerCase(sale).situation = SHIP_LAPSED)
END FOR

-- Bug 3
FOR ALL scripts S of step-4 stamp outcomes containing at least one LOST DO
  run := sweepCashSaleInspections'(S)
  ASSERT FOR EACH LOST row: no notification, no log
  ASSERT run.returnLapsed = |WON rows in S|
END FOR
```

### Preservation Checking

**Goal**: For every input outside C, the fixed code behaves exactly as the original.

**Pseudocode:**

```
-- Bug 1: legacySituationOf transcribes F's query + loop (see Bug Details)
FOR ALL s WHERE NOT isBugCondition_1(s) DO
  ASSERT cashSaleMarkerCase(s) = legacySituationOf(s)       -- situation and openedAt, or both none
END FOR

-- Bug 2
FOR ALL (situation ≠ SHIP_LAPSED, resolutionStatus) DO
  ASSERT decisionPanel'(situation, resolutionStatus) = decisionPanel(resolutionStatus)
  -- RETURN_PENDING / RETURN_IN_TRANSIT -> ReturnCaseActions(reason from returnLapsed),
  -- other cash sales -> DisputeActions
END FOR
FOR ALL (sale, role) WHERE NOT isBugCondition_2({ sale, viewer: role }) DO
  ASSERT NOT canReportUnpostedSale(sale, role)
END FOR

-- Bug 3
FOR ALL scripts S with step-4 outcomes in {WON, ERROR(code?)} DO
  ASSERT sweepCashSaleInspections'(S) = sweepCashSaleInspections(S)
  -- same notices in order, same counts, same log calls, same writes
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

Here specifically, Bug 1's domain is 13 statuses times eight marker combinations, plus arbitrary status strings and timestamps, and the mirror condition C1′ was itself found by enumerating that domain. Bug 3's domain is any sequence of stamp outcomes, where a hand-picked case would not exercise a lost stamp between two won ones.

**Test Plan**: Run each preservation test on F first. The Bug 1 oracle is a transcription of F's query and loop. The Bug 3 oracle is the behavior observed on F: seller then buyer notice per won stamp, one count per won stamp, one log per failed write. Both must pass on F before the fix and on F′ after.

**Test Cases**:

1. **In-flow situations**: on F, contested, lapsed and ship-lapsed rows produce the situations and clocks in the table above, including contested-with-old-ship-marker. Then assert F′ agrees for every row outside C.
2. **Queue payload**: on F, a `SHIP_LAPSED` row's claim, parties and `raisedById: null`, a `RETURN_CONTESTED` row's seller-raised claim, a DISPUTED sale with a ship marker listed once as a condition dispute, and a chargeback whose currency comes from a C1 sale. Then assert all of it is identical on F′.
3. **Decision cards**: on F, `RETURN_CONTESTED`, `RETURN_LAPSED`, contested-and-lapsed (LAPSED copy), `CONDITION_DISPUTE`, trade and chargeback render their current panels. Then assert the same on F′.
4. **Sweep**: on F, one row per step gives `{ completionNotified: 1, warned: 1, returnWarned: 1, returnLapsed: 1, shipWarned: 1, shipLapsed: 1 }` with today's titles, and step 6 lost and failed stamps behave as they do now. Then assert the same on F′.

### Unit Tests

- `cashSaleMarkerCase`: one example per row of the mapping table, including contested taking precedence over lapsed and an unknown status string.
- `canReportUnpostedSale`: buyer and seller on a lapsed ESCROW_HELD delivery sale; buyer on IN_PERSON, unlapsed, IN_TRANSIT and DISPUTED sales.
- Sweep step 4: won, lost, failed write with a code, failed write without one (`UPDATE_ERROR`), and a throwing notice (`THREW`, and the next row still runs). `createNotification`, `emailNotify` and `logBackgroundFailure` are mocked so recipients, titles and log arguments can be asserted. `createAdminClient` returns FakeAdmin, with the six `cash_sales` reads queued in step order.
- Sweep, other steps (3.11): step 6 won, lost and failed, and a one-row-per-step pass with today's titles and stamp payloads.
- `ArbitrationCaseView`: the guidance copy and both formatted dates, the evidence entry with and without `shipByAt`, and the refund clause hidden when `buyerHasGoods` is true.

### Property-Based Tests

`tests/property/lapsedSaleCase.test.ts` (domain project, fast-check):

- **Fix, Bug 1**: dedicated C1 and C1′ arbitraries, because the general arbitrary hits C1 only about 2% of the time and filtering it would discard most runs. Assert `expectedBehavior_1`.
- **Preservation, Bug 1**: a general arbitrary over the 13 statuses plus arbitrary strings, with each marker `fc.option(isoTimestamp, { nil: null, freq: 2 })` so it is set about half the time, filtered by `!isBugCondition_1` (under a tenth discarded). Assert equality with `legacySituationOf`.
- **Invariants from 2.2**: a `SHIP_LAPSED` result implies ESCROW_HELD, a return result implies the return flow, and `openedAt` equals the marker the situation names. Metamorphic: replacing the markers outside a row's flow with arbitrary values never changes the result, which is the requirement's "a ship-lapse marker SHALL never label, age or rank a sale in the return flow".
- **Bug 2, buyer half**: a C2 arbitrary gives true for BUYER. Any sale gives false for SELLER. Any sale outside C2 gives false for both. For DELIVERY sales the predicate agrees with `cashSaleMarkerCase` returning `SHIP_LAPSED`.

`tests/unit/cashSaleInspectionSweep.test.ts`:

- **Fix and preservation, Bug 3**: `fc.array` of step-4 outcomes `WON | LOST | ERROR(code?)` (1 to 8 rows), scripted through `respond` keyed on the row id in `match`. Assert notices only for won rows (seller then buyer), `returnLapsed` equal to the won count, and logs only for failed rows with the right code. With LOST excluded, the same property passes on F. With LOST included, it fails on F with a minimal `[LOST]` counterexample. Also assert that every `cash_sales` write payload is one of the five stamp columns.

`tests/component/arbitrationCaseView.test.tsx` (component project, `numRuns` around 25 to keep jsdom fast):

- For a `SHIP_LAPSED` case and any resolution status, no money control renders. A money control is any button from `DisputeActions` ("Refund buyer in full", "Release to seller", "Partially refund") or `ReturnCaseActions` ("Refund the buyer", "Release to the seller").
- For any other situation and status, the rendered panel matches the original status-based mapping.

### Integration Tests

- **Action level** (`tests/unit/arbitrationQueue.test.ts`): the real `getArbitrationQueue` and `getArbitrationCase` composed end to end, with `@/lib/staffGate`, `@/lib/supabase/admin` (FakeAdmin with `respond` routing `cash_sales` reads by `match.status`, `columns` and `match.id`), `@/lib/actions/disputeEvidence` and `next/cache` mocked. It covers the exploratory cases, the `SHIP_LAPSED` claim and clock, contested-with-old-marker, the DISPUTED-with-marker listing, chargeback currency, `summariseQueue` totals, and `shipment.shipByAt` and `shipLapsedAt` on an open "Not shipped" case. Error logging is off under test, so `withActionLog` records nothing and returns each result as is.
- **Sweep level**: a whole `sweepCashSaleInspections` pass over a scripted world with every step populated, asserting the full result object, notice order and stamp writes.
- **Page body**: `ArbitrationCaseView` rendered whole for each situation, with `@/lib/actions/admin`, `@/lib/actions/arbitration` and `sonner` mocked. The view itself has no hooks.
- **Manual, on your cadence (not automated)**: on a dev database, set `ship_lapsed_at` on an ESCROW_HELD delivery sale and confirm in the buyer's room the ⋯ item, the Protection row, the not-posted prompt and the unchanged note. Raise the dispute and confirm the queue lists one condition dispute and a full refund goes out immediately. On a second such sale, raise and then withdraw a dispute, and confirm it relists as "Not shipped" with no new notices. This is the only coverage for the `CashSaleView` wiring itself.
