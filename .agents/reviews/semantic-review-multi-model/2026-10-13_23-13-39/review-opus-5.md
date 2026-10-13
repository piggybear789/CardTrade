# Escrow hardening ESC-01..39, beta fee waiver, and the US cross-border platform (e65f1a8..adf1255)

Forty commits land three separate bodies of work on `main` at once: the whole `fix/escrow-hardening` branch (ESC-01 through ESC-39, sixteen migrations, buyer-present collection, a custody backstop, a two-person staff rule), a WIP commit that waives platform fees and opens the US/UK/EEA/CA/CH cross-border group, and the merge that reconciled them. The merge resolutions themselves are good: `operationalPlatforms()` correctly replaces the per-region payout loop so the US account drains once per currency rather than once per EEA country, `cashSaleMarkerCase` scopes the arbitration markers by status, and the settlement binding compares like with like once the FX fee is folded in. Source type-checks clean (`npx tsc --noEmit` reports only stale `.next-e2e` artifacts), and 1640 of 1644 runnable tests pass.

The problems are concentrated where the two bodies of work meet. Escrow hardening was built when every contract was AUD or USD; 0136 added four more trading currencies, and three money paths plus two risk tables were not extended to match. Separately, the ESC-23 two-person gate checks that a second person approved *something* for this case, but not that they approved *this decision*, and it never checks recusal on the path that does not need approval.

**Watch for:** two payouts that send the wrong currency with no FX quote (confirmed, `collateralDisbursement.ts:191`, `tradeCashSettlement.ts:511`); every new seller in the regions 0136 just opened is refused at the buyer's Pay step and can never graduate (confirmed, `releasePolicy.ts:147`/`173`); the two-person approval claim is not bound to the approved payload and is re-claimable after a failed execution (confirmed, `approvals.ts:53-75`); recusal is enforced on the approver only, so a staff member who is party to a case can decide it outright below the threshold (confirmed); custody reconciliation silently drops every non-USD obligation on the US platform (confirmed, `admin.ts:1172`, `admin.ts:1284`); three database-level checks now fail against the live catalog (confirmed by running them).

**Verdict**: NEEDS_CHANGES

## High-level view

Three paths pay held money out to a member, and two of them lost their currency. `payoutToMerchant` takes a contract currency precisely so a GBP obligation is sized from a locked FX quote instead of being sent as the same integer of USD; the cash-sale payout passes it, the collateral disbursement drain and the trade-cash release do not. Both drains already filter their rows by currency, so the row knows what it owes — the argument is simply missing at the call. On the AU platform nothing happens, because contract currency and settlement currency are the same; on the US platform a €1,000 fraud-victim payout leaves as $1,000 and is marked SETTLED.

The new-seller fraud controls are keyed by currency through lookup tables that list `aud` and `usd` and fail closed on anything else. That was the right default when those were the only trading currencies. After 0136 it means `exceedsNewSellerExposure` returns true for a €1 sale by a German seller, and the buyer's Pay step refuses with `SELLER_EXPOSURE_LIMIT`; and because the qualifying-sale minimum has the same two keys, no sale in those currencies ever counts toward "established", so the seller cannot work their way out of it. The newly opened cohort cannot complete a first sale at all.

The two-person rule is sound in its happy path and leaky at its edges. `gateResolution` claims an APPROVED row by action and case reference, never by payload, and `settle(false)` deliberately returns the row to APPROVED when execution fails — so after a failed capture any staff member can call the same action directly with that approval id and a payload nobody approved. Recusal is checked only inside `canApprove`, which runs on the approver; the path that proceeds without approval never asks, so a staff member who is a trader on the case can resolve it as long as the value is below the threshold. And `resolveTradeDispute` values UNFOUNDED and NO_EXCHANGE at zero, which makes the gate unreachable for the outcome that refunds the trade's entire cash leg.

Custody reconciliation is the one figure on the admin console that the provider owns rather than the application, and the steering doc names it as the control that detects a drained balance. The cash-sale half of it was extended for 0136 carefully: a foreign-currency contract is converted through its recorded `settlement_amount_cents`, and a row that cannot be converted is counted and reported as `unconvertedSales`. The captured-collateral and trade-cash halves were not — they filter on the settlement currency and silently drop everything else, so a captured EUR hold is money in the USD balance with no obligation recorded against it, and the panel reads healthier than it is.

The provider seam itself is the strongest part of the change, and the parts that would be expensive to get wrong later are the parts that are right. Single capture is enforced by a retrieve-first guard in both capture methods and modelled identically in the mock and in-memory bindings, so a test cannot pass on a capture Stripe would refuse. Off-session-to-member is refused before any API call, with one explicitly named legacy exception pinned by a source scan. Platform events carrying `event.account` are dropped, which closes the "seller settles their own sale from a PaymentIntent in their own connected account" hole. FX transfers are sized from a locked quote, rounded up, and keyed so a retry replays rather than re-rates. The authorisation budget is a partition (114 = 24 + 72 + 18) asserted in tests rather than three numbers free to drift. And the orphan sweep throws on a failed `pre_auth_holds` read rather than treating it as "nothing is live", which is the one mistake there that would have voided every real hold on the platform.

Two smaller correctness notes. The Currency_Conversion fee is persisted on the contract but never read back: the settlement binding and the contract room both re-derive it from `FX_FEE_BPS`, which the module's own comment invites you to tune — doing so would leave every in-flight `PAYMENT_PENDING` sale permanently unsettleable. And the ESC-17b inspection clamp has no lower bound, so a late handover confirmation can produce a deadline already in the past, which the `:17` sweep reads as expired and auto-completes while 0142's notification tells both traders to raise a problem now.

Finally, the test suite: three `database`-project files fail against the live catalog, and each one is a check that used to be load-bearing. The member write-surface grants test still expects members to hold INSERT on `items.owner_id`, which 0136 revoked on purpose. Two assertions in `returnTrackingRefundQueue` still require carrier delivery of a return to queue the refund, which 0143 deliberately replaced with a 72-hour seller window — and the new releasing path has no database-level test standing in its place. The third is a fixture collision with 0144's 90-day tracking binding.

<details>
<summary>Issues (10)</summary>

1. **Collateral disbursement pays in the platform's currency** (confirmed) — `domain/orchestrator/collateralDisbursement.ts:191` omits `currency: row.currency`, so a non-USD disbursement on the US platform transfers that integer as USD with no FX quote. Pass the row's currency.
2. **Trade cash release pays in the platform's currency** (confirmed) — `domain/orchestrator/tradeCashSettlement.ts:511` has the same omission for `record.currency`. Pass it.
3. **New sellers in the 0136 regions cannot transact** (confirmed) — `NEW_SELLER_OPEN_EXPOSURE_MINOR` (`releasePolicy.ts:37`) and `QUALIFYING_SALE_MIN_MINOR` (`:45`) list only `aud`/`usd` and fail closed, so Pay refuses with `SELLER_EXPOSURE_LIMIT` and no sale ever qualifies. Add entries for every `tradingEnabled` currency, or derive them.
4. **Approval claim is not bound to the approved payload** (confirmed) — `lib/arbitration/approvals.ts:53-75` matches only action, case and status, and `settle(false)` returns the row to APPROVED. Compare a payload hash in the claim, or have the action read its arguments from the proposal row.
5. **Recusal is never checked on the deciding path** (confirmed) — `isRecused` runs only inside `canApprove`. Call `caseParticipants` in `gateResolution` and refuse a staff member who is party to the case regardless of value.
6. **UNFOUNDED/NO_EXCHANGE bypass the two-person gate** (confirmed) — `lib/actions/admin.ts:900` values them at 0, but NO_EXCHANGE refunds the whole trade cash leg (`disputeResolution.ts:806`) and the fees. Value NO_EXCHANGE at the cash leg plus fees.
7. **Custody drops non-settlement-currency obligations** (confirmed) — `lib/actions/admin.ts:1172` skips captured collateral in another currency and `:1284` filters trade cash legs to the settlement currency. Convert them as the cash-sale branch does, or count them into `unconvertedSales`.
8. **Three database checks fail against production** (confirmed by running `npx vitest --run`) — `tests/database/grants.test.ts` still expects member INSERT on `items.owner_id` after 0136; `tests/database/returnTrackingRefundQueue.test.ts` still expects delivery to queue the refund after 0143; `tests/database/refundFailureReopen.test.ts` collides with 0144's tracking binding. Update all three and add a database test for `releaseDueReturnRefunds`.
9. **The charged FX fee is written but never read** (likely) — `cash_sales.fx_fee_cents` is persisted at submission, while `cashSaleOrchestrator.ts:2131` and `CashSaleView.tsx:648` re-derive it from `FX_FEE_BPS`; it is also absent from `CASH_SALE_PUBLIC_SELECT`. Read the stored value in the binding and the room.
10. **Inspection clamp has no lower bound** (likely) — `domain/fulfilment/inspection.ts:329` and 0142 can both produce a past deadline, which `inspectionExpired` treats as expired and auto-completes. Floor the clamp, or route a trade with no usable window to staff instead of auto-completing it.

</details>

<details>
<summary>Details</summary>

### Two payouts send the platform's currency instead of the contract's

`payoutToMerchant` grew a `currency` parameter in this change, documented on the interface as the thing that keeps a seller from being paid a different figure: when the contract currency differs from the platform's settlement currency, `transferExactly` locks an FX quote, sizes the transfer so exactly `amount` of the contract currency lands, rounds up, and returns `FAILED` rather than paying an unquoted figure. Omitting the argument falls back to `this.opts.config.currency`.

The cash-sale payout passes it (`cashSaleOrchestrator.ts:2528`, with a comment explaining why). The two other paths that move held money to a member do not:

```ts
// domain/orchestrator/collateralDisbursement.ts:191
const payout = await payments.payoutToMerchant({
  merchantRef: payee.merchantRef,
  amount: row.amountMinor,
  ref: `collateral-payout:${row.id}`,
  nonce: row.nonce,
  sourcePaymentRef: row.holdRef,
});
```

```ts
// domain/orchestrator/tradeCashSettlement.ts:511
const payout = await deps.payments.payoutToMerchant({
  merchantRef: receiver.merchantRef,
  amount: record.amountMinor,
  ref: `trade-cash:${record.tradeId}`,
  nonce,
  sourcePaymentRef: record.collectionRef,
});
```

Both rows carry a currency — the drains select on it (`listDue` filters `.eq('currency', currency)`, `drainTradeCash` takes a `currency` param) — and both are invoked once per platform-currency pass from `app/api/jobs/cash-sale-payouts/route.ts`, so the value is in scope at the call. A staff FRAUD finding on a €1,000 EUR trade therefore queues a €1,000 PAYOUT and the drain transfers 100000 **USD** minor units to the victim's connected account, where Stripe converts at its own rate on arrival. The row is marked SETTLED with a provider ref, so nothing retries and nothing reconciles. On the AU platform this is invisible, which is why it will not show up in any AU test.

### The 0136 regions cannot complete a first sale

ESC-03 layer 1 caps how much collected-but-unreleased money a new seller may hold, and the limit is a per-currency table:

```ts
// domain/payouts/releasePolicy.ts:37
export const NEW_SELLER_OPEN_EXPOSURE_MINOR: Readonly<Record<string, number>> = {
  aud: 200_000,
  usd: 150_000,
};
...
// :146
const limit = NEW_SELLER_OPEN_EXPOSURE_MINOR[p.currency.toLowerCase()];
if (limit === undefined) return true;
```

`loadSellerExposure` always returns an object, so the `exposure &&` guard at `cashSaleOrchestrator.ts:2045` is always true and the currency decides. A UK seller's buyer presses Pay on a £40 sale; `exceedsNewSellerExposure` sees `gbp`, finds no limit, returns true, and `acceptCashSaleTerms` refuses with `SELLER_EXPOSURE_LIMIT` and the member-facing copy "This seller has reached their limit for new sellers. Try again after their current sales complete." Nothing is wrong with the sale and the message is actively misleading.

`countQualifyingSales` closes the exit:

```ts
// :172
const min = QUALIFYING_SALE_MIN_MINOR[sale.currency.toLowerCase()];
if (min === undefined || sale.agreedPriceMinor < min) continue;
```

A GBP, EUR, CAD or CHF sale can never be a qualifying sale, so `qualifyingCompletedSales` stays at 0 forever and the seller is permanently new — which also means every payout they ever receive carries the 7-day new-seller holdback. The same table shape appears in `frictionTax.ts` and `tradeSideValues.ts`, but those fail to 0 or 1 and only weaken a deterrent; this pair blocks the flow. Since `allConfiguredRegionCodes()` discovers regions by scanning the environment, there is no list that forces these tables to be revisited when a region opens — deriving both from `REGIONS` would make the omission impossible.

### The two-person gate is bound to the case, not to the decision

The flow is right in outline: a staff action computes what it would move, `gateResolution` writes a PENDING proposal above the threshold, a second staff member calls `approveStaffResolution`, which checks `canApprove` (different person, not a party, cooling-off on a solo team), marks the row APPROVED and re-runs the same action with the proposal id so every guard applies again. The payload is read from the row, not from the approver, and the unique partial index on `(action, case_ref) where status in ('PENDING','APPROVED')` stops two proposals racing.

The claim is where it loosens:

```ts
// lib/arbitration/approvals.ts:53
if (params.approvalId) {
  const { data, error } = await proposals()
    .update({ status: 'EXECUTED', executed_at: new Date().toISOString() })
    .eq('id', params.approvalId)
    .eq('action', params.action)
    .eq('case_ref', params.caseRef)
    .eq('status', 'APPROVED')
    .select('id');
```

Three predicates, none of them the payload. Normally the APPROVED window is microseconds because `approveStaffResolution` claims it immediately — but `settle(false)` deliberately hands it back:

```ts
// :68
if (!succeeded) {
  await proposals().update({ status: 'APPROVED', executed_at: null })...
}
```

That is exactly the state a failed capture, a provider timeout or a `HOLD_RELEASE_FAILED` leaves behind. `resolveTradeDispute` is a Server Action whose third positional argument is the approval id, so any staff member — including the proposer, who `canApprove` would have refused as `SAME_STAFFER` — can then call it with that id and a FRAUD outcome naming a different victim, and the claim succeeds. The proposal row records what was approved; the decision that executes can be something else.

Recusal has a narrower problem: `isRecused` is only consulted by `canApprove`, i.e. only on the approver. The path through `gateResolution` that proceeds without approval never loads the participants, so a staff member who is the buyer, seller or a trader on the case can decide it themselves whenever `requiresSecondApproval` is false. `caseParticipants` already exists and is cheap; it belongs in `gateResolution` unconditionally.

And the gate cannot fire at all for two trade outcomes:

```ts
// lib/actions/admin.ts:900
valueMinor: outcome.kind === 'UNFOUNDED' || outcome.kind === 'NO_EXCHANGE' ? 0 : await tradeValueMinor(tradeId),
```

UNFOUNDED only releases authorisations, so zero is defensible. NO_EXCHANGE is not: `disputeResolution.ts:806` routes the cash leg through `cashLeg.settleForOutcome`, which refunds the collected cash to the payer, and `:824` refunds both Trade_Fees. A trade with a $3,000 cash leg is unwound, and money leaves the platform balance, on one staff account's say-so.

### Custody reconciliation under-counts what the platform owes

`getCustodyPosition` was extended for 0136 with real care on the cash-sale side. A contract in the settlement currency is counted directly; one in another currency is converted through its recorded `settlement_amount_cents` pro-rated by the buyer's whole charge; and a row that cannot be converted is excluded *and counted*, surfacing as `unconvertedSales` so the panel admits what it could not check.

The other two obligation sources skip that treatment entirely:

```ts
// lib/actions/admin.ts:1172 — captured collateral
if (!trade || String(trade.currency ?? 'aud').toLowerCase() !== currency) continue;
```

```ts
// lib/actions/admin.ts:1284 — trade cash legs
.eq('currency', settles)
```

A captured EUR collateral hold and a GBP trade cash leg are both money sitting in the USD platform balance — the charge was converted on arrival, exactly like a EUR cash sale. Dropping them from the obligations while the balance reading includes their proceeds biases the position toward SURPLUS, and unlike the cash-sale branch there is no counter to say how many rows were ignored. This is the figure the steering doc identifies as the only control capable of detecting a chargeback, a provider fee or an automatic-payout sweep draining the balance, so a silent omission is worth more than a loud one.

### Three database checks are now red

Running the suite (`npx vitest --run`, 169 files): `Test Files 3 failed | 165 passed | 1 skipped`, `Tests 4 failed | 1640 passed`. All four failures are in the `database` project, which runs against the live catalog; a second run of the same suite produced six, the extra two in the same three files, so the count depends on leftover rows in the live database as well as on the code.

```
FAIL tests/database/grants.test.ts > member write surface (live catalog)
AssertionError: listing: create sets owner — INSERT on items.owner_id IS DENIED but is needed
```

0136 revoked member INSERT on `items` on purpose, because a direct PostgREST insert skipped `readListingGate` and published a listing from an unverified account. `createItem` now inserts with the service role. The assertion that pins the member write surface — the check whose whole job is to notice over- and under-granting — was not updated with it, so the one test that would catch a *future* accidental revoke is already failing for a deliberate one.

```
FAIL tests/database/returnTrackingRefundQueue.test.ts
  > QUEUES THE REFUND when a carrier confirms the return arrived
    expected 'NOT_DUE' to be 'PENDING'
  > leaves the refund somewhere the drain will actually find it
    expected false to be true
```

0143 deliberately stopped queuing the refund on the carrier scan and replaced it with a 72-hour seller window released by `releaseDueReturnRefunds`. The test still asserts the old contract, and its own comment explains it exists because a buyer was once told they were refunded when nothing was queued. The replacement path — window opens, `:47` job releases, contest freezes — has unit coverage (`returnInspectionWindow.test.ts`) but nothing at the database level where the RPC and the drain predicate have to agree. That agreement is precisely what the second assertion was protecting.

```
FAIL tests/database/refundFailureReopen.test.ts
Management API 400: ERROR: P0001: tracking-in-use
  CONTEXT: PL/pgSQL function cardtrade.cash_sales_tracking_binding() line 14
```

A fixture collision with 0144, not a product bug — but it does show the binding's reach: a normalised number is held by any contract that is live *or closed within 90 days*, including CANCELLED and FAILED ones, so historical rows (test or real) refuse re-entry of the same number.

### The FX fee is stored and then re-derived

`recordPaymentSubmission` writes `fx_fee_cents` when it is non-zero, and the column exists for exactly the reason the money table needs it. Nothing reads it. The settlement binding re-derives:

```ts
// domain/orchestrator/cashSaleOrchestrator.ts:2131
const expectedCollected = sale.amountCents + currencyConversionFeeFor(sale.amountCents, sale.currency);
```

and so does the room (`CashSaleView.tsx:648`). `fxFee.ts` says of the rate, "Tune this, not the call sites, if Stripe's FX pricing changes" — doing that invalidates `expectedCollected` for every `PAYMENT_PENDING` sale already collected at the old rate. Each becomes `SETTLEMENT_MISMATCH`, which the orchestrator classifies as unexpected and leaves in `PAYMENT_PENDING`: the buyer is charged, the goods are not released, and only a manual fix moves it. The column is also missing from `CASH_SALE_PUBLIC_SELECT`, which the tech steering doc calls out as the thing that makes a new `cash_sales` column invisible to the contract room; reading the stored fee in both places fixes the drift and the omission together.

### A clamped inspection window can start in the past

ESC-17b clamps the inspection deadline to the earliest live hold expiry minus the capture margin, and the clamp deliberately beats the 24-hour floor — a window outliving the money behind it is a promise that cannot be kept. Both copies of the rule agree (`inspection.ts:329` and 0142's `set_trade_inspection_deadline`), which is the part that matters most. Neither has a lower bound:

```ts
// domain/fulfilment/inspection.ts:324
const lastUsefulMoment = expiry.getTime() - COLLATERAL_MARGIN_HOURS * HOUR_MS;
return new Date(Math.min(deadline, lastUsefulMoment)).toISOString();
```

An IN_PERSON trade whose collateral was placed 24 hours before a meeting has an authorisation expiring 90 hours after it. Confirm the handover four days late and `lastUsefulMoment` is already behind `now`, so the deadline is in the past, `inspectionExpired` is immediately true, and the next `:17` pass auto-completes the trade and voids both holds. Meanwhile 0142's six-hour branch has just notified both traders to "raise a problem now". A trader handed a fake at a meeting point — the exact case ESC-20 exists for — gets a window of negative length. The honest outcomes are a floor, or sending the trade to staff rather than auto-completing it; what it should not do is tell both parties to act and then close the door the same hour.

</details>

<details>
<summary>File map</summary>

381 files, +32101 / −6437. The parts this review examined:

- `domain/orchestrator/collateralDisbursement.ts`, `tradeCashSettlement.ts` — the two drains missing a payout currency.
- `domain/orchestrator/cashSaleOrchestrator.ts` — buyer-present collection, the ESC-37 settlement binding, the exposure check at Pay, the seller payout.
- `domain/payouts/releasePolicy.ts` — the one holdback rule; the two per-currency tables that fail closed.
- `domain/services/stripe/StripeService.ts`, `domain/services/types.ts` — single capture, FX quotes, presence, Accounts v2 cross-border capability, restricted-key identity reads.
- `domain/arbitration/approvalPolicy.ts`, `lib/arbitration/approvals.ts`, `lib/actions/admin.ts` — the two-person gate, `getCustodyPosition`, the staff resolution actions.
- `domain/orchestrator/disputeResolution.ts`, `domain/bond/currentHolds.ts` — the four outcomes, the money plan, custody modes.
- `domain/fulfilment/inspection.ts` — the 114-hour partition and the ESC-17b clamp.
- `lib/webhook/webhookPipeline.ts`, `domain/services/stripe/webhook.ts`, `domain/webhook/mapEventToAction.ts` — HOLD_STATUS, TRADE_CASH_SETTLE, chargeback holds, early fraud warnings, connected-account event drop.
- `app/api/jobs/cash-sale-payouts/route.ts` — the per-platform-per-currency pass, returns sync, return refund release.
- `supabase/migrations/0133`–`0148` — custody, tracking clock, return window, tracking binding, approvals, path guards, default-privilege revoke, risk signals, side-value freeze, auth budget.
- `tests/database/*` — the three files now failing against the live catalog.

Full diff: `git diff e65f1a8..adf1255`.

</details>
