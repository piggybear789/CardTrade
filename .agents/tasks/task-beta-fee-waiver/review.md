# Beta fee waiver: Cash_Sale and Trade fees at 0% behind one switch

Commit `0b07616` waives the Cash_Sale Platform_Fee and every trader's Trade_Fee for the beta. It adds one code constant, `BETA_FEE_WAIVER` in `domain/fees/betaFeeWaiver.ts`, and applies it to the rate through `effectiveFeeBps`. `PLATFORM_FEE_BPS` / `TRADE_FEE_BPS` stay as the 5% standard rates. Disclosure and charge both go through `platformFeeCentsFor` / `tradeFeeCentsFor` / `resolveTradeFees`, so they cannot disagree. Member copy comes from new strings in `lib/fees/feeLabels.ts`. Money tables keep a numeric $0.00 and put "waived during beta, normally 5%" in the row label. The Dart mirror `Money.betaFeeWaiver` is pinned by `mobileDomainAgreement.test.ts`. No migration was added, and none is needed: every fee CHECK is `>= 0`.

Watch for: the seller payouts list still reads "less $0.00 fee" with no beta wording (confirmed, non-blocking). Compact surfaces (catalog tile, offers list row) say "no fee(s) during beta" without naming 5% (confirmed, non-blocking). The `ItemForm.tsx` copy edit sits uncommitted inside the user's WIP (confirmed, deliberate). Flutter tests and goldens were not run (confirmed, recorded).

**Verdict**: APPROVED

## High-level view

The switch is a single exported boolean, and only `effectiveFeeBps` reads it. Both fee functions call that, so there are not two toggles. `feesWaivedForBeta()` in `feeLabels` returns the same constant for copy decisions. Being a code constant rather than an env var, the client bundle and the server compile the same value.

On the trade side, the existing `.filter(amountCents > 0)` in `chargeTradeFees` means a zero fee writes no `trade_fees` row and makes no provider call. That path serves `acceptTradeTerms` via `chargeFeesForAgreedTrade`. The retry drain run by the trade-inspections job now also settles any zero-amount FAILED row without calling Stripe, so it cannot loop. On the cash side, the fee is set at open and on price changes. A 0 fee keeps `amount = price + 0 + shipping` valid, and the seller net clamps to the full amount. No code path divides by the fee or asserts it is positive. A grep for `fee > / <= / /` comparisons across `lib`, `domain` and `app` found nothing.

Custody reconciliation has no fee input and is deliberately left alone. New tests pin both cases: equal balance is SOLVENT, and a balance net of absorbed Stripe costs is a real SHORTFALL. Steering records this as an accepted cost that needs a balance buffer.

Copy covers every surface named in the brief: listing note, popover, tile, buy summary, offer dialog, offers list, deal breakdown, binder price hint, both cash-sale money tables, the trade exchange panel and accept dialog, the trade offer form, safety, help, terms, the item-form readout, and three Flutter screens. Onboarding and `lib/email/**` disclose no fee, so nothing changed there. Stored fees are untouched. Row labels decide by the stored figure, so a pre-beta contract still reads "5%" beside its real fee.

<details>
<summary>Issues (5)</summary>

1. **Payouts ledger shows "$0.00 fee" with no beta wording** (non-blocking): `PayoutsDashboard` renders a Fee column and "Buyer paid $X, less $0.00 fee" for beta sales. Consider "less no fee (beta)", or hiding the fee when it is 0, as `AccountStatement.Breakdown` already does.
2. **Compact surfaces omit the standard rate** (non-blocking): the catalog tile ("no fees in beta") and the `OffersSection` buyer row ("…, no fee during beta") do not name 5%. The listing note's popover and the offer dialog do. Accept as a space trade-off, or use `betaFeeNote()` on the offers row.
3. **ItemForm copy edit is uncommitted** (deliberate): the `PriceReadout` sentence change lives only in the working tree inside the user's WIP rewrite. It must ship with that commit, or the item form keeps saying "The 5% buyer fee is added to your price".
4. **Flutter not exercised** (recorded): `flutter test` was not run, and goldens such as `trade_room_before_collateral` need `flutter test --update-goldens`.
5. **Pre-beta unpaid agreements still charge 5%** (documented, consistent with check 9): AGREEMENT rows opened before deploy keep and charge their stored fee until terms change. Expect member questions. If you would rather waive them, that needs a deliberate backfill.

</details>

<details><summary>Details</summary>

### One switch, one function, one value

`domain/fees/betaFeeWaiver.ts` exports `BETA_FEE_WAIVER = true` and `effectiveFeeBps(standardBps, waived = BETA_FEE_WAIVER)`. `platformFeeCentsFor` now returns `percentageFeeMinor(price, effectiveFeeBps(PLATFORM_FEE_BPS))`. `tradeFeeCentsFor` defaults `rateBps` to `effectiveFeeBps(TRADE_FEE_BPS)`, and `resolveTradeFees` uses the same default. The server charge sites (`openAgreement`, `updateAgreedPrice`, `supabaseCashSaleRepository` line-item replace, `chargeTradeFees`) and the client disclosures (`buyerPaysCents`, `ListingFeeNote`, `BuyButton`, `MakeOfferDialog`, `DealTermsBreakdown`, `TradeContract`) all call these functions without an explicit rate. No production caller passes `rateBps`. The copy predicate `feesWaivedForBeta()` returns the same constant, so prose and figure cannot diverge.

One residual: `TradeNegotiationPanel` falls back to `${TRADE_FEE_BPS / 100}%` when `feeRateLabel` is absent. Its only caller, `TradeContract`, always passes `tradeFeeRowRate(myFeeCents)`, so the fallback is unreachable today.

### Zero trade fee never reaches Stripe

```
acceptTradeTerms → chargeFeesForAgreedTrade → chargeTradeFees
    resolveTradeFees → {0, 0} → .filter(>0) → [] → no upsert, no requestTransfer
trade-inspections job → drainFailedTradeFees
    FAILED row with amount_cents <= 0 → recordFeeResult SETTLED, continue (no payer lookup, no provider call)
```

Writing no row rather than a SETTLED 0 row is the right call: `deriveAccountStatement` renders every `trade_fees` row, so a 0 row would print "Trade fee $0.00". `refundTradeFees` iterates zero rows. StripeService, MockService and InMemoryService are untouched, and no Stripe type leaves `domain/services/stripe`. `tradeFeeDrain.test.ts` covers both the charge skip (guarded by `runIf(BETA_FEE_WAIVER)`) and the zero-row drain.

### Cash_Sale at fee 0

The CHECKs `platform_fee_cents >= 0`, `amount_cents = agreed + fee + shipping`, `trade_fees.amount_cents >= 0`, and `0042`'s `greatest(amount - fee, 0)` all accept 0. The plan records that the highest migration is 0133, not 0124, and that none was added. `payoutReadModel.test.ts` now pins `sellerNetCents` at fee 0 (full amount, and minus a partial refund).

### Copy

The listing note reads "No buyer fee during beta", and the popover says "NoDitto fee (normally 5%) $0.00". Prose says `betaFeeNote()` → "No fees during beta (normally 5%)". Tables use `platformFeeRowRate` / `tradeFeeRowRate`, keyed on the stored figure. Terms adds a "Fees" section stating that members will be told before standard fees apply. No "Includes $0.00 buyer fee" remains: `ListingFeeNote` branches before interpolating the fee.

Two gaps remain. `PayoutsDashboard` was left out on purpose, as a ledger of stored fees, but at 0 it reads "less $0.00 fee" under a "Fee" header, which is exactly the bare-$0.00 tone the copy rules avoid elsewhere. The catalog tile and the offers-list row do not name the 5% standard rate. Both are short-form surfaces next to fuller disclosures, so neither blocks.

### Flutter and the pin

`Money.betaFeeWaiver` / `standardFeeBps` are `static` members, so the port census does not grow. `_percentageFee` routes through the waiver, and `standardFee` keeps the 5% rule for tests. `dartFeeSchedule()` parses strictly and throws on a missing constant. The agreement test pins the switch, both standard rates, and the two copy literals. The purchase preview, sale room and trade room labels use `Money.feeRowRate`. Dart tests were updated but not run.

### Test coverage

The coder's evidence covers 25 unit/property files (304 tests), the listing-pane and trade-fee-disclosure component tests, both item-form tests, and the port census. The only failure is the pre-existing P4 palette case. Not tested: safety, help, terms, the owner price block, ItemCard, BuyButton, MakeOfferDialog, OffersSection, CashSaleView, ContractLineItems, DealTermsBreakdown and TradeOfferForm (no component tests), plus Flutter and Playwright. `tsc` was not run. That is acceptable, because `domain/services/types.ts` is unchanged.

</details>

<details>
<summary>File map</summary>

- `domain/fees/betaFeeWaiver.ts`: new switch and `effectiveFeeBps`
- `domain/fees/percentageFee.ts`: pointer comment
- `domain/orchestrator/cashSaleOrchestrator.ts`, `domain/trade/tradeFee.ts`: fee functions apply the waiver; standard-rate docs
- `lib/actions/tradeFees.ts`: zero-fee comment and zero-row drain guard
- `lib/fees/feeLabels.ts`: beta copy strings and row-rate helpers
- `components/listings/{FeeInfoPopover,ListingTrust,ItemCard,BuyButton}.tsx`, `components/offers/MakeOfferDialog.tsx`, `components/account/OffersSection.tsx`, `app/(workspace)/listings/[id]/(detail)/page.tsx`: buy-side copy
- `components/sales/{CashSaleView,ContractLineItems}.tsx`, `components/deals/DealTermsBreakdown.tsx`, `components/contract/ContractExchangePanel.tsx`, `components/trade/{TradeContract,TradeNegotiationPanel,TradeOfferForm}.tsx`: contract and trade copy, plus the `feeWaived` line
- `app/(marketing)/{safety,terms}/page.tsx`, `components/help/HelpCentre.tsx`: policy copy
- `flutter_app/lib/core/money.dart`, `trade_fee.dart`, three screens, and three Dart tests: the mirror
- `scripts/lib/mobileContract.ts`, `tests/unit/mobileDomainAgreement.test.ts`: the cross-language pin
- `tests/**` (platformFee, tradeFee, tradeFeeDrain, listedPrice, regionParity, custody, payoutReadModel, listingPane, tradeFeeDisclosure, us-region e2e): test updates
- `.kiro/steering/{product,structure}.md`: waiver documented
- Working tree only: `components/listings/ItemForm.tsx` price readout sentence

Full diff: `git show 0b07616`.

</details>
