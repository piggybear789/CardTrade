# Red team: cash-sale completion, returns and tracking

Scope: hypotheses E, F, G and N, plus new attacks found on this surface. Read-only review. Nothing was executed against Stripe, Supabase or Ship24. Line numbers are from the working tree at review time.

Summary of verdicts

| # | Hypothesis | Verdict | Severity |
|---|---|---|---|
| F1 | Seller records a tracking number for an old, already-delivered parcel. The inspection clock starts in the PAST, so the sale auto-completes and pays out within about 2 hours | CONFIRMED | Critical |
| E1 | Return scam: the refund fires the moment the carrier says delivered. The seller has no inspection window | CONFIRMED | High |
| E2 / F3 | Buyer gives a return tracking number for any delivered parcel (wrong address, unrelated parcel) and gets refunded while keeping the card | CONFIRMED (code). Whether it fires depends on Ship24 | High |
| F2 | Tracking numbers are not unique, not tied to an address or postcode, and not checked against the ship date. Applies to the outbound leg, the return leg and trades | CONFIRMED | High (multiplies F1/E2) |
| N1 | Cash sale: price, lines, postage or method changed between the buyer viewing and paying | PARTIALLY MITIGATED (server side is sound; the client re-binds to whatever version is live) | Low |
| N2 | Trade: a handover edit after the victim accepted. It does not bump the version, and it is allowed in COLLATERAL_LOCKED and allows DELIVERY | CONFIRMED | High (trade surface) |
| G1 | In-person cash sale is completed by social engineering. The payout is synchronous with no cooling-off | PARTIALLY MITIGATED (UI warning only) | Medium |
| G2 | Buyer coerced into "received" then "accept". Immediate payout, and no dispute is possible after COMPLETED | PARTIALLY MITIGATED | Medium |
| NEW-1 | The return leg has NO pull path. If the Ship24 webhook never fires (the code says it never has), returns never auto-refund | CONFIRMED (availability / liability) | Medium |
| NEW-2 | Ship24 `events[0]` is taken as the delivery instant. If the array is oldest-first, every honest sale's window is shortened | UNVERIFIABLE FROM CODE | Medium |
| NEW-3 | A chargeback does not freeze or reverse the seller release. Stolen card plus a colluding verified seller lets the money out fast | PARTIALLY MITIGATED (Stripe/Dashboard dependent) | Medium |

---

## F1. A stale delivered tracking number pays the seller before the buyer can act. CONFIRMED, Critical

### Attack
1. A dishonest seller (Identity-verified, payout-enabled) sells a SINGLE card for cash, delivery. The buyer pays, so the sale is ESCROW_HELD and the money sits in the platform balance.
2. The seller ships nothing, or ships an empty envelope. In "Mark shipped" they enter the tracking number of ANY parcel that was delivered more than 7 days ago: one they received, an old sale, or a number from a photo of a label.
3. `recordCashSaleShipment` registers it with Ship24 and moves the sale to IN_TRANSIT. The next time either party opens the room, `scheduleCashSaleTrackingCheck` asks Ship24, gets `delivered` plus the carrier's historical `occurrenceDatetime`, and calls `apply_cash_sale_tracking` with that past instant. The seller can also trigger this themselves with `syncCashSaleTracking` (web action or `POST /api/mobile/cash-sale/sync-tracking`).
4. The SQL computes `inspection_deadline_at = delivered_at + 7 days`, which is already in the past.
5. pg_cron `auto_complete_due_cash_sales` (minute :07) completes it and queues the payout. `/api/jobs/cash-sale-payouts` (minute :47) pays the seller. The buyer gets 0 to about 60 minutes to notice and dispute, and gets no inspection-warning email, because that warning requires a deadline still in the future.

### Evidence
- `domain/orchestrator/cashSaleOrchestrator.ts:3016`: `const tracking = await deps.tracking.registerShipment(params.shipment);`. The only checks are a carrier and `trackingNumber.trim().length < 2` (`:3014`). Nothing compares the result's `status`/`deliveredAt` to "now", even though `registerShipment` already reports DELIVERED.
- `cashSaleOrchestrator.ts:3098-3101` (`syncCashSaleTracking`): `deliveredAt: snapshot.deliveredAt ?? null`, callable by any participant, including the seller.
- `lib/tracking/refreshOnRead.ts:147-151`: the room-open path calls `apply_cash_sale_tracking` with `p_delivered_at: snapshot.deliveredAt`.
- `domain/services/tracking/ship24Tracking.ts:82, 129`: `lastEvent = ...events?.[0]`, and `deliveredAt` is the carrier's timestamp, taken without any bound.
- `supabase/migrations/0011_cash_sale_auto_settle.sql` (`apply_cash_sale_tracking`, still the live definition; no later migration replaces it): `v_delivered_at := coalesce(p_delivered_at, now()); v_deadline := v_delivered_at + (... '7 days')`. There is no `greatest(..., now())` and no comparison with `shipped_at`.
- `0038_cash_sale_seller_payout.sql` (`auto_complete_due_cash_sales`): `inspection_deadline_at <= now()`, then `perform cardtrade.mark_cash_sale_payout_due(r.id)`.
- `lib/trades/cashSaleInspectionSweep.ts:116`: `.gt('inspection_deadline_at', nowIso)`. A deadline that is already past is never warned.
- Contrast with trades: `domain/fulfilment/inspection.ts`, `deriveTradeInspectionDeadline`, has `TRADE_INSPECTION_FLOOR_HOURS = 24` measured from when inspection was entered. The cash sale has no equivalent floor.
- 0132 adds a ship-by deadline (`set_cash_sale_ship_by`) with staff flagging. That gives a seller who has nothing to ship a reason to enter any tracking number.

### Money impact
The full sale amount less the fee goes to a seller who shipped nothing. Loss bearer: the buyer, then the platform. The buyer's remaining recourse after COMPLETED is a chargeback, and since the platform is `losses_collector` it absorbs that, with the seller already paid (no `reverse_transfer`, see NEW-3). A fraud ban then follows, but the money is gone. Repeatable across every open sale the seller has, and see F2 for one number serving many sales.

### Fix
1. In `apply_cash_sale_tracking`, clamp the clock start: `v_delivered_at := greatest(coalesce(p_delivered_at, now()), v_sale.shipped_at)`, and compute the deadline from `greatest(v_delivered_at, now())`, so the window is always at least 7 days from when the platform learned of the delivery. Equivalently, mirror the trade's 24h-or-more floor, but a full 7 days from "learned" is safer for cash.
2. Refuse a shipment (`recordCashSaleShipment`) when `registerShipment` already reports DELIVERED, or reports a first-scan or delivery time earlier than the sale's `payment_settled_at`. Flag it for staff instead.
3. Store the raw carrier delivery time separately from the clock-start time, for arbitration.

---

## E1. Return scam: no seller inspection window before the automatic refund. CONFIRMED, High

### Attack
1. The buyer receives a genuine $800 card, swaps it for a fake (or keeps it) and disputes with "not as described".
2. Staff, or the seller conceding through `settleCashSaleDisputeAsParty`, awards REFUND_BUYER. Because `carrierDeliveredAt`/`receivedAt` is set, `returnRequiredForRefund` routes the sale to RETURN_PENDING.
3. The buyer posts a fake card or an empty, weighted envelope with real tracking to the seller's return address, then records it (`recordCashSaleReturnShipment`), and the sale moves to RETURN_IN_TRANSIT.
4. Ship24 reports delivered. The webhook calls `apply_cash_sale_return_tracking` (which stamps the delivery and queues the refund) and then, in the SAME request, `finalizeReturnedCashSale`, which calls `refundPayment` and moves the sale to REFUNDED.
5. The seller opens the parcel hours later and finds nothing. `disputeCashSaleReturn` now returns INVALID_STATE, because the sale is REFUNDED.

### Evidence
- `app/api/webhooks/ship24/route.ts:196-218`: RPC, then `createDefaultCashSaleOrchestrator(...).finalizeReturn({ cashSaleId })`, synchronously.
- `cashSaleOrchestrator.ts:2350`: the only freeze is `if (sale.returnDisputedAt)`, which a seller can only set BEFORE delivery, when they have nothing to go on.
- `cashSaleOrchestrator.ts:2368-2410`: `refundTarget = Math.max(sale.refundCents || sale.amountCents, 0)`, then `deps.payments.refundPayment(...)`, then `recordReturnFinalised` (`:2423`).
- `cashSaleOrchestrator.ts:2471`: `if (sale.status !== 'RETURN_IN_TRANSIT' && sale.status !== 'RETURN_PENDING')`, so a seller cannot contest after REFUNDED.
- `0088_return_conditional_refunds.sql`, `apply_cash_sale_return_tracking`: `if v_sale.return_disputed_at is null then perform cardtrade.mark_cash_sale_refund_due(...)`.
- The steering doc claims "Carrier-confirmed delivery to the Seller automatically refunds". That is accurate, and it is the vulnerability.

### What does mitigate it
- The listing is relisted only on finalisation, and the arbitration case view shows both legs (`lib/actions/arbitration.ts:673`).
- The refund drain respects `return_disputed_at` (`supabaseCashSaleRepository.ts`, `listDueRefunds`, `.is('return_disputed_at', null)`). This guard is real, but it is moot because finalisation refunds directly rather than through the drain.

### Money impact
The seller loses the card and the sale price. Loss bearer: the seller, unless staff reverse it out of platform funds. The buyer keeps the card and the full refund, which includes postage and the platform fee, so the platform also eats its Stripe fee.

### Fix
Split "carrier delivered" from "refund released". On return delivery, set `return_carrier_delivered_at` and open a short seller inspection window, for example `return_inspection_deadline_at = delivered + 48–72h`. During that window the seller may `disputeCashSaleReturn`, which should also be allowed in a new `RETURN_DELIVERED` sub-state. Refund automatically when the window lapses, by a sweep, not by the webhook. This preserves "the seller cannot sit on it", which is the buyer's protection, while giving the seller the same right to inspect the buyer had. Remove the synchronous `finalizeReturn` call from the webhook.

---

## E2 / F3. The return tracking number need not reach the seller at all. CONFIRMED in code, runtime-dependent

### Attack
In step 3 of E1 the buyer does not ship anything. They enter the tracking number of any parcel that a carrier marked delivered and that this Ship24 account has not seen before, for example a parcel they received from another shop. Nothing ties the number to the seller's return address, its postcode, the return deadline window, or even "a different number from the outbound leg".

### Evidence
- `cashSaleOrchestrator.ts:2284`: `if (!carrier || trackingNumber.length < 2)` is the only validation. `:2292` registers it and stores whatever status Ship24 returns, including `DELIVERED`, without reacting.
- `ship24Tracking.ts:69`: `destinationCountryCode: 'AU'` is the only destination data sent. No postcode, and nothing compared with `cash_sale_return_details`.
- The webhook matches on the number alone (`route.ts:188`, `.eq('return_tracking_number', trackingNumber)`) and takes the delivery time from the payload.

### Runtime dependency (cannot verify from code)
The return leg is only ever closed by the Ship24 WEBHOOK (see NEW-1). Whether Ship24 sends a `delivered` webhook for a tracker created on an already-delivered parcel depends on Ship24's behaviour and the Dashboard webhook configuration. Re-using the OUTBOUND number probably would NOT re-fire, because Ship24 dedupes trackers per account. A fresh, previously unseen number probably would.

### Fix
- Refuse a return tracking number equal to the outbound `tracking_number`, or one already on another live contract (see F2).
- Refuse, or flag for staff, when registration reports DELIVERED or a first-scan time earlier than `dispute_resolved_at`.
- Compare the carrier's destination postcode, where Ship24 exposes it, against the return address's postcode.
- The E1 seller window is the backstop that makes all of these defence in depth rather than load-bearing.

---

## F2. Tracking numbers are unbound. CONFIRMED, High (amplifier)

- No uniqueness. No unique constraint or index on `cash_sales.tracking_number`, `return_tracking_number`, or the trade tracking columns: a search for `unique.*tracking_number` across all migrations finds nothing.
- One number, many sales. The webhook loops over up to 5 matches per leg (`route.ts:145-148`, `.limit(5)`, and the return equivalent at `:188-191`). A binder seller with several buyers can enter ONE delivered number on every open sale and start every clock at once (combined with F1). A buyer with several pending returns can use one number for all of them.
- No address binding. The only destination data is `destinationCountryCode: 'AU'` (`ship24Tracking.ts:69, 117`). The buyer's postcode lives in `cash_sale_delivery_details` and is never sent or compared.
- No ship-date check. See F1. `shipped_at` is stamped with `now()` and never compared with the carrier's delivery time.
- No carrier check on match. The webhook matches the number without `tracking_carrier`, so an identical number from another carrier could match.
- Trades. The webhook writes `initiator_carrier_delivered_at` / `counterpart_carrier_delivered_at` directly with the payload time (`route.ts:248`, `.update({ initiator_carrier_delivered_at: deliveredAt })`). For trades this is PARTIALLY MITIGATED by `deriveTradeInspectionDeadline`, which takes the later of the two deliveries and floors the window at 24h from inspection entry. A stale number buys the attacker a 24h window rather than an instant release, and collateral (not collected cash) is at stake. The trade DELIVERY path is meant to be disabled (`TRADE_HANDOVER_METHODS = ['IN_PERSON']`) but is reachable. See N2.

Fix: add a partial unique index on `(lower(tracking_carrier), tracking_number)` across live outbound sales, with an explicit "combined shipment to the same buyer" exception. Make return numbers unique across live returns and different from the outbound number. Clamp delivery times as in F1. Send the destination postcode to Ship24 and compare it with what Ship24 reports.

---

## G1. In-person cash sale: completion on the second confirmation, synchronous payout. PARTIALLY MITIGATED, Medium

### Attack
At or before the meet-up, the seller says "tap confirm so the app knows I'm here, then I'll get the card from the car". The buyer confirms. The seller confirms, the sale is COMPLETED, the seller is paid in the same request, and the seller drives off. Variant: the seller asks the buyer to confirm remotely before the meeting time "to lock it in". `confirmCashSaleHandover` does not check that `meeting_at` has arrived.

### Evidence
- `supabaseCashSaleRepository.ts` `confirmHandover`: when both timestamps are present, `guardedUpdate(... 'HANDOVER', { status: 'COMPLETED' ...})`.
- `cashSaleOrchestrator.ts:3183`: `const released = await payoutCashSaleSeller(deps, { cashSaleId: sale.id });`, called inline with no delay.
- `cashSaleOrchestrator.ts:3255`: `DISPUTABLE_STATUSES = new Set(['INSPECTION', 'IN_TRANSIT', 'HANDOVER', 'ESCROW_HELD'])`. COMPLETED is not disputable, so there is no in-app remedy after the second tap.
- Guard: the UI warning `components/sales/CashSaleView.tsx:1670-1678`: "Your confirmation completes the sale and pays the seller. Only confirm if you met and the item actually changed hands." The buttons read "We met and I have the item". The buyer can dispute from HANDOVER before confirming.
- This is a deliberate product decision, recorded in product.md: cash in-person completes on the second confirmation, unlike trades. The trade side explicitly rejects it, because "confirming a face-to-face handover says 'we met and swapped', NOT 'I am satisfied'". The same reasoning applies to a buyer handed a convincing fake at a car park.

### Cooling-off
There is none. A delivery sale's acceptance (`:3133`) and an in-person second confirmation (`:3183`) both pay at once. The pg_cron and drain path (about 40 minutes, from :07 to :47) applies only to auto-completion. After the transfer, whether the seller can withdraw immediately depends on the connected account's payout schedule and on Stripe's `source_transaction` availability. A transfer tied to a charge becomes available when that charge's funds settle. That is Stripe/Dashboard behaviour and cannot be verified from code (`StripeService.ts:783, 826`).

### Money impact
The buyer loses the price, or the platform loses it if the buyer charges back (`losses_collector: application`).

### Fix
- Make the buyer's confirmation non-releasing: after both confirm, open a short inspection window, for example 24–48h, the same as the trade's `BOTH_HANDOVER_CONFIRMED → INSPECTION`.
- Or at minimum delay the release by N hours, with the buyer still able to dispute.
- Refuse confirmation before `meeting_at - ε`.

## G2. Delivery: buyer coerced or tricked into "received" then "accept". PARTIALLY MITIGATED

`recordCashSaleReceipt` (buyer-only, IN_TRANSIT → INSPECTION) followed by `acceptCashSaleInspection` pays synchronously (`:3133`). "Please mark it received so tracking updates" is a plausible pretext. The two-step flow and the buyer-only guard are the mitigation. The fix is the same as G1: a short release delay after acceptance, or a confirm dialog that states "this pays the seller now and ends your right to dispute".

---

## N1. Cash-sale terms race (TOCTOU). PARTIALLY MITIGATED, Low

### Server side: sound (REFUTED as a server bug)
- The trigger `cash_sales_reset_acceptances` (latest in `0050`, lines 115-120) fires on `fulfillment_method, shipping_cost_cents, shipping_notes, delivery_address_configured, meeting_*, agreed_price_cents`, and `reset_cash_sale_acceptances` (0008) bumps `terms_version` with no no-op guard. Every edit therefore bumps the version. 0101 changed only the TRADE trigger, so for cash sales the steering line "fulfilment edits do not void acceptances" has no money effect: there are no acceptances left to void (0099), but the version still bumps.
- `replace_cash_sale_items` (0064) and `updateAgreedPrice` also change `agreed_price_cents` and so bump the version. `update_cash_sale_terms` recomputes `amount_cents` in SQL (0050, lines 235 and 266).
- `acceptCashSaleTerms` checks `sale.termsVersion !== params.termsVersion` (`:1726`). `claimPayment` is guarded with `.eq('terms_version', termsVersion).is('payment_nonce', null)`, and the charge is `amount: sale.amountCents` from the claimed row (`:1651`). The amount is server-recomputed and bound to the version.
- Who may edit: price is seller-only (`proposeCashSalePrice`), postage is seller-only and the address is buyer-only (`updateCashSaleTerms`). There are no direct table grants to `authenticated` (`cash_sales` has a SELECT policy only).

### Residual (client)
- `CashSaleView.tsx:1612`: `acceptCashSaleTerms(sale.id, sale.terms_version, ...)` where `sale = liveSale ?? initialSale` is Realtime-updated (`:468`). The Pay dialog therefore always sends the CURRENT version, not the version the buyer reviewed. If the seller raises postage while the dialog is open, the label changes ("Accept terms and pay $X" re-renders) and one click pays the new figure.
- There is no upper bound on cash-sale postage. `termsComplete` only checks `>= 0` (`:984`), and the SQL only checks `< 0`. The trade path caps at `DEAL_DELIVERY_COST_MAX`, the cash path does not.
- Method switch (DELIVERY ↔ IN_PERSON) is allowed for either party in AGREEMENT. It bumps the version and is visible. Payment refuses DELIVERY without a buyer address.

### Fix
Snapshot `terms_version` and `amount_cents` when the Pay dialog OPENS. Send `expectedAmountCents` and have `acceptCashSaleTerms` refuse when `sale.amountCents !== expectedAmountCents`. Cap cash postage with the same `DELIVERY_COST_MAX`, or better, a sane AUD ceiling.

## N2. Trade handover edits after acceptance. CONFIRMED, High (trade surface)

### Attack A: change the deal after the victim accepted
The victim accepts terms v5 (meeting at a public shopping centre on Saturday). The attacker calls `updateTradeHandoverTerms` to move the meeting to a remote car park at 11pm. The 0101 trigger does not fire for handover columns, so `terms_version` stays 5 and the victim's acceptance stands. The attacker then accepts v5, and `begin_trade_collateral` starts escrow on terms the victim never saw.

### Attack B: kill the collateral after it is placed
In COLLATERAL_LOCKED (holds live, placed 24h before `meeting_at`), the attacker moves `meeting_at` up to 30 days ahead, or switches the method to DELIVERY. Holds lapse after about 7 days (`expire_lapsed_holds` marks them EXPIRED and flags reconciliation, which detects but does not prevent). `advanceDueHandovers` only handles `handover_method = 'IN_PERSON'` with a past `meeting_at`, so neither variant advances. The attacker then hands over a fake at the meeting: a fraud finding has no collateral to capture.

### Evidence
- `lib/actions/trades.ts:901`: the comment says "EDITABLE ONLY UNTIL THE COLLATERAL IS PLACED". The code at `:930` allows `'COLLATERAL_LOCKED'`. The comment and the code contradict each other.
- `trades.ts:965-968`: `validateFulfilmentTerms(..., { maxDeliveryCostCents, maxMeetingLeadHours })` with no `allowedMethods: TRADE_HANDOVER_METHODS`, unlike `lib/actions/tradeNegotiation.ts:177`. DELIVERY passes (`domain/fulfilment/terms.ts`: "Omitted means both"). The UI exposes it too (`TradeHandoverTermsEditor.tsx`, "Postage each way").
- `trades.ts:988-993`: `admin.from('trades').update({...columns})`, `.eq('id', tradeId)`. There is no version check, no `state` predicate on the write (a TOCTOU against a concurrent state change), and no acceptance reset.
- `0101_fulfillment_no_confirm.sql`: the trigger covers only `cash_amount_cents, cash_direction, declared_value_cents, counterpart_goods_description`.
- `bondPlacementSweep.ts`, `advanceDueHandovers`: `.eq('handover_method', 'IN_PERSON')`.
- Money columns: trade `delivery_cost_cents` is never charged (no use in `domain/` money paths), so a postage edit on a trade moves no money directly.

### Fix
- Pass `allowedMethods: TRADE_HANDOVER_METHODS` in `updateTradeHandoverTerms`.
- Restrict it to `NEGOTIATING | COLLATERAL_PENDING`, as the comment says, and add `.in('state', [...])` to the UPDATE.
- When the trade is past NEGOTIATING, or the other party has already accepted, either bump `terms_version` and clear the counterparty's acceptance, or require the counterparty to accept the new meeting.

---

## NEW-1. Returns depend solely on the Ship24 webhook. CONFIRMED (availability / liability), Medium

`lib/tracking/refreshOnRead.ts` (header): the Ship24 webhook "on the evidence, has never fired for this project". The outbound leg therefore gained a pull path. The return leg did not: the only caller of `apply_cash_sale_return_tracking` is the webhook (`route.ts:196`), and there is no sync action or read-triggered check for `return_tracking_number`. If the webhook really is dead, every RETURN_IN_TRANSIT sale waits forever. The buyer's money is frozen and the item stays RESERVED until staff intervene through `resolveCashSaleReturnCase`. This blunts E1/E2 by accident, but breaks the buyer-protection promise "refund is automatic on carrier confirmation".

Fix: add the read-triggered return check (with the E1 seller window), and an operator alert for RETURN_IN_TRANSIT older than N days. Whether the webhook fires is Dashboard/runtime state and cannot be verified from code.

## NEW-2. `events[0]` as the delivery instant. UNVERIFIABLE, Medium

`ship24Tracking.ts:82, 129` and `route.ts:128` take `events[0].occurrenceDatetime` as the delivery time. If Ship24 orders events oldest-first, that is the first scan (lodgement), and every honest sale's 7-day window is shortened by the transit time, possibly to nothing for slow parcels. If newest-first but a post-delivery event exists (for example "collected from locker"), the time is still not the delivery time. Fix: select the event whose `statusMilestone === 'delivered'` and clamp it as in F1.

## NEW-3. Chargebacks do not freeze or reverse a release. PARTIALLY MITIGATED, Medium

`payoutCashSaleSeller` checks the fraud ban and `canReceiveFunds` only. It does not check for an open `charge.disputed` on the sale. `StripeService.ts:885`: "`reverse_transfer` is deliberately NOT set". Scenario: a buyer with a stolen card (no Identity needed to buy) colludes with an Identity-verified seller, possibly a mule. They do an in-person sale and both confirm in seconds, so the transfer is immediate (G1). The chargeback later debits the platform. Mitigated by Radar, `source_transaction` availability timing, and Connect payout schedules, all runtime/Dashboard and unverifiable here. Fix: hold the release when a dispute is open on the collection, and add a minimum account age or release delay for first sales on new seller accounts.

---

## Refuted or not reachable

- Mobile bypass of cash-sale guards: REFUTED. The `app/api/mobile/cash-sale/*` routes (accept-terms, update-terms, update-items, propose-price, sync-tracking) delegate to the same `lib/actions/cashSale.ts` actions. The Ship24 and cron RPCs are `service_role` only (0011 `grant execute ... to service_role`).
- Direct table write of `cash_sales` (status, tracking, `amount_cents`): REFUTED. There is no INSERT/UPDATE grant or policy for `authenticated`, only `cash_sales_participant_select`.
- Buyer edits the price or postage: REFUTED. `proposeCashSalePrice` is seller-only, and `updateCashSaleTerms` refuses a buyer postage change (`NOT_PERMITTED`).
- A forged Ship24 webhook: REFUTED as long as `SHIP24_WEBHOOK_SECRET` is set. The route fails closed (503) and uses a constant-time compare. The secret travels in a query string, so it may appear in proxy logs. That is a configuration hygiene note.
- Double refund from a duplicate return event: REFUTED. The RPC is monotonic on `return_carrier_delivered_at`, `markRefundDue` is idempotent on its nonce, and finalisation skips the provider call when `refundStatus === 'SETTLED'`.
- The refund drain paying a contested return: REFUTED (`listDueRefunds` has `.is('return_disputed_at', null)`).

## Doc/code drift worth fixing
- product.md says the trade inspection is 72h. The code has `TRADE_INSPECTION_HOURS = 120` (`domain/fulfilment/inspection.ts`).
- product.md describes trade DELIVERY as a live route. The code says trades are "face-to-face only", yet the handover editor still accepts DELIVERY (N2).
- The `updateTradeHandoverTerms` comment says it is locked once collateral is placed. The code allows COLLATERAL_LOCKED (N2).
