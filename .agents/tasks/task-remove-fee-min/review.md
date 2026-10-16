# Platform fee minimum removal (cash sale and trade)

Commit `f02b697` removes the per-currency fee floor ($1.50 per Cash_Sale, $1.00 per trader in AUD), so both fees are now a plain 5%. `domain/fees/feeMinimums.ts` is deleted. It is replaced by `domain/fees/percentageFee.ts`, which holds one helper, `percentageFeeMinor`, with the same truncate / zero-guard / `Math.round` lines as before minus the final `Math.max` against the floor. The Dart port, labels, comments, tests and `product.md` move with it. No migration is needed: no SQL ever enforced the floor. The commit message records a targeted Vitest run (12 files, 173/174 tests). The one failure is a palette-drift case in `mobileThemeAgreement`, and nothing in this diff touches that.

Watch for: two non-blocking points. Contracts agreed while the floor existed will show "Platform fee (5%)" next to a stored $1.50 (likely; the plan accepts this). Two reflowed comments are over-long (confirmed, cosmetic).

**Verdict**: APPROVED

## High-level view

The charge and the disclosure still go through the same two functions. `platformFeeCentsFor` is used by the orchestrator (open agreement, terms acceptance), by the repository's price re-derivation and by every display surface: BuyButton, ListingTrust, MakeOfferDialog, DealTermsBreakdown and buyerPrice. `tradeFeeCentsFor` serves both `resolveTradeFees`, which `chargeTradeFees` calls, and the TradeContract disclosure. Both now delegate to `percentageFeeMinor`, so the disclosed fee cannot diverge from the charged one.

Rounding above the old floor is the same expression as before, `Math.round(trunc(base) * 500 / 10_000)` with zero and negative bases giving 0. On the Dart side, `_percentageFee` keeps the existing half-up integer expression `((b*500)+5000) ~/ 10000`. The `currency` parameters stay on the public signatures as `_currency` (optional where it can be), so call sites compile unchanged, including the user's untracked `DealSteps.tsx`. `resolveTradeFees` loses its `currency` field, and the `trades.currency` read in `chargeTradeFees`, which only existed to pick the floor, is gone with it.

A case-insensitive grep over app/, components/, lib/, domain/, flutter_app/, tests/, supabase/, scripts/ and .kiro/ finds no `feeMinimum`, `FEE_MINIMUM`, `min $`, `$1.50` or "minimum of" fee text. The only "minimum" hits left are statements that there is no minimum. The labels return `'5%'` and `'5% of the item price'`, built from the BPS constants. `product.md` lines 123 and 258 are rewritten to say "no minimum" and record the trade-off. No other steering file mentioned the floor.

The tests pin the no-floor property directly. Each of `platformFeeCentsFor`, `tradeFeeCentsFor` and `resolveTradeFees` has a fast-check property asserting exact equality with `Math.round(x * 500 / 10_000)` across currencies, including the sub-$30 range where the floor used to apply. `mobileDomainAgreement` passed in the recorded run.

<details>
<summary>Issues (2)</summary>

1. **Legacy stored fee shows next to a "5%" label** (likely, non-blocking). A contract opened while the floor existed, for example a $10 sale still in `AGREEMENT`, keeps `platform_fee_cents = 150` but now reads "Platform fee (5%)". The plan accepts this. Mention it to the user. Re-deriving on the next price edit (`updateAgreedPrice`) corrects it on its own.
2. **Over-long reflowed comments** (confirmed, cosmetic). `domain/orchestrator/supabaseCashSaleRepository.ts:467` and `flutter_app/lib/domain/trade/trade_fee.dart:6` were joined into lines of about 120 characters. Rewrap them if anything else touches those files.

</details>

<details>
<summary>Details</summary>

### Charge vs disclosure parity

```
percentageFeeMinor (domain/fees/percentageFee.ts)
 ├─ platformFeeCentsFor ── orchestrator openAgreement / terms, repo.updateAgreedPrice   (charge)
 │                     └── BuyButton, ListingTrust, MakeOfferDialog, DealTermsBreakdown, buyerPrice (disclosure)
 └─ tradeFeeCentsFor ──── resolveTradeFees → chargeTradeFees                           (charge)
                       └── TradeContract myFee/theirFee, DealTermsBreakdown             (disclosure)
```

Before this change, the trade charge read its currency from `trades.currency` and the trade room read `trade?.currency`. The removed floor was the only thing that made those two currency sources matter, so dropping the column read takes away a source of drift without adding a new one. Stored fees and migrations are untouched. The CHECKs (`>= 0`) accept a 0 fee on a sub-10-cent base, and `chargeTradeFees` already skips zero amounts.

### Verification evidence

The commit message lists the targeted files: platformFee, tradeFee, listedPrice, regionParity, cashSaleContract, cashSaleDirectPayout, tradeFeeDrain, moneyCurrencyRendering, mobileDomainAgreement, mobileThemeAgreement, and the component tests tradeFeeDisclosure and listingPane. 11 of 12 files passed. The failing case is mobileThemeAgreement P4, which compares the CSS colour tokens with `tokens.g.dart`. This diff changes neither file, and the fee-symbol census in the same test file passed. That evidence covers the change, so no spot-check was run. `flutter test` was not run, per the plan. The Dart test edits mirror the TS expectations (50, 100, 1050, `'5%'`).

### Commit hygiene

The commit has exactly the 25 files the plan names, with `platformFeeMinimum.test.ts` renamed to `platformFee.test.ts`. The user's work is untouched: the three staged files (`CatalogControls.tsx`, `CatalogResults.tsx`, `browseEvents.ts`) are still staged, the five modified files are still unstaged, and `DealSteps.tsx`, `.agents/**` and `.worktrees/` are still untracked.

</details>

<details>
<summary>File map</summary>

- `domain/fees/feeMinimums.ts`: deleted
- `domain/fees/percentageFee.ts`: new single rounding helper, no floor
- `domain/orchestrator/cashSaleOrchestrator.ts`: `platformFeeCentsFor` delegates to the helper; JSDoc and comment updated
- `domain/trade/tradeFee.ts`: `tradeFeeCentsFor` delegates; `resolveTradeFees` drops `currency`
- `lib/actions/tradeFees.ts`: removes the `trades.currency` read
- `lib/fees/feeLabels.ts`: bare-rate labels; `formatMoney` and minimum imports dropped
- `lib/listings/buyerPrice.ts`, `domain/orchestrator/supabaseCashSaleRepository.ts`, `tests/unit/fakes/cashSaleRepository.ts`: comments only
- `components/listings/FeeInfoPopover.tsx`, `ListingDesktopPane.tsx`, `ListingDetailStack.tsx`, `components/trade/TradeNegotiationPanel.tsx`: doc comments only
- `flutter_app/lib/core/money.dart`, `flutter_app/lib/domain/trade/trade_fee.dart`: Dart port without the floor
- `flutter_app/test/*`: expectations updated to plain 5%
- `tests/unit/platformFee.test.ts` (renamed), `tradeFee.test.ts`, `listedPrice.test.ts`, `regionParity.test.ts`: no-floor properties and updated expectations
- `.kiro/steering/product.md`: fee paragraphs rewritten

Full diff: `git show f02b697`

</details>
