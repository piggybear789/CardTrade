# Escrow hardening: summary

Branch `fix/escrow-hardening` (worktree `.worktrees/escrow-hardening`), head `5252e97`, based on `a850778`. Not merged: `main` has 6 newer commits and the first rebase step conflicts in `components/trade/TradeContract.tsx`, `components/trade/TradeNegotiationPanel.tsx`, `lib/actions/trades.ts`, `tests/component/tradeFeeDisclosure.test.tsx`, `tests/unit/custodyReconciliation.test.ts`. Rebase was aborted; nothing on `main` was touched.

## Status by work package

| WP | ESC ids | Status |
|---|---|---|
| WP1 | 01, 02, 04, 07, 08, 10, 13, 15, 16, 22, 25, 26, 32, 35, 37 (part) | Done (f8bb072) |
| WP2 | 03, 05, 06, 14, 20, 24, 37 | Done |
| WP3 | 09, 17b, 18, 19, 21, 29, 33, 34 | Done |
| WP4 | 11, 12, 30, 38 | Done (020fabe, 2eae672) |
| WP5 | 23, 27, 28, 31, 36, 39 | Done with gaps below |

## Known gaps

- ESC-28: `feeBaseMinor` exists and is property-tested but is not wired into the charged fee. Postage is capped and outliers are flagged.
- ESC-23: no admin UI lists pending proposals (actions only). FRAUD proposals do not pre-capture custody. Recusal checks participants only, not `areRelated`.
- ESC-27: `OffPlatformWarning` was not moved or rendered; `sendMessage` returns `warning: true`.
- ESC-31: no `PayDialogSnapshot` component test.
- ESC-12: trade-side `tracking-in-use` relies on the 0144 trigger alone (trades are in-person only now).
- WP2/WP3 carry-overs: no tests for the duplicate-identity path; no admin UI for resolveDuplicateIdentity / clearPayeeMismatch / reverseCashSalePayout; Stripe binding does not populate the payout-account fingerprint; demo panel does not emit charge.fraud_warning; no capped-seller copy on the listing page; trade headline shows agreed value not each bond; no `cash-declined`/`fee-declined` ActionBar copy.
- `memberWriteSurface` and `tradeClockAgreement` pass alone but time out (5 s) in a 74-file run.

## Ops follow-ups

1. Apply 0133 → 0148 in order with `execute_sql`, one transaction each; verify with `to_regclass` / `pg_get_functiondef`.
2. Run `npx tsc --noEmit` (never run; seam types changed in WP1–WP4).
3. Stripe: automatic payouts off; Radar 3DS rules; subscribe `charge.dispute.*` and `radar.early_fraud_warning.created`; set `STRIPE_IDENTITY_RESTRICTED_KEY[_<REGION>]`.
4. Set `WEBHOOK_SECRET` in mock environments. Never set `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION` in production.
5. Ship24: configure Bearer auth, then remove `SHIP24_WEBHOOK_ALLOW_QUERY_SECRET`.
6. Capture `cardtrade.is_admin()` with `pg_get_functiondef` into a follow-up migration.
