# Product

CardTrade is a safety-first, peer-to-peer clearinghouse and marketplace for collectibles (trading cards, coins, stamps, comics, memorabilia). Its differentiator is a trustless escrow engine built to run on Stripe.

## Transaction models

1. **Cash Sale** — Buyer pays, the platform holds the funds, and the Seller is paid their net once the Buyer accepts the goods. The platform fee is **5% of the agreed item price** (`PLATFORM_FEE_BPS = 500`), charged on the item price only — shipping is a pass-through to the carrier, not revenue.

   **Do not describe the fee as flat.** It is percentage-based in code, and no Australian rail Stripe offers makes a flat fee viable: cards cost 1.7% + $0.30 and PayTo costs 1% + $0.30, both percentages. Card is the current rail; PayTo is the intended addition, worth 0.7 points and a materially better chargeback profile, with card retained as a fallback because PayTo needs the payer's bank to have enabled it. BECS is rejected outright — its dispute window is 7 years, "no questions asked", and unappealable, which is untenable for a platform that is merchant of record and owns loss liability.

2. **2-Way Trade Escrow** — Two users swap goods of equal Fair Market Value with $0 cash. A pre-authorization hold for 100% of FMV is placed on both parties and voided once both receive and accept. The platform fee is 5% of FMV, charged symmetrically to both traders (`domain/trade/tradeFee.ts`).

   **Trade negotiation** follows `PROPOSED → NEGOTIATING → ACCEPTED`. Either party can counter-offer until terms are agreed: items, fulfilment method (delivery or in-person), meeting place/time, and shipping cost. The negotiation panel (`components/trade/TradeNegotiationPanel.tsx`) and server actions (`lib/actions/tradeNegotiation.ts`) handle this flow.

   **Trade fulfilment reaches INSPECTION by two routes, one per method, and they converge deliberately.** A `DELIVERY` trade goes `COLLATERAL_LOCKED --BOTH_SHIPPED--> IN_TRANSIT --BOTH_RECEIVED--> INSPECTION`; an `IN_PERSON` trade goes `COLLATERAL_LOCKED --BOTH_HANDOVER_CONFIRMED--> INSPECTION` in one step. The capitalised names on the arrows are events, not intermediate states. Confirming a face-to-face handover says "we met and swapped", NOT "I am satisfied", so it must never complete the trade: a trader who has just been robbed, coerced, or handed a convincing fake at a meeting point needs a remedy afterwards. This is the one place trade fulfilment deliberately differs from the Cash_Sale, whose in-person path completes on the second confirmation.

   `HANDOVER_FAILED` freezes a trade from `COLLATERAL_LOCKED` or `IN_TRANSIT` and captures **nothing**. It is not `CONDITION_DISPUTE`, which settles a $20 Friction_Tax against the other trader — a no-show has not been proven to be anyone's fault and a lost parcel is nobody's. Before it existed, an `IN_TRANSIT` trade had no exit at all: both traders' collateral sat until the authorisation lapsed, which removes the guarantee rather than resolving anything.

   **The trade inspection window is 72 hours, not the Cash_Sale's 7 days**, measured from the agreed meeting instant (`IN_PERSON`) or from the LATER carrier-confirmed delivery (`DELIVERY`), with a 24-hour floor so a late confirmation still leaves room to dispute. This is a consequence, not a tuning knob: collateral is an uncaptured authorisation that lapses about 7 days after it was PLACED, and a trade's clock starts at collateral rather than at delivery, so postage both ways plus 7 days of inspection would routinely outlive the thing backing it. A carrier-confirmed delivery is the only thing that starts the clock; a trader's own word records receipt but never starts a clock that can end in a payout against them.

   A posted trade has a **postal address of record for each trader** in `trade_delivery_details` — two rows, because a swap posts in both directions — readable by the other trader only from `COLLATERAL_LOCKED`. It is deliberately not on `trades`, which is Realtime-published.

   **Verified traders are NOT bond-exempt.** Entering trade escrow gates BOTH parties on the Identity_Gate (because a fraud finding can pay either side). `resolveTradeBonds` bonds both traders regardless of verification. A Stripe authorisation moves no funds and costs nothing to void, so there is no justification for exempting verified traders from collateral — doing so would disable the safety machinery. `requiredBondCents` KEEPS the exemption only for Cash_Sale seller bonds, where the Buyer's money is already collected and a verified Seller has nothing left to guarantee.

   A saved card is a hard prerequisite for trade escrow — `acceptTradeTerms` surfaces that as an actionable message rather than a generic failure. The default policy is 100% of FMV with `ceilingCents: null`, so a high-value swap asks for an authorisation most cards will decline; `BondPolicy.ceilingCents` is the knob for that and is covered by a test.

   **Trade collateral is NOT the same thing as Cash_Sale proceeds.** Trade collateral is an *uncaptured card authorisation*: no money moves, and none of it enters the platform balance — the platform holds a claim, not funds. Cash_Sale proceeds are genuinely *collected* into the platform balance. Custody reconciliation counts the second and excludes the first (`domain/payouts/custodyReconciliation.ts`); counting collateral would invent a shortfall on every open trade. Member-facing copy calls it **trade collateral** and always explains that it is a temporary card hold — never "escrow", which would imply the platform holds money it does not.

3. **Dispute & Fraud Resolution** — A state machine handling condition disputes (a fixed $20 partial capture "friction tax") and objective fraud (full capture of collateral, paid out to the victim). A staff-confirmed Objective_Fraud finding permanently bans the responsible account. There is deliberately **no identity dossier**: the "Police Evidence Pack" was withdrawn because the platform has no basis to hand a person's identity documents to a private individual on the strength of an in-app fraud determination.

## Current phase

The platform is a **functional MVP** with both transaction models fully implemented end-to-end:

- Registration, identity verification (Stripe Connect onboarding), listings, cash sale, the complete trade escrow lifecycle, dispute/fraud flows, and real-time contract views are all built and working.
- The payment seam supports both `MockService` (deterministic simulation for local dev) and real Stripe (`sk_test_` keys for integration testing, `sk_live_` for production). Provider is selected by `PAYMENTS_PROVIDER` env var.
- Webhook pipeline handles both mock and real Stripe deliveries with signature verification.
- Vercel cron jobs run the cash-sale payout sweep and trade-inspection timeout hourly.

## Domain vocabulary

Use these terms consistently in code and docs: Profile, Identity_Gate, Item, Fair_Market_Value, Cash_Sale, Trade, Trade_State, Trade_Event, Pre_Auth_Hold, Hold_Void, Partial_Capture, Full_Capture, Friction_Tax, Verified_Identity, Identity_Disclosure, Commitment_Point, Webhook_Event, Trade_Collateral.

**Trade_State and Trade_Event are different sets — do not merge them.** This document previously listed one flat union containing both, which reads as a state list and is not one.

- **Trade_State** (9 values, `domain/state-machine/types.ts`, and byte-for-byte the `cardtrade.trade_state` enum): `NEGOTIATING | COLLATERAL_PENDING | COLLATERAL_LOCKED | IN_TRANSIT | INSPECTION | COMPLETED | DISPUTED | FRAUD_RESOLVED | CANCELLED`. `COMPLETED`, `FRAUD_RESOLVED` and `CANCELLED` are terminal.
- **Trade_Event** — what drives a transition. `BOTH_SHIPPED`, `BOTH_RECEIVED`, `BOTH_HANDOVER_CONFIRMED` and `HANDOVER_FAILED` are events, not states: `BOTH_SHIPPED` takes `COLLATERAL_LOCKED → IN_TRANSIT`, `BOTH_RECEIVED` takes `IN_TRANSIT → INSPECTION`, `BOTH_HANDOVER_CONFIRMED` takes `COLLATERAL_LOCKED → INSPECTION` directly, and `HANDOVER_FAILED` takes either of those to `DISPUTED`. `PROPOSED` and `ACCEPTED` are not states either — a Trade row is created at the first offer and lives in `NEGOTIATING` until `TERMS_AGREED`.

`TRANSITIONS` in `domain/state-machine/machine.ts` is the source of truth; read it rather than this summary when the distinction matters.

`Police_Evidence_Pack` is **retired vocabulary** — do not reintroduce it. `KYC_Status` is retired too: there was never an enforced gate behind it, and the flow that wrote it has been removed. `Deal` is retired: the private deal feature has been removed entirely (migration 0055). `DittoBond` is retired member-facing terminology: say **trade collateral** and explain it as a **temporary card hold**. Internal `bondPolicy` / `requiredBondCents` names remain implementation vocabulary.

**Verification is the Identity_Gate, and the Identity_Gate is Connect onboarding actually finished.** `merchant_status = APPROVED` **and** `merchant_settlements_enabled` — both conjuncts, always. That unlocks listing, selling, and entering trade escrow. Evaluate it only through `satisfiesIdentityGate` / `verificationState` in `domain/identity/identityGate.ts`; the SQL equivalent is `public_profiles.is_verified`, and its denormalised form is `items.seller_identity_verified`. All three expressions are pinned against each other by the denormalisation-agreement property in `tests/property/identityGate.test.ts` (Req 21.6).

**`merchant_settlements_enabled` is the gate, not a footnote to it.** It is written only from `stripe_transfers.status === 'active'`, which is the provider's own statement that the flow it hosts completed. Payout code still calls `canReceiveFunds` before moving money, because a transfer additionally needs a `merchant_ref` — that is a mechanical precondition, not a second opinion about identity.

**Do not reintroduce the 0060 shortcut.** Migration 0060 briefly made the mere CREATION of a Connect recipient account the verification milestone, and 0061 reversed it. Creating that account is one server call that fires before the member has typed anything into Stripe's pages, so under 0060 a member was badged verified, could publish listings, could enter trade escrow, and could front a cash sale as a disclosed payee having completed no onboarding at all — and the payouts card read "Verified Account" beside "Payouts incomplete" because both were true of the same row. 0060 named its own exit condition as Stripe granting Connect Additional Document Verification; it was withdrawn early because the policy was wrong on its own terms, not because that condition arrived. If account creation ever needs to unlock something by itself, give that thing its own predicate rather than widening this one.

**Accepted assurance limit, still recorded.** Satisfying the gate means Stripe enabled transfers. It does **not** prove a government document or selfie was checked — Connect can defer document collection — and `merchant_legal_entity_name` may still hold the member's stated name until Stripe returns a provider-reported one, because a seller with no name on file cannot be disclosed and therefore cannot sell at all (see `sellerIdentityDisclosure`). Never describe this state as ID- or document-verified. When Stripe grants Connect Additional Document Verification, add its accepted document status on top of transfers active.

**There is exactly ONE of each of those columns, and exactly one TypeScript field.** Migration 0049 removed `public_profiles.identity_verified` and `items.seller_verified`, which were byte-identical duplicates maintained by their own triggers, along with the `identityVerified` / `creatorIdentityVerified` fields that read them. Do not reintroduce a second column, field, or badge for this fact: two answers to one question is what broke buying once already.

The gate is scoped by whether a role can RECEIVE money. Publishing a listing, selling for cash, and entering trade escrow all require it. A cash Buyer does **not**: a Buyer is only ever refunded to their original card, so demanding payout onboarding of them would be friction with no purpose. A buy-only Member therefore holds no verified identity, and sellers see their display name and trading history instead of a legal name — a deliberate, recorded trade-off.

The only identity the platform holds is the provider-verified legal name Connect reports (`merchant_legal_entity_name`), written monotonically so a later provider report cannot blank a name already disclosed. Never describe a verified Member as having passed a document or selfie check: Connect verifies a payout recipient but can defer document collection, so that wording would overstate the assurance.

Currency is AUD and is always represented as **integer cents** end-to-end (e.g. `fmvCents`, `fmv_cents`, `cash_amount_cents`). Never use floats for money.

Code comments reference requirement numbers (e.g. `Req 3.2`); keep that practice when adding behavior tied to a requirement.
