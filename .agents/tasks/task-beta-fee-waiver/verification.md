# Verification: beta fee waiver

Only targeted Vitest runs. No build, lint, typecheck, full suite, dev server, Playwright or `flutter test`.
`domain/services/types.ts` is unchanged, so `npx tsc --noEmit` was not required and was not run.

## Commands and results

1. Domain, money paths, custody, mobile pin, copy:

   ```
   npx vitest --run tests/unit/platformFee.test.ts tests/unit/tradeFee.test.ts tests/unit/tradeFeeDrain.test.ts tests/unit/listedPrice.test.ts tests/unit/regionParity.test.ts tests/unit/cashSaleContract.test.ts tests/unit/cashSaleDirectPayout.test.ts tests/unit/cashSaleDispute.test.ts tests/unit/cashSaleDisputeWithdrawal.test.ts tests/unit/cashSaleErrors.test.ts tests/unit/cashSaleRefundDrain.test.ts tests/unit/cashSaleReturnFlow.test.ts tests/unit/cashSaleReturnLapse.test.ts tests/unit/privateDealCashSale.test.ts tests/unit/regionGuard.test.ts tests/unit/tradeProposal.test.ts tests/unit/tradeInspectionSweep.test.ts tests/unit/bondPolicy.test.ts tests/unit/custodyReconciliation.test.ts tests/unit/custodyCollectedStatuses.test.ts tests/property/payoutReadModel.test.ts tests/unit/mobileDomainAgreement.test.ts tests/unit/moneyCurrencyRendering.test.ts tests/unit/actionLogCoverage.test.ts tests/unit/regionCurrencyAgreement.test.ts
   ```
   Result: 25 files passed, 304 tests passed.

2. Copy-asserting component tests, plus the user's untracked ItemForm tests (ItemForm.tsx sentence edited in the working tree):

   ```
   npx vitest --run tests/component/listingPane.test.tsx tests/component/tradeFeeDisclosure.test.tsx tests/unit/itemFormSteps.test.ts tests/component/itemFormSteps.test.tsx
   ```
   Result: 4 files passed, 48 tests passed.

3. Port census:

   ```
   npx vitest --run tests/unit/mobileThemeAgreement.test.ts
   ```
   Result: 44 passed, 1 failed. The failure is the pre-existing palette case
   "P4: every web colour has exactly one equal Dart constant", unrelated to this change. The
   port-census cases and "renders money only through core/money.dart" pass.

## What the tests now pin

- `platformFeeCentsFor` and default `tradeFeeCentsFor` / `resolveTradeFees` return 0 for any amount
  while `BETA_FEE_WAIVER` (fast-check properties), and equal `percentageFeeMinor(x, effectiveFeeBps(STANDARD))`
  on either side of the switch. The 5% standard-rate examples and properties are kept, against
  `percentageFeeMinor(x, PLATFORM_FEE_BPS)` and `tradeFeeCentsFor(x, c, TRADE_FEE_BPS)`.
- `chargeTradeFees` during the waiver: no `trade_fees` write, no provider call, `{ collectedCents: 0, anyFailed: false }`.
- `drainFailedTradeFees` settles a zero-amount FAILED row with no provider call.
- Custody: a zero-fee live sale is SOLVENT against an equal balance, and a balance short by absorbed
  Stripe costs is a real SHORTFALL (205 on 10,000).
- `sellerNetCents` with a zero fee pays the full amount.
- Dart `Money.betaFeeWaiver` / `standardFeeBps` and the beta copy literals agree with the TypeScript.

## Not verified here

- No migration: every fee CHECK in `supabase/migrations` is `>= 0`.
- Flutter tests were updated but not run; goldens (e.g. `trade_room_before_collateral`) will differ and need
  `flutter test --update-goldens` in `flutter_app/`.
- Pages with no test (safety, help, terms, owner price block, ItemCard, BuyButton, MakeOfferDialog,
  OffersSection, CashSaleView, ContractLineItems, DealTermsBreakdown, TradeOfferForm) rely on editor diagnostics.
- `tests/e2e/specs/us-region.spec.ts` updated (expects $180.00 while waived), Playwright not run.
