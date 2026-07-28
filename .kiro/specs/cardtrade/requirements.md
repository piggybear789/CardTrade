# Requirements Document

## Introduction

CardTrade is a safety-first, peer-to-peer (P2P) clearinghouse and marketplace for collectibles such as trading cards, coins, stamps, comics, and memorabilia. CardTrade replaces scam-prone marketplaces with a trustless escrow engine designed to run on Pinch Payments.

**Hackathon MVP scope — frontend-first.** This document specifies a hackathon Minimum Viable Product that is FRONTEND-FIRST. The full user experience is built out in the user interface: registration, the KYC flow, collectible item listings, the cash sale flow, the complete 2-way trade escrow lifecycle, the dispute and fraud flows, and the real-time trade contract view. For this phase, all payment, KYC, and webhook operations are handled by DUMMY / MOCK backend actions — a simulated service layer (the Mock_Service) that returns deterministic results — rather than live Pinch Payments API calls. The real Pinch Payments backend (Payers, Pre-Auths, Captures, Voids, and Webhooks) and live Pinch Glassbox KYC are the target integrations for a later phase and are not called in this MVP.

The platform supports three core transaction models, each demonstrated end-to-end in the UI against the Mock_Service:

1. **Cash Sales** — Direct bank-to-bank transfers (in production, via Pinch BECS Direct Debit / PayTo) at a flat platform fee, bypassing percentage-based merchant fees. In this MVP the transfer is simulated by the Mock_Service.
2. **2-Way Trade Escrow** — Users swap equal-value goods with $0 cash. Collateral is posted as a Bond, sized by identity: a KYC-verified trader posts nothing, while an unverified trader posts a 100% Fair Market Value credit pre-authorization hold (simulated by the Mock_Service in this MVP). Holds are voided when both parties receive and accept their items.
3. **Dispute & Fraud Resolution** — A state machine that handles condition disputes (partial capture / friction tax) and objective fraud (full capture of collateral, plus generation of a Police Evidence Pack from verified identity data). In this MVP the captures, voids, and identity data are produced by the Mock_Service.

The MVP is realized with a Next.js App Router frontend and a Supabase backend (PostgreSQL, Auth, Storage, Realtime). Payment, KYC, and webhook behavior is provided by the Mock_Service, a simulated service layer that mimics the Pinch Payments REST API (v2020.1) and Pinch Glassbox KYC deterministically so that state transitions can be triggered from the UI without real payment processing. The real Pinch_Service and KYC_Service integrations remain the target for a later phase.

This requirements document focuses on the core framework as a frontend-first MVP: user profiles and the KYC flow, collectible item listings, cash sales, the 2-way trade escrow lifecycle, the dispute and fraud state machine, and webhook-driven state transitions — all backed by the Mock_Service. The real-time listing and trade user interface (see Requirement 11 and the listing and trade flows) is the primary deliverable for the hackathon.

## Glossary

- **CardTrade_System**: The overall platform, comprising the frontend, backend, and payment integration.
- **Mock_Service**: A stand-in simulated service layer (also referred to as the Simulated_Backend) that deterministically mimics the responses of the Pinch_Service and the KYC_Service for demo purposes during the hackathon MVP. The Mock_Service allows Trade_State transitions, hold placement, capture, void, KYC verification, and webhook events to be triggered from the UI without real payment processing. For the MVP, every requirement in this document that names the Pinch_Service or the KYC_Service is satisfied by the Mock_Service producing simulated results. The Mock_Service maps directly to the real Pinch_Service and KYC_Service integrations planned for a later phase.
- **User**: A registered account holder who can buy, sell, or trade goods.
- **Buyer**: A User purchasing an Item in a Cash Sale.
- **Seller**: A User listing an Item for a Cash Sale.
- **Trader**: A User participating in a 2-Way Trade as either the initiator or the counterpart.
- **Counterpart**: The other Trader in a 2-Way Trade relative to a given Trader.
- **Profile**: A persisted record of a User's account data, including display name, contact details, and KYC status.
- **KYC_Service**: The identity verification capability provided by Pinch Glassbox KYC, which performs all Know Your Customer (KYC) checks and supplies verified identity data to the CardTrade_System. For the hackathon MVP, the KYC_Service is realized by the Mock_Service, which returns simulated verification results and simulated verified identity data; the real Pinch Glassbox KYC integration is the target for a later phase.
- **KYC_Status**: The verification state of a Profile, one of UNVERIFIED, PENDING, VERIFIED, or REJECTED.
- **Item**: A listing record describing a collectible (such as a trading card, coin, stamp, comic, or piece of memorabilia), including title, description, category, Fair Market Value, condition, images, and availability status.
- **Fair_Market_Value**: The declared monetary value of an Item, denominated in Australian dollars (AUD), used to size collateral holds.
- **Cash_Sale**: A transaction where a Buyer pays a Seller for an Item via bank transfer plus a flat platform fee.
- **Trade**: A 2-Way Trade record pairing two Items of equal Fair_Market_Value between two Traders.
- **Trade_State**: The lifecycle state of a Trade, one of COLLATERAL_PENDING, COLLATERAL_LOCKED, IN_TRANSIT, INSPECTION, COMPLETED, DISPUTED, or FRAUD_RESOLVED.
- **State_Machine**: The component that governs valid transitions between Trade_State values.
- **Pinch_Service**: The integration module that communicates with the Pinch Payments REST API. For the hackathon MVP, the Pinch_Service is realized by the Mock_Service, which returns simulated payer, pre-authorization, capture, and void results; the real Pinch Payments REST API integration is the target for a later phase.
- **Payer**: A Pinch Payments entity representing a User's payment instrument and identity.
- **Pre_Auth_Hold**: A credit pre-authorization hold placed on a Trader's payment instrument for that Trader's Bond.
- **Bond**: The collateral a Trader must post to enter a Trade, sized by the Bond_Policy. Trust is either identity or money: where both Traders' KYC_Status is VERIFIED, neither posts a Bond; where either Trader is not VERIFIED, both post 100% of their own paired Item's Fair_Market_Value, so no Trade ever leaves one side as the only party with money at risk.
- **Bond_Policy**: The rule that derives both Traders' Bonds from their KYC_Status values and their Items' Fair_Market_Value.
- **Hold_Void**: The release of a Pre_Auth_Hold at $0 cost.
- **Partial_Capture**: The capture of a fixed portion of a Pre_Auth_Hold.
- **Full_Capture**: The capture of the entire Pre_Auth_Hold amount.
- **Friction_Tax**: A fixed $20 Partial_Capture applied on a Condition Dispute, comprising $10 return shipping to the Counterpart and $10 platform fee.
- **Condition_Dispute**: A dispute where a received Item does not match its described condition.
- **Objective_Fraud**: A confirmed fraud event such as an empty box or a fake Item.
- **Police_Evidence_Pack**: An official PDF document generated on Objective_Fraud resolution, containing verified identity data supplied by the KYC_Service (Pinch Glassbox KYC).
- **Webhook_Event**: An HTTP notification reporting a payment lifecycle change. In production this is sent by Pinch Payments to the CardTrade_System; for the hackathon MVP, Webhook_Events are emitted by the Mock_Service and may be triggered manually from the UI or generated by the simulated backend.
- **Webhook_Handler**: The API route that receives, validates, and processes Webhook_Events.
- **Webhook_Log**: A persisted record of each received Webhook_Event and its processing outcome.
- **Platform_Fee**: A flat fee charged by the CardTrade_System per Cash_Sale.
- **RLS_Policy**: A PostgreSQL Row-Level Security policy restricting data access to authorized Users.

## Requirements

> **Hackathon MVP scope note:** For this phase, wherever an acceptance criterion names the Pinch_Service or the KYC_Service, that behavior is satisfied by the Mock_Service producing deterministic simulated results (simulated hold placement, simulated capture and void, simulated KYC verification, and simulated or UI-triggered Webhook_Events). The Trade_State names, transition logic, and all UI behavior remain intact and are fully testable against the Mock_Service. These payment, KYC, and webhook requirements are retained as written and map directly to the real Pinch Payments and Pinch Glassbox KYC integrations in a later phase.

### Requirement 1: User Registration and Profile Management

**User Story:** As a new user, I want to register and maintain a profile, so that I can participate in sales and trades under a verified identity.

#### Acceptance Criteria

1. WHEN a visitor submits registration credentials containing a syntactically valid email address (local-part@domain format) and a password between 8 and 128 characters, THE CardTrade_System SHALL create a User account and an associated Profile with KYC_Status set to UNVERIFIED and return a registration-success response.
2. IF a visitor submits registration credentials with an email address already associated with an existing User, THEN THE CardTrade_System SHALL reject the registration, create no new User account, and return a duplicate-account error message.
3. IF a visitor submits registration credentials with a missing or malformed email address or a password outside the 8 to 128 character range, THEN THE CardTrade_System SHALL reject the registration, create no new User account, and return a validation error message identifying the invalid field.
4. WHEN an authenticated User submits updated Profile fields in which each required field is non-empty and each text field is at most 255 characters, THE CardTrade_System SHALL persist the updated Profile fields and return a confirmation response.
5. IF an authenticated User submits updated Profile fields in which a required field is empty or a text field exceeds 255 characters, THEN THE CardTrade_System SHALL reject the update, retain the previously stored Profile values, and return a validation error message identifying the invalid field.
6. THE CardTrade_System SHALL restrict access to each Profile so that only the owning User can read and modify that Profile, and SHALL deny read and write requests targeting that Profile from any other User.
7. WHEN an unauthenticated visitor requests a protected resource, THE CardTrade_System SHALL deny access and return an authentication-required response.

### Requirement 2: Identity Verification (KYC)

**User Story:** As a user, I want to complete identity verification through the KYC flow, so that I can be trusted to place collateral and receive fraud protection.

> **MVP note:** In this phase the KYC_Service is the Mock_Service. Payer creation, verification success/failure, and verified identity data are simulated deterministically and may be triggered from the UI. The KYC flow UI (initiate, pending, verified, rejected states) is a primary MVP deliverable.

#### Acceptance Criteria

1. WHEN a User whose Profile KYC_Status is UNVERIFIED or REJECTED initiates identity verification, THE KYC_Service (Pinch Glassbox KYC) SHALL create a Payer record in Pinch Payments and set that Profile KYC_Status to PENDING.
2. WHEN the KYC_Service reports a successful verification for a Profile, THE CardTrade_System SHALL set that Profile KYC_Status to VERIFIED.
3. IF the KYC_Service reports a failed verification for a Profile, THEN THE CardTrade_System SHALL set that Profile KYC_Status to REJECTED and record the failure reason with that Profile for later review by the User.
4. WHILE a Profile KYC_Status is not VERIFIED, THE CardTrade_System SHALL allow that User to initiate a Trade only when that User has a Payer with a payment instrument against which the Bond required by Requirement 5.4 can be placed, and SHALL otherwise reject the request and return an error indicating that either identity verification or a payment method is required.
5. THE KYC_Service (Pinch Glassbox KYC) SHALL store verified identity data for use in generating a Police_Evidence_Pack.
6. IF the KYC_Service cannot create a Payer record when a User initiates identity verification, THEN THE CardTrade_System SHALL leave that Profile KYC_Status unchanged and return an error indicating that verification could not be started.
7. IF a User whose Profile KYC_Status is PENDING or VERIFIED initiates identity verification, THEN THE CardTrade_System SHALL reject the request and return an error indicating that verification is already in progress or already complete.

### Requirement 3: Item Listing Management

**User Story:** As a seller or trader, I want to list items with a declared value, so that others can buy or trade for them.

> **MVP note:** The item listing and catalog browsing UI is a primary hackathon deliverable. Persistence uses the Supabase backend directly; no payment or KYC calls are involved beyond the VERIFIED gate, which is satisfied by the Mock_Service.

#### Acceptance Criteria

1. WHEN a User submits an Item with a title of 1 to 120 characters, a description of 1 to 2000 characters, a category, a condition, a Fair_Market_Value between 0.01 and 999,999,999.99 AUD, and between 1 and 10 images, THE CardTrade_System SHALL create an Item with availability status set to AVAILABLE, regardless of that User's KYC_Status and regardless of whether they have a provider-approved Seller identity disclosure.
1a. WHILE a User's KYC_Status is not VERIFIED, THE CardTrade_System SHALL disclose before listing that verification is optional and that every transaction on their Items will hold collateral per Requirement 5.4 until they verify, and SHALL allow that User to decline verification and continue listing.
2. IF a User submits an Item with a Fair_Market_Value that is not between 0.01 and 999,999,999.99 AUD, THEN THE CardTrade_System SHALL reject the submission and return a validation error message.
3. IF a User submits an Item in which a required field (title, description, category, condition, Fair_Market_Value, or at least one image) is missing or outside its permitted range, THEN THE CardTrade_System SHALL reject the submission and return a validation error message identifying the invalid field.
4. WHEN the owning User updates an Item that has availability status AVAILABLE, THE CardTrade_System SHALL persist the updated Item fields.
5. IF the owning User attempts to update an Item whose availability status is not AVAILABLE, THEN THE CardTrade_System SHALL reject the update, preserve the existing Item fields, and return an error indicating the Item cannot be modified in its current status.
6. WHILE an Item is reserved for an active Cash_Sale or Trade, THE CardTrade_System SHALL set that Item availability status to RESERVED and prevent modification of that Item Fair_Market_Value.
7. IF a User who is not the owning User attempts to create, update, or delete an Item on behalf of another User, THEN THE CardTrade_System SHALL deny the operation and return an authorization error message.
8. WHEN any authenticated User requests the catalog of Items with availability status AVAILABLE, THE CardTrade_System SHALL return those Items.
9. WHILE the owning User has no provider-approved Seller identity disclosure, THE CardTrade_System SHALL keep that User's Items open to Trades and offers, SHALL NOT offer a Cash_Sale on them, and SHALL disclose on the Item and to the owning User that cash payment is unavailable until payout setup is approved, so that no Buyer is shown a Cash_Sale they cannot complete.

### Requirement 4: Bilateral Cash Sale Contracts

**User Story:** As a buyer or seller, I want to agree on fulfillment terms before payment and keep the payment protected until fulfillment is confirmed, so that neither party must act before the other party's commitment is secured.

> **MVP note:** In this phase the Pinch_Service is the Mock_Service. Agreement, payment, payment-protection, shipping, handover, inspection, cancellation, refund, and dispute transitions are simulated deterministically and may be triggered from the UI. `ESCROW_HELD` is CardTrade's internal name for a payment-protection lifecycle state; CardTrade SHALL NOT describe or represent Pinch payment protection as regulated escrow, a trust account, or a custodial escrow service.

#### Acceptance Criteria

1. WHEN an authenticated Buyer with a Payer/payment method explicitly confirms the current provider-approved legal identity of a Seller and selects Buy for an AVAILABLE Item, THE CardTrade_System SHALL atomically reserve the Item and create a Cash_Sale in AGREEMENT without requesting, transferring, capturing, or holding money; ordinary Buyers SHALL NOT be required to complete Managed Merchant onboarding or KYC merely to purchase.
2. IF a Buyer selects Buy for an Item whose availability status is not AVAILABLE, THEN THE CardTrade_System SHALL reject the request without creating a Cash_Sale or moving money; WHERE concurrent Buy requests target the same AVAILABLE Item, THE CardTrade_System SHALL accept at most one and reject the remainder as item unavailable.
3. WHILE a Cash_Sale is in AGREEMENT, THE Buyer and Seller SHALL negotiate a versioned term set whose fulfillment method is either SHIPPING or FACE_TO_FACE and whose current version contains the Item price, flat Platform_Fee, and the fulfillment details and costs required by the selected method.
4. WHEN either participant edits the current terms during AGREEMENT, THE CardTrade_System SHALL create the next monotonically increasing terms version and clear both participants' acceptance version and acceptance timestamp.
5. WHILE a Cash_Sale is in AGREEMENT, THE CardTrade_System SHALL allow each participant to accept only the current terms version and SHALL record that participant's accepted version and server-generated acceptance timestamp.
6. THE CardTrade_System SHALL begin payment only after the Buyer and Seller have accepted the same current terms version; it SHALL then transition the Cash_Sale to PAYMENT_PENDING and request one bank-to-bank payment for the Item price plus agreed shipping cost plus the flat Platform_Fee via BECS Direct Debit or PayTo.
7. WHILE a Cash_Sale remains in AGREEMENT and funding has not begun, either participant MAY cancel it at no cost; the CardTrade_System SHALL transition it to CANCELLED, move no money, and restore the Item to AVAILABLE. No later lifecycle state SHALL offer unilateral free cancellation after funding has begun.
8. IF the payment request fails before funds are secured, THEN THE CardTrade_System SHALL mark the Cash_Sale FAILED, restore the Item to AVAILABLE, preserve an audit event, and report the failure to both participants without representing any funds as protected.
9. WHEN the Pinch_Service confirms that the Buyer's funds are secured under the applicable payment-protection arrangement, THE CardTrade_System SHALL transition the Cash_Sale to ESCROW_HELD; `ESCROW_HELD` SHALL be treated and presented only as an internal payment-protection state and not as regulated escrow, a trust account, or custody by CardTrade.
10. THE CardTrade_System SHALL prevent the Seller from recording shipment, exposing a delivery address, or completing a face-to-face handover before the Cash_Sale reaches ESCROW_HELD.
11. FOR SHIPPING terms, THE Buyer SHALL provide a private delivery address and the participants SHALL agree on the shipping cost and shipping details in the same accepted terms version; the Buyer may always read that address, while the Seller may read it only from ESCROW_HELD onward, and no other end user may read it.
12. WHILE a SHIPPING Cash_Sale is ESCROW_HELD, THE Seller SHALL record the carrier and tracking number before or when recording shipment, after which the CardTrade_System SHALL timestamp shipment and transition the Cash_Sale to IN_TRANSIT.
13. WHILE a SHIPPING Cash_Sale is IN_TRANSIT, THE Buyer SHALL be able to record receipt exactly once; the CardTrade_System SHALL timestamp receipt, begin inspection, and transition the Cash_Sale to INSPECTION. Recording receipt SHALL NOT by itself set the carrier tracking state to delivered.
13a. WHEN the Shipping_Provider confirms delivery of a SHIPPING Cash_Sale, THE CardTrade_System SHALL record the provider-confirmed delivery instant, transition an IN_TRANSIT Cash_Sale to INSPECTION, and set an inspection deadline 7 days after that instant.
13b. THE CardTrade_System SHALL derive the inspection deadline only from a Shipping_Provider delivery confirmation, and SHALL NOT derive it from the Seller's own assertion that the Item was delivered.
14. WHILE a SHIPPING Cash_Sale is in INSPECTION, WHEN the Buyer accepts the Item, THE CardTrade_System SHALL timestamp acceptance, release settlement to the provider-approved Seller, transition the Cash_Sale to COMPLETED, and set the Item to SOLD.
14a. WHEN the inspection deadline of a Cash_Sale still in INSPECTION passes, THE CardTrade_System SHALL transition that Cash_Sale to COMPLETED, set the Item to SOLD, mark the completion as automatic, and record an audit event, so that an inactive Buyer cannot strand the Seller's funds indefinitely.
14b. THE CardTrade_System SHALL NOT auto-complete a Cash_Sale in DISPUTED, and raising a dispute before the inspection deadline SHALL stop automatic completion.
15. FOR FACE_TO_FACE terms, the participants SHALL agree on a meeting place and time in the same accepted terms version, and after funds are secured each participant SHALL independently confirm completion of the handover.
16. WHEN both participants have confirmed a FACE_TO_FACE handover for the same funded Cash_Sale, THE CardTrade_System SHALL transition the Cash_Sale to COMPLETED, release settlement to the provider-approved Seller, and set the Item to SOLD; one participant's confirmation alone SHALL NOT complete the sale or release funds.
17. WHEN either participant raises a dispute after funds are secured and before settlement release, THE CardTrade_System SHALL transition the Cash_Sale to DISPUTED, record the actor, reason, and timestamp, and preserve the protected funds until the dispute is resolved by refund or settlement; it SHALL NOT automatically release funds because a delivery or handover event was recorded.
18. THE CardTrade_System SHALL charge one flat Platform_Fee per Cash_Sale, fixed independently of Item price, and SHALL represent Item price, shipping cost, Platform_Fee, payment total, refund, and settlement amounts exclusively as integer AUD cents.
19. BEFORE payment begins, THE CardTrade_System SHALL show the Buyer the provider-approved Seller legal entity name, optional trading name, ABN/ACN or equivalent registration number, and approval date, and SHALL require explicit confirmation that this is the intended Seller.
20. THE CardTrade_System SHALL source Seller disclosure only from provider-controlled merchant fields and SHALL NOT disclose contact details, date of birth, residential address, bank details, payment credentials, identity-document data, or compliance notes.
21. WHEN the Buyer confirms Seller identity, THE CardTrade_System SHALL persist an immutable snapshot of the displayed identity, its opaque version, the Buyer identifier, and a server-generated confirmation timestamp on the Cash_Sale; IF that identity is absent, unapproved, changed before payment, or unconfirmed, THEN payment SHALL NOT begin.
22. WHEN the Seller has the provider-approved merchant identity required by criteria 19-21, THE CardTrade_System SHALL NOT require separate Cash_Sale collateral; Seller protection SHALL instead require secured Buyer funds before shipment or handover. This criterion does not alter the symmetric Bond policy for 2-Way Trades.
23. WHEN a Buyer makes an offer that may later open a Cash_Sale, THE CardTrade_System SHALL bind the same Seller identity acknowledgement to that offer and revalidate its opaque version before reserving the Item and again before beginning payment.

### Requirement 5: Two-Way Trade Initiation and Collateral

**User Story:** As a trader, I want to swap an equal-value item with another user using collateral holds instead of cash, so that neither party risks money in the exchange.

> **MVP note:** In this phase the Pinch_Service is the Mock_Service. Pre_Auth_Hold placement, confirmation, failure, and Hold_Void are simulated deterministically and may be triggered from the UI. The COLLATERAL_PENDING and COLLATERAL_LOCKED states and their transitions remain intact and fully testable against the Mock_Service.

#### Acceptance Criteria

1. WHEN a Counterpart accepts a PENDING Trade_Proposal whose paired Items both have availability status AVAILABLE and whose Fair_Market_Value amounts are equal in AUD to the cent, THE CardTrade_System SHALL create a Trade with Trade_State set to COLLATERAL_PENDING and set both paired Items availability status to RESERVED.
2. THE CardTrade_System SHALL NOT require the two sides of a Trade to be equal in value, and SHALL NOT appraise goods; the Counterpart's acceptance of a Trade_Proposal is what agrees its valuation. WHERE the proposing Trader states a declared value for their side, THE CardTrade_System SHALL record it, present it to the Counterpart before they decide, and SHALL NOT use it to size any Bond.
3. IF a Trader proposes a Trade pairing an Item whose availability status is not AVAILABLE, THEN THE CardTrade_System SHALL reject the proposal, return an item-unavailable error message, and leave both Items availability status unchanged.
4. WHEN a Trade enters Trade_State COLLATERAL_PENDING, THE Pinch_Service SHALL request a Pre_Auth_Hold for the Bond required of each Trader, where the Bond is $0.00 for both Traders when both Profiles' KYC_Status is VERIFIED and otherwise 100% of the Fair_Market_Value of the goods that Trader RECEIVES for BOTH Traders, and SHALL request no Pre_Auth_Hold for a Trader whose Bond is $0.00. Sizing on what is received, never on what a Trader declares their own side to be worth, is what prevents a Trader from reducing their own exposure by understating their goods.
4a. WHERE the payment provider offers no funds-reservation primitive, THE CardTrade_System MAY realise a Pre_Auth_Hold as a recorded authorisation to charge the Trader up to the Bond amount rather than as reserved funds; in that case it SHALL take no money unless a Partial_Capture or Full_Capture becomes due, SHALL disclose to the Trader that their instrument may be charged up to that amount, and SHALL treat a failed capture as a real outcome requiring resolution.
4b. WHERE a Trade includes a cash component, THE CardTrade_System SHALL require the receiving Trader to hold a provider-approved payout account before the offer may be made, SHALL permit the proposing Trader either to add cash or request cash from the Counterpart, SHALL record which participant pays, and SHALL settle the cash component from that recorded payer to the recorded receiver when the Trade completes.
5. WHEN the Pinch_Service confirms every requested Pre_Auth_Hold for a Trade is active within 300 seconds of the Trade entering COLLATERAL_PENDING, OR no Pre_Auth_Hold was required for that Trade, THE State_Machine SHALL transition the Trade from COLLATERAL_PENDING to COLLATERAL_LOCKED.
6. IF the Pinch_Service reports that either Pre_Auth_Hold has failed, OR both Pre_Auth_Holds are not confirmed active within 300 seconds of the Trade entering COLLATERAL_PENDING, THEN THE State_Machine SHALL cancel the Trade, request a Hold_Void for any active Pre_Auth_Hold associated with that Trade, and restore both paired Items availability status to AVAILABLE.
7. WHEN a Trader offers a Trade pairing an owned Item (or bundle of owned Items, plus optional cash per 5.4b) with availability status AVAILABLE against another Trader's publicly listed Item with availability status AVAILABLE, THE CardTrade_System SHALL create a Trade_Proposal with status PENDING, SHALL NOT create a Trade, SHALL NOT change either Item availability status, and SHALL NOT request any Pre_Auth_Hold. Per 5.2, the two sides need not be equal in value; KYC_Status VERIFIED is not a precondition for proposing.
8. THE CardTrade_System SHALL permit only the Counterpart to accept or decline a PENDING Trade_Proposal, and SHALL permit only the proposing Trader to withdraw it.
9. WHEN a Counterpart declines a PENDING Trade_Proposal, OR the proposing Trader withdraws it, THE CardTrade_System SHALL record the terminal Trade_Proposal status, create no Trade, move no money, and leave both Items availability status unchanged.
10. IF a Counterpart accepts a Trade_Proposal whose paired Items (or any bundled Item) are no longer all AVAILABLE, THEN THE CardTrade_System SHALL reject the acceptance, create no Trade, and return an item-unavailable error message. Per 5.2, a value mismatch is never a rejection reason — the Counterpart's acceptance is what agrees the exchange.
11. IF a Trader offers a Trade on an Item that is not publicly listed, THEN THE CardTrade_System SHALL reject the offer and create no Trade_Proposal.
12. WHEN a Trader offers an Item that they have not published to the catalog, THE CardTrade_System SHALL create that Item with availability status AVAILABLE and excluded from catalog search results and filter facets, SHALL keep it excluded permanently, and SHALL disclose to the Counterpart that the offered Item is not publicly listed.
13. THE CardTrade_System SHALL permit at most one PENDING Trade_Proposal per proposing Trader per targeted Item.

### Requirement 6: Two-Way Trade Shipping and Inspection Lifecycle

**User Story:** As a trader, I want the trade to progress through shipping and inspection, so that both parties confirm receipt before collateral is released.

#### Acceptance Criteria

1. WHILE a Trade is in Trade_State COLLATERAL_LOCKED, THE CardTrade_System SHALL allow each Trader to record shipment of that Trader's own side exactly once and store the shipment timestamp. Shipment, receipt, and acceptance are recorded PER SIDE, not per Item: a Trader sending several Items records one shipment covering all of them, and a Trader receiving several records one receipt once they hold the whole side. Per-Item tracking is deliberately not modelled, so a Trader who receives only part of a side must raise a Condition_Dispute rather than partially confirm.
2. WHEN both Traders have recorded shipment of their respective Items, THE State_Machine SHALL transition the Trade from COLLATERAL_LOCKED to IN_TRANSIT.
3. WHILE a Trade is in Trade_State IN_TRANSIT, THE CardTrade_System SHALL allow each Trader to record receipt of the Counterpart's whole side exactly once and store the receipt timestamp.
4. WHEN both Traders have recorded receipt of the Counterpart's Item, THE State_Machine SHALL transition the Trade from IN_TRANSIT to INSPECTION.
5. WHILE a Trade is in Trade_State INSPECTION, THE CardTrade_System SHALL allow each Trader to record acceptance of the Counterpart's Item exactly once and store the acceptance timestamp.
6. WHEN both Traders have recorded acceptance of the Counterpart's Item during Trade_State INSPECTION, THE State_Machine SHALL transition the Trade from INSPECTION to COMPLETED.
7. WHEN a Trade transitions to COMPLETED, THE Pinch_Service SHALL request a Hold_Void for each Pre_Auth_Hold associated with that Trade at $0 cost.
8. IF a Trader attempts to record shipment, receipt, or acceptance when the Trade is not in the Trade_State that permits that action, or when that Trader has already recorded that same action, THEN THE CardTrade_System SHALL reject the request, return an error message indicating the action is not permitted, and preserve all existing shipment, receipt, and acceptance records.

### Requirement 7: Condition Dispute Resolution

**User Story:** As a trader, I want to raise a condition dispute when an item does not match its description, so that I am compensated for return shipping without losing my full collateral.

> **MVP note:** In this phase the Pinch_Service is the Mock_Service. The Friction_Tax Partial_Capture, its settlement, and Hold_Void are simulated deterministically and may be triggered from the UI. The DISPUTED state and its transitions remain intact and fully testable against the Mock_Service.

#### Acceptance Criteria

1. WHEN a Trader who has recorded receipt of the Counterpart's Item raises a Condition_Dispute during Trade_State INSPECTION, THE State_Machine SHALL transition the Trade to DISPUTED and record the raising Trader and the disputed-against Trader, where the disputed-against Trader is the Counterpart of the raising Trader.
2. WHEN a Trade enters Trade_State DISPUTED due to a Condition_Dispute, THE Pinch_Service SHALL request a $20.00 Partial_Capture from the Pre_Auth_Hold of the disputed-against Trader as the Friction_Tax.
3. WHEN the Friction_Tax Partial_Capture settles, THE CardTrade_System SHALL allocate $10.00 to the Counterpart for return shipping and $10.00 to the Platform_Fee.
4. WHILE a Trade is in Trade_State DISPUTED for a Condition_Dispute and the disputed Item has not yet been recorded as returned, THE CardTrade_System SHALL keep the remaining Pre_Auth_Hold amount of the disputed-against Trader and the full Pre_Auth_Hold of the raising Trader locked.
5. WHEN the disputed Item is recorded as returned within 14 calendar days of the transition to DISPUTED, THE Pinch_Service SHALL request a Hold_Void for the remaining Pre_Auth_Hold amount of the disputed-against Trader and for the Pre_Auth_Hold of the raising Trader.
6. IF the Friction_Tax Partial_Capture fails to settle, THEN THE CardTrade_System SHALL retain the Trade in Trade_State DISPUTED, keep all Pre_Auth_Holds associated with that Trade locked, and record a Partial_Capture failure indication.
7. IF the disputed Item is not recorded as returned within 14 calendar days of the transition to DISPUTED, THEN THE CardTrade_System SHALL keep the remaining Pre_Auth_Hold amounts locked and record a return-overdue indication.

### Requirement 8: Objective Fraud Resolution

**User Story:** As a victim of fraud, I want the scammer's full collateral captured and an evidence pack generated, so that I am made whole and can pursue legal action.

> **MVP note:** In this phase the Pinch_Service and KYC_Service are the Mock_Service. Full_Capture, fund transfer, Hold_Void, and the verified identity data used for the Police_Evidence_Pack are simulated deterministically and may be triggered from the UI. The FRAUD_RESOLVED state and its transitions remain intact and fully testable against the Mock_Service.

#### Acceptance Criteria

1. WHEN a Trader reports Objective_Fraud while the Trade is in Trade_State INSPECTION or DISPUTED and the CardTrade_System confirms the fraud, THE State_Machine SHALL transition the Trade to FRAUD_RESOLVED.
2. WHEN a Trade enters Trade_State FRAUD_RESOLVED, THE Pinch_Service SHALL request a Full_Capture of 100% of the offending Trader's Pre_Auth_Hold within 10 seconds of the transition.
3. WHEN the Full_Capture settles, THE CardTrade_System SHALL transfer the captured funds to the victim Trader within 10 seconds of receiving the settlement confirmation.
4. WHEN a Trade enters Trade_State FRAUD_RESOLVED, THE CardTrade_System SHALL generate a Police_Evidence_Pack as a PDF using verified identity data from the KYC_Service within 60 seconds of the transition.
5. WHEN a Trade enters Trade_State FRAUD_RESOLVED, THE Pinch_Service SHALL request a Hold_Void for the victim Trader's Pre_Auth_Hold within 10 seconds of the transition.
6. IF the Pinch_Service reports that the Full_Capture has failed, THEN THE CardTrade_System SHALL retry the Full_Capture up to 3 times, and upon exhausting all retries SHALL preserve the offending Trader's Pre_Auth_Hold, flag the Trade for manual reconciliation, and return an error indication identifying the failed Full_Capture.
7. IF the KYC_Service does not return verified identity data for the offending Trader while generating the Police_Evidence_Pack, THEN THE CardTrade_System SHALL mark the Police_Evidence_Pack as incomplete and return an error indication identifying the missing identity data.

### Requirement 9: Trade State Machine Integrity

**User Story:** As the platform operator, I want trade state transitions to be strictly controlled, so that trades cannot enter invalid or inconsistent states.

#### Acceptance Criteria

1. THE State_Machine SHALL permit a Trade_State transition only when the transition is defined as valid from the current Trade_State.
2. IF a transition is requested that is not valid from the current Trade_State, THEN THE State_Machine SHALL reject the transition, preserve the current Trade_State unchanged, and return an error response to the requester indicating that the requested transition is invalid from the current Trade_State.
3. WHEN two or more transition requests target the same Trade before any of them has been committed, THE State_Machine SHALL commit exactly one transition (the first request to reach commit) and reject each remaining concurrent request while preserving the committed Trade_State.
4. IF a concurrent transition request is rejected under criterion 3, THEN THE State_Machine SHALL return an error response to the rejected requester indicating that the Trade_State was modified by another request.
5. WHEN the State_Machine commits a transition, THE CardTrade_System SHALL record the prior Trade_State, the new Trade_State, the identifier of the requesting Trader, and the transition timestamp.
6. WHEN a Trader who is one of the two participating Traders requests read access to a Trade, THE CardTrade_System SHALL grant read access to that Trade.
7. IF a requester who is not one of the two participating Traders requests read access to a Trade, THEN THE CardTrade_System SHALL deny the request and return an error response indicating that access to the Trade is not permitted.

### Requirement 10: Webhook-Driven State Transitions

**User Story:** As the platform, I want to process payment webhooks reliably, so that trade and sale states reflect payment events.

> **MVP note:** In this phase Webhook_Events are emitted by the Mock_Service and may be triggered manually from the UI or generated by the simulated backend. Authenticity verification, logging, idempotency, and State_Machine dispatch remain intact and fully testable against these simulated events. The Webhook_Handler contract maps directly to the real Pinch Payments webhooks in a later phase.

#### Acceptance Criteria

1. WHEN the Webhook_Handler receives a Webhook_Event, THE Webhook_Handler SHALL verify the authenticity of the Webhook_Event before applying any state change or persisting a Webhook_Log.
2. IF a received Webhook_Event fails authenticity verification, THEN THE Webhook_Handler SHALL reject the Webhook_Event, apply no Trade_State transition, and return an unauthorized response.
3. WHEN the Webhook_Handler accepts a Webhook_Event, THE CardTrade_System SHALL persist a Webhook_Log recording the Webhook_Event payload, the Webhook_Event identifier, and a processing outcome of success, failure, or no-op.
4. WHEN the Webhook_Handler processes a Webhook_Event that maps to a Trade_State transition, THE Webhook_Handler SHALL request that transition through the State_Machine and record the transition result in the Webhook_Log.
5. WHEN the Webhook_Handler receives a Webhook_Event whose event identifier matches a Webhook_Log with a successful outcome, THE Webhook_Handler SHALL acknowledge the Webhook_Event with a success response without repeating the associated state transition.
6. WHEN the Webhook_Handler successfully processes a Webhook_Event, THE Webhook_Handler SHALL return a success acknowledgment within 5 seconds of receiving the Webhook_Event.
7. WHEN the Webhook_Handler receives an authentic Webhook_Event that does not map to any known Trade_State transition or Cash_Sale update, THE Webhook_Handler SHALL record a no-op outcome in the Webhook_Log and acknowledge the Webhook_Event.
8. IF the State_Machine rejects a transition requested by the Webhook_Handler, THEN THE Webhook_Handler SHALL record a failure outcome in the Webhook_Log and preserve the current Trade_State.

### Requirement 11: Real-Time Trade Contract View

**User Story:** As a trader, I want a live view of the trade contract, so that I can see the current escrow status and take the appropriate action.

> **MVP note:** This real-time trade contract view is the primary hackathon deliverable. It reflects Trade_State and Pre_Auth_Hold status sourced from the Mock_Service, and it surfaces the UI controls that trigger simulated backend actions and state transitions.

#### Acceptance Criteria

1. WHEN a participating Trader opens a Trade, THE CardTrade_System SHALL display the current Trade_State and the current status of each Pre_Auth_Hold associated with that Trade.
2. WHEN the Trade_State changes or the status of any Pre_Auth_Hold associated with the Trade changes, THE CardTrade_System SHALL update the open Trade view for each participating Trader within 5 seconds without requiring a page reload.
3. WHERE the current Trade_State permits one or more Trader actions, THE CardTrade_System SHALL display each action available to that Trader for the current Trade_State.
4. IF the current Trade_State permits no action for a Trader, THEN THE CardTrade_System SHALL display the Trade view without action controls for that Trader.
5. IF the real-time connection for an open Trade view is lost, THEN THE CardTrade_System SHALL display a non-live status indicator to the participating Trader and attempt to re-establish the connection.
