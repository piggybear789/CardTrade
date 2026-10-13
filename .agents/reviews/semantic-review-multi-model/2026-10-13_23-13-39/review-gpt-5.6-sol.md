# Escrow hardening merge is not production-ready

## Summary

This range merges ESC-01–39 with beta fee waivers, cross-border US-platform regions, and a large UI change set. The new collection/payout seams, persisted trade-cash rows, custody queue, and approval proposals are directionally sound, but their merged assumptions disagree at critical boundaries. Every new trade is currently unable to leave `COLLATERAL_PENDING`; cross-border trade money is charged, paid, reversed, and reconciled in inconsistent denominations; and staff approvals can authorize the wrong payload or fail open. Terminal trades can also leave collected cash in a status no drain consumes.

Watch for: **confirmed** trade lock outage under the current fee waiver; **confirmed** wrong-currency cross-border charges, payouts, and reversals; **confirmed** missing foreign trade liabilities in custody; **confirmed** approval bypass/retry defects; **confirmed** stranded trade cash and tracking-number races.

**Verdict**: NEEDS_CHANGES

## High-level view

Fee collection creates no rows when the effective fee is zero, while collateral reconciliation requires at least one settled fee row. With the waiver enabled, live authorizations can be placed but no trade can lock.

Several new trade paths select the correct US Stripe account but omit the contract currency at the provider call. Foreign cash legs and collateral compensation therefore become USD operations, reversals confuse contract and transfer denominations, and custody excludes non-USD trade obligations rather than converting or flagging them.

The approval proposal flow does not bind authorization to the stored payload, defaults security facts on database errors, does not recuse the staff member initiating the decision, and values cash-moving trade outcomes at zero. Its failed-execution state is also non-retryable through the approval action.

Trade cash is routed after terminal state transitions, so one failed queue write can strand already-collected money. The drain limits before currency/eligibility filtering, and migration 0144’s tracking-number check is not atomic across concurrent contracts.

<details>
<summary>Issues (14)</summary>

1. **Waived-fee lock deadlock — confirmed** — Zero effective fees create no rows, but the lock gate requires a row, so every new trade remains `COLLATERAL_PENDING`. Treat a zero fee obligation as satisfied without weakening nonzero fee checks.
2. **Trade cash denomination and FX fee — confirmed** — Cross-border trade cash omits its contract currency and buyer FX fee during collection, then omits currency again during release. Pass `record.currency`, charge the disclosed conversion fee, and reconcile intents already created under fixed idempotency keys.
3. **Collateral payout denomination — confirmed** — Captured-collateral payouts ignore `row.currency`, so foreign compensation is paid as USD. Pass the row currency through `payoutToMerchant`.
4. **Foreign trade custody omission — confirmed** — The US custody report drops all non-USD trade cash and captured collateral. Persist settlement-denomination facts and include or explicitly mark every foreign obligation as unresolved.
5. **Converted payout reversal mismatch — confirmed** — Staff supply a contract-currency amount to reverse a settlement-currency Stripe Transfer, preventing accurate/full cross-border clawbacks. Persist and reverse against the actual transfer amount/currency via a new migration.
6. **Terminal cash stranding — confirmed** — Trade cash is queued only after the trade becomes terminal; a failed queue write leaves `COLLECTED` money with no eligible drain or lifecycle retry. Add a database backstop or terminal-row reconciler.
7. **Trade-cash queue starvation — confirmed** — The drain applies `limit` before currency and hold filtering, so held rows can permanently hide eligible rows. Scope and filter in SQL before limiting or paginate past ineligible rows.
8. **Approval payload substitution — confirmed** — An approval id is claimed by action/case only, allowing execution with a different amount, outcome, decision, or victim. Execute only the stored canonical payload in an internal dispatcher.
9. **Approval facts fail open — confirmed** — Amount, participant, and staff-count reads turn database errors into zero/empty facts. Treat unavailable authorization facts as hard refusals.
10. **Decision-maker recusal missing — confirmed** — Only the second approver is checked against case participants; a staff buyer/seller can decide a sub-threshold case involving themselves. Recuse the proposer/executor before direct execution and proposal creation.
11. **Cash-moving outcomes valued at zero — confirmed** — `UNFOUNDED` and `NO_EXCHANGE` can release/refund collected cash and fees while bypassing the two-person threshold. Value every movement authorized by the outcome.
12. **Approved failure retry dead end — confirmed** — Failed execution resets a proposal to `APPROVED`, while the approval action accepts only `PENDING`. Make the exact approved decision retryable or return it to a state that requires a fresh approval.
13. **Tracking claim race — confirmed** — Concurrent contracts can both pass migration 0144’s check-then-write trigger and claim one return number. Serialize normalized claims or enforce them through a constrained claim table in a new migration.
14. **Merged-seam regression coverage — confirmed gap** — Existing tests cover each half in isolation but miss the contradictory production bindings above. Add targeted integration tests, including foreign currencies and concurrent tracking claims, before promotion.

</details>

<details>
<summary>Details</summary>

## Waived Trade_Fees make `COLLATERAL_PENDING` absorbing

**Confirmed — blocking.** `chargeTradeFees` removes zero-fee entries and writes no `trade_fees` rows during the waiver (`lib/actions/tradeFees.ts:72-78`). The collateral gate requires `rows.length > 0` (`lib/trades/collateralLock.ts:87-94`). After both holds become active, every webhook, synchronous reconciliation, retry, and demo path returns `INCOMPLETE/FEES`; retrying still creates no rows.

Cash and cashless trades are both blocked, potentially leaving real card authorizations active. Define readiness from the effective obligation: zero computed fees need no rows; nonzero fees still require settled rows.

## Trade cash and collateral compensation bypass contract-currency handling

**Confirmed — blocking for cross-border regions.** `payTradeCash` sends `record.amountMinor` without `record.currency` or `currencyConversionFeeFor` (`domain/orchestrator/tradeCashSettlement.ts:199-211`). `releaseTradeCash` also omits currency (`domain/orchestrator/tradeCashSettlement.ts:511-517`). On the shared US platform, a EUR 100.00 leg becomes a USD 100.00 PaymentIntent and a USD payout rather than a EUR collection plus the disclosed FX fee and a quoted payout landing exactly EUR 100.00.

Existing idempotency keys prevent a code fix from changing an already-created attempt’s currency, so production rows and PaymentIntents created by this version require reconciliation.

**Confirmed — blocking for dispute compensation.** `CollateralDisbursementRow` carries currency, but its payout omits it (`domain/orchestrator/collateralDisbursement.ts:191-200`). Pass `row.currency` so `transferExactly` uses a locked quote; original-payment refunds remain correctly denominated without a currency argument.

## Foreign trade obligations disappear from custody

**Confirmed — blocking operational control.** `getCustodyPosition` passes the platform settlement currency to `loadCapturedCollateral`, whose filter keeps only matching contract currencies (`lib/actions/admin.ts:1171-1173,1272-1274`). Its trade-cash query also requires `.eq('currency', settles)` (`lib/actions/admin.ts:1283-1286`). The US report therefore omits every non-USD captured hold and collected cash leg and can report a healthy position while those obligations still exist.

Cash sales persist `settlement_amount_cents` and count unresolved conversions; trade collections/captures do neither. Persist their settlement-denomination amounts, include them in custody, and mark missing conversions as incomplete rather than excluding them.

## Converted payout reversals use contract units against settlement units

**Confirmed — blocking for cross-border clawbacks.** `reverseCashSalePayout` validates and forwards `amountMinor` in the Cash_Sale currency (`lib/actions/admin.ts:740-765`), while Stripe applies it to the original Transfer’s currency (`domain/services/stripe/StripeService.ts:1188-1194`). If EUR 100.00 required a USD 113.04 transfer, the action reverses USD 100.00 and rejects `11304` as greater than the EUR net.

Persist the payout settlement amount/currency, translate staff intent to the transfer denomination, and bound against the unreversed transfer. The schema currently records only the transfer id, so correct this with a new migration rather than editing applied files.

## Terminal transitions leave no recovery path for collected trade cash

**Confirmed — blocking money recovery.** Dispute resolution commits its terminal event before `cashLeg.settleForOutcome` (`domain/orchestrator/disputeResolution.ts:778-806`). Normal completion and abandonment do the same (`lib/trades/completion.ts:248-251`; `lib/trades/collateralPlacement.ts:497-529`). Migration 0139 only catches a row transitioning into `COLLECTED` after termination, not one already `COLLECTED` when the trade ends.

A failed post-transition queue write leaves a terminal trade and a `COLLECTED` row. The drain reads only `RELEASE_PENDING`/`REFUND_PENDING`, and the lifecycle action cannot rerun. Add a terminal-state database backstop or a reconciler that derives routing for terminal trades with collected cash.

## Held rows can monopolize the trade-cash drain

**Confirmed.** The repository fetches the oldest global page and applies `limit` (`domain/orchestrator/supabaseTradeCashSettlementRepository.ts:149-155`); `drainTradeCash` filters that page by currency afterwards (`domain/orchestrator/tradeCashSettlement.ts:576-587`). A row with `holdReason` returns without changing its ordering (`domain/orchestrator/tradeCashSettlement.ts:493-503`). Fifty held rows can indefinitely hide newer eligible rows, including other currencies on the same platform.

Move currency and due/hold eligibility into the query before `limit`, or paginate past ineligible rows. Scope stale `COLLECTING` reads by platform for the same reason.

## Approval authorization is detached from the stored proposal

**Confirmed — authorization integrity.** `gateResolution` claims by id, action, case, and status only (`lib/arbitration/approvals.ts:55-61`); it never compares stored payload/value or binds execution to `decided_by`. The optional `approvalId` parameters are on exported Server Actions. Since migration 0145 lets staff read proposal ids, a staff caller can use an `APPROVED` id with a different outcome, amount, return decision, or trade victim—especially after the long-lived failed state below.

Remove approval ids from the public action surface. Atomically claim and dispatch the stored canonical payload through a server-only function.

## Approval facts and recusal fail open

**Confirmed — authorization integrity.** `caseParticipants`, `staffCount`, `cashSaleValueMinor`, and `tradeValueMinor` ignore Supabase errors and return empty/zero facts (`lib/arbitration/approvals.ts:107-144`). A transient read failure can turn a high-value action into a no-approval action, permit a participant approver, or activate the solo fallback. These reads must refuse when unavailable.

**Confirmed — authorization integrity.** Recusal is checked only for the approver; the initial `staffId` path never loads participants (`lib/arbitration/approvals.ts:79-101`; `lib/actions/admin.ts:456-468`). A staff buyer on a sub-threshold sale can refund themselves. Check the proposer/executor against direct participants before direct execution and proposal creation; this is separate from the already-documented related-account follow-up.

## Two-person valuation excludes real trade cash movements

**Confirmed.** `resolveTradeDispute` assigns zero value to `UNFOUNDED` and `NO_EXCHANGE` (`lib/actions/admin.ts:899-903`). The former releases collected cash; the latter refunds it and can refund Trade_Fees (`domain/orchestrator/tradeCashLeg.ts:40-85`; `domain/orchestrator/disputeResolution.ts:818-825`). One staff account can therefore move well above the threshold.

Calculate approval value from captured collateral, collected cash, and fee refunds authorized by the outcome, not from the outcome label.

## Failed approvals cannot be executed again

**Confirmed.** `settle(false)` resets `EXECUTED` to `APPROVED` (`lib/arbitration/approvals.ts:67-73`), but `approveStaffResolution` rejects non-`PENDING` rows and claims only `PENDING` (`lib/actions/admin.ts:1385-1409`). A transient provider refusal leaves an open proposal that the approval action cannot retry, while migration 0145’s open-proposal index prevents replacement.

Use a retryable claimed state for the same stored decision, or return it to `PENDING` for fresh approval. Handle thrown errors too; current call sites settle only ordinary failure results.

## Tracking-number ownership is a check-then-write race

**Confirmed.** Migration 0144 calls `tracking_in_use(...)` from row triggers and then permits the write (`supabase/migrations/0144_tracking_number_binding.sql:40-98,110-127,139-146`). No constraint or transaction lock serializes different contract rows. Concurrent requests can both observe no owner and commit one return number, letting one delivery advance multiple refunds.

The same-pair outbound exception prevents a simple universal unique index. Use a transaction advisory lock keyed by normalized number and re-check, or a constrained normalized-claim table. Because 0144 is applied, ship a new migration.

## Regression coverage misses the merged contracts

**Confirmed gap.** `tradeFeeDrain.test.ts` proves waived fees write no rows but never combines that with production `areFeesSettled`; `tradeCashCollection.test.ts` uses AUD and does not assert currency/FX; custody tests receive already-converted pure inputs; approval tests cover pure policy only; tracking tests have no concurrent-writer case.

Not tested in this review: no build, typecheck, lint, Vitest, Stripe smoke test, or production query was run. This was a static review of the full `e65f1a8..adf1255` diff and final files, respecting the requested test cadence. Add focused regressions for every blocking seam, then run the Stripe test-mode cross-border smoke path before promotion.

</details>

<details>
<summary>File map and full diff</summary>

The range changes 381 files. Production-critical files traced here:

- `lib/trades/collateralLock.ts`, `lib/actions/tradeFees.ts` — fee obligation and lock readiness.
- `domain/orchestrator/tradeCashSettlement.ts`, `domain/orchestrator/supabaseTradeCashSettlementRepository.ts` — held cash lifecycle and drain.
- `domain/orchestrator/collateralDisbursement.ts`, `domain/orchestrator/disputeResolution.ts`, `domain/orchestrator/tradeCashLeg.ts` — dispute captures and outcome routing.
- `lib/trades/completion.ts`, `lib/trades/collateralPlacement.ts` — completion/abandonment ordering.
- `domain/services/types.ts`, `domain/services/stripe/StripeService.ts`, `lib/regionBinding.ts`, `domain/services/index.ts` — payment seam, currency, FX, and platform selection.
- `lib/actions/admin.ts`, `lib/arbitration/approvals.ts`, `domain/arbitration/approvalPolicy.ts`, `lib/actions/arbitration.ts` — staff authorization, approval lifecycle, and custody.
- `app/api/jobs/cash-sale-payouts/route.ts` — per-platform/currency drains.
- `supabase/migrations/0133_trade_dispute_custody.sql` through `0148_message_risk_flags.sql` — applied escrow, tracking, approval, RLS, and hardening schema.
- Relevant unit/component tests — current coverage around fees, trade cash, custody, approvals, and tracking.

Full diff: `git diff --no-ext-diff e65f1a8..adf1255`

</details>
