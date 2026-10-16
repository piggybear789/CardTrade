# Red team: collateral lifecycle and trade fulfilment

Scope: trade collateral (Stripe manual-capture authorisations), the trade state machine,
fulfilment, the dispute/fraud capture path, and the pg_cron and Vercel sweeps around them.
This was a read-only review. I made no code changes and called no live Stripe or Supabase.
Line numbers refer to the working tree at the time of review. For SQL, the latest
`create or replace` is the one that counts.

What I could NOT verify from code: the live DB function bodies (0121–0124 were applied by
`execute_sql`, so a hand-applied override is possible), Dashboard webhook subscriptions,
webhook delivery latency, Radar/3DS rules, automatic-payout setting, and the per-card-brand
authorisation window Stripe actually reports in `capture_before`.

## Summary of verdicts

| # | Finding | Verdict | Severity |
|---|---|---|---|
| C1 | Raising a dispute partial-captures $20. Stripe then releases the rest, so the fraud remedy can never capture | CONFIRMED | Critical |
| C2 | A single `hold.active` webhook confirms the WHOLE trade, so it can lock with one hold or none | CONFIRMED (timing-dependent) | High |
| C3 | `updateTradeHandoverTerms` is unilateral, works in COLLATERAL_LOCKED and allows DELIVERY. Used to stall until collateral lapses | CONFIRMED | High |
| C4 | `holdForTrader` takes the first unordered row, ignoring status, so after any retry captures hit a dead hold | CONFIRMED | High |
| C5 | The cash leg has no collateral and is charged only AFTER both holds are voided | CONFIRMED | High |
| C6 | The collateral budget assumes 7 days, but a Visa MIT auth lasts about 4d18h. SQL inspection is 72h with no expiry clamp, while copy says 5 days | CONFIRMED | Medium-High |
| C7 | Binder-trade collateral is valued by the attacker, and can be re-priced after a forced HOLDS_FAILED | CONFIRMED | Medium |
| C8 | The initiator's own items are never checked AVAILABLE, and HOLDS_FAILED un-sells and un-reserves items | CONFIRMED | Medium |
| C9 | An in-person cash sale completes and pays out on the second tap, which turns double-sell into a loss | CONFIRMED | Medium |
| C10 | Legacy `proposeTrade` action forces a counterparty into escrow without consent | PARTIALLY-MITIGATED (likely unreachable) | Low / latent |
| C11 | The hold-expiry warning goes to the hold OWNER (the attacker), not the protected party | CONFIRMED | Low |
| C12 | A void result is ignored on re-placement, and a crash between provider and DB leaves an orphan auth | CONFIRMED | Low |
| C13 | Trade cash in `PAYOUT_MODE=platform` is collected and never forwarded | LIKELY (verify) | Medium (not attacker-driven) |

Hypothesis map: **A** → C3, C6 (+C1). **B** → section B. **O** → C2, C4, C12. **Q** → C8, C9 (+C1/C4 break the containment).

---

## C1. A dispute destroys the collateral it is meant to protect (Critical)

**Attack**
1. A (attacker) agrees an IN_PERSON trade with V. The day before, both holds go on at 100% of what each receives.
2. At the meeting A hands V a convincing fake and takes V's real card.
3. V does the right thing and presses "Raise a problem" (`raiseDispute`), or "Report fraud" (`reportFraud`).
4. `raiseConditionDispute` partial-captures `min($20, hold)` from A's hold at **raise** time.
5. Stripe partial capture releases the uncaptured remainder automatically, and a payment that has been partially captured cannot be captured again. See [Stripe: place a hold on a payment method](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method). Content was rephrased for compliance with licensing restrictions.
6. Staff later find objective fraud, and `resolveTradeFraud` → `reportObjectiveFraud` → `fullCapture(A's hold)`. That fails on an already-captured PaymentIntent and returns `FULL_CAPTURE_FAILED`. The trade is already terminal `FRAUD_RESOLVED`.

**Evidence**
- `domain/orchestrator/disputeResolution.ts:309` — `const capture = await payments.partialCapture({` runs inside `raiseConditionDispute`, straight after the DISPUTED transition.
- `domain/services/stripe/StripeService.ts:674` — `{ amount_to_capture: params.amount }`. The comment above it reads "Capturing less than the authorised amount makes Stripe release the remainder automatically".
- `lib/actions/trades.ts:847` — `reportFraud` calls `raiseConditionDispute({` FIRST, so even a fraud claim triggers the $20 capture.
- `domain/orchestrator/disputeResolution.ts:660` — `const capture = await payments.fullCapture(offendingHold.holdRef);`. This is the same PaymentIntent, now already captured.
- `domain/state-machine/machine.ts:94` — `CONDITION_DISPUTE: 'DISPUTED'` is reachable only from INSPECTION, and `FRAUD_CONFIRMED` from DISPUTED is the only route staff can use once a member has acted.

**Impact:** V loses the full card value minus $10 (the return-shipping share). A pays $20 plus the Trade_Fee and keeps V's card. The platform holds nothing to pay V. Every member-raised trade dispute or fraud claim lands on this path, so the fraud branch of the state machine is effectively dead.

**Fix:** never partial-capture at raise. Either:
- capture the friction tax only at resolution (`DISPUTE_RESOLVED`), choosing the amount there; or, better,
- on dispute or fraud claim, **full-capture the accused's hold into the platform balance**. That converts a lapsing authorisation into held funds. At resolution, refund the remainder, or pay the victim.

The second option also fixes C6/A. It moves the money into custody, so it touches the custody reconciliation and licensing notes in `stripe-payments.md`. Add a test: raise a dispute, then resolve fraud, and assert the victim payout equals the hold.

---

## C2. One webhook confirms the whole trade (High; hypothesis O)

**Attack**
1. A is the counterpart. `placeBondsForAgreedTrade` places the initiator's hold first, then the counterpart's (`tradeProposal.ts` placement loop).
2. A makes sure A's own card declines at placement: a frozen card, a prepaid card with no balance, or a card at its limit.
3. V's hold succeeds. Stripe sends `payment_intent.amount_capturable_updated` for V's PaymentIntent.
4. The pipeline maps that to `HOLDS_CONFIRMED` for the trade, with no check on the other hold. Two outcomes:
   - The webhook lands while A's placement call is in flight: the trade moves to `COLLATERAL_LOCKED`. `placeTradeCollateral` then dispatches `HOLDS_FAILED`, which is `INVALID_TRANSITION` from LOCKED, so the compensation never runs. The result is LOCKED with V backed and A unbacked.
   - The webhook lands after the synchronous HOLDS_FAILED, which is a self-loop that voids V's hold and restores items: `HOLDS_CONFIRMED` from COLLATERAL_PENDING moves the trade to LOCKED with **no live collateral at all**, items AVAILABLE, and both traders told "collateral locked".
5. A meets V and defrauds them. There is nothing to capture.

**Evidence**
- `domain/webhook/mapEventToAction.ts:63` — `case 'hold.active': return { kind: 'TRADE_EVENT', tradeEvent: 'HOLDS_CONFIRMED' };`
- `lib/webhook/webhookPipeline.ts:200` — `event: action.tradeEvent,` is applied directly. The only side effect wired is the HOLDS_FAILED compensation (`createCollateralSideEffects`, which returns ok for every other event).
- `domain/state-machine/machine.ts:57` — `HOLDS_FAILED: 'COLLATERAL_PENDING'` is a self-loop, so the trade stays confirmable afterwards.
- `domain/orchestrator/tradeProposal.ts:494` — `currentHoldsAreActive` exists, but only the synchronous paths use it.

**Impact:** V's goods are unprotected while the UI says they are protected. V eats the loss. This depends on webhook latency against the placement round trip, which I could not verify. Either ordering produces an unbacked lock.

**Fix:** in the `TRADE_EVENT` branch, never apply `HOLDS_CONFIRMED` from the event alone. Re-read `pre_auth_holds` and require `currentHoldsAreActive`. Also require that the webhook's `holdId` equals the latest row's `hold_ref` for that trader. Put that guard in a domain side effect on HOLDS_CONFIRMED, so every caller gets it. Placement is synchronous, so the webhook could reasonably be demoted to `NO_OP` for `hold.active`.

---

## C3. Unilateral reschedule after lock stalls until collateral lapses (High; hypothesis A)

**Attack**
1. The trade is LOCKED, holds were placed at M−24h, and they expire around M+6d (Mastercard) or M+3d18h (Visa MIT; see C6).
2. A meets V at M and takes V's card (fake in return, or nothing at all).
3. A immediately calls `updateTradeHandoverTerms` through the web action or `POST /api/mobile/trades/update-handover-terms`. A then does one of the following:
   - sets `meetingAt = now + 29d`: `advanceDueHandovers` only fires at `meeting_at <= now`, so INSPECTION never opens; or
   - switches `method: 'DELIVERY'`: `toHandoverColumns` nulls `meeting_at`, and `advanceDueHandovers` filters on `handover_method = 'IN_PERSON'`, so it never fires. `shipping_deadline_at` is set by a state-change trigger, so the 0039 nudges never fire either.
4. A never confirms the handover. V cannot raise a condition dispute (INSPECTION only). V cannot claim fraud: `record_trade_fraud_claim` refuses outside INSPECTION/DISPUTED, and `raiseConditionDispute` is an invalid transition. V's only button is `HANDOVER_FAILED`, which captures nothing.
5. V is not told the meeting moved: the action creates no notification. The hold lapses, `expire_lapsed_holds` marks it EXPIRED and flags `manual_reconciliation`, and A has kept V's card.
6. Variant: both confirm, but A has already moved `meeting_at` 29 days out. The trigger then sets `inspection_deadline_at = meeting_at + 72h`, about 32 days away, and V believes they have weeks while the collateral dies within days.

**Evidence**
- `lib/actions/trades.ts:901` — the doc comment says "EDITABLE ONLY UNTIL THE COLLATERAL IS PLACED", yet `lib/actions/trades.ts:930` reads `trade.state !== 'NEGOTIATING' && trade.state !== 'COLLATERAL_PENDING' && trade.state !== 'COLLATERAL_LOCKED'`. COLLATERAL_LOCKED is allowed.
- `lib/actions/trades.ts:966` — the options passed are `{ maxDeliveryCostCents, maxMeetingLeadHours }`. There is **no `allowedMethods`**. Compare `lib/actions/tradeNegotiation.ts:177`, which passes `TRADE_HANDOVER_METHODS`.
- The action writes the trade with the admin client and `.eq('id', tradeId)`. It does not bump `terms_version`, does not need counterpart consent, and sends no notification.
- `lib/trades/bondPlacementSweep.ts:166-167` — `.eq('handover_method', 'IN_PERSON')` and `.not('meeting_at', 'is', null)`.
- `supabase/migrations/0057_trade_fulfilment_parity.sql:207` — the deadline is `greatest(v_base + 72h, now()+24h)`, where `v_base` is `meeting_at`. There is no clamp to hold expiry.
- `supabase/migrations/0046_trade_fraud_claim.sql:81` — `if v_trade.state not in ('INSPECTION', 'DISPUTED') then return false;`.
- `supabase/migrations/0109_expired_collateral_escalation.sql:56,72` — the reconciler sets EXPIRED and `manual_reconciliation = true`, and does nothing else. There is no re-authorisation and no state change.

**Same bug, pre-lock griefing variant:** in COLLATERAL_PENDING, A switches to DELIVERY (null `meeting_at`) or keeps pushing the date out by 30 days.
- `placeDueTradeCollateral` needs `meeting_at` (`bondPlacementSweep.ts:73`).
- `flagStaleCollateralTrades` needs `meeting_at` (`inspectionSweep.ts:313`).
- `retryTradeCollateral` refuses because no holds exist (`tradeNegotiation.ts:476`).
- No event leaves COLLATERAL_PENDING except HOLDS_CONFIRMED.

V's item stays RESERVED and off the market indefinitely, and nobody is alerted. `acceptTradeTerms` also never requires a handover method or meeting time, so a trade can be agreed straight into this dead state.

**Impact:** V loses the full goods value. On-platform recovery is zero once the auth lapses. The platform only learns of it via the `manual_reconciliation` flag.

**Fix:**
- Restrict `updateTradeHandoverTerms` to NEGOTIATING. In COLLATERAL_PENDING, allow it only when `now < meeting_at − BOND_PLACEMENT_LEAD_HOURS`, and require the other trader's acceptance (bump a handover version).
- Pass `allowedMethods: TRADE_HANDOVER_METHODS`.
- Notify the counterparty.
- Refuse `acceptTradeTerms` / `begin_trade_collateral` without IN_PERSON plus a non-null `meeting_at`.
- Let a participant claim fraud (and staff capture) from COLLATERAL_LOCKED.
- Make `flagStaleCollateralTrades` also catch `meeting_at is null`.

---

## C4. Captures hit a dead hold after any retry (High; hypothesis O)

**Attack**
1. At placement (the day before), A makes A's own card decline. `placeTradeCollateral` records FAILED rows. HOLDS_FAILED voids V's hold, which stays on file as VOIDED.
2. A fixes the card. The hourly sweep re-runs placement (or A presses retry). This is attempt 2 for **both** traders, both ACTIVE, and the trade locks.
3. Each trader now has two rows: an old FAILED/VOIDED one and the live one.
4. A defrauds V. Friction tax and fraud capture both call `holdForTrader`, which returns the **first** row in an unordered result set. That is typically the dead attempt-1 row. A's FAILED row's `hold_ref` is the deterministic `hold:<trade>:<trader>` string, not a `pi_`.
5. The capture fails. The fraud path marks the trade `FRAUD_RESOLVED` (terminal) with `FULL_CAPTURE_FAILED`. A's real ACTIVE hold is never captured. Because the trade is terminal, `expire_lapsed_holds` later marks it EXPIRED **without** escalating (0109 deliberately skips terminal trades). `full_capture_failed` was at least flagged by the fraud path.

**Evidence**
- `domain/orchestrator/disputeResolution.ts:215` — `return holds.find((hold) => hold.traderId === traderId);`. No status filter.
- `domain/orchestrator/supabaseDisputeResolutionRepository.ts:48` — `.eq('trade_id', tradeId);`. No `order by`. After `markHoldStatus` updates, physical row order is undefined.
- `domain/orchestrator/tradeProposal.ts:525` — `existing.filter((hold) => hold.traderId === placement.traderId).length + 1` creates the extra rows by design.
- The correct helper `currentHoldsByTrader` exists in `tradeProposal.ts`, but the dispute module does not use it.

**Impact:** V's loss is unrecovered automatically. Recovery depends on an operator manually capturing the right PaymentIntent in the Dashboard before it lapses; I found no admin tool for that. This also triggers on honest declines.

**Fix:** select the current live hold: `status in ('ACTIVE','PARTIALLY_CAPTURED')`, latest `created_at`, per trader. Use one shared helper. Make the fraud path refuse to commit FRAUD_RESOLVED until it has found a capturable hold, or keep the trade non-terminal and flagged.

---

## C5. Cash leg has no collateral and is charged after the holds are released (High)

**Attack**
1. A offers a low-value card plus $X cash (`PROPOSER_PAYS`) for V's card worth about $X more. Bonds are sized on **goods FMV only**. Cash appears nowhere in `resolveTradeSideValues` or `resolveTradeBonds`.
2. The swap happens. Before completion, A swaps their default card to one that will decline off-session, or one that triggers 3DS (`requires_action` counts as failed).
3. On completion (`BOTH_ACCEPTED` or `INSPECTION_EXPIRED`), `finalizeCompletedTrade` **voids both holds first**, then charges A's card off-session for the cash.
4. The charge fails. `manual_reconciliation` is set, and A's collateral is already gone.

**Evidence**
- `lib/trades/completion.ts:209` — `const holds = await voidTradeHolds(trade.id);`, then `:212` — `cash = await settleTradeCash(trade);`.
- `domain/services/stripe/StripeService.ts:753` — the cash leg is a fresh `paymentIntents.create(... off_session: true)` at completion.
- `domain/orchestrator/disputeResolution.ts` `resolveConditionDispute` (DISPUTE_RESOLVED → COMPLETED) never settles the cash leg at all.

**Impact:** V loses the cash amount. The platform has no recourse beyond chasing A.

**Fix:** collect the cash leg into the platform balance when collateral is placed (the Cash_Sale model), refunding it on HOLDS_FAILED or cancellation. At minimum, settle cash **before** voiding the payer's hold, and capture the payer's hold up to the cash amount if the charge fails.

---

## C6. The authorisation budget is wrong in three places (Medium-High; hypothesis A)

- `domain/fulfilment/inspection.ts:93` — `CARD_AUTHORISATION_DAYS = 7`. Holds are `off_session: true` (`StripeService.ts:611`), which Stripe treats as merchant-initiated. Stripe documents a **5-day Visa MIT window, exactly 4 days 18 hours**, against 7 days for customer-initiated payments ([Stripe docs](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method)). Content was rephrased for compliance with licensing restrictions. A Visa hold placed at M−24h therefore dies at about M+3d18h. `capture_before` should report the real expiry, so `expires_at` is likely right, but the schedule built around it is not.
- `inspection.ts:71` — `TRADE_INSPECTION_HOURS = 120`, and member copy says five days. But `0057_trade_fulfilment_parity.sql:147-152` `trade_inspection_hours()` is `select 72`, and the **SQL trigger is the authoritative deadline**. `deriveTradeInspectionDeadline`, which has the expiry clamp, is not called anywhere in app code. So members are promised 5 days and get 3, and the SQL path has no clamp to `expires_at`. I could not verify the live DB value. Nothing pins TS to SQL here, unlike the region test.
- Arbitration never reads `expires_at`. There is no re-authorisation anywhere. `expire_lapsed_holds` only records, flags and notifies.

**Attack (A):** with Visa, a dispute raised at the end of a 72h window leaves staff about 18 hours before the authorisation is gone. A can make V wait until near the deadline, for example with "let me check the card, I'll refund you", or by offering to swap back. Then C1 or C3 finishes it.

**Fix:** capture into custody at dispute time (C1). Align SQL and TS, with an agreement test like `regionCurrencyAgreement`. Clamp the SQL deadline to the earliest `expires_at − margin`. Compute placement lead and windows from the brand-specific `capture_before`, or place holds on-session (customer-initiated, 7 days) at agreement.

---

## C7. Binder-trade collateral is valued by the attacker (Medium)

On a SHOPFRONT trade, the binder side is valued at the initiator's goods (`domain/trade/tradeSideValues.ts:51`, `counterpartSideCents: initiatorSideCents`). The initiator's own bond is the binder side, so **A's collateral is sized by A's own listed FMV**.

**Attack**
1. A offers item X (listed at $800) for "the Charizard from your binder". V agrees.
2. A forces the first placement to decline. HOLDS_FAILED **restores items to AVAILABLE** (`tradeProposal.ts:624`), and an AVAILABLE item's FMV is editable (`itemOrchestrator.ts:170` blocks edits only while RESERVED).
3. A edits X to $1. The next sweep re-reserves the items and re-sizes from the **live** `fmv_cents`: both bonds become $1. `tradeSidesAreValued` passes because $1 > 0.
4. A takes the Charizard and hands over junk. The most staff can capture is $1.

**Impact:** V loses the binder card's value. Nothing voids acceptances on an FMV edit (I found no trigger).

**Fix:** snapshot each side's value on the trade row at TERMS_AGREED and size bonds and fees from the snapshot. Keep items RESERVED across HOLDS_FAILED retries; release them only on cancel. Treat any FMV change on a negotiating trade's items as a terms change.

---

## C8. Item availability holes let one SINGLE card back two contracts (Medium; hypothesis Q)

- The initiator's own offered item is checked for ownership only, never for AVAILABLE:
  - `supabase/migrations/0081_trade_against_shopfront.sql:154` raises only `initiator-item-not-owned`.
  - `lib/actions/tradeNegotiation.ts:704` uses `initiatorItemId = input.offer.itemId` with no status check.
- `begin_trade_collateral` silently skips anything not AVAILABLE (`0081:353` `and status = 'AVAILABLE'`). A card already RESERVED by a paid cash sale, or already SOLD, can therefore be put into a trade.
- HOLDS_FAILED `restoreItems` sets AVAILABLE unconditionally (`supabaseTradeProposalRepository.ts:142`). A forced decline therefore **un-sells a SOLD item** or un-reserves one held by a live cash sale, and puts it back in the catalog.

**Impact:** escrow contains it only if the trade collateral can actually be captured, and C1, C3 and C4 show it often cannot. A cash buyer is protected by funds already held. A trader is not.

**Fix:** check the initiator's items are AVAILABLE in SQL. Make `begin_trade_collateral` fail when it reserves fewer rows than the bundle has. Restore only items whose status is RESERVED **by this trade** (record the reservation owner).

---

## C9. In-person cash completion turns shopfront double-sell into a loss (Medium; hypothesis Q)

The double-sell is the documented accepted risk. A seller promises one card to two IN_PERSON buyers. The second buyer gets a convincing fake at the meetup, and both tap confirm. The sale **completes on the second tap and pays out immediately** (`cashSaleOrchestrator.ts:3154`, followed by `payoutCashSaleSeller`). A cash-sale dispute is only available from ESCROW_HELD, IN_TRANSIT, HANDOVER or INSPECTION, so COMPLETED is final.

**Impact:** the buyer loses the price. Their remaining recourse is a card chargeback, which the platform absorbs as merchant of record.

**Fix:** give in-person cash sales a short INSPECTION window (as trades have), and delay the payout drain past it. At minimum, hold the payout for N hours after an in-person completion.

---

## C10. Legacy `proposeTrade` forces a counterparty into escrow (Low / latent)

`lib/actions/trades.ts:305` calls `proposeTradeWithSupabase` and does all of the following in one call:
- creates a COLLATERAL_PENDING trade the counterparty never agreed to;
- RESERVES their item;
- authorises their saved card off-session for 100% of the **attacker's own item FMV**;
- skips the region check, the meeting time and the fee;
- leaves `handover_method` null, so the lifecycle falls back to the shipping branch and there is no auto-advance.

It is still exported from a `'use server'` module. Nothing imports it from client code or the mobile API, and Next 16 does not emit action IDs for unreferenced server actions, so it is **probably unreachable**. I did not verify this against the build manifest. If it is ever reachable, it is mass griefing plus unauthorised authorisations on other members' cards. **Fix:** delete it.

## C11. The expiry warning goes to the wrong person (Low)

`0093_hold_expiry_warning_excludes_cancelled.sql:55` inserts the notification for `r.trader_id`, the **owner** of the expiring hold. On the attack path, that is A being told A's collateral is about to lapse. V, whom that collateral protects, gets nothing until it has already gone (0109). **Fix:** notify both participants, and flag for staff before expiry, not after.

## C12. Orphan authorisations (Low)

- `lib/trades/collateralPlacement.ts:227` — `await payments.voidHold(hold.holdRef);` then marks VOIDED **regardless of the returned status**. A failed void leaves a live, untracked auth.
- A crash between `paymentIntents.create` and `recordHold` leaves a PaymentIntent with no row. The retry reuses the same attempt number and key, so it is idempotent for 24h if the parameters are identical. If the amount changed, Stripe rejects the reused key, the attempt is recorded FAILED, and the next attempt creates a second auth while the first lives on until it lapses.

The cost is an encumbrance on a card, not lost money.

## C13. Trade cash may never reach its receiver (Medium; not attacker-driven, verify)

`settleTradeCash` uses `requestTransfer`. In the default `PAYOUT_MODE=platform` (`domain/services/stripe/config.ts:372`), that collects only (`StripeService.ts:769` `if (!settleDirect)` returns SETTLED with no transfer). `settleTradeCash` then clears `manual_reconciliation`. I found no trade-cash payout queue to match the Cash_Sale `payoutCashSaleSeller` drain. **Verify** against `domain/payouts/payoutReadModel.ts`. If confirmed, use `payoutToMerchant` from a queued drain.

---

## Hypothesis verdicts

### A. Stall or freeze until the authorisation lapses: CONFIRMED
- Stall vector: C3, a unilateral reschedule or a switch to DELIVERY after lock. The window is made worse by C6 (Visa MIT about 4d18h, SQL 72h, no clamp).
- `expire_lapsed_holds` (0109:56,72) marks the hold EXPIRED, writes a same-state `COLLATERAL_EXPIRED` audit row, sets `manual_reconciliation` on live trades, and notifies. It does **not** change state, re-authorise, or capture.
- There is **no re-authorisation** anywhere in the codebase.
- Arbitration (`disputeResolution.ts`, `admin.ts:558,630`) never reads `expires_at`.
- `enforce_trade_shipping_deadlines` (0039) only nudges and stamps `shipping_overdue_at`. It moves no money, and only runs for DELIVERY trades with a deadline set.
- Loss falls on the victim. The platform is only alerted.

### B. HANDOVER_FAILED captures nothing: PARTIALLY-MITIGATED
- **Who and from where:** either participant, from COLLATERAL_LOCKED or IN_TRANSIT (`trades.ts:1085`, `:1094`; also the mobile `report-handover-failed` route, which delegates to the same action). The only requirement is a 10–2000 character reason.
- **Resolution:** staff only. `resolveTradeConditionDispute` gives DISPUTE_RESOLVED → COMPLETED and voids both holds, so the goods stay wherever they are. `resolveTradeFraud` full-captures the named offender's hold.
- **Abuse:** after taking V's card at the meeting, A reports "they never showed". This pre-empts V's INSPECTION-only condition dispute (so there is no $20 for A to pay) and turns the case into an in-person he-said/she-said with no carrier evidence.
- **Does the receiver keep the goods risk-free?** Yes, unless staff find fraud **and** capture inside the authorisation window **and** the capture targets the right row (C4). V can still `reportFraud` from DISPUTED, which records the claim; the transition fails harmlessly because the trade is already DISPUTED, so the C1 partial capture does not fire on this path.
- **Guards:** staff review, and evidence upload (0082).
- **Gap:** the clock keeps running, and a trade with a cash leg resolved via DISPUTE_RESOLVED never settles the cash.

### O. Idempotency key and unbacked lock
- **Same key with changed parameters blocking collateral: REFUTED** as a lock-out. Retries use `hold:<trade>:<trader>:<attempt>` with the attempt counted from existing rows (`tradeProposal.ts:525`), so a decline does not replay. The residual issue is orphan auths (C12).
- **Trade reaching COLLATERAL_LOCKED with a hold failed or missing: CONFIRMED** via the webhook path (C2). The synchronous paths are guarded by `currentHoldsAreActive`.
- **Related:** captures target stale rows (C4).

### Q. Shopfront double-sell becomes a real loss: PARTIALLY-CONFIRMED
- **Cash sales:** the IN_PERSON instant completion and payout (C9) converts it into buyer loss and platform chargeback exposure.
- **Trades:** a binder has no reservation, and SINGLE items also leak through availability holes (C8). Containment rests entirely on capturing collateral, which C1, C3 and C4 defeat.
- **Delivery cash sales:** remain contained, because the buyer's funds are held. That part is REFUTED as a loss.

## Fix priority
1. C1: stop partial-capture-at-raise, and capture into custody on dispute.
2. C2: make HOLDS_CONFIRMED re-check every current hold.
3. C3: lock handover terms after placement, require consent, enforce IN_PERSON.
4. C4: pick the live hold per trader.
5. C5: collect the cash leg up front.
6. C6: align SQL and TS, clamp to expiry, plan for Visa MIT.
7. C7, C8: snapshot side values, keep reservations, check initiator availability.
8. C9, C11, C12, C10, C13.
