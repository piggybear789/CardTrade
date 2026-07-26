# Product

CardTrade is a safety-first, peer-to-peer clearinghouse and marketplace for collectibles (trading cards, coins, stamps, comics, memorabilia). Its differentiator is a trustless escrow engine built to run on Pinch Payments.

## Transaction models

1. **Cash Sale** — Buyer pays Seller via bank transfer (BECS Direct Debit / PayTo in production) plus a flat platform fee instead of percentage merchant fees.
2. **2-Way Trade Escrow** — Two users swap goods of equal Fair Market Value with $0 cash. A pre-authorization hold for 100% of FMV is placed on both parties and voided once both receive and accept.
3. **Dispute & Fraud Resolution** — A state machine handling condition disputes (a fixed $20 partial capture "friction tax") and objective fraud (full capture of collateral plus a Police Evidence Pack generated from KYC identity data).

There is also a private 1:1 "deal room" flow for binding deals negotiated directly between two users, with optional cash and collateral components.

## Current phase: frontend-first hackathon MVP

- The full user experience is built in the UI: registration, KYC flow, listings, cash sale, the complete trade escrow lifecycle, dispute/fraud flows, and the real-time trade contract view.
- All payment, KYC, and webhook behavior is served by `Mock_Service` — a deterministic simulated service layer that mimics the Pinch Payments REST API and Pinch Glassbox KYC. No live payment calls are made.
- The real Pinch integration is a later phase and must slot in behind the existing service interface without touching orchestrators, the state machine, actions, or the UI.

## Domain vocabulary

Use the spec's terms consistently in code and docs: Profile, KYC_Status (`UNVERIFIED | PENDING | VERIFIED | REJECTED`), Item, Fair_Market_Value, Cash_Sale, Trade, Trade_State (`COLLATERAL_PENDING | COLLATERAL_LOCKED | IN_TRANSIT | INSPECTION | COMPLETED | DISPUTED | FRAUD_RESOLVED`), Pre_Auth_Hold, Hold_Void, Partial_Capture, Full_Capture, Friction_Tax, Police_Evidence_Pack, Webhook_Event.

Currency is AUD and is always represented as **integer cents** end-to-end (e.g. `fmvCents`, `fmv_cents`, `cash_amount_cents`). Never use floats for money.

The authoritative spec lives in `.kiro/specs/cardtrade/`. Code comments reference requirement numbers (e.g. `Req 3.2`); keep that practice when adding behavior tied to a requirement.
