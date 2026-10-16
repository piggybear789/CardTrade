# Implementation Plan: beta fee waiver (Cash_Sale and Trade fees at 0%)

Goal: every platform fee is 0 during the beta. The Cash_Sale Platform_Fee and the per-trader
Trade_Fee both go to 0%. Member copy says plainly that fees are waived during beta and that the
standard rate is 5%. The standard rate stays defined, so ending the beta means flipping ONE
constant (plus its Dart mirror, which a test pins).

The user's message 8 asked to keep "Includes $20,000.00 buyer fee" on the listing. Messages
11 and 12 supersede it for the beta. The original JSX stays as the non-waived branch, so that
note comes back by itself when the switch is flipped.

## Ground rules for the implementer

- Work in place on `main` in `c:\dev\Marketplace`. No worktree.
- The working tree holds UNRELATED user work. Do not touch, stage or commit it:
  - modified, unstaged: `app/(workspace)/t/[token]/page.tsx`, `components/deals/DealComposeForm.tsx`,
    `components/deals/DealEditDialog.tsx`, `components/deals/DealInviteShare.tsx`,
    `components/layout/mobile-chrome/variants.tsx`, `components/listings/ItemForm.tsx`,
    `components/listings/ItemFormSkeleton.tsx`, `lib/actions/listings.ts`, `lib/listings/itemFormChrome.ts`,
    `tests/e2e/specs/listings.spec.ts`, `tests/e2e/support/listings.ts`
  - STAGED by the user: `components/listings/CatalogControls.tsx`, `components/listings/CatalogResults.tsx`,
    `lib/catalog/browseEvents.ts`
  - untracked: `components/deals/DealSteps.tsx`, `components/ui/step-progress.tsx`,
    `lib/listings/itemFormSteps.ts`, `tests/component/itemFormSteps.test.tsx`, `tests/unit/itemFormSteps.test.ts`,
    `.kiro/specs/lapsed-sale-case-fix/`, `.agents/**`, `.worktrees/`
- `DealSteps.tsx` (untracked, user's) calls `platformFeeCentsFor(priceCents, currency)` for "They pay".
  It needs no edit: it will show the price with no fee added. Keep the signature unchanged.
- `ItemForm.tsx` has a 465-line uncommitted user rewrite. Item 8 edits ONE sentence in it in the
  working tree and does NOT commit it (see item 8 and item 12).
- Do not run `npm run build`, `npm run lint`, `npm run typecheck`, the full suite, `npm run dev`,
  or `flutter test`. Run only the targeted Vitest commands listed. `domain/services/types.ts` is
  NOT changed, so `npx tsc --noEmit` is not required.
- `tests/unit/mobileThemeAgreement.test.ts` has a pre-existing palette (P4) failure. Ignore it.
  Its port-census tests ("holds exactly the nine Advisory_Domain_Ports", "adds no exported symbol
  to a port…") must still pass.

## Design decisions (recorded)

1. **One switch, a code constant: `BETA_FEE_WAIVER = true` in a new file `domain/fees/betaFeeWaiver.ts`.**
   It sits beside `percentageFee.ts`, the shared rounding rule. It is a constant, not an env var:
   disclosure renders on the client and the charge runs on the server, so an env mismatch would
   show one fee and charge another. The file also exports
   `effectiveFeeBps(standardBps: number, waived: boolean = BETA_FEE_WAIVER): number` →
   `waived ? 0 : standardBps`. The `waived` parameter exists so tests can cover both sides of the
   switch without mocking a module.
2. **The standard rates keep their names and values.** `PLATFORM_FEE_BPS = 500`
   (`domain/orchestrator/cashSaleOrchestrator.ts`) and `TRADE_FEE_BPS = 500` (`domain/trade/tradeFee.ts`)
   are unchanged and now documented as the STANDARD rates. `platformFeeCentsFor` and
   `tradeFeeCentsFor` / `resolveTradeFees` apply `effectiveFeeBps(...)`. Every disclosure and every
   charge already goes through those two functions (BuyButton, ListingTrust, MakeOfferDialog,
   DealTermsBreakdown, buyerPrice, TradeContract, the orchestrator, `supabaseCashSaleRepository`,
   `chargeTradeFees`), so they cannot disagree. No new production export is added for the standard
   rate. Tests use `percentageFeeMinor(x, PLATFORM_FEE_BPS)` as the standard-rate function.
3. **No DB migration.** Every fee CHECK in `supabase/migrations` allows 0:
   - `0008_cash_sale_contract.sql:97` `cash_sales_fee_nonnegative check (platform_fee_cents >= 0)`
   - `0008_bilateral_cash_sales.sql:115` `platform_fee_cents >= 0`
   - `0008_cash_sale_contract.sql:99` `amount_cents = agreed_price_cents + platform_fee_cents + shipping_cost_cents`
     (holds with 0)
   - `0056_trade_fees.sql:17` `amount_cents bigint not null check (amount_cents >= 0)`
   - `0036_charge_disputes.sql:30` `amount_cents >= 0`
   - `0042_payout_queued_event.sql:40` `greatest(amount_cents - platform_fee_cents, 0)`
   - `0064` `replace_cash_sale_items` takes `p_platform_fee_cents` from the caller and does not
     validate it as > 0. No SQL anywhere derives the fee (no `* 500`, `0.05`, `/ 10000`, `fee_bps`).
   The highest migration file is `0133_binder_listing_chat_copy.sql`, not 0124. No migration is added.
4. **Cash_Sale money path needs no code change.** Collection charges `sale.amountCents`
   (price + 0 + shipping). `sellerNetCentsFor` / `payoutReadModel.sellerNetCents` clamp
   `amount - fee - refund` at 0. The Seller is released the full amount. StripeService's
   `applicationFee` path does `Math.max(amount - (applicationFee ?? 0), 0)`. A `source_transaction`
   transfer must not exceed the source charge's amount, and a full-amount transfer equals it, so it is
   valid. Nothing divides by the fee or asserts fee > 0.
5. **Trade fee: the exact skip-charge path.** `chargeTradeFees` (`lib/actions/tradeFees.ts`) already
   does `.filter((entry) => entry.amountCents > 0)` before the loop. With both fees 0 it writes no
   `trade_fees` row, does no payer lookup, and makes no `payments.requestTransfer` call. It returns
   `{ collectedCents: 0, anyFailed: false }`. `chargeFeesForAgreedTrade`
   (`lib/trades/collateralPlacement.ts`) logs nothing, and the trade proceeds to `HOLDS_CONFIRMED` /
   `syncHolds`. `refundTradeFees` iterates zero rows. `drainFailedTradeFees` (run by
   `app/api/jobs/trade-inspections`) selects only `status = 'FAILED'` rows, so there is nothing to loop on.
   - Waived fees get NO row, rather than a SETTLED 0 row, because
     `lib/actions/statement.ts` → `deriveAccountStatement` (`domain/statement/accountStatement.ts:352`)
     renders every `trade_fees` row as a "Trade fee" statement entry. A 0 row would put
     "Trade fee $0.00" lines on members' statements.
   - Add one guard to `drainFailedTradeFees`: a FAILED row with `amount_cents <= 0` is recorded
     SETTLED with no provider call (Stripe refuses a zero-amount PaymentIntent) and counted in
     `settled`. No such row can be written today, but the guard makes "a zero fee never reaches the
     provider and never loops" true by construction.
   - StripeService, MockService and InMemoryService are not changed: a zero fee never reaches them.
6. **Custody reconciliation is not changed.** `domain/payouts/custodyReconciliation.ts` has no fee
   input. It counts the buyer's whole collected amount as owed while a sale is live, and nothing
   once disbursed. Zero fee revenue therefore raises no flag by itself. During beta, though, the
   platform absorbs Stripe's processing fee with no revenue to cover it, so a balance net of
   provider fees can genuinely fall short of what members are owed. That SHORTFALL is real money and
   must stay visible. "Fixing" the check would hide an insolvency, so the mitigation is operational:
   keep a buffer in the platform balance. This goes into steering (item 11) and is pinned by a test
   (item 3).
7. **Copy rules.**
   - Prose never says "$0.00 fee". It says "No fees during beta (normally 5%)".
   - Money TABLES (contract rooms, breakdowns) keep the numeric `$0.00`, so the arithmetic still
     adds up, and the waiver goes in the row label: "Platform fee (waived during beta, normally 5%)".
   - Prose decides with `feesWaivedForBeta()`, which reads the switch.
   - Row labels decide with the fee figure: `feeCents === 0` → waived label. A contract that STORED
     a non-zero fee before the beta therefore still reads "(5%)". A contract agreed during the beta
     still reads "waived during beta" after the switch is flipped, so ending the beta needs only the
     flip. Accepted edge: with the switch off, a sub-10-cent price rounds to a 0 fee and would get the
     waived label. Nobody lists at 9 cents.
   - All member strings live in `lib/fees/feeLabels.ts`.
8. **Stored fees are untouched.** No backfill. This includes AGREEMENT-status cash sales opened
   before deploy: the fee is set at open and on price/line changes (`openAgreement`,
   `replaceLineItems`, `updateAgreedPrice`), not at Pay. Those rooms keep showing "(5%)" next to the
   stored fee, which is honest. The trade room derives its disclosed fee live, so a trade charged
   before the beta will read as waived in the room. `trade_fees` and the statement still show what
   was charged. Both are recorded in steering.
9. **Out of scope, deliberately:** the condition-dispute Friction_Tax ($20, `domain/dispute/frictionTax.ts`)
   is a penalty, not a percentage platform fee. The same goes for its copy (safety page line ~260,
   `PayoutsDashboard` "A $20 resolution fee"). The admin console's "Platform fee kept",
   `ReturnCaseActions` "less the platform fee", `CashSalePriceDialog` "Shipping and the platform fee
   stay separate" and `CashSaleTermsDialog` "Fee is on item price only" are still true statements of
   the stored fee. `PayoutsDashboard` "less $X fee" / "−$X" is a ledger of the stored fee per sale.
   `AccountStatement` already hides a zero fee breakdown (`if (entry.feeCents === 0) return null`).
   The onboarding wizard and `lib/email/**` disclose no fee (grep for "fee" finds only code comments
   or nothing). None of these change.
10. **No FEAT decomposition.** The labels (item 4) feed every copy item, and the switch (item 1) feeds
    everything. It is one coherent change, so the existing build loop runs this plan.

## Exact strings to add to `lib/fees/feeLabels.ts`

Keep the three existing functions. They return the STANDARD rate unchanged: `platformFeeRateLabel()` → `'5%'`,
`platformFeePhrase()` → `'5% of the item price'`, `tradeFeeRateLabel()` → `'5%'`. Add:

```ts
import { BETA_FEE_WAIVER } from '@/domain/fees/betaFeeWaiver';

/** Whether fees are waived for the beta. Read at call time, from the one switch. */
export function feesWaivedForBeta(): boolean { return BETA_FEE_WAIVER; }

/** "No fees during beta (normally 5%)" — the one sentence prose surfaces use. */
export function betaFeeNote(): string {
  return `No fees during beta (normally ${rateLabel(PLATFORM_FEE_BPS)})`;
}

/** Under a listing's price while waived. */
export const LISTING_BETA_FEE_NOTE = 'No buyer fee during beta';

/** Lower-case clause after a figure: "You'd pay $X, no fee during beta". */
export const NO_FEE_DURING_BETA = 'no fee during beta';

/** Catalog tile, replaces "incl. fees" while waived. */
export const TILE_BETA_FEE_NOTE = 'no fees in beta';

/** Hint beside a $0.00 fee row. */
export const FEE_WAIVED_HINT = 'No fee during beta.';

/** FeeInfoPopover while waived. */
export const FEE_POPOVER_WAIVED_TRIGGER = 'No buyer fee during beta. Show breakdown';
export const FEE_POPOVER_WAIVED_TITLE = 'No NoDitto fee during beta';
export const FEE_POPOVER_WAIVED_FOOTNOTE =
  'Fees are waived during the beta. Postage, if any, is agreed with the seller before you pay.';

/** Terms page, one sentence. */
export const TERMS_BETA_FEE_SENTENCE =
  'Platform fees on cash sales and trades are waived during the beta, and members will be told before standard fees apply.';

/** Parenthetical for a Cash_Sale fee row: "waived during beta, normally 5%" when the fee is 0, else "5%". */
export function platformFeeRowRate(feeCents: number): string {
  return feeCents === 0 ? `waived during beta, normally ${rateLabel(PLATFORM_FEE_BPS)}` : rateLabel(PLATFORM_FEE_BPS);
}

/** Same for a Trade_Fee row. */
export function tradeFeeRowRate(feeCents: number): string {
  return feeCents === 0 ? `waived during beta, normally ${rateLabel(TRADE_FEE_BPS)}` : rateLabel(TRADE_FEE_BPS);
}
```

Update the module header comment to say the waiver lives in `domain/fees/betaFeeWaiver.ts` and that these
strings are the only beta-fee wording.

## Member-facing surfaces and what each says (all read during planning)

| Surface | File | While waived |
|---|---|---|
| Listing fee note | `components/listings/ListingTrust.tsx` `ListingFeeNote` | `LISTING_BETA_FEE_NOTE` + `FeeInfoPopover waived` |
| Fee breakdown (i) | `components/listings/FeeInfoPopover.tsx` | trigger `FEE_POPOVER_WAIVED_TRIGGER`, title `FEE_POPOVER_WAIVED_TITLE`, row "NoDitto fee (normally 5%)" = feeText ($0.00), "You pay", footnote `FEE_POPOVER_WAIVED_FOOTNOTE` |
| Catalog tile | `components/listings/ItemCard.tsx` ~l.394 | `TILE_BETA_FEE_NOTE` instead of "incl. fees" |
| Owner price block | `app/(workspace)/listings/[id]/(detail)/page.tsx` ~l.983-996 | add a muted `<p>` with `betaFeeNote()` under the `dl` |
| Buy dialog summary | `components/listings/BuyButton.tsx` `OrderSummary` l.124-126 | `betaFeeNote()` instead of "$X + $Y fee" |
| Offer dialog | `components/offers/MakeOfferDialog.tsx` l.178-180, l.217-224 | `betaFeeNote()` instead of "Seller's price … + … NoDitto fee"; "You'd pay **$X**, no fee during beta." |
| Offers list | `components/account/OffersSection.tsx` l.342 | `` `You'd pay ${…}, ${NO_FEE_DURING_BETA}` `` |
| Deal composer breakdown | `components/deals/DealTermsBreakdown.tsx` | empty state `` `${betaFeeNote()}.` ``; row `NoDitto fee (${platformFeeRowRate(fee)})`; trade "Your fee" info `` `${betaFeeNote()}.` `` |
| Binder line-items price hint | `components/sales/ContractLineItems.tsx` l.195-200 | "The price for the lot — $X. Any postage is added on top when you agree terms. {betaFeeNote()}." |
| Cash-sale money tables (2) | `components/sales/CashSaleView.tsx` l.1400, l.1637 | label `Platform fee (${platformFeeRowRate(sale.platform_fee_cents)})`; 2nd row hint `FEE_WAIVED_HINT` when stored fee is 0 |
| Trade room exchange | `components/trade/TradeContract.tsx` l.1138, 1262, 1281 + `components/contract/ContractExchangePanel.tsx` l.338 | rate via `tradeFeeRowRate(...)`; the panel shows the $0.00 fee line when `feeWaived` |
| Trade accept dialog | `components/trade/TradeNegotiationPanel.tsx` l.332-351 | waived description; hint `FEE_WAIVED_HINT` |
| Trade offer form | `components/trade/TradeOfferForm.tsx` l.366-369 | "Valued at the seller's asking price. {betaFeeNote()}." |
| Safety page | `app/(marketing)/safety/page.tsx` l.107 | `{betaFeeNote()}. Postage is passed through at cost.` |
| Help centre | `components/help/HelpCentre.tsx` l.70-71 | replace "The buyer fee is included in the price you see before paying." with `` `${betaFeeNote()}.` `` |
| Terms | `app/(marketing)/terms/page.tsx` | new `<h2>Fees</h2><p>{TERMS_BETA_FEE_SENTENCE}</p>` after "Stripe and money movement", only while waived |
| Item form price readout | `components/listings/ItemForm.tsx` l.243 (working tree) | `` `${betaFeeNote()}. Buyers pay your price.` `` + existing card-processing sentence. NOT committed |
| Flutter purchase preview | `flutter_app/lib/features/sales/screens/purchase_flow_screen.dart` l.376 | `Platform fee (${Money.feeRowRate(feeCents)})` |
| Flutter sale room | `flutter_app/lib/features/sales/screens/sale_room_screen.dart` l.236-238 | label via `Money.feeRowRate(sale.platformFeeCents)`; hint `'No fee during beta.'` when 0 |
| Flutter trade room | `flutter_app/lib/features/trades/screens/trade_room_screen.dart` l.487-512 | explainer and row label as in item 9 |
| E2E price pin | `tests/e2e/specs/us-region.spec.ts` l.77-93 | expected `$180.00` while waived, `$189.00` otherwise |

The other places a fee appears were also read, and all of them only render `ListingFeeNote` or
mention the fee in comments: `ListingDesktopPane.tsx`, `ListingDetailStack.tsx`,
`ListingBuyerBar.tsx`, `listings/[id]/(detail)/loading.tsx` (the waived note is one `text-meta` line, the
same as the skeleton's reserved line), `lib/seo/structuredData.ts` (uses `listedPriceCents`, so it
now shows the asking price with no copy change), `lib/listings/buyerPrice.ts` (numeric only,
`askingPriceRange` still inverts exactly when the fee is 0), and `trades/[id]/page.tsx`. They need no
change. Item 9 above covers the surfaces left unchanged on purpose.

---

# Items

- [ ] 1. Add the switch and route both fee functions through it; update the domain fee tests.
      Create `domain/fees/betaFeeWaiver.ts` with a header comment. The comment explains why it is a
      code constant (client disclosure and server charge must read the same value), that ending the
      beta means flipping this constant plus `Money.betaFeeWaiver` in `flutter_app/lib/core/money.dart`,
      and that the platform absorbs Stripe costs meanwhile. The file exports
      `export const BETA_FEE_WAIVER = true;` and
      `export function effectiveFeeBps(standardBps: number, waived: boolean = BETA_FEE_WAIVER): number { return waived ? 0 : standardBps; }`.
      Other edits:
      - In `cashSaleOrchestrator.ts`: `platformFeeCentsFor` body becomes
        `return percentageFeeMinor(agreedPriceCents, effectiveFeeBps(PLATFORM_FEE_BPS));`. Import from
        `'../fees/betaFeeWaiver'`. The JSDoc on `PLATFORM_FEE_BPS` says it is the STANDARD rate, and the
        JSDoc on `platformFeeCentsFor` says the fee is 0 while `BETA_FEE_WAIVER` is on.
      - In `domain/trade/tradeFee.ts`: the default `rateBps` of `tradeFeeCentsFor` becomes
        `effectiveFeeBps(TRADE_FEE_BPS)`, and `resolveTradeFees` uses
        `params.rateBps ?? effectiveFeeBps(TRADE_FEE_BPS)`. Add a header paragraph "BETA WAIVER". KEEP
        the existing comment mention of `PLATFORM_FEE_BPS` in that file: `flutter_app/lib/domain/trade/trade_fee.dart`
        exports `platformFeeBps`, and the port census in `mobileThemeAgreement.test.ts` resolves Dart
        symbols against identifiers in `tradeFee.ts` plus one import hop.
      - In `domain/fees/percentageFee.ts`: add one comment line pointing to the waiver.
      Tests:
      - `tests/unit/platformFee.test.ts`: assert `platformFeeCentsFor(x) === 0` for fixed examples, and
        as a fast-check property over prices and currencies while `BETA_FEE_WAIVER`. Turn the existing
        5% examples and properties into STANDARD-rate checks on
        `percentageFeeMinor(x, PLATFORM_FEE_BPS)` with the same expected values (500, 4_225, 0/0/1/50/100/150/151,
        `Math.round(x*500/10_000)` property, monotonicity). Add
        `effectiveFeeBps(500, false) === 500`, `effectiveFeeBps(500, true) === 0`, and
        `platformFeeCentsFor(x) === percentageFeeMinor(x, effectiveFeeBps(PLATFORM_FEE_BPS))` as a property,
        so re-enabling is covered.
      - `tests/unit/tradeFee.test.ts`: the same split. The default `tradeFeeCentsFor` and `resolveTradeFees`
        give 0 for any value (property). The standard-rate examples pass `TRADE_FEE_BPS` explicitly, and so
        do the existing explicit-rate cases (250 bps, 0 bps). Assert `resolveTradeFees` with
        `rateBps: TRADE_FEE_BPS` keeps the symmetry/unequal-sides properties.
      - `tests/unit/regionParity.test.ts` l.239: replace the `Math.round((agreedPriceCents*500)/10_000)` line with
        `percentageFeeMinor(run.agreedPriceCents, effectiveFeeBps(PLATFORM_FEE_BPS))`, so it reads 0 now and 5% after the flip.
      - `tests/unit/listedPrice.test.ts`: l.6 expects `40_000_000 + platformFeeCentsFor(40_000_000, 'aud')`.
        Rename the l.15 case to "adds the effective fee on cheap singles (none during the beta)" and
        expect `BETA_FEE_WAIVER ? 500 : 525`.
      Files: `domain/fees/betaFeeWaiver.ts` (new), `domain/fees/percentageFee.ts`, `domain/orchestrator/cashSaleOrchestrator.ts`,
      `domain/trade/tradeFee.ts`, `tests/unit/platformFee.test.ts`, `tests/unit/tradeFee.test.ts`,
      `tests/unit/regionParity.test.ts`, `tests/unit/listedPrice.test.ts`
      Verify: `npx vitest --run tests/unit/platformFee.test.ts tests/unit/tradeFee.test.ts tests/unit/regionParity.test.ts tests/unit/listedPrice.test.ts tests/unit/cashSaleContract.test.ts tests/unit/cashSaleDirectPayout.test.ts tests/unit/cashSaleDispute.test.ts tests/unit/cashSaleDisputeWithdrawal.test.ts tests/unit/cashSaleErrors.test.ts tests/unit/cashSaleRefundDrain.test.ts tests/unit/cashSaleReturnFlow.test.ts tests/unit/cashSaleReturnLapse.test.ts tests/unit/privateDealCashSale.test.ts tests/unit/regionGuard.test.ts tests/unit/tradeProposal.test.ts tests/unit/tradeInspectionSweep.test.ts tests/unit/bondPolicy.test.ts`. Everything passes. If an orchestrator suite asserted a literal fee-derived amount, rewrite that assertion in terms of `platformFeeCentsFor(...)`. Never assert `> 0`.

- [ ] 2. Make the zero trade fee path explicit and loop-proof.
      In `lib/actions/tradeFees.ts`:
      - Above the `owed` filter in `chargeTradeFees`, add a comment saying a zero fee (the beta waiver)
        writes no row and makes no provider call. Give both reasons: Stripe refuses a zero-amount
        charge, and a 0 row would print "Trade fee $0.00" on statements.
      - In `drainFailedTradeFees`, right after `result.attempted += 1;`, add:
        `if (Number(row.amount_cents) <= 0) { result.settled += 1; await recordFeeResult(row.trade_id, row.trader_id, 'SETTLED'); continue; }`
        with a one-line comment.
      In `tests/unit/tradeFeeDrain.test.ts`, extend the dynamic import to
      `const { chargeTradeFees, drainFailedTradeFees } = await import(...)` and add:
      - (a) `chargeTradeFees` with non-zero `initiatorReceivesCents` / `counterpartReceivesCents` while
        `BETA_FEE_WAIVER`: `requestTransfer` is never called, `admin.writes` has no `trade_fees` entry, and
        the result is `{ collectedCents: 0, anyFailed: false }`. Guard the test with `it.runIf(BETA_FEE_WAIVER)`.
      - (b) the drain with one FAILED row of `amount_cents: 0`: `requestTransfer` is not called, the
        recorded update has `status: 'SETTLED'`, and `result.settled === 1`.
      Leave `lib/trades/collateralPlacement.ts`, StripeService, MockService and InMemoryService unchanged.
      Files: `lib/actions/tradeFees.ts`, `tests/unit/tradeFeeDrain.test.ts`
      Verify: `npx vitest --run tests/unit/tradeFeeDrain.test.ts tests/unit/tradeInspectionSweep.test.ts tests/unit/actionLogCoverage.test.ts`. All pass.

- [ ] 3. Pin custody and payout behaviour at a zero fee (tests only, no code change).
      In `tests/unit/custodyReconciliation.test.ts` add a `describe('zero fee revenue (beta waiver)')` with two cases:
      - a live sale `collectedCents: 10_000` against `readable(10_000)` is `SOLVENT` with `shortfallCents: 0`.
      - against `readable(9_795)`, which models Stripe's ~1.75% + $0.30 deducted and no fee revenue, it
        is `SHORTFALL` with `shortfallCents: 205`. Comment that this is a real shortfall the platform must
        cover with a balance buffer, not a false alarm.
      In `tests/property/payoutReadModel.test.ts` add an example: `sellerNetCents({ amountCents: 10_000, platformFeeCents: 0 }) === 10_000`
      and `=== 6_000` with `refundCents: 4_000`.
      Files: `tests/unit/custodyReconciliation.test.ts`, `tests/property/payoutReadModel.test.ts`
      Verify: `npx vitest --run tests/unit/custodyReconciliation.test.ts tests/unit/custodyCollectedStatuses.test.ts tests/property/payoutReadModel.test.ts`. All pass.

- [ ] 4. Add the beta-fee strings to `lib/fees/feeLabels.ts` and unit-test them.
      Add exactly the exports listed under "Exact strings" above, and update the header. In
      `tests/unit/platformFee.test.ts` (labels block), assert:
      - `betaFeeNote() === 'No fees during beta (normally 5%)'`
      - `platformFeeRowRate(0) === 'waived during beta, normally 5%'` and `platformFeeRowRate(500) === '5%'`; same for `tradeFeeRowRate`
      - `feesWaivedForBeta() === BETA_FEE_WAIVER`
      - the existing standard labels still return `'5%'` / `'5% of the item price'`
      - none of the strings match `/\$0\.00|min/i`
      Files: `lib/fees/feeLabels.ts`, `tests/unit/platformFee.test.ts`
      Verify: `npx vitest --run tests/unit/platformFee.test.ts tests/unit/moneyCurrencyRendering.test.ts`. Both pass.

- [ ] 5. Listing and buy-side surfaces (depends on 4).
      Change each surface to read `feeLabels`, keeping the existing JSX as the non-waived branch:
      - `components/listings/FeeInfoPopover.tsx`: add a prop `waived?: boolean`. When true, the
        `InfoPopover` label is `FEE_POPOVER_WAIVED_TRIGGER`, the title is `FEE_POPOVER_WAIVED_TITLE`, the
        fee row label is `NoDitto fee (normally {rateLabel})` with value `feeText`, and the footnote is
        `FEE_POPOVER_WAIVED_FOOTNOTE`. Update the header comment.
      - `components/listings/ListingTrust.tsx` `ListingFeeNote`: compute `feeCents` once. When
        `feesWaivedForBeta()`, render `<span>{LISTING_BETA_FEE_NOTE}</span>` and `<FeeInfoPopover waived … />`.
        Otherwise render the existing "Includes {fee} buyer fee" unchanged. Keep the same `<p>` classes so
        the geometry is unchanged.
      - `components/listings/ItemCard.tsx` ~l.394: `{feesWaivedForBeta() ? TILE_BETA_FEE_NOTE : 'incl. fees'}`.
      - `app/(workspace)/listings/[id]/(detail)/page.tsx`: after the owner `<dl>` (~l.996), add
        `{feesWaivedForBeta() ? <p className="text-meta text-muted-foreground">{betaFeeNote()}</p> : null}`.
      - `components/listings/BuyButton.tsx` `OrderSummary` l.124-126: waived → `{betaFeeNote()}`, else the
        existing "{money(price)} + {money(fee)} fee".
      - `components/offers/MakeOfferDialog.tsx`: the l.178-180 line becomes `{betaFeeNote()}` when waived. The
        live line l.217-224 when waived reads `You'd pay <span …>{money(buyerPaysCents(…))}</span>, {NO_FEE_DURING_BETA}.`.
      - `components/account/OffersSection.tsx` l.342 buyer branch, when waived:
        `` `You'd pay ${money(buyerPaysCents(offer.amountCents, offer.currency))}, ${NO_FEE_DURING_BETA}` ``.
      In `tests/component/listingPane.test.tsx`:
      - Expect `LISTING_BETA_FEE_NOTE` and the trigger name `FEE_POPOVER_WAIVED_TRIGGER` when `feesWaivedForBeta()`,
        otherwise the old strings. Branch the assertion on the switch and import the strings from `@/lib/fees/feeLabels`.
      - The desktop pane headline expects `formatMoney(buyerPaysCents(400_000, 'aud'), 'aud')`.
      - Lines 106 and 184 use the same branched note.
      - Leave the `queryByText(/buyer fee/)` null checks (owner, binder) as they are.
      - Update the file header comment to say the note reads "No buyer fee during beta" while waived.
      Files: `components/listings/FeeInfoPopover.tsx`, `components/listings/ListingTrust.tsx`, `components/listings/ItemCard.tsx`,
      `app/(workspace)/listings/[id]/(detail)/page.tsx`, `components/listings/BuyButton.tsx`, `components/offers/MakeOfferDialog.tsx`,
      `components/account/OffersSection.tsx`, `tests/component/listingPane.test.tsx`
      Verify: `npx vitest --run tests/component/listingPane.test.tsx`. Passes.

- [ ] 6. Contract rooms, deal breakdown and trade surfaces (depends on 4).
      - `components/sales/CashSaleView.tsx`, both rows (l.1400, l.1637): label
        `` `Platform fee (${platformFeeRowRate(sale.platform_fee_cents)})` ``. On the second row, the hint is
        `sale.platform_fee_cents === 0 ? FEE_WAIVED_HINT : 'Returned if the sale is refunded in full.'`. Keep
        the values as `money(sale.platform_fee_cents)`. Drop the `platformFeeRateLabel` import if it is no
        longer used.
      - `components/sales/ContractLineItems.tsx` l.195-200: when waived the hint reads
        "The price for the lot{ — $X}. Any postage is added on top when you agree terms. {betaFeeNote()}."
        Otherwise it stays the existing text.
      - `components/deals/DealTermsBreakdown.tsx`:
        - empty state, when waived: `` `${betaFeeNote()}.` ``
        - the sale row label is `` `NoDitto fee (${platformFeeRowRate(fee)})` ``
        - the `TradeTermsBreakdown` "Your fee" `info`, when waived: `` `${betaFeeNote()}.` ``
      - `components/contract/ContractExchangePanel.tsx`: add the optional side field
        `feeWaived?: boolean` (JSDoc: "Show a $0.00 fee line labelled as waived"). The fee line renders when
        `!compact && ((side.feeCents ?? 0) > 0 || (side.feeWaived === true && side.feeCents === 0))`.
      - `components/trade/TradeContract.tsx`:
        - `feeRateLabel: tradeFeeRowRate(myFeeCents)` (l.1138)
        - both `feeLabel`s become `` `NoDitto fee (${tradeFeeRowRate(myFeeCents|theirFeeCents)})` ``
        - pass `feeWaived: feesWaivedForBeta() && theirsValueCents + cashToMe > 0` on your side, and
          `feesWaivedForBeta() && yoursValueCents + cashToThem > 0` on theirs
      - `components/trade/TradeNegotiationPanel.tsx`:
        - when `feesWaivedForBeta()`, the `DialogDescription` reads "If you are the last to accept, the trade
          starts straight away: the collateral is authorised against your card, with
          {NO_FEE_DURING_BETA}. Replace the card here if you do not want this one used."
        - the fee row hint is `FEE_WAIVED_HINT` when waived, else 'Charged to your card.'
        - update the `feeRateLabel` JSDoc
      - `components/trade/TradeOfferForm.tsx` l.366-369: when waived, "Valued at the seller's asking price. {betaFeeNote()}."
      In `tests/component/tradeFeeDisclosure.test.tsx`:
      - let `renderPanel` accept `feeRateLabel`
      - render the cost-disclosure cases with `{ feeText: '$0.00', feeRateLabel: tradeFeeRowRate(0), collateralText: '$700.00' }`
        when `feesWaivedForBeta()`, otherwise the existing `$35.00` / `'5%'` inputs
      - assert the label `` `NoDitto fee (${tradeFeeRowRate(...)})` `` and the matching hint (`FEE_WAIVED_HINT` or 'Charged to your card.')
      - the unvalued case asserts `/the collateral is authorised against/i`
      Files: `components/sales/CashSaleView.tsx`, `components/sales/ContractLineItems.tsx`, `components/deals/DealTermsBreakdown.tsx`,
      `components/contract/ContractExchangePanel.tsx`, `components/trade/TradeContract.tsx`, `components/trade/TradeNegotiationPanel.tsx`,
      `components/trade/TradeOfferForm.tsx`, `tests/component/tradeFeeDisclosure.test.tsx`
      Verify: `npx vitest --run tests/component/tradeFeeDisclosure.test.tsx tests/component/listingPane.test.tsx`. Passes.

- [ ] 7. Marketing pages (depends on 4).
      - `app/(marketing)/safety/page.tsx` l.107: `{feesWaivedForBeta() ? <>{betaFeeNote()}. Postage is passed through at cost.</> : <>existing text</>}`.
        Keep the `platformFeePhrase` import for the else branch.
      - `components/help/HelpCentre.tsx` l.70-71: swap the last sentence for `` `${betaFeeNote()}.` `` when waived.
      - `app/(marketing)/terms/page.tsx`: after the "Stripe and money movement" section, add
        `{feesWaivedForBeta() ? (<><h2>Fees</h2><p>{TERMS_BETA_FEE_SENTENCE}</p></>) : null}`.
      Files: `app/(marketing)/safety/page.tsx`, `components/help/HelpCentre.tsx`, `app/(marketing)/terms/page.tsx`
      Verify: `npx vitest --run tests/unit/platformFee.test.ts tests/component/listingPane.test.tsx`. Still green. No test renders these pages; rely on editor diagnostics for these three files.

- [ ] 8. Item form price readout: edit the working tree only, do NOT commit.
      In the user's working-tree `components/listings/ItemForm.tsx`, at ~l.243 (inside `PriceReadout`), change
      only the sentence "The {platformFeeRateLabel(currency)} buyer fee is added to your price. Card processing is
      shown on your statement." Use `feesWaivedForBeta() ? `${betaFeeNote()}. Buyers pay your price. ` : `The … buyer fee is added to your price. ``
      followed by the unchanged "Card processing is shown on your statement.", and add the `feeLabels` imports to
      the existing import on l.88. Touch nothing else in the file. Exclude this file from the commit in item 12,
      because it holds the user's uncommitted 465-line rewrite. Record this in the final report.
      Files: `components/listings/ItemForm.tsx` (working tree only)
      Verify: `npx vitest --run tests/unit/itemFormSteps.test.ts tests/component/itemFormSteps.test.tsx`. These are the user's untracked tests for this file. Report their result, and if they fail, confirm the failure also occurs with your hunk reverted before treating it as unrelated.

- [ ] 9. Flutter mirror, Dart copy, and the agreement pin.
      - `flutter_app/lib/core/money.dart`, all as `static` members inside `Money` (NOT top-level, so the
        port census is unchanged):
        - `static const bool betaFeeWaiver = true;`
        - `static const int standardFeeBps = 500;`
        - `static int standardFee(int baseCents)`, which keeps the half-up `((base * standardFeeBps) + 5000) ~/ 10000`
          and returns 0 for `<= 0`
        - `_percentageFee` returns `betaFeeWaiver ? 0 : standardFee(baseCents)`
        - `static String betaFeeNote() => 'No fees during beta (normally 5%)';`
        - `static String feeRowRate(int feeCents) => feeCents == 0 ? 'waived during beta, normally 5%' : '5%';`
        Use the literals exactly. Doc comments say "Mirrors `BETA_FEE_WAIVER` in `domain/fees/betaFeeWaiver.ts`" etc.
        Keep the `/// Mirrors \`lib/format.ts\`` header as the first `Mirrors` line.
      - `flutter_app/lib/domain/trade/trade_fee.dart`: doc comments only. The fee is 0 while
        `Money.betaFeeWaiver`, and `platformFeeBps` is the standard rate. Do not add top-level symbols.
      - `purchase_flow_screen.dart` l.376: `'Platform fee (${Money.feeRowRate(feeCents)})'`.
      - `sale_room_screen.dart` l.236-238: label `'Platform fee (${Money.feeRowRate(sale.platformFeeCents)})'`, hint
        `sale.platformFeeCents == 0 ? 'No fee during beta.' : 'Charged on the item price only.'`.
      - `trade_room_screen.dart` l.487-512:
        - explainer when `Money.betaFeeWaiver`: `'A trade moves goods, not cash. ${Money.betaFeeNote()}.'`, else the existing text
        - row label `'Your trade fee (${Money.feeRowRate(yourFeeCents)})'`
      - Dart tests, updated for consistency but not run:
        - `flutter_app/test/money_test.dart` and `flutter_app/test/widget_test.dart`: `Money.platformFee` and
          `Money.tradeFee` expect 0 while waived, and the old 5% expectations move to `Money.standardFee`
        - `flutter_app/test/domain_test.dart` "Trade Fee" group: `tradeFee` is 0, and the standard expectations use `Money.standardFee`
        - `contract_room_test.dart` l.170 keeps `'Platform fee (5%'`, because the fixture stores 210
      - Add a parser `dartFeeSchedule(): { betaFeeWaiver: boolean; standardFeeBps: number; source: string }` to
        `scripts/lib/mobileContract.ts` next to `dartZeroDecimalCurrencies`. It reads `core/money.dart`
        with `/static\s+const\s+bool\s+betaFeeWaiver\s*=\s*(true|false)\s*;/` and
        `/static\s+const\s+int\s+standardFeeBps\s*=\s*(\d+)\s*;/`, and throws a descriptive Error if either
        is missing (strict, per the steering rule).
      - In `tests/unit/mobileDomainAgreement.test.ts`, add `describe('the beta fee waiver agrees across the language boundary')`:
        - `dartFeeSchedule().betaFeeWaiver === BETA_FEE_WAIVER`
        - `standardFeeBps === PLATFORM_FEE_BPS` and `=== TRADE_FEE_BPS`
        - `source` contains `` `'${betaFeeNote()}'` `` and `` `'${platformFeeRowRate(0)}'` ``
        Also update the header comment to name the fee switch.
      - Goldens such as `trade_room_before_collateral` will differ. They cannot be regenerated here. Record
        that the user should run `flutter test --update-goldens` in `flutter_app/`.
      Files: `flutter_app/lib/core/money.dart`, `flutter_app/lib/domain/trade/trade_fee.dart`,
      `flutter_app/lib/features/sales/screens/purchase_flow_screen.dart`, `flutter_app/lib/features/sales/screens/sale_room_screen.dart`,
      `flutter_app/lib/features/trades/screens/trade_room_screen.dart`, `flutter_app/test/money_test.dart`, `flutter_app/test/widget_test.dart`,
      `flutter_app/test/domain_test.dart`, `scripts/lib/mobileContract.ts`, `tests/unit/mobileDomainAgreement.test.ts`
      Verify: `npx vitest --run tests/unit/mobileDomainAgreement.test.ts` passes. `npx vitest --run tests/unit/mobileThemeAgreement.test.ts` fails only on the pre-existing palette P4 case, and the port-census and "renders money only through core/money.dart" cases pass.

- [ ] 10. E2E price pin.
      In `tests/e2e/specs/us-region.spec.ts`, add
      `import { BETA_FEE_WAIVER } from '../../../domain/fees/betaFeeWaiver';` (relative: e2e specs do not use the `@/` alias).
      Use `const expectedHeadline = BETA_FEE_WAIVER ? '$180.00' : '$189.00';` in the l.92 assertion, and update the
      l.81-85 comment. Do not run Playwright.
      Files: `tests/e2e/specs/us-region.spec.ts`
      Verify: `npx vitest --run tests/unit/platformFee.test.ts` still passes. There is no e2e run. The import path must resolve: `domain/fees/betaFeeWaiver.ts` exists at the repo root.

- [ ] 11. Steering docs.
      - `.kiro/steering/product.md` l.123: append "**waived during beta** (`BETA_FEE_WAIVER` in `domain/fees/betaFeeWaiver.ts`)".
      - l.256: note the standard 5% rate and the beta waiver.
      - After the l.258 paragraph, add a "**Fees are waived during the beta.**" paragraph covering:
        - the switch's file and name, and `effectiveFeeBps`
        - `PLATFORM_FEE_BPS` / `TRADE_FEE_BPS` remain the 5% standard rates
        - why it is a code constant, not an env var
        - ending the beta = flip it and `Money.betaFeeWaiver` (pinned by `mobileDomainAgreement.test.ts`)
        - copy comes from `lib/fees/feeLabels.ts` ("No fees during beta (normally 5%)", never "$0.00 fee"), with no end date promised, and Terms say members will be told first
        - a zero trade fee skips the charge entirely: no `trade_fees` row and no provider call, and the drain settles any zero row without charging
        - ACCEPTED COST: the platform absorbs Stripe's card (~1.7% + $0.30) and payout costs on every sale, and the seller receives the full amount
        - custody reconciliation is unchanged and can show a real SHORTFALL equal to absorbed processing costs, so keep a buffer in the platform balance and do not tune the check
        - stored fees are untouched, including unpaid AGREEMENT rows, which still charge the fee stored at open
        - the trade room derives its fee live, so a trade charged before the beta reads as waived there
      - l.274 trade paragraph: add "(waived during beta)".
      - `.kiro/steering/structure.md` l.70: fix "5% of FMV" to "5% of Trade_Side_Value, 0 during beta". Add a
        `fees/` bullet under `domain/`: `percentageFee.ts` (the one rounding rule) and `betaFeeWaiver.ts`
        (`BETA_FEE_WAIVER`, the one switch).
      Files: `.kiro/steering/product.md`, `.kiro/steering/structure.md`
      Verify: `npx vitest --run tests/unit/regionCurrencyAgreement.test.ts`. Passes. Prose has no test, so re-read both paragraphs for accuracy against the code.

- [ ] 12. Final targeted run, then commit with pathspec-only staging.
      Run all of these and confirm they pass. The only allowed failure is the pre-existing `mobileThemeAgreement` palette P4.
      ```
      npx vitest --run tests/unit/platformFee.test.ts tests/unit/tradeFee.test.ts tests/unit/tradeFeeDrain.test.ts tests/unit/listedPrice.test.ts tests/unit/regionParity.test.ts tests/unit/cashSaleContract.test.ts tests/unit/cashSaleDirectPayout.test.ts tests/unit/cashSaleDispute.test.ts tests/unit/cashSaleDisputeWithdrawal.test.ts tests/unit/cashSaleErrors.test.ts tests/unit/cashSaleRefundDrain.test.ts tests/unit/cashSaleReturnFlow.test.ts tests/unit/cashSaleReturnLapse.test.ts tests/unit/privateDealCashSale.test.ts tests/unit/regionGuard.test.ts tests/unit/tradeProposal.test.ts tests/unit/tradeInspectionSweep.test.ts tests/unit/bondPolicy.test.ts tests/unit/custodyReconciliation.test.ts tests/unit/custodyCollectedStatuses.test.ts tests/property/payoutReadModel.test.ts tests/unit/mobileDomainAgreement.test.ts tests/unit/moneyCurrencyRendering.test.ts tests/unit/actionLogCoverage.test.ts tests/unit/regionCurrencyAgreement.test.ts
      npx vitest --run tests/component/listingPane.test.tsx tests/component/tradeFeeDisclosure.test.tsx
      npx vitest --run tests/unit/mobileThemeAgreement.test.ts
      ```
      Then `git add -- domain/fees/betaFeeWaiver.ts` (the only new file). Commit ONLY the files this plan
      changed, by pathspec, so the user's staged `CatalogControls.tsx` / `CatalogResults.tsx` / `browseEvents.ts`
      stay staged and uncommitted:
      `git commit -m "feat: waive platform fees during beta" -m "<body: the switch, the 0-fee trade skip, no migration (all fee CHECKs are >= 0), copy via feeLabels, accepted Stripe cost, verification run>" -- <every path from items 1-7 and 9-11>`.
      EXCLUDE `components/listings/ItemForm.tsx`, `.agents/**`, and every user file in the ground rules.
      Afterwards, `git status --short` must still show the user's files exactly as before, plus
      ` M components/listings/ItemForm.tsx`. Do not push.
      Files: none new
      Verify: `git show --stat HEAD` lists only this plan's files. `git status --short` shows the user's three staged files still staged.

## Final report must state

- The switch is `BETA_FEE_WAIVER` in `domain/fees/betaFeeWaiver.ts`, with Dart mirror `Money.betaFeeWaiver`.
- No migration was needed (fee CHECKs are all `>= 0`).
- The `ItemForm.tsx` sentence was edited in the working tree and left uncommitted, because it holds the user's WIP.
- Flutter goldens need `flutter test --update-goldens`. `flutter test` was not run.
- During beta the platform absorbs Stripe costs, and custody may show a real shortfall that needs a balance buffer.
- Unpaid agreements opened before deploy keep their stored 5% fee.
