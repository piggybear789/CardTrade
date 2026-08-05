# Product

CardTrade is a safety-first, peer-to-peer clearinghouse and marketplace for collectibles (trading cards, coins, stamps, comics, memorabilia). Its differentiator is a trustless escrow engine built to run on Stripe.

## Transaction models

1. **Cash Sale** — Buyer pays, the platform holds the funds, and the Seller is paid their net once the Buyer accepts the goods. The platform fee is **5% of the agreed item price** (`PLATFORM_FEE_BPS = 500`), charged on the item price only — shipping is a pass-through to the carrier, not revenue.

   **Do not describe the fee as flat.** It is percentage-based in code, and no Australian rail Stripe offers makes a flat fee viable: cards cost 1.7% + $0.30 and PayTo costs 1% + $0.30, both percentages. Card is the current rail; PayTo is the intended addition, worth 0.7 points and a materially better chargeback profile, with card retained as a fallback because PayTo needs the payer's bank to have enabled it. BECS is rejected outright — its dispute window is 7 years, "no questions asked", and unappealable, which is untenable for a platform that is merchant of record and owns loss liability.
2. **2-Way Trade Escrow** — Two users swap goods of equal Fair Market Value with $0 cash. A pre-authorization hold for 100% of FMV is placed on both parties and voided once both receive and accept.

   **Trade fulfilment reaches INSPECTION by two routes, one per method, and they converge deliberately.** A `DELIVERY` trade goes `COLLATERAL_LOCKED → BOTH_SHIPPED → IN_TRANSIT → BOTH_RECEIVED → INSPECTION`; an `IN_PERSON` trade goes `COLLATERAL_LOCKED → BOTH_HANDOVER_CONFIRMED → INSPECTION`. Confirming a face-to-face handover says "we met and swapped", NOT "I am satisfied", so it must never complete the trade: a trader who has just been robbed, coerced, or handed a convincing fake at a meeting point needs a remedy afterwards. This is the one place trade fulfilment deliberately differs from the Cash_Sale, whose in-person path completes on the second confirmation.

   `HANDOVER_FAILED` freezes a trade from `COLLATERAL_LOCKED` or `IN_TRANSIT` and captures **nothing**. It is not `CONDITION_DISPUTE`, which settles a $20 Friction_Tax against the other trader — a no-show has not been proven to be anyone's fault and a lost parcel is nobody's. Before it existed, an `IN_TRANSIT` trade had no exit at all: both traders' collateral sat until the authorisation lapsed, which removes the guarantee rather than resolving anything.

   **The trade inspection window is 72 hours, not the Cash_Sale's 7 days**, measured from the agreed meeting instant (`IN_PERSON`) or from the LATER carrier-confirmed delivery (`DELIVERY`), with a 24-hour floor so a late confirmation still leaves room to dispute. This is a consequence, not a tuning knob: collateral is an uncaptured authorisation that lapses about 7 days after it was PLACED, and a trade's clock starts at collateral rather than at delivery, so postage both ways plus 7 days of inspection would routinely outlive the thing backing it. A carrier-confirmed delivery is the only thing that starts the clock; a trader's own word records receipt but never starts a clock that can end in a payout against them.

   A posted trade has a **postal address of record for each trader** in `trade_delivery_details` — two rows, because a swap posts in both directions — readable by the other trader only from `COLLATERAL_LOCKED`. It is deliberately not on `trades`, which is Realtime-published. Traders used to exchange addresses in the chat thread.

   **RESOLVED: verified traders are no longer bond-exempt.** The Identity_Gate and the Bond Policy used to cancel each other out. Entering trade escrow gates BOTH parties on the Identity_Gate (because a fraud finding can pay either side), and satisfying that Gate is exactly what `resolveTradeBonds` called "verified" — so every trade that could legally start posted **zero collateral**, `bondsRequired === 0`, and no `pre_auth_holds` row was ever written. A Condition_Dispute had no $20 to partial-capture and an Objective_Fraud finding paid the victim nothing: both branches of the state machine were unreachable in production.

   `resolveTradeBonds` now bonds both traders regardless of verification. The exemption's justification had expired — it existed because the previous provider's holds were charge-and-refund, so a bond took real money and cost real fees. A Stripe authorisation moves no funds and costs nothing to void, so the exemption was buying off a cost that no longer exists while disabling the safety machinery. `requiredBondCents` KEEPS the exemption, because its other caller is the Cash_Sale seller bond, where the Buyer's money is already collected and a verified Seller has nothing left to guarantee.

   Two consequences to hold in mind. A saved card is now a hard prerequisite for trade escrow, where a verified trader previously needed none — `acceptTradeTerms` surfaces that as an actionable message rather than a generic failure. And the default policy is still 100% of FMV with `ceilingCents: null`, so a high-value swap asks for an authorisation most cards will decline; `BondPolicy.ceilingCents` is the knob for that and is covered by a test.

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
