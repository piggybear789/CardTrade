# US platform serves UK/EEA/CA/CH, cross-country, buyer absorbs FX

## Verified against Stripe test mode (US platform acct_1UIfsRRbOJEOZeCm)
- DE recipient-only v2 account on US platform: REFUSED (stripe_transfers needs merchant.card_payments).
- DE account with merchant.card_payments + recipient.stripe_transfers: created, onboarded, transfer OK.
- EUR charge on US platform settles to USD immediately (balance is USD only).
- transfers.create currency=eur with USD source_transaction: refused (currency mismatch).
- transfers.create currency=eur w/o source: balance_insufficient (no EUR balance; no auto-convert).
- transfer in USD -> DE seller receives EUR converted by Stripe.
- POST /v1/fx_quotes with Stripe-Version 2026-09-30.preview works: usd->eur rate 0.884781 (base 0.893718, fx_fee_rate 0.01).
- Test account acct_1UQ1EbDBt8PZ9Rx1 (DE) still open on US test platform.

## Decisions (user)
- Region step stays; IP pre-selects it; never written from IP alone.
- Cross-country allowed between regions on the SAME platform (US group: US, GB, EEA, CA, CH). AU only with AU.
- Buyer absorbs FX. Seller receives exactly the agreed amount in the contract currency.
- Currency must be extremely clear in UI.

## Design
- Platform map: platformRegionFor(region): AU->AU; US/GB/EEA/CA/CH->US. Credentials per PLATFORM.
- Contract currency = seller's (listing's) currency, as today. Buyer charged in it.
- Settlement currency of a platform = its region currency (US -> usd).
- When contract currency != settlement currency: buyer pays fx_fee (FX_COVER_BPS) on top; payout uses locked FX quote so seller gets exact net.
- Connect: account country = member's own region; request merchant.card_payments when country != platform country.
- Stripe calls take currency per call (contract row), not config.

## Stages
1. Platform mapping + per-call currency + compat + Connect config + migration tradingEnabled.
2. FX fee + exact payout.
3. Currency clarity UI + IP preselect.
4. Custody/friction tax/docs/flutter/tests.

## Status (end of session)
- Done: stages 1-4 in code; migration 0136 written, NOT applied; steering updated.
- Pending: apply 0136 (execute_sql, single transaction); mirror `_US` env on Vercel; first live FX payout check; close test acct acct_1UQ1EbDBt8PZ9Rx1.
- Not done: Flutter money strings without ISO code; catalog browse still country-scoped; Terms copy.
