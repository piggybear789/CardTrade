# Final consolidated issues report — escrow hardening ESC-01..39 merged with the beta fee waiver and the US cross-border platform regions (git range e65f1a8..adf1255 on branch main in c:\dev\Marketplace (everything pushed today: escrow hardening ESC-01..39 from fix/escrow-hardening, the user's WIP commit c671815 with beta fee waiver / US cross-border platform regions / item form 2 steps / lapsed-sale case, the merge commit 087ff79 and its conflict resolutions, and adf1255). Focus on production-readiness defects: money-path correctness (Stripe holds, captures, refunds, transfers, payouts, idempotency keys, currency and FX handling, per-platform region bindings), authorization (RLS, service-role writes, requireStaff/requireAdmin, two-person approval gate in lib/actions/admin.ts and lib/arbitration/approvals.ts), state-machine and orchestrator guards, merge-resolution mistakes (lib/actions/arbitration.ts, domain/orchestrator/disputeResolution.ts, app/api/jobs/cash-sale-payouts/route.ts, lib/actions/admin.ts getCustodyPosition, domain/services/types.ts, StripeService.requestTransfer), and SQL migrations 0133-0148 in supabase/migrations (all already applied to production). Background docs: .kiro/steering/*.md and .agents/tasks/task-escrow-hardening/summary.md (known gaps; do not re-report those). Report only real defects with file:line and a concrete failure scenario; no style nits.)

Issues are sorted from highest to lowest combined importance/confidence.

---

## 1. Waived Trade_Fee makes COLLATERAL_PENDING an absorbing state — no trade can lock

**Severity: High**

- **User impact:** Every trade started on production today is permanently stuck. Both traders place real card authorisations, the room shows collateral pending forever, no trade ever reaches COLLATERAL_LOCKED, and the holds sit against their cards until they lapse. The entire trade product is down.
- **Issue:** `chargeTradeFees` (`lib/actions/tradeFees.ts:74-78`) filters out zero-amount obligations and writes no `trade_fees` row at all while `BETA_FEE_WAIVER` is on — deliberate, because Stripe refuses a zero-amount charge. The ESC-29 lock precondition `areFeesSettled` (`lib/trades/collateralLock.ts:88-95`) returns `rows.length > 0 && rows.every(SETTLED)`, so with no rows it returns false and `confirmCollateralIfComplete` (`domain/orchestrator/collateralReconcile.ts:88-90`) returns `INCOMPLETE/FEES` on every path that could lock the trade: the hold webhook, the synchronous reconcile after placement, the fee retry in the `:17` job, and the demo panel. Retrying charges nothing and so writes nothing, so the state is absorbing. The waiver and ESC-29 were developed on separate branches and this contradiction only exists in the merged tree.
- **Recommendation:** Derive lock readiness from the effective obligation rather than row existence: compute the fees the trade owes (`resolveTradeFees` with the waiver applied) and treat a zero total as satisfied, while still requiring a SETTLED row for every nonzero fee. Add a test that locks a trade with the waiver on and one that refuses to lock with a PENDING nonzero fee, so neither direction can regress.

## 2. Trade cash leg is collected and released in the platform's currency, with no FX fee

**Severity: High** · *(cluster: cross-border currency — see also #3, #9, #10)*

- **User impact:** On the US platform a EUR 100.00 trade cash leg is charged to the payer as USD 100.00 and later paid out as USD 100.00. The payer is charged the wrong amount in the wrong currency, the receiver is paid an amount that is not what they agreed, and nothing flags it — the settlement row is marked SETTLED with a provider ref.
- **Issue:** `payTradeCash` (`domain/orchestrator/tradeCashSettlement.ts:199-211`) calls the collection without `currency: record.currency` and without adding `currencyConversionFeeFor(...)`, which every cash-sale collection does; `releaseTradeCash` (`domain/orchestrator/tradeCashSettlement.ts:511-517`) calls `payoutToMerchant` without `currency: record.currency`. Omitting the argument falls back to `this.opts.config.currency` (the platform settlement currency), so `transferExactly` never locks an FX quote and the integer minor units are sent as USD. The row carries a currency and the drain already filters on it, so the value is in scope at both call sites. Invisible on the AU platform, where contract and settlement currency coincide, which is why no AU test catches it.
- **Recommendation:** Pass `record.currency` at both call sites and charge the disclosed Currency_Conversion fee on a foreign-currency collection, mirroring `cashSaleOrchestrator`. Because attempt-keyed idempotency means an already-created PaymentIntent cannot be re-denominated by a code change, audit and reconcile any non-USD `trade_cash_settlements` rows and intents created by this version before promoting.

## 3. Captured-collateral payout ignores the row's currency

**Severity: High** · *(cluster: cross-border currency — see also #2, #9, #10)*

- **User impact:** A fraud victim owed EUR 1,000 from the offender's captured collateral is transferred 100000 USD minor units instead. They receive the wrong amount, Stripe converts on arrival at its own rate, the disbursement is marked SETTLED, and nothing retries or reconciles.
- **Issue:** `domain/orchestrator/collateralDisbursement.ts:191-200` builds the `payoutToMerchant` call from `row.amountMinor` but omits `currency: row.currency`, even though `CollateralDisbursementRow` carries it and `listDue` filters rows by it. The cash-sale payout passes the currency (`cashSaleOrchestrator.ts:2528`); this drain and the trade-cash drain were missed.
- **Recommendation:** Pass `row.currency` so `transferExactly` sizes the transfer from a locked FX quote and returns FAILED rather than paying an unquoted figure. Refunds to the original payment stay correct without a currency argument, so only the payout path needs changing.

## 4. New-seller exposure tables fail closed, so no seller in the newly opened regions can complete a sale

**Severity: High**

- **User impact:** Every UK, EEA, Canadian and Swiss seller the 0136 change just onboarded is unsellable. Their buyer presses Pay and is refused with "This seller has reached their limit for new sellers. Try again after their current sales complete." — on the seller's very first sale, with nothing wrong and no path out, because no sale in those currencies can ever count toward being established.
- **Issue:** `NEW_SELLER_OPEN_EXPOSURE_MINOR` (`domain/payouts/releasePolicy.ts:36-40`) and `QUALIFYING_SALE_MIN_MINOR` (`domain/payouts/releasePolicy.ts:43-47`) list only `aud` and `usd`. `exceedsNewSellerExposure` returns `true` when the currency has no limit (`releasePolicy.ts:~147`), and `countQualifyingSales` skips any sale whose currency has no minimum (`releasePolicy.ts:~173`), so `qualifyingCompletedSales` stays at 0 forever and the seller is permanently new — which also means every payout they do eventually receive carries the 7-day new-seller holdback. `acceptCashSaleTerms` surfaces this as `SELLER_EXPOSURE_LIMIT`. Because `allConfiguredRegionCodes()` discovers regions by scanning the environment, nothing forces these tables to be revisited when a region opens.
- **Recommendation:** Derive both tables from `REGIONS` so every `tradingEnabled` currency has a value by construction, and add a test asserting that every tradeable currency resolves a limit and a qualifying minimum. Keep the fail-closed default for genuinely unknown currencies.

## 5. An approval id is claimed by case and action only, so an approved decision can execute a different payload

**Severity: High** · *(cluster: two-person staff gate — see also #6, #7, #8, #14)*

- **User impact:** The ESC-23 two-person control does not hold where it matters most. One staff member can move money on a high-value or fraud case that a second person never agreed to: a different victim, a different outcome, a different refund amount.
- **Issue:** `gateResolution` (`lib/arbitration/approvals.ts:52-61`) claims the proposal by `id`, `action`, `case_ref` and `status='APPROVED'` and never compares the stored `payload` or `value_minor`, nor binds execution to `decided_by`. `settle(false)` (`lib/arbitration/approvals.ts:66-75`) deliberately returns a failed execution to APPROVED, which is exactly the state a declined capture or provider timeout leaves behind, so the reusable window is not microseconds but open-ended. `approvalId` is an argument on exported Server Actions (`resolveTradeDispute`, `resolveCashSaleDispute`, `resolveCashSaleReturnCase`, `reverseCashSalePayout` in `lib/actions/admin.ts`) and migration 0145 lets staff read proposal ids, so any staff member — including the proposer, whom `canApprove` would refuse as `SAME_STAFFER` — can call the action directly with that id and their own payload, and the claim succeeds.
- **Recommendation:** Execute only the stored canonical payload: have the claim read the proposal row and dispatch the decision from it through a server-only function, and remove `approvalId` from the public Server Action surface. If the parameter must stay, compare a hash of the payload and the value in the claim predicate and reject a mismatch.

## 6. Recusal is never checked on the path that decides without approval

**Severity: High** · *(cluster: two-person staff gate — see also #5, #7, #8, #14)*

- **User impact:** A staff member who is the buyer, seller or a trader on a case can decide that case in their own favour — refund themselves, award themselves compensation — provided the value is below the two-person threshold.
- **Issue:** `isRecused` is consulted only inside `canApprove` (`lib/arbitration/approvals.ts:79-101`), i.e. only for the second approver. The branch in `gateResolution` that proceeds when `requiresSecondApproval` is false never loads participants, and neither does the proposal-creation branch, so the proposer/executor is never tested against the case. The staff resolution actions in `lib/actions/admin.ts` (around `:456-468` and the trade/sale resolution entry points) rely on `gateResolution` for this.
- **Recommendation:** Call `caseParticipants` in `gateResolution` unconditionally and refuse a staff member who is party to the case regardless of value — before direct execution and before creating a proposal. It is a cheap single-row read on a path that already does several.

## 7. Authorization facts fail open on a database error

**Severity: High** · *(cluster: two-person staff gate — see also #5, #6, #8, #14)*

- **User impact:** A transient Supabase read failure silently downgrades the two-person control: a high-value decision becomes a one-person decision, a participant approver is allowed through, or the solo-team self-approval fallback activates on a team that is not solo.
- **Issue:** `caseParticipants`, `staffCount`, `cashSaleValueMinor` and `tradeValueMinor` (`lib/arbitration/approvals.ts:105-144`) all discard the Supabase `error` and return empty arrays or `0`. `valueMinor: 0` means `requiresSecondApproval` is false; `participants: []` means `isRecused` is false; `staffCount() === 0`/`1` enables the cooling-off self-approval. Supabase reports errors in the returned object rather than throwing, so each of these reads as a clean "no constraint applies".
- **Recommendation:** Treat an unavailable authorization fact as a hard refusal: check the returned `error` in each helper and propagate a failure that `gateResolution` turns into a refusal with a retry message, rather than a permissive default.

## 8. UNFOUNDED and NO_EXCHANGE are valued at zero, bypassing the two-person gate on real money

**Severity: High** · *(cluster: two-person staff gate — see also #5, #6, #7, #14)*

- **User impact:** One staff account alone can unwind a trade with a $3,000 cash leg — refunding the cash and both Trade_Fees out of the platform balance — because the gate values that outcome at nothing.
- **Issue:** `lib/actions/admin.ts:899-903` sets `valueMinor` to `0` when `outcome.kind` is `UNFOUNDED` or `NO_EXCHANGE`. Zero is defensible for UNFOUNDED's hold releases, but NO_EXCHANGE routes the collected cash leg through `cashLeg.settleForOutcome` (`domain/orchestrator/disputeResolution.ts:~806`, `domain/orchestrator/tradeCashLeg.ts:40-85`) and refunds both Trade_Fees (`disputeResolution.ts:~818-825`); UNFOUNDED releases collected cash to the receiver. The gate therefore never fires for outcomes that move more than the threshold.
- **Recommendation:** Compute `valueMinor` from what the outcome actually authorizes — captured collateral plus collected cash plus fee refunds — rather than from the outcome label, so the threshold tracks the money.

## 9. Custody reconciliation silently drops every non-settlement-currency obligation

**Severity: High** · *(cluster: cross-border currency — see also #2, #3, #10)*

- **User impact:** The one console figure capable of detecting a drained platform balance, a chargeback or a provider fee reads healthier than it is. A captured EUR collateral hold and a GBP trade cash leg are money in the USD balance with no obligation recorded against them, biasing the position toward SURPLUS with no indication that rows were skipped.
- **Issue:** `getCustodyPosition` in `lib/actions/admin.ts` was extended for 0136 only on the cash-sale side, where a foreign contract is converted via its recorded `settlement_amount_cents` and an unconvertible row is excluded *and counted* as `unconvertedSales`. Captured collateral skips any trade whose currency differs from the settlement currency (`lib/actions/admin.ts:1171-1173`, and the same filter around `:1272-1274`), and the trade-cash query filters with `.eq('currency', settles)` (`lib/actions/admin.ts:1283-1286`). Neither path persists a settlement-denomination amount for the conversion, and neither reports what it ignored.
- **Recommendation:** Persist the settlement-denomination amount on captured holds and collected trade cash (new migration — 0133-0148 are applied), include converted obligations in the position, and surface anything unconvertible as an explicit incomplete count the way `unconvertedSales` does. Never silently exclude an obligation from this figure.

## 10. Cross-border payout reversal applies contract units to a settlement-currency transfer

**Severity: Medium** · *(cluster: cross-border currency — see also #2, #3, #9)*

- **User impact:** Staff cannot correctly claw back a payout on a cross-border sale. On a EUR 100.00 sale paid out as USD 113.04, asking to reverse EUR 100.00 reverses USD 100.00 (leaving USD 13.04 with the seller), and asking for the true figure is rejected as exceeding the sale's net.
- **Issue:** `reverseCashSalePayout` (`lib/actions/admin.ts:740-765`) validates and forwards `amountMinor` in the Cash_Sale's currency, while Stripe applies a transfer reversal in the original Transfer's currency (`domain/services/stripe/StripeService.ts:1188-1194`). The schema records only the transfer id, so the actual transferred amount and currency are not available to translate staff intent or to bound the request.
- **Recommendation:** Persist the payout's settlement amount and currency at transfer time (new migration), translate the staff-entered contract-currency figure into the transfer denomination, and bound the request against the unreversed portion of the transfer rather than the contract net.

## 11. Collected trade cash can be stranded by a terminal transition

**Severity: Medium**

- **User impact:** A trader's already-collected cash can end up with no owner and no automatic path to either party: the trade is terminal, the money is still held by the platform, no drain will pick it up, and the member has to notice and complain.
- **Issue:** Every routing call happens after the terminal event is committed — dispute resolution (`domain/orchestrator/disputeResolution.ts:778-806`), normal completion (`lib/trades/completion.ts:248-251`) and abandonment (`lib/trades/collateralPlacement.ts:497-529`). If the queue write fails, the row stays `COLLECTED`, and the drain only reads `RELEASE_PENDING`/`REFUND_PENDING` while the lifecycle action cannot be rerun on a terminal trade. Migration 0139's trigger only catches a row transitioning *into* COLLECTED after termination, not one already COLLECTED when the trade ends.
- **Recommendation:** Add a database backstop for "terminal trade with a COLLECTED settlement row" (new migration) or a reconciler pass in the `:47` job that derives the correct routing from the trade's terminal state and queues it, so a failed write is retried rather than lost.

## 12. Migration 0144's tracking-number binding is a check-then-write race

**Severity: Medium**

- **User impact:** Two contracts can both claim the same return tracking number, so one carrier delivery advances two refunds. A buyer can be refunded on a sale whose goods never came back.
- **Issue:** `supabase/migrations/0144_tracking_number_binding.sql:40-98,110-127,139-146` calls `tracking_in_use(...)` from row triggers and then allows the write. Nothing serialises concurrent writers on different contract rows — no unique index (the same-pair outbound exception rules out a simple universal one) and no lock — so two transactions can each observe no owner and both commit.
- **Recommendation:** In a new migration, take a transaction-level advisory lock keyed by the normalized number and re-check inside the lock, or move ownership into a constrained normalized-claim table that the exception can be expressed against. Add a concurrent-writer test.

## 13. Held rows can starve the trade-cash drain

**Severity: Medium**

- **User impact:** Eligible trade-cash releases are never paid. A backlog of held or not-yet-due rows means members wait indefinitely for money the platform is ready to send, including members on a different currency on the same platform.
- **Issue:** `supabaseTradeCashSettlementRepository.ts:149-155` fetches the oldest global page and applies `limit` before any currency, due or hold filtering; `drainTradeCash` (`domain/orchestrator/tradeCashSettlement.ts:576-587`) filters that page afterwards, and a row with a `holdReason` returns without changing its position in the ordering (`tradeCashSettlement.ts:493-503`). Fifty held rows at the head of the queue hide every newer eligible row permanently. The stale `COLLECTING` read has the same unscoped shape.
- **Recommendation:** Push currency, due-time and hold eligibility into the SQL query before `limit`, or paginate past ineligible rows. Scope the stale-`COLLECTING` read by platform for the same reason.

## 14. A failed execution leaves an approval that cannot be retried

**Severity: Medium** · *(cluster: two-person staff gate — see also #5, #6, #7, #8)*

- **User impact:** A transient provider refusal blocks the decision for good. The proposal sits APPROVED, the approval action refuses it, and 0145's open-proposal index prevents staff filing a replacement, so a disputed case cannot be resolved at all until someone edits the database.
- **Issue:** `settle(false)` resets the row to `APPROVED` (`lib/arbitration/approvals.ts:66-73`), but `approveStaffResolution` (`lib/actions/admin.ts:1385-1409`) accepts and claims only `PENDING` rows. Call sites also settle only on an ordinary `{ ok: false }` result, so a thrown error leaves the row EXECUTED with nothing moved.
- **Recommendation:** Either make the exact approved decision retryable from a dedicated claimed state, or return the row to `PENDING` so a fresh approval can be given. Wrap execution so a thrown error settles the proposal too. (Fixing this alongside #5 matters: the long-lived APPROVED window is what makes payload substitution practical.)

## 15. The persisted Currency_Conversion fee is written and never read back

**Severity: Medium**

- **User impact:** Changing the FX rate constant would brick every in-flight foreign-currency sale: the buyer is charged, the settlement check fails as `SETTLEMENT_MISMATCH`, the sale stays in `PAYMENT_PENDING`, and only a manual fix releases it.
- **Issue:** `recordPaymentSubmission` writes `cash_sales.fx_fee_cents`, but the ESC-37 settlement binding re-derives it (`domain/orchestrator/cashSaleOrchestrator.ts:2131`, `expectedCollected = sale.amountCents + currencyConversionFeeFor(...)`) and so does the contract room (`components/sales/CashSaleView.tsx:648`). `domain/fees/fxFee.ts` explicitly invites tuning the rate rather than the call sites. The column is also absent from `CASH_SALE_PUBLIC_SELECT` (`lib/supabase/cashSaleProjection.ts`), so the room could not read it today.
- **Recommendation:** Add `fx_fee_cents` to `CASH_SALE_PUBLIC_SELECT` and read the stored value in both the settlement comparison and the money table, falling back to the derived value only when the column is null (pre-0136 rows).

## 16. A clamped inspection deadline can start in the past

**Severity: Medium**

- **User impact:** A trader who was handed a fake at a meeting point gets a zero-length window to dispute: 0142 notifies both traders to raise a problem now, and the next hourly sweep auto-completes the trade and voids both holds in the same hour.
- **Issue:** The ESC-17b clamp has no lower bound in either copy of the rule — `domain/fulfilment/inspection.ts:324-329` returns `min(deadline, expiry - COLLATERAL_MARGIN_HOURS)`, and 0142's `set_trade_inspection_deadline` mirrors it. An IN_PERSON trade whose collateral was placed 24 hours before the meeting has an authorisation expiring ~90 hours after it; a handover confirmed four days late puts `lastUsefulMoment` behind `now`, so `inspectionExpired` is immediately true and the `:17` pass auto-completes.
- **Recommendation:** Floor the clamped deadline, or when no usable window remains route the trade to staff instead of auto-completing it. Do not notify both parties to act and close the window the same hour.

## 17. Three database checks are red and the replacement seams have no coverage

**Severity: Medium**

- **User impact:** The checks that would catch a future over- or under-grant and a broken refund queue are already failing, so a real regression in those areas would be indistinguishable from the known noise and would ship.
- **Issue:** `npx vitest --run` reports the `database` project failing in three files: `tests/database/grants.test.ts` still expects member INSERT on `items.owner_id`, which 0136 deliberately revoked in favour of a service-role `createItem`; `tests/database/returnTrackingRefundQueue.test.ts` still asserts that carrier delivery of a return queues the refund, which 0143 replaced with the 72-hour seller window released by `releaseDueReturnRefunds`; `tests/database/refundFailureReopen.test.ts` collides with 0144's 90-day tracking binding (`tracking-in-use`) on its fixture. The new releasing path has unit coverage only — nothing at the database level pins the RPC against the drain predicate, which is exactly what the deleted assertion protected. More broadly, the merged seams are untested: fee-waiver plus production `areFeesSettled`, foreign-currency trade cash and payouts, custody with unconverted rows, approval claim with a substituted payload, concurrent tracking claims.
- **Recommendation:** Update all three database tests to the post-0136/0143/0144 contract, add a database test for `releaseDueReturnRefunds` (window opens, drain finds it, contest freezes it), and add targeted regressions for each blocking seam above — including a non-AUD currency — then run the Stripe test-mode cross-border smoke path before promotion.
