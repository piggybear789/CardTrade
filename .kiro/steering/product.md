# Product

CardTrade is a safety-first, peer-to-peer clearinghouse and marketplace for collectibles (trading cards, coins, stamps, comics, memorabilia). Its differentiator is a trustless escrow engine built to run on Stripe.

## Transaction models

1. **Cash Sale** — Buyer pays, the platform holds the funds, and the Seller is paid their net once the Buyer accepts the goods. The platform fee is **5% of the agreed item price** (`PLATFORM_FEE_BPS = 500`), charged on the item price only — shipping is a pass-through to the carrier, not revenue.

   **Do not describe the fee as flat.** It is percentage-based in code, and no Australian rail Stripe offers makes a flat fee viable: cards cost 1.7% + $0.30 and PayTo costs 1% + $0.30, both percentages. Card is the current rail; PayTo is the intended addition, worth 0.7 points and a materially better chargeback profile, with card retained as a fallback because PayTo needs the payer's bank to have enabled it. BECS is rejected outright — its dispute window is 7 years, "no questions asked", and unappealable, which is untenable for a platform that is merchant of record and owns loss liability.
2. **2-Way Trade Escrow** — Two users swap goods of equal Fair Market Value with $0 cash. A pre-authorization hold for 100% of FMV is placed on both parties and voided once both receive and accept.

   **The two mechanisms are not the same thing, and the difference is load-bearing.** Trade and deal collateral is an *uncaptured card authorisation*: no money moves, and none of it enters the platform balance — the platform holds a claim, not funds. Cash_Sale proceeds are genuinely *collected* into the platform balance. Custody reconciliation counts the second and excludes the first (`domain/payouts/custodyReconciliation.ts`); counting collateral would invent a shortfall on every open trade. The member-facing name for collateral is **DittoBond**, matching the Bond Policy the domain layer has always used — never "escrow", which would imply the platform holds money it does not.
3. **Dispute & Fraud Resolution** — A state machine handling condition disputes (a fixed $20 partial capture "friction tax") and objective fraud (full capture of collateral, paid out to the victim). There is deliberately **no identity dossier**: the "Police Evidence Pack" was withdrawn because the platform has no basis to hand a person's identity documents to a private individual on the strength of an in-app fraud determination, and the term is not a real one. See Requirement 8.4.

There is also a private 1:1 "deal room" flow for binding deals negotiated directly between two users, with optional cash and collateral components.

A deal's cash is an **uncaptured authorisation** until both parties mark the deal complete, which is why a deal dispute is a capture decision rather than a refund. Either party may raise a dispute on a binding deal, which freezes it and captures nothing; support then decides one of `REFUND_PAYER` (release the authorisation — nobody is charged), `SPLIT` (capture the arbitrated share, provider releases the rest) or `RELEASE_RECIPIENT` (capture in full). Collateral is released in **every** outcome: a deal has no Friction_Tax and no fraud finding, so capturing a party's collateral would impose a penalty they were never told about. Do not add a deal `RESOLVED` state — `dispute_outcome` is what distinguishes an arbitrated unwind from a pre-binding cancellation, and both land in `CANCELLED`.

## Current phase: frontend-first hackathon MVP

- The full user experience is built in the UI: registration, KYC flow, listings, cash sale, the complete trade escrow lifecycle, dispute/fraud flows, and the real-time trade contract view.
- All payment, KYC, and webhook behavior is served by `Mock_Service` — a deterministic simulated service layer that mimics the Stripe REST API and Stripe Identity KYC. No live payment calls are made.
- The real Stripe integration is a later phase and must slot in behind the existing service interface without touching orchestrators, the state machine, actions, or the UI.

## Domain vocabulary

Use the spec's terms consistently in code and docs: Profile, Identity_Gate, Item, Fair_Market_Value, Cash_Sale, Trade, Trade_State (`COLLATERAL_PENDING | COLLATERAL_LOCKED | IN_TRANSIT | INSPECTION | COMPLETED | DISPUTED | FRAUD_RESOLVED`), Pre_Auth_Hold, Hold_Void, Partial_Capture, Full_Capture, Friction_Tax, Verified_Identity, Identity_Disclosure, Commitment_Point, Webhook_Event.

`Police_Evidence_Pack` is **retired vocabulary** — do not reintroduce it. `KYC_Status` is retired too: there was never an enforced gate behind it (nothing in the codebase compared it to `VERIFIED` to permit or refuse an action), and the flow that wrote it has been removed.

**Identity verification is the Identity_Gate, and nothing else.** One signal: Stripe Connect onboarding APPROVED with settlements enabled (`merchant_status` + `merchant_settlements_enabled`). Evaluate it only through `satisfiesIdentityGate` / `verificationState` in `domain/identity/identityGate.ts`; the SQL equivalent is `public_profiles.is_verified`, and its denormalised form is `items.seller_identity_verified`. Approval alone is not enough — `stripe_transfers.status === 'active'` is the only signal money can arrive.

**There is exactly ONE of each of those columns, and exactly one TypeScript field.** Migration 0049 removed `public_profiles.identity_verified` and `items.seller_verified`, which were byte-identical duplicates maintained by their own triggers, along with the `identityVerified` / `creatorIdentityVerified` fields that read them. Do not reintroduce a second column, field, or badge for this fact: two answers to one question is what broke buying once already. The retired `identity_verified` name also invited copy about a document-and-selfie check, which is why it is not the survivor.

The gate is scoped by whether a role can RECEIVE money. Publishing a listing, selling for cash, entering trade escrow, and cash-bearing private deals all require it. A cash Buyer does **not**: a Buyer is only ever refunded to their original card, so demanding payout onboarding of them would be friction with no purpose. A buy-only Member therefore holds no verified identity, and sellers see their display name and trading history instead of a legal name — a deliberate, recorded trade-off.

The only identity the platform holds is the provider-verified legal name Connect reports (`merchant_legal_entity_name`), written monotonically so a later provider report cannot blank a name already disclosed. Never describe a verified Member as having passed a document or selfie check: Connect verifies a payout recipient but can defer document collection, so that wording would overstate the assurance.

Currency is AUD and is always represented as **integer cents** end-to-end (e.g. `fmvCents`, `fmv_cents`, `cash_amount_cents`). Never use floats for money.

The authoritative spec lives in `.kiro/specs/cardtrade/`. Code comments reference requirement numbers (e.g. `Req 3.2`); keep that practice when adding behavior tied to a requirement.
