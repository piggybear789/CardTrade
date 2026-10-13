# Bugfix Requirements Document

## Introduction

A review of the ship-by work (HEAD `e65f1a8`, "Posted sales get a ship-by date", migration 0132) and the hourly cash-sale sweep found three defects in how lapsed cash sales reach staff. The user also asked for one gap behind the second defect to be fixed in the same pass.

- **Bug 1: return-flow sales show up as "Not shipped" cases.** A sale that misses its ship-by date carries that flag for the rest of its life. Take a sale that is then shipped late, disputed, and awarded a refund that waits on the goods coming back. The queue lists it as a seller who has not posted. Its age is measured from the old flag, its Decision card refuses every outcome, and it stays listed for as long as the return runs.
- **Bug 2: a genuine "Not shipped" case has no working decision and no way out.** Staff are offered refund and release outcomes, and every one fails because the sale is not disputed. The server accepts a dispute while the sale waits to be posted, but the buyer's contract room has no control to raise one. If the seller never posts, nothing in the product can move the case on.
- **Bug 3: the return-lapse sweep sends its notices after losing a race.** When two passes overlap, the pass whose stamp lost still sends both members their "return deadline passed" notifications and still counts the sale.

The impact is threefold. The triage queue lists false cases that can rank above real ones and cannot be cleared. Real cases have staff controls that all fail while the buyer's payment stays held. Members get duplicate notices.

The fix stays inside existing policy. Missing a ship-by date or a return deadline still cancels, refunds and releases nothing (0089, 0132). The fix adds no new way to move money. The staff decision on the merits is not widened beyond DISPUTED sales, because its DISPUTED guard and its idempotency guard are deliberate.

Two follow-ups are recorded here. Neither is a requirement of this fix:

- A staff action that cancels an ESCROW_HELD sale and refunds the buyer. That is a new money path, so it needs a product decision.
- Flutter parity for the buyer's dispute control on a lapsed sale that has not been posted. The Flutter sale room offers a dispute only at inspection.

In this document, a sale's ship-by date has **lapsed** once the hourly sweep has found it passed with nothing posted and flagged the sale (`ship_lapsed_at` set). A return has **lapsed** once the sweep has flagged a dispatch deadline that passed unposted (`return_lapsed_at` set). A return is **contested** once the seller has disputed it (`return_disputed_at` set).

## Bug Analysis

### Current Behavior (Defect)

#### Bug 1: return-flow sales listed as "Not shipped"

Bug condition: a cash sale in RETURN_PENDING or RETURN_IN_TRANSIT whose ship-by date lapsed earlier in its life, with a return that is neither contested nor lapsed.

1.1 WHEN a cash sale is RETURN_PENDING or RETURN_IN_TRANSIT, its ship-by date lapsed earlier in its life, and its return is neither contested nor lapsed THEN the system lists it in the arbitration queue as a "Not shipped" case claiming "The seller has not posted the item by the ship-by date. The buyer's payment is still held.", although the seller did post and the return is running normally

1.2 WHEN such a sale is listed THEN the system measures its age from the old ship-lapse timestamp, so it can arrive already past the 72-hour SLA, ranked HIGH and counted as overdue in the queue totals, and it stays listed through RETURN_PENDING and RETURN_IN_TRANSIT until the return finishes

1.3 WHEN staff open such a case THEN the Decision card presents the return decision as a return the seller contested ("The seller says the return did not arrive as expected"), and every outcome is refused with "That return is not waiting on a decision.", so staff can neither act on the case nor clear it

#### Bug 2: a "Not shipped" case has no working decision

Bug condition: a posted (delivery) cash sale that is ESCROW_HELD and whose ship-by date has lapsed. This is a genuine "Not shipped" case.

1.4 WHEN staff open a genuine "Not shipped" case THEN the Decision card offers "Refund buyer in full", "Release to seller" and "Partially refund", and confirms each one as moving real money. Every one then fails with "This sale is ESCROW_HELD, so it cannot be resolved." because the sale is not disputed

1.5 WHEN staff open a genuine "Not shipped" case THEN the case page does not say what can actually happen next: that nothing has been cancelled or refunded, that the seller recording tracking closes the case, or how the buyer can be refunded. It never shows the ship-by date the seller missed. The shipment evidence reads "Not recorded" with no dated lapse entry, unlike a lapsed return

1.6 WHEN the buyer of a posted sale that is ESCROW_HELD with a lapsed ship-by date opens their contract room on the web THEN the system offers no way to raise a dispute, even though the server accepts a dispute from ESCROW_HELD. "Report a problem" appears only at INSPECTION, "Not received" only at IN_TRANSIT, and "Handover failed" only at HANDOVER. If the seller never posts, the case has no exit inside the product and the buyer's payment stays held

#### Bug 3: return-lapse notices sent after a lost race

Bug condition: two overlapping sweep passes (a repeated cron delivery, or a manual trigger of the jobs route) select the same RETURN_PENDING sale whose dispatch deadline passed with nothing posted. The other pass stamps `return_lapsed_at` first, so this pass's conditional stamp matches no row.

1.7 WHEN a sweep pass's stamp of a lapsed return matches no row because another pass already stamped it THEN the system still sends the seller "Return not posted — we are reviewing it" and the buyer "Return deadline passed", and still counts the sale in `returnLapsed`. Both members receive duplicate notices and the job over-reports

### Expected Behavior (Correct)

#### Bug 1

2.1 WHEN a cash sale is RETURN_PENDING or RETURN_IN_TRANSIT, its ship-by date lapsed earlier in its life, and its return is neither contested nor lapsed THEN the system SHALL NOT treat it as an open case. It SHALL be absent from the queue and from the queue totals, and a direct request for its case page SHALL report that the case is not open

2.2 WHEN the system decides whether a cash sale is a "Not shipped" case or a return case THEN it SHALL derive the situation from the sale's status and its markers together, using one pure rule with no database or framework access, so that every combination can be tested:
- SHIP_LAPSED only while the sale is ESCROW_HELD and its ship-by date has lapsed, with the clock starting at the lapse
- RETURN_CONTESTED or RETURN_LAPSED only while the sale is RETURN_PENDING or RETURN_IN_TRANSIT, with contested taking precedence over lapsed and the clock starting at the contest or the lapse
- no case for any other combination of status and markers

A ship-lapse marker SHALL therefore never label, age or rank a sale in the return flow

2.3 WHEN staff open a return case from the queue THEN its return SHALL be contested or lapsed, so the system never refuses the return decision as "not waiting on a decision", and the Decision card SHALL describe the actual reason (contested or lapsed)

#### Bug 2

2.4 WHEN staff open a genuine "Not shipped" case THEN the Decision card SHALL NOT offer any outcome that the system would refuse because the sale is not disputed

2.5 WHEN staff open a genuine "Not shipped" case THEN the case page SHALL tell staff what the case is and what can actually happen:
- the seller has not posted by the ship-by date, and the buyer's payment is still held
- nothing has been cancelled or refunded, and nothing will be done automatically
- the parcel may be in the post without tracking recorded, so staff can check in with the seller and keep a record in the staff notes
- the seller recording tracking moves the sale on and closes the case by itself
- the buyer can report a problem from their contract room, which turns the case into a dispute staff can resolve; because no delivery is recorded, a full refund then goes back to the buyer straight away
- the ship-by date the seller missed, and when the sale was flagged

2.6 WHEN the buyer of a posted sale that is ESCROW_HELD with a lapsed ship-by date opens their contract room on the web THEN the system SHALL offer "Report a problem", which raises a dispute through the existing member dispute path. Its prompt SHALL fit an item that has not been posted, rather than asking what is wrong with an item the buyer has not received. A dispute raised this way SHALL turn the sale into a dispute in the staff queue, and SHALL move no money by itself

#### Bug 3

2.7 WHEN a sweep pass's stamp of a lapsed return matches no row because another pass already stamped it THEN the system SHALL skip that sale without notifying either member, without counting it, and without logging a failure. Only the pass whose stamp actually took effect SHALL notify and count

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a posted sale passes its ship-by date with nothing posted, or a buyer misses a return deadline, THEN the system SHALL CONTINUE TO cancel, refund and release nothing because of it. The flag SHALL CONTINUE TO be a triage signal only, and every refund or release SHALL CONTINUE TO go through the existing dispute and return decisions

3.2 WHEN a posted sale is ESCROW_HELD and its ship-by date has lapsed THEN the system SHALL CONTINUE TO list it as a "Not shipped" case with the same claim and parties, with its clock starting at the lapse, under the same priority rules. An ESCROW_HELD sale whose ship-by date has not lapsed SHALL CONTINUE TO be absent from the queue

3.3 WHEN a RETURN_PENDING or RETURN_IN_TRANSIT sale's return is contested or lapsed THEN the system SHALL CONTINUE TO list it as "Return contested" (which takes precedence) or "Return lapsed". Its claim, clock and raised-by SHALL stay the same, and so SHALL its Decision card (the return decision with reason CONTESTED or LAPSED). This SHALL hold even when the sale also carries an old ship-lapse marker

3.4 WHEN a cash sale is DISPUTED (whatever its ship-by history), a trade is DISPUTED, or a chargeback is open THEN the system SHALL CONTINUE TO list it once, exactly as today, with its existing Decision card

3.5 WHEN staff open any case page THEN the system SHALL CONTINUE TO resolve it by re-deriving the queue. A sale SHALL be openable exactly when it is listed, and a case that has left the queue SHALL report "That case is not open, or does not exist."

3.6 WHEN the seller records a shipment on a "Not shipped" sale THEN the system SHALL CONTINUE TO move it out of ESCROW_HELD and out of the queue without staff action

3.7 WHEN a buyer withdraws a dispute they raised on an ESCROW_HELD sale with a lapsed ship-by date, and the sale returns to ESCROW_HELD with nothing posted, THEN the system SHALL CONTINUE TO list it as a "Not shipped" case. It SHALL NOT flag the sale again or notify either member again

3.8 WHEN either party views a posted sale that is ESCROW_HELD THEN the contract room SHALL CONTINUE TO show the ship-by note: "Post by …" for the seller, "The seller posts by …" for the buyer, or, once lapsed, "Ship-by date passed (…) · our team is checking in"

3.9 WHEN a sale is INSPECTION, IN_TRANSIT or HANDOVER THEN the contract room SHALL CONTINUE TO offer the existing dispute controls to the same parties as today. WHEN a sale is ESCROW_HELD THEN the contract room SHALL CONTINUE TO offer no dispute control to the seller, and none to the buyer unless it is a posted sale with a lapsed ship-by date

3.10 WHEN a party raises a dispute THEN the system SHALL CONTINUE TO accept it only from ESCROW_HELD, IN_TRANSIT, HANDOVER or INSPECTION, and only with a non-empty reason of at most 1000 characters. WHEN staff resolve a dispute THEN the decision on the merits SHALL CONTINUE TO:
- refuse any sale that is not DISPUTED
- return success, without refunding again, on a sale it already decided
- refund a full REFUND_BUYER outcome immediately, without requiring a return, when the sale has no delivery recorded, unless an operator overrides the return requirement

3.11 WHEN the hourly sweep runs THEN the completion notices, the inspection-window warning, the return-deadline warning, the ship-by warning and the ship-by lapse flag SHALL CONTINUE TO select, stamp, notify, count and log exactly as they do today

3.12 WHEN a sweep pass's stamp of a lapsed return takes effect THEN the system SHALL CONTINUE TO send both notifications with their current copy and to count the sale. WHEN that write returns an error THEN the system SHALL CONTINUE TO log a background failure named `cash-sale.return-lapse`, with the database error code (or `UPDATE_ERROR`) and context limited to identifiers, and to skip the sale without notifying. WHEN a notification throws THEN the system SHALL CONTINUE TO log it as `cash-sale.return-lapse` with `THREW`, without stopping the pass

3.13 WHEN any action touched by this fix runs THEN the system SHALL CONTINUE TO record it under its existing action name (`arbitration.getArbitrationQueue`, `arbitration.getArbitrationCase`, `admin.resolveCashSaleDispute`, `admin.resolveCashSaleReturnCase`, `cashSale.disputeCashSale`), so its error groups in the admin console stay continuous
