# Implementation Plan: remove the platform fee minimums

Goal: the Platform_Fee becomes a plain 5% of the item price on a Cash_Sale
(`PLATFORM_FEE_BPS = 500`), and the Trade_Fee a plain 5% of Trade_Side_Value per
trader (`TRADE_FEE_BPS = 500`). No per-currency floor anywhere: TypeScript, Dart, copy,
tests, steering. The user has accepted that small sales lose money. Do not argue it,
and do not add a floor back.

## Ground rules (read before touching anything)

- Work in place on `main` in `c:\dev\Marketplace`. NO worktree. Do NOT edit anything
  under `c:\dev\Marketplace\.worktrees\` (the `escrow-hardening` worktree has its own
  copies of these files, and every grep hits them too).
- The tree has unrelated user work. `git status` at planning time:
  - modified, unstaged: `app/(workspace)/t/[token]/page.tsx`, `components/deals/DealComposeForm.tsx`,
    `components/deals/DealEditDialog.tsx`, `components/deals/DealInviteShare.tsx`, `lib/actions/listings.ts`
  - STAGED by the user: `components/listings/CatalogControls.tsx`,
    `components/listings/CatalogResults.tsx`, `lib/catalog/browseEvents.ts`
  - untracked: `components/deals/DealSteps.tsx` (calls `platformFeeCentsFor(priceCents, currency)`), `.kiro/specs/lapsed-sale-case-fix/`, `.agents/**`, `.worktrees/`

  None of the files this plan changes are in that list. If you commit, ALWAYS pass
  explicit pathspecs (`git commit -m "…" -- <file> <file> …`), because a bare
  `git commit` would sweep the user's three staged files into it. Never `git add -A` / `git add .`.
  Never stage or commit `.agents/**`.
- Do NOT run `npm run build`, `npm run lint`, `npm run typecheck`, the full suite,
  `npm run dev`, or `flutter test`. Only the targeted Vitest files listed per item.
  `domain/services/types.ts` is NOT changed by this plan, so `npx tsc --noEmit` is not
  required.
- Do NOT touch stored fees: no migration, no backfill, no seed edits. Already-agreed
  contracts keep the `platform_fee_cents` / `trade_fees.amount_cents` they were given.

## Decisions (made here, not left to the implementer)

1. **Delete `domain/fees/feeMinimums.ts`; add `domain/fees/percentageFee.ts`** with one
   pure helper, `percentageFeeMinor(baseMinor, rateBps)`, that both fee functions call.
   One rounding definition shared by cash and trade, as today, minus the floor.
2. **Rounding is kept byte-for-byte.** The existing body of `percentageFeeWithMinimum`
   (`domain/fees/feeMinimums.ts` lines 67-71) is, verbatim:
   ```ts
   const base = Math.max(Math.trunc(baseMinor), 0);
   if (base === 0 || rateBps <= 0) return 0;
   const percentage = Math.round((base * rateBps) / 10_000);
   return Math.max(percentage, Math.max(Math.trunc(minimumMinor), 0));
   ```
   The new helper keeps the first three lines exactly, and returns `percentage`. So for
   any amount, the fee is `Math.round((price * 500) / 10_000)` (truncated, non-negative
   base; zero base or zero rate → 0). Above the old floor it is identical to today.
   The Dart port's existing expression `((baseCents * 500) + 5000) ~/ 10000` (half-up,
   equal to `Math.round` for non-negative ints) with `if (baseCents <= 0) return 0;`
   is likewise kept as is.
3. **The `currency` parameters stay on the public fee and label functions, renamed
   `_currency` where unused.** Reason: about 20 call sites pass it (components, the
   orchestrator, the repositories, buyerPrice, Flutter screens), one of them in the
   user's untracked `components/deals/DealSteps.tsx`, which this task must not edit.
   Dropping the parameter would break that file. The `_` prefix matches
   `argsIgnorePattern: '^_'` in `eslint.config.mjs`, so it raises no unused-var warning.
   The parameter becomes optional on `platformFeeCentsFor` and the three label
   functions. On `tradeFeeCentsFor` it stays positional, because `rateBps` follows it.
   Exception: `resolveTradeFees` has one production caller, so its `currency` field
   is removed. The `trades.currency` read in `lib/actions/tradeFees.ts`, which existed
   only to pick the minimum, is deleted with it.
4. **Labels:** `platformFeeRateLabel()` → `'5%'`, `tradeFeeRateLabel()` → `'5%'`,
   `platformFeePhrase()` → `'5% of the item price'`, all derived from the BPS constants
   as today (`${rateBps / 100}%`). Member copy changes through these functions; no
   component JSX string needs editing.
5. **SQL: no migration.** The highest migration file is `0133_binder_listing_chat_copy.sql`. No
   migration computes or enforces the floor. Checked: the only fee constraints are
   `cash_sales_fee_nonnegative check (platform_fee_cents >= 0)` (0008),
   `trade_fees.amount_cents check (amount_cents >= 0)` (0056), and
   `greatest(amount_cents - platform_fee_cents, 0)` in the payout event (0042). The
   0064 `replace_cash_sale_items` RPC takes `p_platform_fee_cents` from the caller
   ("PLATFORM_FEE_BPS … must not be duplicated here"). The floor was only ever in
   TypeScript and Dart (it was added in commit 66b29e9 with no migration). A fee of 0
   on a sub-10-cent base passes every CHECK. `chargeTradeFees` already filters
   `amountCents > 0`.
6. **Known, accepted consequence (do not code around it):** a contract created while
   the floor existed, e.g. a $10 sale still in `AGREEMENT` with a stored $1.50 fee, will
   show "Platform fee (5%)" beside its stored $1.50. Per the brief, stored fees are not
   touched. Mention it in the final summary; do not add logic.

---

- [ ] 1. Replace the fee calculation with a plain percentage (TypeScript domain + lib).
      a) Create `domain/fees/percentageFee.ts`, with a header comment in the house style
         stating it is the ONE rounding rule for the Platform_Fee and the Trade_Fee,
         that there is deliberately no minimum (removed; below ~$30 a cash sale does not
         cover the provider's fixed costs, an accepted trade-off), and that it is a pure
         module:
         ```ts
         /**
          * `rateBps` of `baseMinor`, rounded to the nearest minor unit. A base of zero (or
          * less) or a rate of zero yields zero. No minimum is applied.
          */
         export function percentageFeeMinor(baseMinor: number, rateBps: number): number {
           const base = Math.max(Math.trunc(baseMinor), 0);
           if (base === 0 || rateBps <= 0) return 0;
           return Math.round((base * rateBps) / 10_000);
         }
         ```
      b) Delete `domain/fees/feeMinimums.ts` (`git rm domain/fees/feeMinimums.ts`).
      c) `domain/orchestrator/cashSaleOrchestrator.ts`:
         - Replace the import block at lines 17-21
           (`feeMinimumMinor, percentageFeeWithMinimum, PLATFORM_FEE_MINIMUM_MINOR … from '../fees/feeMinimums'`)
           with `import { percentageFeeMinor } from '../fees/percentageFee';`.
         - Rewrite the JSDoc of `platformFeeCentsFor` (lines ~76-94). Remove the sentences
           "raised to the currency's minimum (`PLATFORM_FEE_MINIMUM_MINOR`, $1.50 in AUD)
           … pays it once. A currency with no floor on file gets the plain percentage."
           and "`currency` is required rather than defaulted: the floor is a money amount …".
           New text: a plain `PLATFORM_FEE_BPS` of the item price with NO minimum (removed
           deliberately; an accepted trade-off on small sales). Shipping is excluded.
           Rounded with `Math.round`, 0 → 0. `_currency` does not affect the result and
           is kept so callers keep their signature.
         - Signature/body: `export function platformFeeCentsFor(agreedPriceCents: Cents, _currency?: string | null): Cents { return percentageFeeMinor(agreedPriceCents, PLATFORM_FEE_BPS); }`
         - Comment at ~line 1201-1203: change "The row's currency is derived on insert from
           the PAYEE's region (`set_row_currency_from_region`, 0068), so the fee floor is
           read from the same place. The region guard above has already refused an
           unknown region." to drop the "so the fee floor is read from the same place"
           clause (e.g. "…derived on insert from the PAYEE's region (…, 0068); the fee is
           denominated in it."). Leave the call
           `platformFeeCentsFor(agreedPriceCents, regionCurrency(item.ownerRegionCode))`
           and the one at ~line 1343 unchanged.
      d) `domain/trade/tradeFee.ts`:
         - Replace the import (lines 36-40) with `import { percentageFeeMinor } from '../fees/percentageFee';`.
         - Header lines 29-32 ("MINIMUM. The percentage is floored per trader by
           `TRADE_FEE_MINIMUM_MINOR` (`domain/fees/feeMinimums.ts`), because each fee is a
           separate card charge with a fixed provider cost.") become a NO-MINIMUM note:
           a plain percentage per trader, the floor was removed deliberately.
         - KEEP the header path line `// domain/trade/tradeFee.ts` and the JSDoc on
           `TRADE_FEE_BPS` that mentions `PLATFORM_FEE_BPS`. `tests/unit/mobileThemeAgreement.test.ts`
           ("adds no exported symbol to a port…") resolves the Dart port's `platformFeeBps`
           and `tradeFee` symbols against this file's identifiers. Removing either token
           makes that test report a surplus symbol.
         - `tradeFeeCentsFor` JSDoc (lines ~50-64): remove "raised to the currency's
           per-trader minimum (`TRADE_FEE_MINIMUM_MINOR`, $1.00 in AUD). Each trader's fee
           is its own card charge … currency with no floor on file gets the plain
           percentage." and the `@param currency … because the floor is a money amount in
           that currency.` text. Say instead that `_currency` does not affect the result.
           Signature: `tradeFeeCentsFor(valueReceivedCents: number, _currency: string | null, rateBps: number = TRADE_FEE_BPS): number`,
           body `return percentageFeeMinor(valueReceivedCents, rateBps);`.
         - `resolveTradeFees`: delete the `currency: string | null;` field and its
           comment ("The trade's ISO 4217 code, which selects the per-trader minimum.").
           Call `tradeFeeCentsFor(params.initiatorReceivesCents, null, rate)` and the
           same for the counterpart.
      e) `lib/actions/tradeFees.ts` (`chargeTradeFees`, lines ~64-76): delete the comment
         "The fee minimum is a money amount, so it is read in the trade's own frozen
         currency — …" and the `const { data: tradeRow } = await admin.from('trades').select('currency')…maybeSingle();`
         query. Remove the `currency: …` property from the `resolveTradeFees({...})` call.
         Nothing else in the file uses `tradeRow`.
      f) `lib/fees/feeLabels.ts`: remove the `feeMinimums` import and the `formatMoney`
         import (now unused). Rewrite the header (line 3 `e.g. "5%, min $1.50"` → `e.g. "5%"`;
         lines 5-7 drop "and the per-currency minimums in `domain/fees/feeMinimums.ts`").
         Remove the sentence saying it lives in `lib/` "only because it formats money",
         because it no longer formats money. Keep the module in `lib/` so imports stay stable. New bodies:
         - `function rateLabel(rateBps: number): string { return \`${rateBps / 100}%\`; }`
         - `platformFeeRateLabel(_currency?: string | null): string` → `rateLabel(PLATFORM_FEE_BPS)`; JSDoc `"5%"`.
         - `platformFeePhrase(_currency?: string | null): string` → `` `${PLATFORM_FEE_BPS / 100}% of the item price` ``; JSDoc drop "with a minimum of $1.50".
         - `tradeFeeRateLabel(_currency?: string | null): string` → `rateLabel(TRADE_FEE_BPS)`; JSDoc `"5%"`.
      g) `lib/listings/buyerPrice.ts` comments only: lines 20-22 ("`PLATFORM_FEE_LABEL` (a
         bare "5%") used to live here. The fee now has a per-currency minimum, so the label
         needs the currency too: it is `platformFeeRateLabel` …") → "The member-facing
         rate label is `platformFeeRateLabel` in `lib/fees/feeLabels.ts`."; line 27 remove
         "(including its minimum)". Code unchanged.
      h) Comment-only cleanups in other fee callers:
         - `domain/orchestrator/supabaseCashSaleRepository.ts` ~line 467-468: "The Platform_Fee is a percentage of the item price (with a per-currency floor), so…" → drop "(with a per-currency floor)".
         - `tests/unit/fakes/cashSaleRepository.ts` ~line 457: "The percentage Platform_Fee (with its per-currency floor) is re-derived" → drop the parenthetical.
      Files: domain/fees/percentageFee.ts (new), domain/fees/feeMinimums.ts (deleted),
      domain/orchestrator/cashSaleOrchestrator.ts, domain/trade/tradeFee.ts,
      lib/actions/tradeFees.ts, lib/fees/feeLabels.ts, lib/listings/buyerPrice.ts,
      domain/orchestrator/supabaseCashSaleRepository.ts, tests/unit/fakes/cashSaleRepository.ts
      Verify: item 3's test run (the old floor tests are rewritten there). Here, check
      the editor diagnostics on the changed files only: no unresolved import of
      `feeMinimums` remains in TS (`git grep -n feeMinimums -- domain lib components app tests`
      should list only test files that item 3 rewrites).

- [ ] 2. Remove the minimum from member-facing copy and from component docs.
      With item 1 done, every rendered label reads "5%" / "5% of the item price". Edit
      comments that still describe a minimum:
      - `components/listings/FeeInfoPopover.tsx` line 26: `/** The rate as members read it, e.g. "5%, min $1.50". */` → `e.g. "5%".`
      - `components/trade/TradeNegotiationPanel.tsx` lines 108-111: `The rate as members read it, e.g. "5%, min $1.00", from \`tradeFeeRateLabel\`. Passed in because it depends on the trade's currency, which this panel does not hold. Falls back to the bare percentage.` → `The rate as members read it, e.g. "5%", from \`tradeFeeRateLabel\`, so the label has one source. Falls back to the bare percentage.`
      - `components/listings/ListingDesktopPane.tsx` line 55 and `components/listings/ListingDetailStack.tsx` line 57: `` /** `items.currency`, which selects the fee minimum folded into the headline. */ `` → `` /** `items.currency`, the currency the fee-inclusive headline is shown in. */ ``

      Full grep inventory (case-insensitive `min `, `minimum`, `1.50`, `1.00`, `feeMinimum`,
      `FEE_MINIMUM` over app/, components/, lib/, domain/, flutter_app/, tests/, supabase/,
      .kiro/steering, excluding .worktrees/.agents/node_modules):

      | Hit | Change? |
      |---|---|
      | `lib/fees/feeLabels.ts` (header, `rateLabel`, `platformFeeRateLabel`, `platformFeePhrase`, `tradeFeeRateLabel`) | YES, item 1f. This is the source of every rendered "5%, min $1.50" / "5%, min $1.00" / "with a minimum of $1.50" |
      | `components/deals/DealTermsBreakdown.tsx:32,41` (`platformFeeRateLabel(currency)`), `:36,83` fee calls | No edit; renders "(5%)" via 1f |
      | `components/listings/ListingTrust.tsx:43,51` (FeeInfoPopover `rateLabel`) | No edit; renders "NoDitto fee (5%)" |
      | `components/listings/ItemForm.tsx:209` "The {platformFeeRateLabel(currency)} buyer fee is added…" | No edit; "The 5% buyer fee…" |
      | `components/sales/CashSaleView.tsx:1400,1637` `Platform fee (${platformFeeRateLabel(sale.currency)})` | No edit; "Platform fee (5%)" |
      | `components/sales/ContractLineItems.tsx:198` | No edit |
      | `components/trade/TradeContract.tsx:880-881,1138,1262,1281` | No edit; "NoDitto fee (5%)" |
      | `components/listings/BuyButton.tsx:112`, `components/offers/MakeOfferDialog.tsx:179,223` fee amounts | No edit; amounts are now plain 5% |
      | `app/(marketing)/safety/page.tsx:107` "NoDitto fee of {platformFeePhrase('aud')}" | No edit; reads "5% of the item price" |
      | `app/(marketing)/help`, `terms`, `privacy`; `lib/email/**` | No fee-minimum text found. No edit |
      | `components/deals/DealSteps.tsx:256` (untracked user file) | DO NOT EDIT; signature kept so it still compiles |
      | `components/listings/FeeInfoPopover.tsx:26`, `TradeNegotiationPanel.tsx:108`, `ListingDesktopPane.tsx:55`, `ListingDetailStack.tsx:57` | YES (comments), this item |
      | `domain/fees/feeMinimums.ts`, `domain/orchestrator/cashSaleOrchestrator.ts:17-20,81-98,1203`, `domain/trade/tradeFee.ts:29-40,53-73,93`, `lib/actions/tradeFees.ts:64`, `lib/listings/buyerPrice.ts:20-22,27`, `supabaseCashSaleRepository.ts:468`, `tests/unit/fakes/cashSaleRepository.ts:457` | YES, item 1 |
      | `flutter_app/lib/core/money.dart:146-212`, `flutter_app/lib/domain/trade/trade_fee.dart:5-8,20-23` | YES, item 4 |
      | `flutter_app/test/money_test.dart`, `widget_test.dart`, `domain_test.dart`, `widgets/contract_room_test.dart:169` | YES, item 4 |
      | `tests/unit/platformFeeMinimum.test.ts`, `tradeFee.test.ts`, `listedPrice.test.ts:15-17`, `regionParity.test.ts:232-234` | YES, item 3 |
      | `.kiro/steering/product.md:123,258` | YES, item 5 |
      | `flutter_app/lib/core/constants.dart:43` "Minimum offer amount", slider/CSS/WCAG "minimum" hits, `CatalogControls.tsx` "Minimum price" | No; unrelated to the fee |
      | `.agents/tasks/task-escrow-redteam/notes-dispute-bond-fee.md:174` | No; historical task notes, not product |
      | `.worktrees/escrow-hardening/**` | No; a separate worktree, never touch |
      | `supabase/migrations/**`, seeds | No; see Decision 5 |

      Files: components/listings/FeeInfoPopover.tsx, components/trade/TradeNegotiationPanel.tsx,
      components/listings/ListingDesktopPane.tsx, components/listings/ListingDetailStack.tsx
      Verify: `npx vitest --run tests/component/tradeFeeDisclosure.test.tsx tests/component/listingPane.test.tsx`
      passes. The first asserts `'NoDitto fee (5%)'`, the second the fee-inclusive
      headline ("Includes $20,000.00 buyer fee"), and both are unchanged at those prices.

- [ ] 3. Update the TypeScript tests: drop the floor assertions and add no-floor properties for both fee functions.
      a) `git mv tests/unit/platformFeeMinimum.test.ts tests/unit/platformFee.test.ts` and rewrite it:
         - Header: "The Cash_Sale Platform_Fee: a plain 5% of the item price with no minimum."
         - Remove the `@/domain/fees/feeMinimums` import and the whole `describe('feeMinimums helpers', …)` block.
           Import `percentageFeeMinor` from `@/domain/fees/percentageFee` instead and test that
           `percentageFeeMinor(10_000, 0)` is 0, `percentageFeeMinor(0, 500)` is 0, `percentageFeeMinor(-5, 500)` is 0.
         - Keep `'is 5% …'`: `platformFeeCentsFor(10_000,'aud')` is 500, `(84_500,'aud')` is 4_225.
         - Replace "floors a small AUD contract at $1.50" and "hands over to the percentage at $30"
           with "has no minimum: small contracts pay the plain 5%": `(1,'aud')` is 0, `(1_000,'aud')` is 50,
           `(2_000,'aud')` is 100, `(3_000,'aud')` is 150, `(3_010,'aud')` is 151 (150.5 rounds up), `(9,'aud')` is 0, `(10,'aud')` is 1 (0.5 rounds up).
         - Keep "charges nothing on a zero price" (`(0,'aud')` is 0).
         - Replace "applies no floor where none is on file" with "is the same in every currency":
           `(1_000, c)` is 50 for c in `'aud' | 'usd' | 'jpy' | null`, and calling with no currency `platformFeeCentsFor(1_000)` is 50.
         - Replace the "never below the floor (property)" with
           **"is exactly Math.round(price * 500 / 10_000), with no floor (property)"**:
           `fc.property(fc.integer({ min: 0, max: 100_000_000 }), fc.constantFrom('aud','usd','gbp','jpy', null), (price, currency) => { const fee = platformFeeCentsFor(price, currency); expect(Number.isInteger(fee)).toBe(true); expect(fee).toBe(Math.round((price * PLATFORM_FEE_BPS) / 10_000)); })`.
           Also assert `PLATFORM_FEE_BPS` is 500 so the property pins the literal 500.
         - Keep "is non-decreasing in price (property)".
         - "what the buyer is shown": `buyerPaysCents(1_000,'aud')` is 1_050 (was 1_150), `buyerPaysCents(10_000,'aud')` is 10_500.
           Rename the test "folds the plain fee into the fee-inclusive headline".
         - Labels test, renamed "names the bare rate, with no minimum": `platformFeeRateLabel('aud')` is `'5%'`, `tradeFeeRateLabel('aud')` is `'5%'`,
           `platformFeeRateLabel('usd')` is `'5%'`, `platformFeeRateLabel()` is `'5%'`, `platformFeePhrase('aud')` is `'5% of the item price'`.
           Also `expect(platformFeeRateLabel('aud')).not.toMatch(/min/i)`.
      b) `tests/unit/tradeFee.test.ts`:
         - Header lines 3-5: drop "floored per trader by the currency's minimum".
         - Remove `import { TRADE_FEE_MINIMUM_MINOR } from '@/domain/fees/feeMinimums';`; add `import fc from 'fast-check';`.
         - Line 38 comment "A zero rate switches the fee off entirely, minimum included." → "A zero rate switches the fee off entirely."
         - Replace "floors each trader at $1.00 in AUD…" with "has no per-trader minimum": `tradeFeeCentsFor(1_000,'aud')` is 50, `(1,'aud')` is 0, `(2_000,'aud')` is 100, `(2_020,'aud')` is 101.
         - Replace "applies no floor in a currency that has none on file" / "reads the currency case-insensitively"
           with "is the same in every currency": `(1_000, c)` is 50 for c in `'aud' | 'AUD' | 'usd' | null`.
         - Add property **"is exactly Math.round(value * 500 / 10_000), with no floor (property)"** over
           `fc.integer({ min: 0, max: 100_000_000 })` × `fc.constantFrom('aud','usd','jpy', null)`, asserting
           `tradeFeeCentsFor(v, c) === Math.round((v * TRADE_FEE_BPS) / 10_000)` and `TRADE_FEE_BPS === 500`.
         - Add property: `resolveTradeFees({ initiatorReceivesCents: a, counterpartReceivesCents: b })` equals
           `{ initiatorFeeCents: Math.round(a*500/10_000), counterpartFeeCents: Math.round(b*500/10_000) }`.
         - Remove `currency: 'aud'` from every `resolveTradeFees({...})` literal (the field no longer exists).
         - "floors each side independently" → rename "charges each side independently, with no minimum"; expected `{ initiatorFeeCents: 50, counterpartFeeCents: 2_500 }` (was 100).
      c) `tests/unit/listedPrice.test.ts` lines 15-17: `it('applies the currency minimum fee on cheap singles', …500 + 150)` →
         `it('adds the plain 5% fee on cheap singles, with no minimum', () => { expect(listedPriceCents(500, 'aud', false)).toBe(525); });`.
         The `askingPriceRange` inversion test is unchanged (`buyerPaysCents` stays strictly increasing).
      d) `tests/unit/regionParity.test.ts` lines 232-234 comment: "The per-currency MINIMUM is not, and this fixture's price sits above every floor on file, so the fee is the plain percentage in all four worlds." → "There is no per-currency minimum, so the fee is the plain percentage in all four worlds." Assertions unchanged.
      Files: tests/unit/platformFee.test.ts (renamed from platformFeeMinimum.test.ts), tests/unit/tradeFee.test.ts,
      tests/unit/listedPrice.test.ts, tests/unit/regionParity.test.ts
      Verify: `npx vitest --run tests/unit/platformFee.test.ts tests/unit/tradeFee.test.ts tests/unit/listedPrice.test.ts tests/unit/regionParity.test.ts tests/unit/cashSaleContract.test.ts tests/unit/cashSaleDirectPayout.test.ts tests/unit/tradeFeeDrain.test.ts tests/unit/moneyCurrencyRendering.test.ts`
      all pass. (`cashSaleContract` and `cashSaleDirectPayout` compute expected amounts through
      `platformFeeCentsFor`, and `tradeFeeDrain` imports `lib/actions/tradeFees.ts`.)

- [ ] 4. Flutter: make the Dart port a plain percentage and update its copy and tests (edit only; do NOT run `flutter test`).
      a) `flutter_app/lib/core/money.dart` (lines ~146-212):
         - Delete `platformFeeMinimumMinor`, `tradeFeeMinimumMinor`, `_minimumFor` and `_feeWithMinimum` with their doc comments.
         - Add:
           ```dart
           /// 5% of [baseCents], rounded half-up to the nearest minor unit, with no
           /// minimum. Zero or negative base → 0.
           ///
           /// Mirrors `percentageFeeMinor` in `domain/fees/percentageFee.ts`.
           static int _percentageFee(int baseCents) {
             if (baseCents <= 0) return 0;
             return ((baseCents * 500) + 5000) ~/ 10000;
           }
           ```
           (the same expression as today's `_feeWithMinimum`, without the `> minimumCents` branch).
         - `platformFee(int priceCents, {required String? currency})`: keep the signature (screens pass it).
           Body `return _percentageFee(priceCents);`. Doc: "5% of item price (PLATFORM_FEE_BPS = 500), no minimum.
           Uses rounding (not truncation) to match `platformFeeCentsFor` in `domain/orchestrator/cashSaleOrchestrator.ts`.
           [currency] does not affect the result."
         - `tradeFee(int valueCents, {required String? currency})`: body `return _percentageFee(valueCents);`. Doc "5% of value, no minimum."
         - `platformFeeRateLabel(String currency)` → `return '5%';`, doc `"5%"`. `tradeFeeRateLabel(String currency)` → `return '5%';`, doc `"5%"`.
           Keep the "Mirrors `…` in `lib/fees/feeLabels.ts`" lines.
         - Do NOT touch line 8 `/// Mirrors \`lib/format.ts\` in the web app.`. It must stay the FIRST
           `/// Mirrors` line in the file, because `dartAdvisoryPorts()` (scripts/lib/mobileContract.ts) reads the first match as the port's pin.
      b) `flutter_app/lib/domain/trade/trade_fee.dart`: header lines 5-8 → "The platform fee is 5% of the trade side value, charged symmetrically to BOTH traders, with no minimum. Use [resolveTradeSideValues] …". `tradeFee` doc lines 20-23: drop ", raised to the currency's per-trader minimum". Keep `/// Mirrors \`domain/trade/tradeFee.ts\`` and `const int platformFeeBps = 500;` exactly.
      c) Dart tests:
         - `flutter_app/test/money_test.dart`: line 72 title → `'calculates 5% — 10000 cents → 500 cents'`. Replace the lines 81-85 test with `'has no minimum — small sales pay the plain 5%'`: `platformFee(1000,'aud')` is 50, `(2000)` is 100, `(1)` is 0. Delete the lines 87-90 crossover test. Lines 92-96 → title `'every currency gets the same plain percentage'`, keep usd/null expectations, add `platformFee(1000, currency: 'aud')` is 50. Line 98 title → `'zero price → zero fee'`. Line 104 title → `'calculates 5%'`. Lines 108-111 → `'has no per-trader minimum'`: `tradeFee(1000,'aud')` is 50, `tradeFee(0,'aud')` is 0. Lines 125-133 → `'adds the plain 5% fee on a small sale'`, comment `// 1000 + 0 + 50 = 1050`, expect 1050. Add `test('rate labels name no minimum', …)`: `Money.platformFeeRateLabel('aud')` is `'5%'`, `Money.tradeFeeRateLabel('aud')` is `'5%'`.
         - `flutter_app/test/widget_test.dart`: line 157 title → `'calculates 5% — 10000 cents → 500'`. Lines 161-163 → `'has no minimum — 2000 cents → 100'`, expect 100. Line 165 title → `'calculates 5% — rounds correctly'`.
         - `flutter_app/test/domain_test.dart`: line 200 comment → `// Any currency: 5% of $19.99 → $1.00 (rounded).`. Lines 204-207 → `'has no per-trader minimum'`: `tradeFee(100,'aud')` is 5, `tradeFee(1999,'aud')` is 100. Line 209 title → `'zero and negative values return 0'`.
         - `flutter_app/test/widgets/contract_room_test.dart` line 169 comment → `// "(5%)" in every currency: there is no fee minimum.` (assertion `textContaining('Platform fee (5%')` unchanged).
      Screens `features/sales/screens/purchase_flow_screen.dart:357,377`, `features/sales/screens/sale_room_screen.dart:236`,
      `features/trades/screens/trade_room_screen.dart:486-487` need no edit; they render "5%" through `Money`.
      Files: flutter_app/lib/core/money.dart, flutter_app/lib/domain/trade/trade_fee.dart,
      flutter_app/test/money_test.dart, flutter_app/test/widget_test.dart, flutter_app/test/domain_test.dart,
      flutter_app/test/widgets/contract_room_test.dart
      Verify: `npx vitest --run tests/unit/mobileDomainAgreement.test.ts tests/unit/mobileThemeAgreement.test.ts`
      passes (the port census, the "no surplus symbol" check against `domain/trade/tradeFee.ts`,
      and the retired-vocabulary scan all read these Dart files).

- [ ] 5. Steering docs: say the fee is a plain 5% with no minimum, removed deliberately.
      `.kiro/steering/product.md`:
      - Line 123 (Cash sales lifecycle step 3): replace `Fee = **5% of item price** (\`PLATFORM_FEE_BPS = 500\`), **minimum $1.50 per contract** (\`PLATFORM_FEE_MINIMUM_MINOR\`). Shipping is pass-through.`
        with `Fee = **5% of item price** (\`PLATFORM_FEE_BPS = 500\`), **no minimum**. Shipping is pass-through.`
      - Line 258: replace the whole paragraph beginning `**The fee has a per-currency MINIMUM** (\`domain/fees/feeMinimums.ts\`): …` and ending `The Dart port lives in \`core/money.dart\`.` with:
        > **There is no fee minimum, deliberately.** The fee is a plain percentage: 5% of the item price on a Cash_Sale, and 5% of Trade_Side_Value per trader on a Trade, rounded to the nearest minor unit (`domain/fees/percentageFee.ts`); a zero base charges zero. A per-currency floor ($1.50 per Cash_Sale, $1.00 per trader) existed briefly and was removed on purpose. The trade-off is accepted and recorded: the provider's costs have a fixed part (card ~$0.30, payout ~$0.25) that a percentage cannot cover, so below about $30 a cash sale costs more to process than it earns. Do not reintroduce a floor without a product decision. Contracts agreed while the floor existed keep the fee stored on them. Member copy reads the rate from `lib/fees/feeLabels.ts` ("5%") so it cannot drift from the charge; the Dart port lives in `core/money.dart`.
      - Leave the next paragraph ("**Do not describe the fee as flat.** …") as is.
      Other steering files checked (`tech.md`, `structure.md`, `stripe-payments.md`, `flutter.md`, `AGENTS.md`): no fee-minimum mention, no edit.
      Files: .kiro/steering/product.md
      Verify: docs-only. Re-run the item 3 and 4 Vitest commands to confirm nothing regressed.

- [ ] 6. Final targeted verification and (if the workflow commits) a path-scoped commit.
      Run once:
      `npx vitest --run tests/unit/platformFee.test.ts tests/unit/tradeFee.test.ts tests/unit/listedPrice.test.ts tests/unit/regionParity.test.ts tests/unit/cashSaleContract.test.ts tests/unit/cashSaleDirectPayout.test.ts tests/unit/tradeFeeDrain.test.ts tests/unit/moneyCurrencyRendering.test.ts tests/unit/mobileDomainAgreement.test.ts tests/unit/mobileThemeAgreement.test.ts tests/component/tradeFeeDisclosure.test.tsx tests/component/listingPane.test.tsx`
      Expected: all pass. `git grep -n -i -E "feeMinimum|FEE_MINIMUM|percentageFeeWithMinimum|min \\$1|minimum of \\$" -- app components lib domain flutter_app tests .kiro/steering`
      returns nothing (a sanity check only; the tests above are the verification).
      If committing: `git add` / `git rm` ONLY the files listed in items 1-5, then
      `git commit -m "refactor: remove platform fee minimums" -- <those exact paths>`.
      The pathspec list must name BOTH sides of the rename (`tests/unit/platformFeeMinimum.test.ts`
      and `tests/unit/platformFee.test.ts`) and the deleted `domain/fees/feeMinimums.ts`, or the
      commit will leave them out.
      Never include the user's staged `components/listings/CatalogControls.tsx`,
      `components/listings/CatalogResults.tsx` or `lib/catalog/browseEvents.ts`, or any
      other path from the git status above. Do not push.
