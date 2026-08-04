# Requirements Document

## Introduction

This spec adds a member-facing **Payouts** surface to the CardTrade account area: one place where a signed-in member can see what money is owed to them, what has already been released, why a release failed, and which disputes or fraud resolutions are affecting money owed to or clawed back from them.

Today there is no such surface. `cash_sales.seller_payout_status`, `seller_payout_ref`, `seller_payout_due_at`, `seller_payout_attempts` and `seller_payout_error` are rendered **only** in the admin moderation console (`app/admin/page.tsx`, "Seller releases owed"). `app/sales/[id]/page.tsx` does not even select those columns, and `components/sales/CashSaleView.tsx` shows the buyer-side money rows (item price, shipping, Platform_Fee, buyer total) but never the Seller_Net. `app/profile/page.tsx#payouts` covers payout **setup** — connected-account onboarding state — and never shows money received. The most common real failure (`SELLER_NOT_PAYABLE`, because payout onboarding is unfinished) currently shows a Seller a COMPLETED sale, no money, and no explanation, and emits no notification at all.

So this is largely a **read-model and presentation gap, not a schema gap**. RLS policy `cash_sales_participant_select` already lets a Seller read their own payout columns on the cookie-bound client, and `cash_sale_events_participant_select` already lets a participant read the contract's persisted event log. Three genuine additions are required: a persisted event when a release is queued (so history can show progression rather than only terminal states), member-facing read access to `charge_disputes` (which is admin-only today), and notifications on release settle and failure.

The visual reference is a settings-level tab strip (Profile · Card · Payouts · Preferences) with a "Payouts dashboard" containing a balance card, a bank-account block, and a reverse-chronological transfer history where each entry is one state change of one transfer. The reference is followed for structure and narration, and deliberately **departed from** on the bank-account block for the privacy reason recorded below. The member additionally asked for "any arbitrations", which the reference does not have; disputes and fraud resolutions are treated here as a third first-class concern alongside balances and history.

### Second concern: consolidating verification onto Stripe Connect

Requirements 13 to 20 cover a second, coupled change: collapsing CardTrade's two verification signals into one gate owned by Stripe Connect. It is in this spec rather than its own because the dashboard's payability block, destination-account name, and seller badge all read from whichever signal wins, and shipping the dashboard against the losing one would guarantee rework.

Two findings from the codebase set the terms, and both correct assumptions recorded elsewhere in the repo.

**There is no enforced KYC gate today.** `.kiro/steering/product.md` and the authoritative cardtrade spec describe `kyc_status` as gating listing, offering, buying and trading. No such guard exists. A search for every comparison of a KYC status against `VERIFIED` across `domain/`, `lib/` and `app/` finds only the webhook that writes the outcome, the already-verified check inside `startIdentityVerification`, and the disclosure read in `getCounterpartyIdentity`. `BuyerRecord.kycStatus` is selected in `supabaseCashSaleRepository.ts`, passed into the cash sale orchestrator, and never compared to anything. What `kyc_status` actually drives is presentation: the public badge, the identity-verified catalog filter, the commitment-point disclosure, and the Bond_Policy input.

**The `/kyc` flow is a real Stripe Identity integration, not a placeholder.** With `STRIPE_KYC_MODE=identity` set, `createStripePaymentService` discards the mock delegate (`kycDelegate: config.kycMode === 'mock' ? kycDelegate : undefined`), and `startIdentityVerification` opens a genuine hosted VerificationSession through `beginIdentityCheck`, whose outcome arrives on real `identity.verification_session.*` webhooks. The header comment in `domain/services/index.ts` claiming KYC is "always the Mock delegate" is stale and must be corrected or removed. Retiring this flow is therefore a deliberate decision to stop using a working capability, not the removal of scaffolding, and Requirement 20 records the assurance that is given up.

The consolidation is worth making anyway because it converts a documented-but-absent gate into an enforced one, and because it closes a live silent failure: today a Seller can list and sell without a Connected_Account and only discovers at release time that `canReceiveFunds` fails, which is exactly the dead-end Requirement 6 exists to explain.

## Scope and product decisions

These decisions are settled here so the acceptance criteria below can be read literally rather than interpreted.

- **No "Available Now" and no withdraw action.** The reference labels its headline figure "Available Now", which implies a member-triggered cash-out. CardTrade has no per-member provider balance and no withdrawal endpoint: a Payout_Release is queued automatically on completion and drained by an hourly job. The headline figure is therefore labelled **Releasing now** and the Payouts_Dashboard exposes no withdraw, transfer-out, or pay-me-now control.
- **Upcoming means collected-but-not-yet-owed.** Funds are collected from the Buyer into the platform balance at agreement and released on completion. `Upcoming_Proceeds` covers Cash_Sales whose funds are already collected and whose completion has not yet occurred. Cash_Sales before collection (AGREEMENT, PAYMENT_PENDING) contribute to neither figure, because no money has moved and presenting them as pending income would be a forecast, not a balance.
- **Disputed money is neither releasing nor upcoming.** A Cash_Sale in DISPUTED is money at risk with an outcome still owed. It is excluded from both balance figures and reported in the Arbitration_Summary instead. This keeps the buckets a strict partition and removes the main double-count risk.
- **One identity gate, owned by Stripe Connect.** The Identity_Gate is Merchant_Status APPROVED together with Settlements_Enabled, and it is the only verification signal in the system. The payer gate (`kyc_status`, `/kyc`, `lib/actions/kyc.ts`, `components/kyc/`, the `KycService` half of the seam) is retired by Requirements 13 to 20. This dashboard reads payability and verified identity from Connect state alone (`merchant_status`, `merchant_settlements_enabled`, `merchant_legal_entity_name`) and renders no figure, badge, or gate derived from `kyc_status`.
- **Receiving money is what requires onboarding.** The Identity_Gate is scoped by whether a role can ever receive funds, so that onboarding is never demanded of someone with nothing to receive. Selling for cash requires it, because a Seller receives Seller_Net. Trade escrow requires it, because captured collateral on an Objective_Fraud is paid to `trades.fraud_victim_id` and either trader can be that party. A cash Buyer does not require it, because a Buyer is only ever refunded to their original card and no transfer is sent to them.
- **Buy-only members hold no verified identity, and that is accepted.** A Seller ships only after funds are collected into the platform balance, so carries no non-delivery exposure to an unidentified Buyer; the residual risk is chargeback, which the platform absorbs as merchant of record however well the Buyer is identified. The Seller sees a display name and trading history. This makes `components/identity/CounterpartyIdentity.tsx` one-directional for buy-only members, which its own header notes was the condition it was built to fix — a deliberate reversal, recorded here so it is not read as a regression.
- **No bank account digits, anywhere.** The reference shows a BSB and a masked account number. CardTrade cannot and will not: Stripe collects settlement-account details in its own hosted flow, CardTrade never receives or stores them, and `.kiro/steering/stripe-payments.md` forbids exposing bank details, merchant refs, contact details, address, date of birth, document numbers, and compliance notes. The Destination_Account_Summary therefore shows the member's **own** provider-verified legal name, the payout-capability state, and a route into the hosted flow — and no BSB, no account number, and no masked digits, even if a provider response happens to contain them.
- **Settlement timing belongs to the bank.** `stripe_transfers.status === 'active'` is the only signal that money can actually arrive, and a hosted-onboarding return does not prove payability. Once a release settles, arrival in the member's bank is the bank's timing, not CardTrade's, so the dashboard states a business-day range as a bank characteristic rather than promising a date.
- **This is not the admin console.** Nothing here shows another member's money, and no member-facing read accepts a member id from the client.
- **`Police_Evidence_Pack` stays retired.** No evidence-pack affordance, download, or wording appears on any arbitration surface (Req 8.4 of the authoritative spec).
- **List scoping follows the existing convention.** Where the Transfer_History or Arbitration_Summary needs an active/past split, it uses `partitionByScope` / `resolveScope` / `SectionFilter` (`components/layout/SectionFilter.tsx`) with a terminal-state predicate in `lib/lifecycle.ts`, rather than a new filtering mechanism.

## Glossary

- **CardTrade_System**: The overall platform — Next.js frontend, Supabase backend, and the payment provider seam.
- **Member**: An authenticated account holder viewing their own account area. Referred to as User elsewhere in the authoritative spec; "Member" is used here to keep the viewer distinct from a Buyer or Seller role on a specific contract.
- **Profile**: The persisted account record for a Member, including `merchant_status`, `merchant_settlements_enabled` and `merchant_legal_entity_name`.
- **Merchant_Status**: `profiles.merchant_status`, one of `NONE | PENDING | APPROVED | REJECTED`. Connect onboarding state.
- **Settlements_Enabled**: `profiles.merchant_settlements_enabled`, true only when the provider reports `stripe_transfers.status === 'active'`.
- **Identity_Gate**: Merchant_Status APPROVED together with Settlements_Enabled. The single verification and payability signal. APPROVED alone does not mean payable.
- **Connected_Account**: The Member's Stripe Connect account, created via `stripe.v2.core.accounts.create` under a `recipient` configuration requesting `stripe_balance.stripe_transfers`.
- **Verified_Identity**: The provider-verified legal name Stripe reports for a Connected_Account, derived from `identity.individual.given_name` + `surname` and persisted as `merchant_legal_entity_name`. Never a member-supplied value. The only identity CardTrade treats as verified.
- **Identity_Disclosure**: The counterparty-visible presentation of a Verified_Identity at a Commitment_Point.
- **Commitment_Point**: The moment two Members become bound to a specific transaction, at which Identity_Disclosure occurs.
- **Retired_Payer_Gate**: The removed verification path — the `kyc_status` and `kyc_reason` columns, the `identity_verified_name` / `identity_verified_first_name` / `identity_verified_at` / `identity_is_adult` / `identity_session_id` columns, the `/kyc` route, `lib/actions/kyc.ts`, `components/kyc/`, the `KycService` half of the seam, and `STRIPE_KYC_MODE`.
- **Public_Profile_View**: The `public_profiles` view, exposing a member-safe Profile subset including a verified flag.
- **Catalog_Identity_Filter**: The listing-search filter restricting results to identity-verified sellers, backed by the denormalised `items.seller_identity_verified` column.
- **Bond_Policy**: `requiredBondCents` in `domain/bond/bondPolicy.ts`, which relieves a verified Seller of posting collateral.
- **Cash_Sale**: A bilateral sale contract. Statuses: `AGREEMENT | PAYMENT_PENDING | ESCROW_HELD | IN_TRANSIT | HANDOVER | INSPECTION | COMPLETED | DISPUTED | CANCELLED | FAILED | REFUNDED`.
- **Platform_Fee**: 5% of the agreed item price (`PLATFORM_FEE_BPS = 500`), charged on the item price only. Shipping is a carrier pass-through, not revenue.
- **Seller_Net**: The amount owed to a Seller for one Cash_Sale, in integer AUD cents: `max(amount_cents - platform_fee_cents, 0)`.
- **Payout_Release**: The release leg of escrow for one Cash_Sale — the transfer of Seller_Net from the platform balance to the Seller's connected account.
- **Release_Status**: `cash_sales.seller_payout_status`, one of `NOT_DUE | PENDING | SETTLED | FAILED`.
- **Releasing_Now**: The total Seller_Net across the Member's Cash_Sales whose Release_Status is PENDING or FAILED. Money CardTrade owes the Member and has already queued for release.
- **Upcoming_Proceeds**: The total Seller_Net across the Member's Cash_Sales whose funds are collected and whose Release_Status is NOT_DUE, in statuses ESCROW_HELD, IN_TRANSIT, HANDOVER or INSPECTION.
- **At_Risk_Proceeds**: The total Seller_Net across the Member's Cash_Sales in status DISPUTED, plus the amount of any open Charge_Dispute attributable to the Member.
- **Balance_Summary**: The Releasing_Now and Upcoming_Proceeds figures presented together with their explanations.
- **Payouts_Dashboard**: The member-facing Payouts surface, comprising the Balance_Summary, the Destination_Account_Summary, the Transfer_History and the Arbitration_Summary.
- **Payout_Read_Model**: The server-side derivation that turns the Member's own Cash_Sale rows, contract events and dispute records into the data the Payouts_Dashboard renders. Derived on the server; never recomputed from partial data in the browser.
- **Destination_Account_Summary**: The display-safe description of where a release is sent: the Member's own provider-verified legal name, the payout-capability state, and a route into the provider-hosted flow.
- **Transfer_History**: The reverse-chronological list of Transfer_History_Entry records for the Member.
- **Transfer_History_Entry**: One persisted state change of one Payout_Release, rendered as a plain-language sentence with its timestamp. A single Payout_Release produces several entries as it progresses.
- **Payout_Release_Worker**: The hourly drain of the owed-release queue (`processDueCashSalePayouts`), which skips any Cash_Sale past `MAX_PAYOUT_ATTEMPTS` so a permanently broken release waits for an operator instead of consuming retries.
- **MAX_PAYOUT_ATTEMPTS**: The automatic-retry cap for a Payout_Release, currently 8.
- **Condition_Dispute**: A dispute that a received Item does not match its described condition. Resolved by a Friction_Tax.
- **Friction_Tax**: A fixed $20 Partial_Capture on a Condition_Dispute — $10 return shipping to the Counterpart and $10 platform fee.
- **Objective_Fraud**: A confirmed fraud event (empty box, fake Item). Resolved by a Full_Capture of collateral paid to the victim recorded in `trades.fraud_victim_id`.
- **Charge_Dispute**: A payer-initiated chargeback recorded in `charge_disputes`. The platform is merchant of record and absorbs the loss; `outcome = 'lost'` is the only outcome that means funds were absorbed, and `warning_closed` moved no money.
- **Arbitration_Record**: One member-safe entry in the Arbitration_Summary, derived from a disputed Cash_Sale, a disputed or fraud-resolved Trade, or a Charge_Dispute attributable to the Member.
- **Arbitration_Summary**: The member-facing list of Arbitration_Records with their money implications.
- **Notification_Service**: `createNotification` in `lib/notifications/createNotification.ts`. Server-only, best-effort, inserts via the service-role client because `notifications` has no member insert policy.
- **Payment_Service**: The provider seam (`PaymentService` / `KycService` from `domain/services/types.ts`). The only route to provider state.
- **Account_Tab_Strip**: The horizontal navigation across the account-area routes, with the current route marked.

## Requirements

### Requirement 1: A dedicated Payouts surface in the account area

**User Story:** As a member who sells, I want a Payouts tab of my own, so that I can see what I am owed and what I have been paid without opening individual sale contracts.

#### Acceptance Criteria

1. THE CardTrade_System SHALL serve the Payouts_Dashboard at a single addressable route within the account area.
2. THE CardTrade_System SHALL present an Account_Tab_Strip on every account-area route that links to the Payouts_Dashboard and marks the current route with `aria-current="page"`.
3. WHEN an unauthenticated visitor requests the Payouts_Dashboard route, THE CardTrade_System SHALL redirect that visitor to sign-in with the requested path preserved in a `redirectTo` parameter.
4. THE CardTrade_System SHALL list the Payouts_Dashboard route in both `PROTECTED_PREFIXES` and `config.matcher` in `middleware.ts`.
5. THE Payouts_Dashboard SHALL render the Balance_Summary, the Destination_Account_Summary, the Transfer_History and the Arbitration_Summary in that order.
6. THE Payouts_Dashboard SHALL render on the server from the Payout_Read_Model and SHALL be excluded from static prerendering.
7. THE Payouts_Dashboard SHALL provide a link from each money figure and each Transfer_History_Entry to the Cash_Sale contract the figure or entry derives from, WHERE that entry derives from a single Cash_Sale.
8. THE Payouts_Dashboard SHALL exclude any control that requests an immediate withdrawal, cash-out, or manual transfer of a balance.

### Requirement 2: Authorization and data boundaries

**User Story:** As a member, I want certainty that my payout figures are mine alone, so that I can trust the surface with my financial information.

#### Acceptance Criteria

1. THE Payout_Read_Model SHALL resolve the viewing Member from the server-side session and SHALL derive every figure from records where that Member is the Seller of the Cash_Sale, a participant in the Trade, or the attributed party of the Charge_Dispute.
2. THE Payout_Read_Model SHALL read Cash_Sale rows and contract events through the cookie-bound Supabase client so that `cash_sales_participant_select` and `cash_sale_events_participant_select` apply.
3. IF a request supplies a member identifier, a Cash_Sale identifier, or a dispute identifier as an input to a Payouts_Dashboard read, THEN THE CardTrade_System SHALL ignore the supplied identifier and scope the read to the session Member.
4. WHERE a Payouts_Dashboard read requires a provider-controlled `merchant_*` column that is not selectable by the `authenticated` role, THE CardTrade_System SHALL perform that read on the server filtered to the session Member's own Profile identifier and SHALL return only the fields named in Requirement 4.
5. THE CardTrade_System SHALL enforce Member scoping in both the row-level security policy and an explicit server-side owner guard for every Payouts_Dashboard read path.
6. THE Payouts_Dashboard SHALL exclude every counterparty identifier, provider transfer reference, provider dispute reference, merchant reference, provider error string, and compliance note from rendered output and from data passed to client components.
7. THE Payouts_Dashboard SHALL exclude the Buyer's delivery address, contact details, and any other Buyer-private contract field.

### Requirement 3: Balance summary

**User Story:** As a seller, I want to see what is being released to me now and what is still to come, so that I know how much money the platform is holding on my behalf and why.

#### Acceptance Criteria

1. THE Balance_Summary SHALL display Releasing_Now as the total Seller_Net across the Member's Cash_Sales whose Release_Status is PENDING or FAILED.
2. THE Balance_Summary SHALL display Upcoming_Proceeds as the total Seller_Net across the Member's Cash_Sales whose Release_Status is NOT_DUE and whose status is ESCROW_HELD, IN_TRANSIT, HANDOVER or INSPECTION.
3. THE Balance_Summary SHALL exclude Cash_Sales in status AGREEMENT and PAYMENT_PENDING from both Releasing_Now and Upcoming_Proceeds, and SHALL state that a figure counts only funds already collected from a Buyer.
4. THE Balance_Summary SHALL exclude Cash_Sales in status CANCELLED, FAILED and REFUNDED from both Releasing_Now and Upcoming_Proceeds.
5. THE Balance_Summary SHALL exclude Cash_Sales in status DISPUTED from both Releasing_Now and Upcoming_Proceeds and SHALL report the corresponding amount in the Arbitration_Summary as At_Risk_Proceeds.
6. THE Balance_Summary SHALL exclude every Cash_Sale whose Release_Status is SETTLED from both Releasing_Now and Upcoming_Proceeds.
7. THE Balance_Summary SHALL count each Cash_Sale in at most one of Releasing_Now, Upcoming_Proceeds and At_Risk_Proceeds.
8. THE Balance_Summary SHALL label the Releasing_Now figure as money being released rather than as a withdrawable balance, and SHALL state that release happens automatically without a Member action.
9. THE Balance_Summary SHALL explain Upcoming_Proceeds as proceeds that become releasable when the Buyer accepts the goods or the inspection window closes.
10. THE Balance_Summary SHALL display each figure net of the Platform_Fee and SHALL state that the Platform_Fee is 5% of the agreed item price and that shipping is passed through to the carrier.
11. WHERE the Member has at least one Cash_Sale contributing to Releasing_Now whose Release_Status is FAILED, THE Balance_Summary SHALL indicate that part of the figure is blocked and SHALL link to the explanation required by Requirement 6.

### Requirement 4: Destination account summary

**User Story:** As a seller, I want to know where my money is going and how to change it, so that I can be confident a release will reach me.

#### Acceptance Criteria

1. THE Destination_Account_Summary SHALL display the Member's own Verified_Identity as reported by the Payment_Service for their connected account, WHERE that name has been reported, and SHALL derive it from Connect state alone rather than from the retired payer-gate columns `identity_verified_name`, `identity_verified_first_name`, or `identity_verified_at`.
2. THE Destination_Account_Summary SHALL display a payout-capability state derived from `merchant_status` together with `merchant_settlements_enabled`, and SHALL treat APPROVED without settlements enabled as not yet payable.
3. THE Destination_Account_Summary SHALL provide an update action that requests a fresh provider-hosted onboarding link at the moment the action is taken.
4. IF the Payment_Service does not offer a hosted onboarding flow, THEN THE Destination_Account_Summary SHALL state that payout details are managed by the payment provider and SHALL omit the update action.
5. THE Destination_Account_Summary SHALL exclude bank-state branch numbers, account numbers, partial or masked account numbers, card numbers, date of birth, residential address, document numbers, merchant references, and provider compliance notes.
6. THE CardTrade_System SHALL exclude settlement-account fields from every validation schema, Server Action payload, component property, component state value, and database column introduced by this feature.
7. THE Destination_Account_Summary SHALL state that payout details are collected and held by the payment provider and that CardTrade does not receive them.
8. WHILE the Member's `merchant_settlements_enabled` value is false, THE Destination_Account_Summary SHALL state that releases cannot be sent yet and SHALL present completing payout setup as the next action.

### Requirement 5: Transfer history

**User Story:** As a seller, I want a dated history of every movement of my money, so that I can reconcile what arrived in my bank against what the platform says it sent.

#### Acceptance Criteria

1. THE Transfer_History SHALL derive every Transfer_History_Entry from persisted records — the Member's Cash_Sale payout columns and the contract event log — and SHALL NOT synthesise an entry from client-side state or from an assumed provider timeline.
2. THE Transfer_History SHALL order entries by their recorded timestamp, most recent first.
3. THE Transfer_History SHALL render each Transfer_History_Entry as a plain-language sentence naming the amount in AUD and the state change, with the entry timestamp displayed beneath the sentence.
4. THE Transfer_History SHALL render one entry per recorded state change, so that a single Payout_Release contributes several entries, and SHALL NOT collapse the state changes of one Payout_Release into a single entry.
5. WHEN a Payout_Release falls due for a Cash_Sale, THE CardTrade_System SHALL record a persisted queued event for that Cash_Sale carrying the Seller_Net amount.
6. WHEN a Payout_Release settles, THE CardTrade_System SHALL record a persisted settled event, and THE Transfer_History SHALL describe the entry as sent and state that arrival in a bank account can take up to four business days.
7. WHEN a Payout_Release fails, THE CardTrade_System SHALL record a persisted failed event, and THE Transfer_History SHALL describe the entry using the member-safe reason required by Requirement 6.
8. WHERE the Member received captured collateral as the victim of an Objective_Fraud resolution, THE Transfer_History SHALL include an entry for that payment.
9. THE Transfer_History SHALL exclude provider transfer references, provider dispute references, merchant references, retry counts, and raw provider error strings from every entry.
10. WHERE the Transfer_History exceeds the number of entries that can be rendered on one page, THE Payouts_Dashboard SHALL provide server-driven scoping using the existing `resolveScope` and `SectionFilter` convention rather than a new filtering mechanism.
11. THE Transfer_History SHALL describe a settled Payout_Release as sent rather than as owed, arrived, or received.

### Requirement 6: Release failure transparency

**User Story:** As a seller whose payout has not arrived, I want to know why and what to do about it, so that I can fix the cause myself instead of guessing or contacting support.

#### Acceptance Criteria

1. WHILE a Cash_Sale of the Member has Release_Status FAILED, THE Payouts_Dashboard SHALL display a member-safe reason for the failure together with the action that resolves the failure.
2. WHERE a Payout_Release failed because the Member cannot yet receive funds, THE Payouts_Dashboard SHALL state that payout setup is incomplete and SHALL link to the payout setup surface.
3. WHERE a Payout_Release failed for a reason other than the Member's payout setup, THE Payouts_Dashboard SHALL state that the payment provider rejected the release and that CardTrade is retrying it.
4. WHERE a Cash_Sale has reached MAX_PAYOUT_ATTEMPTS without settling, THE Payouts_Dashboard SHALL state that automatic retries have stopped and that a CardTrade operator is reviewing the release.
5. THE Payouts_Dashboard SHALL exclude the persisted `seller_payout_error` text, the provider error code, the retry count, and any compliance note from the member-safe reason.
6. WHILE a Cash_Sale of the Member has Release_Status FAILED, THE Balance_Summary SHALL continue to count that Cash_Sale's Seller_Net in Releasing_Now and SHALL NOT present the Cash_Sale as paid.
7. THE Payouts_Dashboard SHALL state that funds for a failed Payout_Release remain held by CardTrade on the Member's behalf and that the Member does not need to re-sell or re-invoice.
8. THE Payouts_Dashboard SHALL exclude any control that retries a Payout_Release, because retry is an operator action.

### Requirement 7: Arbitrations and money at risk

**User Story:** As a member involved in a dispute, I want the money consequences of that dispute in the same place as my payouts, so that I understand why an amount is missing, held, or reversed.

#### Acceptance Criteria

1. THE Arbitration_Summary SHALL include an Arbitration_Record for each Cash_Sale of the Member whose status is DISPUTED, stating the dispute reason recorded on the contract, which party raised the dispute, and that the proceeds are held pending the outcome.
2. THE Arbitration_Summary SHALL include an Arbitration_Record for each Trade of the Member whose state is DISPUTED or FRAUD_RESOLVED.
3. WHERE a Trade of the Member was resolved as a Condition_Dispute, THE Arbitration_Summary SHALL state that a Friction_Tax of $20 was captured, comprising $10 return shipping to the Counterpart and $10 platform fee.
4. WHERE a Trade of the Member was resolved as an Objective_Fraud and the Member is recorded as the fraud victim, THE Arbitration_Summary SHALL state that the counterparty's collateral was captured in full and paid to the Member.
5. WHERE a Trade of the Member was resolved as an Objective_Fraud and the Member is not recorded as the fraud victim, THE Arbitration_Summary SHALL state that the Member's collateral was captured in full.
6. THE Arbitration_Summary SHALL include an Arbitration_Record for each Charge_Dispute attributable to the Member, stating the disputed amount, the date the dispute opened, and whether the dispute is open or closed.
7. WHERE a Charge_Dispute attributable to the Member is closed with outcome `lost`, THE Arbitration_Summary SHALL state that the funds were reversed by the payer's bank.
8. WHERE a Charge_Dispute attributable to the Member is closed with outcome `warning_closed`, THE Arbitration_Summary SHALL state that no funds moved.
9. THE Arbitration_Summary SHALL report At_Risk_Proceeds as a total and SHALL state that an at-risk amount appears in neither Releasing_Now nor Upcoming_Proceeds.
10. THE Arbitration_Summary SHALL link each Arbitration_Record to the Cash_Sale, Trade or dispute conversation the record derives from, WHERE such a destination exists for the Member.
11. THE Arbitration_Summary SHALL exclude the provider's dispute reason string, the provider dispute reference, the provider status string, the evidence deadline, and any assessment of a payer's fraud risk.
12. THE Arbitration_Summary SHALL exclude any evidence-pack, identity-dossier, or document-download affordance, and SHALL exclude the retired term `Police_Evidence_Pack`.
13. THE Arbitration_Summary SHALL exclude the counterparty's date of birth, document details, address, and contact details.

### Requirement 8: Member-facing read access to charge disputes

**User Story:** As a member whose sale was charged back, I want to see that chargeback in my own account, so that a reversal is not invisible to me.

#### Acceptance Criteria

1. THE CardTrade_System SHALL grant an authenticated Member read access to the Charge_Dispute records attributable to that Member, where attribution is by `profile_id` equal to the Member, or by `cash_sale_id` referencing a Cash_Sale in which the Member is a participant, or by `trade_id` referencing a Trade in which the Member is a participant.
2. THE CardTrade_System SHALL restrict the member-readable projection of a Charge_Dispute to the disputed amount, the opened timestamp, the closed timestamp, and the outcome.
3. THE CardTrade_System SHALL withhold `dispute_ref`, `charge_ref`, `reason`, `status`, and `evidence_due_by` from every member-facing read of a Charge_Dispute.
4. THE CardTrade_System SHALL deny an authenticated Member read access to a Charge_Dispute that is not attributable to that Member.
5. THE CardTrade_System SHALL retain the existing admin read policy on `charge_disputes` unchanged.
6. THE CardTrade_System SHALL grant no member write access to `charge_disputes`, so that the webhook pipeline on the service-role client remains the only writer.
7. THE CardTrade_System SHALL introduce the member-facing access as a new sequential migration file in `supabase/migrations/` rather than by editing an applied migration.

### Requirement 9: Notifications on release settle and failure

**User Story:** As a seller, I want to be told when my money moves or fails to move, so that I do not have to check a dashboard to find out.

#### Acceptance Criteria

1. WHEN a Payout_Release for a Cash_Sale settles, THE CardTrade_System SHALL emit a notification to the Seller of that Cash_Sale stating the amount sent and linking to the Payouts_Dashboard.
2. WHEN a Payout_Release for a Cash_Sale transitions into Release_Status FAILED, THE CardTrade_System SHALL emit a notification to the Seller of that Cash_Sale stating the member-safe reason required by Requirement 6 and linking to the action that resolves the failure.
3. WHERE a Payout_Release attempt fails while the Cash_Sale Release_Status is already FAILED, THE CardTrade_System SHALL emit no additional notification for that attempt.
4. WHERE a Payout_Release is already SETTLED and a release is requested again, THE CardTrade_System SHALL emit no additional notification.
5. IF the Notification_Service fails to record a notification, THEN THE CardTrade_System SHALL complete the Payout_Release outcome and record the persisted event unchanged.
6. THE CardTrade_System SHALL exclude the provider transfer reference, the provider error string, the retry count, and the Buyer's identity from every payout notification.
7. THE CardTrade_System SHALL emit a payout notification only to the Seller of the Cash_Sale.

### Requirement 10: Empty and pre-onboarding states

**User Story:** As a member who has not sold anything yet, I want the Payouts tab to explain how being paid works, so that a page of zeroes does not read as an error.

#### Acceptance Criteria

1. WHERE the Member has no Cash_Sale in which they are the Seller, THE Payouts_Dashboard SHALL state that no sales have been made yet and SHALL explain that proceeds appear here once a Buyer pays.
2. WHERE the Member has no Cash_Sale in which they are the Seller, THE Payouts_Dashboard SHALL omit the zero-valued Balance_Summary figures.
3. WHERE the Member's `merchant_status` is NONE, THE Payouts_Dashboard SHALL state that payout setup has not been started and SHALL present starting payout setup as the primary action.
4. WHILE the Member's `merchant_status` is PENDING, THE Payouts_Dashboard SHALL state that payout approval is in progress and that any owed proceeds will be released automatically once approval arrives.
5. WHERE the Member's `merchant_status` is REJECTED, THE Payouts_Dashboard SHALL state that payout setup was not approved and SHALL present retrying payout setup as the primary action, without disclosing a provider compliance note.
6. WHERE the Member has Cash_Sales as Seller but no Transfer_History_Entry, THE Transfer_History SHALL state that no money has moved yet and SHALL explain when the first movement occurs.
7. WHERE the Member has no Arbitration_Record, THE Arbitration_Summary SHALL state that no disputes affect the Member's money.
8. IF the Payout_Read_Model cannot be loaded, THEN THE Payouts_Dashboard SHALL state that payout information is unavailable and SHALL offer a retry, and SHALL NOT render a zero balance.

### Requirement 11: Money representation and display integrity

**User Story:** As a member reconciling amounts, I want every figure to be exact and consistently formatted, so that the dashboard agrees with my bank statement.

#### Acceptance Criteria

1. THE Payout_Read_Model SHALL represent every monetary value as integer AUD cents.
2. THE CardTrade_System SHALL convert a monetary value from integer cents to a displayed string only in the shared formatting helpers in `lib/format.ts`.
3. THE Payout_Read_Model SHALL compute Seller_Net as `max(amount_cents - platform_fee_cents, 0)`.
4. THE Payout_Read_Model SHALL compute every total as the sum of its integer-cent components, so that a displayed total equals the sum of the displayed components it summarises.
5. THE Payouts_Dashboard SHALL display every monetary figure with the AUD currency label.
6. THE Payouts_Dashboard SHALL render timestamps in a form that identifies the calendar date of each Transfer_History_Entry.
7. THE Payouts_Dashboard SHALL remain keyboard reachable and screen-reader labelled, and SHALL keep every figure and action visible at 200% zoom without horizontal page scrolling.
8. THE Payouts_Dashboard SHALL provide an accessible name for the Upcoming_Proceeds explanation so that the explanation is available without a pointer hover.

### Requirement 12: Verifiable correctness properties

**User Story:** As a maintainer, I want the payout arithmetic pinned by property tests, so that a future change cannot quietly double-count, hide, or negate a member's money.

#### Acceptance Criteria

1. FOR ALL sets of Cash_Sale records where the Member is the Seller, THE Payout_Read_Model SHALL assign each Cash_Sale to at most one of Releasing_Now, Upcoming_Proceeds and At_Risk_Proceeds (partition property).
2. FOR ALL Cash_Sale records, THE Payout_Read_Model SHALL produce a Seller_Net greater than or equal to zero (non-negativity property).
3. FOR ALL Cash_Sale records, THE Payout_Read_Model SHALL produce a Seller_Net less than or equal to `amount_cents` (bounded-net property).
4. FOR ALL sets of Cash_Sale records, THE Payout_Read_Model SHALL produce a Releasing_Now total equal to the sum of the Seller_Net values of the Cash_Sales it presents as releasing (reconciliation property).
5. FOR ALL sets of Cash_Sale records, THE Payout_Read_Model SHALL exclude every Cash_Sale whose Release_Status is SETTLED from Releasing_Now (settled-is-never-owed property).
6. FOR ALL sets of Cash_Sale records, THE Payout_Read_Model SHALL produce Transfer_History_Entry records whose recorded timestamps are non-increasing in presentation order (ordering property).
7. FOR ALL sets of persisted payout events, THE Payout_Read_Model SHALL produce the same Transfer_History for the same input regardless of the order in which the events are supplied (order-independence property).
8. FOR ALL sets of Cash_Sale and Charge_Dispute records, THE Payout_Read_Model SHALL produce totals that are unchanged when the derivation is applied twice to the same input (idempotence property).
9. FOR ALL sets of records belonging to more than one Member, THE Payout_Read_Model SHALL produce figures for the session Member that are unchanged by the presence of another Member's records (isolation property).
10. FOR ALL Payout_Read_Model outputs, THE CardTrade_System SHALL produce no field containing a provider transfer reference, provider dispute reference, merchant reference, provider error string, or bank account number (redaction property).

### Requirement 13: A single identity gate

**User Story:** As a member, I want one consistent answer to whether someone is verified, so that a badge means the same thing on every surface.

#### Acceptance Criteria

1. THE CardTrade_System SHALL derive every verification state presented to any Member from the Identity_Gate alone.
2. THE CardTrade_System SHALL treat Merchant_Status APPROVED with Settlements_Enabled false as neither verified nor payable.
3. THE CardTrade_System SHALL present the same verification state for a given Member on every surface that presents one.
4. THE CardTrade_System SHALL contain no code path that reads `kyc_status` to decide a gate, a badge, a filter, or a disclosure.
5. THE CardTrade_System SHALL write Merchant_Status, Settlements_Enabled and Verified_Identity only from a provider report received through the Payment_Service.
6. THE CardTrade_System SHALL deny the `authenticated` role column `UPDATE` on every column backing the Identity_Gate.
7. THE CardTrade_System SHALL record the Identity_Gate as the single verification signal in `.kiro/steering/product.md` and `.kiro/steering/stripe-payments.md`, and SHALL correct the claim in `.kiro/steering/product.md` that KYC_Status gates listing, offering, buying and trading.

### Requirement 14: Enforced gating by role

**User Story:** As a seller, I want to be told I need payout setup before I sell, so that I do not discover at payout time that I cannot be paid.

#### Acceptance Criteria

1. THE CardTrade_System SHALL require the Identity_Gate to be satisfied before a Member may publish an Item for cash sale.
2. THE CardTrade_System SHALL require the Identity_Gate to be satisfied before a Member may enter a Trade escrow, so that a Member who could be owed fraud restitution can be paid it.
3. THE CardTrade_System SHALL require the Identity_Gate to be satisfied before a Member may create or join a private deal carrying a cash component.
4. THE CardTrade_System SHALL NOT require the Identity_Gate of a Member acting only as a cash Buyer.
5. THE CardTrade_System SHALL require a saved payment method before a cash Buyer may accept contract terms.
6. THE CardTrade_System SHALL enforce every gate in this requirement in the orchestrator as well as in the UI, so that a gate is not enforceable only by hiding a control.
7. WHERE a Member attempts an action the Identity_Gate blocks, THE CardTrade_System SHALL name the blocked action and SHALL link to payout setup as the resolving action.
8. THE CardTrade_System SHALL return a blocked action as a typed `ActionResult` failure rather than by throwing.
9. THE CardTrade_System SHALL preserve the existing behaviour that a Trade carries no cash component, so that satisfying the Identity_Gate for a Trade does not imply a transfer.
10. THE CardTrade_System SHALL leave an Item already published by a Member who does not satisfy the Identity_Gate visible and unchanged, so that introducing the gate does not silently delist existing inventory.

### Requirement 15: Retirement of the payer gate

**User Story:** As a maintainer, I want the retired verification path removed completely rather than left dormant, so that two competing definitions of verified cannot reappear.

#### Acceptance Criteria

1. THE CardTrade_System SHALL remove the `/kyc` route and its entries from both `PROTECTED_PREFIXES` and `config.matcher` in `middleware.ts`.
2. THE CardTrade_System SHALL remove the `/kyc` entry from `app/robots.ts`, and SHALL remove the route from `app/sitemap.ts` WHERE it appears there.
3. WHEN a request arrives for the removed `/kyc` path, THE CardTrade_System SHALL respond with its standard not-found handling.
4. THE CardTrade_System SHALL remove `lib/actions/kyc.ts` and `components/kyc/`, and SHALL remove every import of them.
5. THE CardTrade_System SHALL remove the Identity verification card and its link from `app/profile/page.tsx`, leaving payout setup as the only verification surface, and SHALL correct that file's header comment to match.
6. THE CardTrade_System SHALL remove the `KycService` interface, the `runVerification` contract, the `IdentityCheckSession` type and the hosted identity-check opener from `domain/services/types.ts`.
7. THE CardTrade_System SHALL remove `runVerification`, `beginIdentityCheck` and the `kycDelegate` option from `StripeService`, `MockService` and `InMemoryService` in the same change, so that no implementation of the seam retains a verification method.
8. THE CardTrade_System SHALL remove the `StripeKycMode` type, the `kycMode` configuration field and the `STRIPE_KYC_MODE` environment variable, including from `.env.local.example` and the steering documents.
9. THE CardTrade_System SHALL correct or remove the stale claim in the `domain/services/index.ts` header comment that KYC is always served by the Mock delegate.
10. THE CardTrade_System SHALL remove the `identity.verification_session.*` translations from `domain/services/stripe/webhook.ts` and the `kyc.verified` / `kyc.rejected` mappings from `domain/webhook/mapEventToAction.ts`.
11. WHEN an inbound provider event carries a type that is no longer mapped, THE CardTrade_System SHALL record a logged no-op and SHALL acknowledge the authentic event with a success response.
12. THE CardTrade_System SHALL remove the writes to `kyc_status`, `kyc_reason` and the `identity_verified_*` columns from `lib/webhook/webhookPipeline.ts`.
13. THE CardTrade_System SHALL remove the `kyc_status` initialisation from Profile provisioning in `lib/actions/auth.ts` and `lib/auth/ensureProfile.ts`.
14. THE CardTrade_System SHALL remove the `KycStatus` type and the `kycStatus` field from `BuyerRecord` in `domain/orchestrator/cashSaleOrchestrator.ts` and from the select in `domain/orchestrator/supabaseCashSaleRepository.ts`.
15. THE CardTrade_System SHALL update or remove every test asserting behaviour of the Retired_Payer_Gate, so that the suite passes without it.
16. THE CardTrade_System SHALL leave no reference to the Retired_Payer_Gate in any remaining source file, comment, test, or steering document.

### Requirement 16: Schema migration

**User Story:** As a maintainer, I want the retired columns and their dependent objects removed in one reviewable migration, so that the database stops maintaining a value nothing reads.

#### Acceptance Criteria

1. THE CardTrade_System SHALL introduce every schema change as new sequential files in `supabase/migrations/` and SHALL NOT edit an applied migration.
2. THE CardTrade_System SHALL separate the migration into a non-destructive phase that repoints dependants onto the Identity_Gate and a destructive phase that drops retired columns, so that the destructive phase can be applied as a distinct, explicitly approved step.
3. THE CardTrade_System SHALL repoint `items.seller_identity_verified` at the Identity_Gate.
4. THE CardTrade_System SHALL replace the `set_item_seller_identity_verified` insert trigger and the `sync_items_seller_identity_verified` propagation trigger so that propagation fires on a change to the Identity_Gate columns rather than on a change to `kyc_status`.
5. THE CardTrade_System SHALL guard the propagation trigger on an actual change in value, so that a provider report repeating the current state does not rewrite every row a Seller owns.
6. THE CardTrade_System SHALL backfill `items.seller_identity_verified` from the Identity_Gate so that existing rows are correct rather than defaulted.
7. THE CardTrade_System SHALL retain the partial index supporting the Catalog_Identity_Filter.
8. THE CardTrade_System SHALL update the Public_Profile_View so that its verified flag derives from the Identity_Gate.
9. THE CardTrade_System SHALL drop the `kyc_status` and `kyc_reason` columns and the `kyc_status` enum type in the destructive phase.
10. THE CardTrade_System SHALL drop the `identity_verified_name`, `identity_verified_first_name`, `identity_verified_at`, `identity_is_adult` and `identity_session_id` columns in the destructive phase.
11. THE CardTrade_System SHALL preserve the seller identity already snapshotted onto `cash_sales` rows, so that a completed contract continues to show the identity disclosed when it was agreed.
12. THE CardTrade_System SHALL regenerate `lib/supabase/database.types.ts` from the migrated schema rather than hand-editing it.
13. THE CardTrade_System SHALL update `supabase/seed.sql` and `supabase/seeds/` so that no seed writes a dropped column.
14. THE CardTrade_System SHALL retain row-level security on every table it alters.

### Requirement 17: Identity disclosure after consolidation

**User Story:** As a buyer committing to a purchase, I want to see who I am dealing with, so that I can commit to a stranger with confidence.

#### Acceptance Criteria

1. THE CardTrade_System SHALL source every Identity_Disclosure from the Verified_Identity reported by the provider for the counterparty's Connected_Account.
2. THE CardTrade_System SHALL disclose a Verified_Identity only at a Commitment_Point.
3. THE CardTrade_System SHALL persist a Verified_Identity only from the provider's own report, and only from absent to present, so that a later event cannot blank a name already disclosed.
4. WHERE a counterparty holds no Connected_Account, THE CardTrade_System SHALL present that counterparty's display name and trading history and SHALL NOT present a verified badge.
5. THE CardTrade_System SHALL exclude government registration numbers, merchant references, contact details, address, date of birth, document numbers, bank details and provider compliance notes from every Identity_Disclosure.
6. THE CardTrade_System SHALL update `components/identity/CounterpartyIdentity.tsx` to read the Verified_Identity through a Connect-sourced read rather than the removed `getCounterpartyIdentity` action.
7. THE CardTrade_System SHALL update `components/identity/IdentityBadge.tsx` so that its verified input derives from the Identity_Gate, and SHALL correct its documentation accordingly.
8. THE CardTrade_System SHALL scope every counterparty identity read to a transaction in which the requesting Member is a participant.

### Requirement 18: Dependent surfaces

**User Story:** As a member browsing listings, I want badges and the verified filter to keep working, so that consolidating the gate does not degrade what was built on it.

#### Acceptance Criteria

1. THE CardTrade_System SHALL keep the Catalog_Identity_Filter functional, filtering on the repointed denormalised column so that filtering remains a database-side operation.
2. THE CardTrade_System SHALL update `components/listings/CatalogControls.tsx` so that its filter label and description describe the Identity_Gate.
3. WHERE a surface previously distinguished an identity check from a payability check, THE CardTrade_System SHALL present a single verification state and SHALL remove the distinction from labels, descriptions and code comments.
4. THE CardTrade_System SHALL update `components/layout/KycRailStatus.tsx` to the consolidated vocabulary, resolving its existing disagreement with `app/profile/page.tsx`.
5. THE CardTrade_System SHALL derive the Bond_Policy's verified input from the Identity_Gate.
6. THE CardTrade_System SHALL keep the existing asymmetry whereby a cash Buyer posts no bond, so that only an unverified Seller posts collateral on a Cash_Sale.
7. THE CardTrade_System SHALL update the identity gate in `lib/actions/deals.ts` and the seller flags in `lib/actions/listings.ts` to the Identity_Gate.
8. THE CardTrade_System SHALL update the gating explanation in `app/listings/[id]/page.tsx` to match the consolidated model.

### Requirement 19: Migration of existing members

**User Story:** As an existing member who was marked verified before this change, I want to understand my real status, so that I am not silently downgraded without explanation.

#### Acceptance Criteria

1. THE CardTrade_System SHALL determine each existing Member's verification state solely from the Identity_Gate after migration.
2. WHERE an existing Member was verified by the Retired_Payer_Gate but holds no Connected_Account satisfying the Identity_Gate, THE CardTrade_System SHALL present that Member as not verified.
3. WHERE a Member's presented verification state changes as a result of this migration, THE CardTrade_System SHALL notify that Member, stating that verification is now handled by the payment provider and linking to payout setup.
4. THE CardTrade_System SHALL leave an in-flight Cash_Sale, Trade or private deal in its current state, so that consolidating the gate does not cancel or fail a live contract.
5. THE CardTrade_System SHALL continue to release proceeds owed on a completed Cash_Sale to a Seller who satisfies the Identity_Gate, so that the migration does not strand queued money.
6. THE CardTrade_System SHALL retain the existing automatic retry behaviour for a release that cannot yet be sent because payout setup is incomplete.

### Requirement 20: Accepted assurance change

**User Story:** As a product owner, I want the assurance CardTrade gives up recorded explicitly, so that a future fraud review can find the decision rather than infer it.

#### Acceptance Criteria

1. THE CardTrade_System SHALL record that Connect recipient onboarding may impose a lighter verification burden than a document-and-selfie Identity check, and may defer document collection until provider thresholds are reached.
2. THE CardTrade_System SHALL record that Settlements_Enabled proves payability and yields a provider-verified legal name, but does not prove a government document was inspected at the moment the gate was satisfied.
3. THE CardTrade_System SHALL NOT describe a Member satisfying the Identity_Gate using wording that claims a document or selfie check was performed.
4. THE CardTrade_System SHALL keep the Identity_Gate as the sole signal, so that reintroducing a higher assurance tier later is an addition rather than a reversal.
5. THE CardTrade_System SHALL NOT reintroduce the retired term `Police_Evidence_Pack` on any surface added or changed by this feature.

### Requirement 21: Verifiable correctness properties of the gate

**User Story:** As a maintainer, I want the consolidated gate pinned by tests, so that the two-gate contradiction cannot return.

#### Acceptance Criteria

1. FOR ALL Profile records, THE CardTrade_System SHALL report a verified state true only where Merchant_Status is APPROVED and Settlements_Enabled is true (single-source property).
2. FOR ALL Profile records, THE CardTrade_System SHALL report the same verified state to every surface that presents one (consistency property).
3. FOR ALL Profile records, THE CardTrade_System SHALL report a verified state unchanged by any value of a Retired_Payer_Gate column (independence property).
4. FOR ALL sequences of provider reports, THE CardTrade_System SHALL leave a persisted Verified_Identity present once it has been present (monotonic-disclosure property).
5. FOR ALL Identity_Disclosure outputs, THE CardTrade_System SHALL produce no field containing a registration number, merchant reference, address, date of birth, document number or bank detail (redaction property).
6. FOR ALL Member and Item pairs, THE CardTrade_System SHALL produce a Catalog_Identity_Filter result equal to filtering by the owner's Identity_Gate directly (denormalisation-agreement property).
7. FOR ALL Members not satisfying the Identity_Gate, THE CardTrade_System SHALL permit every cash Buyer action and SHALL deny every action in Requirement 14 criteria 1 through 3 (buyer-exemption property).

### Requirement 22: Cash_Sale dispute resolution

**User Story:** As a buyer who raised a dispute, I want it decided, so that my money is either returned to me or released to the seller rather than held indefinitely.

**Context.** `disputeCashSale` moved a sale to DISPUTED and nothing resolved it. There was no refund primitive on the payment seam, no resolution action, and no operator control; `REFUNDED` existed in the status enum and the badge rendered it, but nothing ever set it. Meanwhile `HandoverFailedDialog` told the Buyer they would be refunded. Funds sat in the platform balance with no exit.

#### Acceptance Criteria

1. THE CardTrade_System SHALL expose a refund primitive on the Payment_Service that returns collected funds to the payer, in whole or in part, and SHALL report failure through a status field rather than by throwing.
2. THE CardTrade_System SHALL implement that primitive in every binding of the seam, so no implementation silently lacks it.
3. THE CardTrade_System SHALL support exactly three resolutions of a disputed Cash_Sale: full refund to the Buyer, partial refund with the remainder released to the Seller, and release to the Seller with no refund.
4. THE CardTrade_System SHALL restrict resolution to an admin, and SHALL record the deciding admin and the decision time against the Cash_Sale.
5. THE CardTrade_System SHALL attempt the refund BEFORE the Cash_Sale leaves DISPUTED, so a provider refusal leaves a retryable dispute rather than a resolved sale whose funds never moved.
6. WHERE a refund fails, THE CardTrade_System SHALL leave the Cash_Sale DISPUTED, record the failure, and permit a retry.
7. THE CardTrade_System SHALL assign the refund idempotency key once, persist it, and reuse it verbatim on every retry, so a retry cannot refund a Buyer twice out of platform funds.
8. WHERE a Cash_Sale has already been resolved, THE CardTrade_System SHALL treat a further resolution as a successful no-op and SHALL issue no second refund.
9. THE CardTrade_System SHALL reject a partial refund that is zero, negative, or equal to or greater than the amount collected.
10. WHERE the resolution is a full refund, THE CardTrade_System SHALL set the Cash_Sale to REFUNDED and return the Item to the catalog.
11. WHERE the resolution is a partial refund or a release, THE CardTrade_System SHALL complete the Cash_Sale, leave the Item sold, and queue the Seller release through the same path an ordinary completion uses.
12. THE CardTrade_System SHALL reduce the Seller_Net by the refunded amount, so the platform absorbs no part of a partial refund.
13. WHERE the Seller release fails after a resolution, THE CardTrade_System SHALL keep the resolution and retry the release, and SHALL NOT reopen the dispute.
14. THE CardTrade_System SHALL notify both the Buyer and the Seller of the outcome, each in terms of their own money.
15. THE CardTrade_System SHALL record an auditable event naming the outcome and the deciding admin.
16. THE CardTrade_System SHALL state, wherever a dispute is raised, that funds are frozen pending operator review and that the outcome may be a full refund, a partial refund, or no refund — and SHALL NOT promise an automatic refund.
17. THE CardTrade_System SHALL present the amount collected, the platform fee, and the Seller's prospective net alongside each disputed sale, so an operator decides with the money visible.
18. THE CardTrade_System SHALL require confirmation before applying a resolution, stating the money effect in plain language.

### Requirement 23: Scheduled release draining

**User Story:** As a seller, I want owed releases retried automatically, so that a transient failure does not depend on an operator noticing.

#### Acceptance Criteria

1. THE CardTrade_System SHALL invoke the owed-release queue on a schedule, not only on operator demand.
2. THE CardTrade_System SHALL support the HTTP method the scheduler actually issues.
3. THE CardTrade_System SHALL authenticate the scheduled invocation with a shared secret compared in constant time, and SHALL fail closed when that secret is absent.
4. THE CardTrade_System SHALL keep the drain idempotent, so a duplicate scheduled call cannot pay a Seller twice.

## Implementation notes carried from the codebase

These are existing facts the design must respect rather than rediscover.

- Layering is one-directional: `app/` → `components/` → `lib/` → `domain/`. Derivation logic that property tests need to reach belongs in `domain/` so it runs in the Node-only Vitest project.
- Server Actions live in `lib/actions/*`, begin with `'use server'`, export only async functions, and return `ActionResult` (`{ ok: true, data }` / `{ ok: false, error, message, field? }`). Expected failures are values, never thrown.
- `payoutCashSaleSeller` is idempotent: it reuses the persisted `seller_payout_nonce` verbatim so retries dedupe at the provider, and an already-SETTLED release is a no-op success. Adding notifications must not change that.
- `mark_cash_sale_payout_due` is a `security definer` function that only transitions a NOT_DUE release, and is called from both interactive completion and the auto-complete cron. The queued event required by Requirement 5.5 needs to be recorded on both paths.
- `cash_sale_events` is already in the `supabase_realtime` publication with `replica identity full`, so payout progression can be pushed live if the design wants it.
- Every new table or policy needs RLS, added as a new numbered migration.
- `0033_item_seller_identity_verified.sql` is the migration to mirror for Requirement 16: it defines the insert trigger, the propagation trigger guarded on an actual change, the backfill, and the partial index. The replacement should follow its structure with the Identity_Gate as the source.
- `0005_merchant_onboarding.sql` revokes column `UPDATE` on `profiles` from `authenticated` specifically to stop self-promotion of `kyc_status`, `is_admin`, `merchant_*`, `rating` and `rating_count`. Dropping `kyc_status` must not widen those grants.
- `applyComplianceUpdate` in the merchant onboarding orchestrator is the existing write path for provider-reported Connect state including `legalName`, and is the natural single writer for Verified_Identity. `StripeService` derives that name from `a.identity?.individual?.given_name` + `surname`, so it is provider-verified rather than member-supplied.
- Connect onboarding is provider-hosted via `v2.core.accountLinks.create`. Links are single-use and short-lived, so a fresh link is requested per attempt rather than cached. Returning from the flow does not prove payability.
- Accounts must be created with `stripe.v2.core.accounts.create`; `POST /v1/accounts` is hard-blocked for new integrations and fails at runtime despite the SDK still typing the v1 `controller` parameter.
- `npx tsc --noEmit` is required after changing `domain/services/types.ts`, because editor diagnostics have been observed reporting clean on files that `tsc` then fails.
- Removing a member-facing route means checking `middleware.ts` (both lists), `app/robots.ts`, `app/sitemap.ts`, and any `redirectTo` or `next` parameter naming it.
- `0036_charge_disputes.sql` contains an admin-notification block keyed on `is_admin` that has not yet been checked for identity coupling; the design should confirm it before the destructive phase.
