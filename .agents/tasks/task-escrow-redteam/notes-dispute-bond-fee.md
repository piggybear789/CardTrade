# Red team: dispute / bond sizing / fee evasion

Read-only review. No code changed, no live Stripe or Supabase calls, no secrets read.
Every layer checked: migrations (latest definition wins), server actions, orchestrators, `app/api/mobile/**` (the mobile trade routes `raise-dispute`, `report-fraud`, `update-handover-terms` and `sync-tracking` call the same server actions, so every finding below applies to mobile too).

Severity: CRIT / HIGH / MED / LOW. "Runtime" means it depends on Dashboard or env config and can't be checked from the code.

---

## Summary

| ID | Finding | Verdict | Severity |
|---|---|---|---|
| C1 | Reporting fraud from INSPECTION triggers the $20 Friction_Tax capture first. Stripe then releases the rest of the authorisation, so the full fraud capture can never succeed | CONFIRMED (NEW) | CRIT |
| C2 | A condition dispute caps the attacker's loss at $20. Nothing enforces a return, staff have no option to award the value difference, and a dispute raised in bad faith takes $20 from an honest trader that can't be refunded | CONFIRMED | HIGH |
| D1 | The trade cash leg is never collateralised, and it is charged only after both holds are voided | CONFIRMED (NEW) | HIGH |
| D2 | Binder + cash: the attacker's bond equals only their own self-priced goods. Cash is excluded and 1 cent passes `tradeSidesAreValued` | CONFIRMED | HIGH |
| D3 | FMV can be edited between the two acceptances. Bonds and fees are sized from the live FMV at placement, and the edit doesn't void acceptance | CONFIRMED (NEW) | MED |
| D4 | `updateTradeHandoverTerms` still works in COLLATERAL_LOCKED and omits `allowedMethods`. The meeting can be pushed out 30 days, or the trade switched to DELIVERY, after the holds are placed, so the holds lapse | CONFIRMED (NEW) | HIGH |
| N1 | With `PAYOUT_MODE=platform` (the default), the trade cash leg is collected into the platform balance, marked settled, and never forwarded to the receiver | CONFIRMED (NEW, runtime) | HIGH |
| P1 | Postage is set by the seller, effectively uncapped, and carries no fee: item $1 + postage $499 pays the $1.50 minimum fee | CONFIRMED | MED |
| P2 | A failed Trade_Fee never blocks the trade, and the retry reuses the idempotency key inside Stripe's 24 h window, so it just replays the decline | CONFIRMED | MED |
| P3 | Off-platform payment lures in messaging | PARTIALLY-MITIGATED | MED |
| R* | Refuted hypotheses | see end | — |

---

## C1. The fraud remedy is destroyed by the Friction_Tax (CRIT, NEW)

**Attack.** I trade a convincing fake for your $1,000 card, in person (trades are IN_PERSON only, `domain/fulfilment/inspection.ts:61`). We both confirm the handover, or the sweep assumes it (`HANDOVER_ASSUMED`), and the trade moves to INSPECTION. You find the fake and press "Report fraud". I lose $20. You get $10, and my $1,000 collateral is released to me automatically.

**Evidence.**
- `lib/actions/trades.ts:847`: `reportFraud` always runs the condition-dispute path before recording the claim: `const raised = await buildDisputeOrchestrator(...).raiseConditionDispute({`
- `domain/orchestrator/disputeResolution.ts:300-311`: raising a dispute **immediately** captures from the accused's hold, with no review: `const chargeable = frictionTaxChargeableCents(...)` then `await payments.partialCapture({ holdId: disputedHold.holdRef, amount: chargeable })`
- `domain/services/stripe/StripeService.ts:14` and `:674`: `amount_to_capture` is a single capture, and *"Stripe releases the uncaptured remainder automatically"*. Multicapture is never requested anywhere in `domain/services/**`.
- `disputeResolution.ts:660`: the staff-confirmed fraud path then calls `payments.fullCapture(offendingHold.holdRef)` on a PaymentIntent that is already `succeeded`. Stripe rejects it. All 3 attempts replay the same key (`capture:full:${holdId}`, StripeService.ts:700), giving `FULL_CAPTURE_FAILED` and manual reconciliation. The victim is paid nothing from the collateral.
- The fraud path never checks `hold.status` (it reads `PARTIALLY_CAPTURED` and captures anyway).
- The tests hide it. `domain/services/testing/InMemoryService.ts:433`: `fullCapture` returns `this.holds.get(holdId)?.amount` (the full amount) even after a partial capture. MockService behaves the same way.
- The operator is misled. `components/admin/TradeDisputeActions.tsx:178` says *"Captures the other trader's collateral in full"*, and the confirm dialog quotes `offender.bondCents`, but that money was released when the claim was filed.
- The seed data shows the end state: `supabase/seeds/demo_lifecycle.sql` has a hold with `amount_cents 430000` and `captured_cents 2000`, status `PARTIALLY_CAPTURED`.

**When the remedy survives.** If the trade reaches DISPUTED through `HANDOVER_FAILED` first (only from COLLATERAL_LOCKED or IN_TRANSIT), the `CONDITION_DISPUTE` transition is invalid from DISPUTED. Nothing is captured, so the full capture can still work. But once a trade is in INSPECTION, the victim only has two buttons, and both capture $20 first.

**Impact.** The victim loses the full card value minus $10. The attacker's cost is capped at $20 plus the ban (the ban is a real deterrent, but an Identity-verified mule account is the attacker's cost of doing business). The platform keeps $10.

**Fix.**
1. Never capture when a dispute or fraud claim is *raised*. Move the Friction_Tax capture into the staff `resolveConditionDispute`, and make `reportFraud` record the claim without calling `raiseConditionDispute`. Use a dedicated `FRAUD_CLAIMED` event into DISPUTED, or `HANDOVER_FAILED`-style "freeze, capture nothing" semantics.
2. Make `fullCapture` refuse unless `hold.status === 'ACTIVE'`.
3. Make InMemoryService and MockService model single-capture semantics: a capture after any capture fails, and the remainder is released. Then add a property test: "any dispute sequence → fraud resolution still captures ≥ hold − tax".
4. Fix the admin copy so it shows what is actually still capturable.

---

## C2. A condition dispute caps the loss at $20, and it can be abused (HIGH)

**Attack A (lower grade or wrong card).** I list "Near Mint" and hand over Heavily Played, or a cheaper printing of the same card. That's classic "condition". The value difference is $300.
- Staff's only non-fraud outcome is `resolveTradeConditionDispute` → `resolveConditionDispute`, which commits `DISPUTED -> COMPLETED` and voids the remaining holds (`disputeResolution.ts:433-480`; admin.ts around line 550).
- No staff outcome captures the value difference or refunds the victim's own card. The only money moved is the $20 (`frictionTax.ts:33`), split $10 to the raiser for return postage and $10 to the platform.
- The return is **not enforced**: *"NOTHING SCHEDULES IT YET. There is no `return_deadline_at` on `trades`"* (`disputeResolution.ts`, `markDisputeReturnOverdue` doc). The raiser's own goods are never brought back. The trade simply COMPLETES.
- So the attacker's cost is $20, against a $300 gain.

**Classification criteria.** None in code. `domain/arbitration/arbitrationCase.ts` covers triage only, and `TradeDisputeActions.tsx` leaves it to the operator: *"decide it on the evidence"*. Counterfeit, wrong card and empty parcel versus grade mismatch is undefined, so the attacker's whole game is to stay on the "condition" side of the line.

**Attack B (false dispute, NEW).** I receive a perfect card and raise a condition dispute with any reason of `DISPUTE_REASON_MIN` characters or more.
- $20 is captured from the honest trader instantly (`disputeResolution.ts:309`).
- $10 is paid to me (`payeeTraderId: params.actorId`, `:345`).
- There is **no staff outcome that reverses it**: the only buttons are "condition" (which keeps the $20) and "fraud".
- Small, but repeatable per trade and free to me.

**Ops noise.** `resolveConditionDispute` skips only `VOIDED` and `FULLY_CAPTURED` (`disputeResolution.ts:466`). So it tries `voidHold` on the `PARTIALLY_CAPTURED` (already succeeded) PI, which fails and raises `flagManualReconciliation` on every resolved condition dispute. That flood of false flags hides real ones.

**Doc drift.** The steering docs say the trade inspection window is 72 h. The code says `TRADE_INSPECTION_HOURS = 120` (`inspection.ts:71`).

**Fix.**
- Staff outcome set: (a) unfounded, no capture and release both; (b) condition with a staff-chosen capture up to the hold (value difference plus postage); (c) fraud.
- Add `return_deadline_at` plus a sweep that runs `markDisputeReturnOverdue`.
- Write down criteria: counterfeit, wrong card or empty parcel is Objective_Fraud; a grade one step off is condition.
- Treat `PARTIALLY_CAPTURED` as terminal in the void loop.

---

## D. Bond sizing

**Baseline (correct).** Each trader is bonded for what they RECEIVE, goods only. `tradeProposal.ts:500` passes `initiator: { verified: initiator.verified, fmvCents: counterpartSideCents }` (crossed deliberately). The side values come from `fmv_cents` sums (`:473`). There is no verification exemption (`bondPolicy.ts` `resolveTradeBonds` passes `verified: false`). For a SINGLE-for-SINGLE trade with no cash, the hypothesis "bond sized on what I give" is **REFUTED**.

### D1. The cash leg is not collateralised and is charged after the holds are released (HIGH, NEW)

**Attack.** I offer my $5 card plus $495 cash for your $500 SINGLE.
- My bond is $500 (your card) and yours is $5.
- We swap and the trade completes.
- `finalizeCompletedTrade` voids both holds first (`lib/trades/completion.ts:209`) and only then charges my saved card off-session for the cash (`:212`, `settleTradeCash`).
- Before completion I swap my default card for a virtual card with no balance, or I just charge back afterwards.
- The cash charge fails, the trade gets `manual_reconciliation`, and my $500 collateral is already gone.

**Evidence.** The cash leg is excluded from side values (`resolveTradeSideValues` takes goods only, `tradeSideValues.ts:36-52`; `loadSide` sums `fmvCents`, `tradeProposal.ts:473`). `settleTradeCash` treats failure as "does not block COMPLETED".

**Impact.** Up to $1,000,000 (the cash bound in `termsProblem`) is unbacked. The cash receiver bears the loss.

**Fix.**
- Add the cash owed to the payer's bond.
- Settle the cash by partially capturing it from the payer's hold **before** any void, or collect the cash up front at the Commitment_Point into the platform balance (the Cash_Sale model).
- Never void the payer's hold until the cash has settled.

### D2. Binder + cash collapses the attacker's bond (HIGH)

**Attack.** I open a trade against your binder. I offer a 1-cent (or $5) card I priced myself, plus $495 cash, for "PSA 10 Charizard" out of your binder.
- The binder side is valued at what is offered: `return { initiatorSideCents, counterpartSideCents: initiatorSideCents }` (`tradeSideValues.ts:51`). That's my goods only, with no cash.
- So my bond is about $5, your bond is about $5, and my fee is the $1 minimum (I "receive" $5).
- `tradeSidesAreValued` refuses only zero: `> 0` (`:106`). With `FMV_MIN_CENTS = 1` (`domain/validation/item.ts:77`), 1 cent passes.
- The cash is then never collected (D1), or I never turn up with your card after the handover: the fraud capture is $5, and C1 kills even that.
- To make it look right, I can set `declared_value_cents = 50000`. The room headline `tradeAgreedValueCents` shows the declared value (`tradeSideValues.ts`, "presentation only"), so the trade *looks* like $500 while it is bonded at $5.

**Fix.**
- Value the binder side as initiator goods plus cash paid by the initiator. Better: freeze an agreed side value that both parties accept, and bond on the larger of it and the goods.
- Refuse a side below a minimum, or below a fraction of the cash leg.
- Show the actual bond amounts in the headline, not the declared value.

### D3. FMV re-pricing between acceptances (MED, NEW)

**Attack.** While the trade is NEGOTIATING, the items are still `AVAILABLE`. Items are reserved only at `begin_trade_collateral` (`0081_trade_against_shopfront.sql:351`).
- FMV is immutable only while `RESERVED` (`itemOrchestrator.ts:170`), so `updateItem` accepts an FMV change during negotiation.
- No trigger voids trade acceptance on an item change. `reset_trade_terms_acceptances` watches only cash, direction, declared value and the goods description (0101).
- Bonds and fees are read from **live** `fmv_cents` at placement (`collateralPlacement.ts:84-108`, `tradeProposal.ts:473`), a day before the meeting.
- The sequence: you accept version N, I edit my item's FMV, then I accept and the trade locks.
  - On a binder trade I drop my FMV to 1 cent, which shrinks **my own** bond (D2).
  - On a SINGLE trade I raise my FMV, which inflates **your** bond and your 5% fee (charged to your card without your consent to that figure). For example, with my FMV at $5,000 you pay a $250 fee.

**Note.** Direct PostgREST writes are blocked: `fmv_cents` has no member UPDATE grant (`0072_member_write_grants_least_privilege.sql:203-211`). This only goes through the action, which is the hole.

**Fix.** Snapshot the per-side values on the trade when terms are accepted and size from the snapshot, or bump `terms_version` when an item on a NEGOTIATING trade changes. Alternatively refuse FMV edits on items attached to a live trade.

### D4. Rescheduling or switching the method after the holds are placed (HIGH, NEW)

**Attack.** The holds are placed about 24 h before the meeting (`BOND_PLACEMENT_LEAD_HOURS = 24`). Once the trade is COLLATERAL_LOCKED, either trader can call `updateTradeHandoverTerms` alone. No re-confirmation is needed (0101).
- The state gate allows `COLLATERAL_LOCKED` (`lib/actions/trades.ts:930`), even though its own doc comment says *"EDITABLE ONLY UNTIL THE COLLATERAL IS PLACED"* (`:901`).
- It passes no `allowedMethods` (`:965` passes only the cost cap and the lead hours), so `DELIVERY` is accepted even though `TRADE_HANDOVER_METHODS = ['IN_PERSON']`.
- So I move the meeting to +30 days (`MAX_MEETING_LEAD_HOURS = 30 * 24`) or switch the trade to posted.
- The authorisations lapse after about 7 days (extended auth isn't available, per the `StripeService.placeHold` comment).
- `advanceDueHandovers` only handles IN_PERSON trades whose meeting time has passed.
- Then I commit the fraud. There is nothing to capture, and `expire_lapsed_holds` only flags an operator.

**Impact.** The victim loses the full value. The attacker's cost is zero.

**Fix.** Allow handover edits only in NEGOTIATING and COLLATERAL_PENDING, and pass `allowedMethods: TRADE_HANDOVER_METHODS`. When the meeting moves while COLLATERAL_PENDING, the existing sweep handles placement. Add a DB-side guard as well (raise in a trigger when `meeting_at` or `handover_method` changes while `state >= COLLATERAL_LOCKED`).

### `BondPolicy.ceilingCents`

**REFUTED as a current risk.** It defaults to `null` (`bondPolicy.ts:53`), and no caller passes a `bondPolicy`: `placeBondsForAgreedTrade({ repository, payments }, …)` in `collateralPlacement.ts:236`, and there are no other `bondPolicy:` sites. If a ceiling is ever set, everything received above it is unbonded and becomes a straight fraud budget. Pair any ceiling with a value cap on the trade itself.

---

## N1. The trade cash leg never reaches the receiver in platform payout mode (HIGH, NEW, runtime)

**How.** `settleTradeCash` calls `requestTransfer({ ..., merchantRef })` (`completion.ts:150-158`). In `StripeService.requestTransfer`, `const settleDirect = params.merchantRef && this.opts.config.payoutMode === 'direct'` (`:768`). If that is false, it returns `SETTLED` after **collecting** only.
- `settleTradeCash` then writes `manual_reconciliation: false` (`completion.ts:170`) and reports success.
- No later `payoutToMerchant` exists for trade cash (no other `trade-cash` references).
- `PAYOUT_MODE` defaults to `platform` (`config.ts:372`).

**Impact.** The cash receiver is never paid, the platform balance grows, and nothing flags it. **Runtime:** whether production sets `PAYOUT_MODE=direct` can't be verified from code.

**Fix.** Collect into the platform, then `payoutToMerchant` (with `source_transaction`) to the receiver's connected account. Mark settled only after the transfer.

---

## P. Fee evasion

### P1. Postage carries no fee and is effectively uncapped (MED, CONFIRMED)

**How.**
- The fee is on the item price only: `platformFeeCentsFor(agreedPriceCents, …)` (`cashSaleOrchestrator.ts:94`).
- Postage is the seller's to set (`:1405`, *"POSTAGE IS THE SELLER'S TO PRICE"*).
- The cap is `DELIVERY_COST_MAX_CENTS = 99_999_999_999` (`domain/fulfilment/terms.ts:31`).

**Attack.** The buyer and seller agree $500 in chat, and the contract says item $1 + postage $499. The fee is the $1.50 minimum (`feeMinimums.ts`). The platform still pays card processing on the full $500 (about 1.7% + $0.30 ≈ $8.80) plus the payout cost. **Net loss to the platform** on every such sale, not just lost revenue.

**Against a non-colluding buyer.** It works as bait: a $1 tile, then $499 postage in the room. **Mitigated:** a postage change bumps `terms_version` (`cash_sales_reset_acceptances`, 0050), and `acceptCashSaleTerms` refuses `STALE_TERMS`. So the buyer sees the total before paying, and that race is REFUTED.

**Fix.** Charge the fee on item + postage above a postage allowance, and/or cap postage (an absolute cap plus a ratio to the price), and flag contracts where postage is much larger than the price.

### P2. A failed Trade_Fee never blocks the trade, and the retry can't succeed (MED, CONFIRMED)

**How.**
- `chargeTradeFees`: *"Never throws and never blocks the trade"* (`tradeFees.ts:44`).
- `collateralPlacement.ts:110` only `console.warn`s and proceeds to lock.
- The drain reuses `nonce: row.nonce` (`tradeFees.ts:349`) as the Stripe idempotency key (`StripeService.ts:759`), and is limited to `MAX_FEE_ATTEMPTS = 8` (`:257`), hourly.
- A card decline is a cached idempotent result for 24 h. The codebase asserts this itself in `placeBondsForAgreedTrade`: *"Stripe caches the original decline … for 24 hours"*. So all 8 retries fall inside the window and replay the decline.
- If the trader has changed their default card, the parameters differ, which is an idempotency error and also FAILED.
- After 8 attempts the row is abandoned.

**Attack.** Use a prepaid or virtual card whose available balance exactly equals the hold. The hold succeeds, and the fee charge, which runs straight after, declines for insufficient funds. The trade proceeds and the fee is never collected.

**Impact.** 5% of the received value (minimum $1), lost by the platform. **Runtime:** the exact Stripe idempotency caching for 402 card errors can't be verified from code; the code's own comment asserts it.

**Fix.** Either require the fee to settle before HOLDS_CONFIRMED (refund on later cancellation), or after a *definite* decline retry with a new key (`${nonce}:${attempt}`). That's safe because a decline took no money. Also extend retries past 24 h, and as a last resort capture the fee from the hold before voiding it.

### P3. Off-platform payment lures (MED, PARTIALLY-MITIGATED)

**What exists.** `components/sales/CashSaleView.tsx:765-769` shows `OffPlatformWarning` (*"Anyone asking you to pay by PayID or bank transfer is running a scam"*), but **only when `payBlocked`** inside a cash-sale room.

**What's missing.**
- `lib/actions/messages.ts` does no content screening (no PayID, BSB, phone or "friends and family" detection).
- No warning in listing-page DMs, which open via `getOrCreateConversation` before any contract exists. That's where the lure happens.
- The guard that does work is structural: off-platform money is outside escrow, the user's own risk.

**Fix.** Pattern-detect payment handles, account numbers and phone numbers in `sendMessage`. Show an inline warning and record a moderation signal. Show the warning in every pre-contract thread.

---

## Refuted (brief)

- **"A participant can award themselves the fraud capture."** REFUTED. `resolveTradeFraud` is `requireStaff`, and the victim is an explicit argument validated against the participants (`disputeResolution.ts` `reportObjectiveFraud`, admin.ts:614). The old participant `resolveDispute` was removed (trades.ts:776-789).
- **"Bond sized on what the trader gives" (SINGLE-for-SINGLE, no cash).** REFUTED. Crossed correctly at `tradeProposal.ts:500`.
- **"A zero-value side yields an unbonded trade."** REFUTED for zero (`tradeSidesAreValued`, `tradeProposal.ts:494`). Near-zero is NOT blocked (see D2).
- **"`BondPolicy.ceilingCents` under-bonds today."** REFUTED (never set; see D).
- **"`declared_value_cents` sizes a bond."** REFUTED. Never read for bonds or fees. It only skews the display (D2).
- **"Seller bumps postage at the moment the buyer pays."** REFUTED. `terms_version` bump plus the `STALE_TERMS` check.
- **"Fee charged on a declined collateral hold."** REFUTED. Bonds come before the fee, and `hold-failed` returns before `chargeFeesForAgreedTrade` (`collateralPlacement.ts:236-277`).
- **"Direct PostgREST write of `fmv_cents` or `status`."** REFUTED. No member UPDATE grant (0072).

## Runtime / Dashboard items not verifiable from code
- `PAYOUT_MODE` in production (N1).
- Stripe idempotent replay of a declined `confirm: true` PaymentIntent (P2).
- Whether the Stripe account is eligible for multicapture (an alternative fix for C1).
- Authorisation lifetime per card network (D4 assumes about 7 days, per the in-code note).
