# Red team report: NoDitto escrow and collateral

Read-only adversarial review. No code changed, and no Stripe, Supabase or Ship24 calls were made. This report merges five investigator branches, and all five wrote complete notes:

| Branch | Notes file | Hypotheses |
|---|---|---|
| Collateral lifecycle | `notes-collateral-lifecycle.md` | A, B, O, Q |
| Dispute, bond and fee | `notes-dispute-bond-fee.md` | C, D, P |
| Cash sale, returns and tracking | `notes-cashsale-returns-tracking.md` | E, F, G, N |
| Identity, chargeback and Sybil | `notes-identity-chargeback-sybil.md` | H, I, J |
| RLS, authz and provider trust | `notes-rls-authz-provider.md` | K, L, M, R, S |

Hypothesis letters are the ones the branches used: A stall until the authorisation lapses · B HANDOVER_FAILED abuse · C dispute and Friction_Tax · D bond sizing · E return scams · F tracking trust · G in-person and social engineering · H stolen-card Sybil cash-out · I chargebacks · J identity and ban evasion · K direct table writes and RLS · L authorisation (price, staff) · M provider trust · N terms TOCTOU · O idempotency and unbacked lock · P fee evasion · Q shopfront double-sell · R public action and API surface · S storage and evidence.

During consolidation I spot-checked these citations against the working tree, and every one matched:
- `disputeResolution.ts:215` (`holdForTrader`), `:309` (`partialCapture`) and `:660` (`fullCapture`)
- `lib/actions/trades.ts:901` (the comment) and `:930` (the state gate)
- `0057:147-152` (`select 72`) against `inspection.ts:71` (`TRADE_INSPECTION_HOURS = 120`)
- `0011:71` (`coalesce(p_delivered_at, now())`), which is the only definition of `apply_cash_sale_tracking`
- `0088:81,87,120` (return-details policies and grant)

Coverage limits that apply to all branches:
- The live DB was not inspected. That means no `has_column_privilege` or `pg_policies` check, and 0121–0124 were hand-applied with `execute_sql`, so a live override is possible.
- `is_admin()` is defined in no migration.
- The Flutter client was reviewed only through `app/api/mobile/**`, not through its own direct Supabase reads and writes.

---

## 1. Executive summary

There is a lot of escrow machinery, but the guarantees it advertises do not hold against a motivated attacker. The investigators keep finding three structural causes:

1. **Collateral is a lapsing authorisation, and several paths release or strand it before staff can use it.** Raising a dispute partial-captures $20, after which Stripe drops the rest. Either trader can move the meeting after the holds are placed until they expire. Captures target whichever hold row comes back first. One webhook can lock a trade with nothing behind it. The fraud branch of the trade state machine is effectively unreachable with money still attached.
2. **Data from carriers and the provider is trusted as if it belonged to the contract.** A tracking number is not tied to the sale, the address, the carrier or the ship date, and the carrier's historical delivery time starts the cash-sale clock. A seller who ships nothing can be paid within about an hour. A buyer can trigger a refund on a "return" that never reached the seller.
3. **Money leaves faster than fraud can be detected.** In-person cash sales pay out inline on the second tap. Charges are off-session, so there is no 3DS liability shift. Payouts never check for an open chargeback, and there is no clawback. As merchant of record and `losses_collector`, the platform absorbs every stolen-card or friendly-fraud loss out of a commingled balance. The identity blocklist meant to stop repeat offenders is almost certainly empty.

Several direct-PostgREST holes bypass server-action guards: a buyer can squat the seller's return address, and listings can be inserted without the Identity_Gate. The trade cash leg is unprotected twice over: it is never collateralised, and in the default payout mode it is never forwarded to the receiver.

Totals: 3 Critical, 13 High, 14 Medium, 9 Low.

**Top 5 by expected loss (likelihood × money impact):**
1. **ESC-02.** A seller enters any old, already-delivered tracking number. The 7-day inspection deadline lands in the past, and pg_cron plus the payout drain pay the seller within about an hour for goods never sent.
2. **ESC-03.** Stolen-card cash-out through two accounts (a private deal plus an in-person double tap). An off-session charge with no 3DS pays a mule's Connect account in seconds, and the chargeback lands on the platform weeks later.
3. **ESC-01.** Any member-raised trade dispute or fraud claim partial-captures $20, and Stripe releases the rest, so a later staff fraud finding captures nothing. The victim loses the full card value and the fraudster pays $20.
4. **ESC-04.** After collateral locks, either trader can move the meeting 30 days out or switch to DELIVERY without consent. The holds lapse with no capture possible, and the fraud costs the attacker nothing.
5. **ESC-11 (amplified by ESC-12 and ESC-13).** Return scam. The refund fires automatically, inside the webhook request, the moment the carrier says "delivered", and the seller gets no inspection window. The buyer can post an empty envelope, cite an unrelated delivered parcel, or redirect the return address to themselves.

---

## 2. Findings table

| ID | Title | Hyp. | Severity | Status | Loss bearer |
|---|---|---|---|---|---|
| ESC-01 | Dispute or fraud claim partial-captures $20, so Stripe releases the rest and the fraud capture can never succeed | C, A | Critical | CONFIRMED | victim |
| ESC-02 | Stale delivered tracking number starts the cash-sale clock in the past, giving auto-complete and payout in about 1h | F, M | Critical | CONFIRMED | victim (then platform via chargeback) |
| ESC-03 | Stolen-card Sybil cash-out: private deal, off-session charge, inline in-person payout | H | Critical | CONFIRMED (Radar/3DS unverifiable) | platform |
| ESC-04 | Unilateral handover edit after collateral lock (reschedule, or switch to DELIVERY) lets holds lapse, and edits never bump the version | A, N | High | CONFIRMED | victim |
| ESC-05 | Trade cash leg is not collateralised and is charged only after both holds are voided | D | High | CONFIRMED | victim |
| ESC-06 | Trade cash leg is collected but never forwarded when `PAYOUT_MODE=platform` (the default) | D | High | CONFIRMED (production env unverifiable) | victim |
| ESC-07 | Friction tax and fraud capture take the first unordered hold row, a dead attempt after any retry | O | High | CONFIRMED | victim |
| ESC-08 | One `hold.active` webhook confirms the whole trade, so it locks with one hold or none | O | High | CONFIRMED (timing-dependent) | victim |
| ESC-09 | Binder plus cash: attacker self-values both bonds, cash is excluded, and 1 cent passes | D, Q | High | CONFIRMED | victim |
| ESC-10 | Condition dispute caps the attacker's loss at $20, return is not enforced, and a bad-faith dispute takes $20 with no reversal | C | High | CONFIRMED | victim |
| ESC-11 | Return refund fires synchronously on carrier delivery with no seller inspection window | E | High | CONFIRMED | victim (seller) |
| ESC-12 | Tracking numbers unbound: no uniqueness, address, carrier or date binding, on outbound, return and trade legs | F, E, M | High | CONFIRMED (Ship24 behaviour unverifiable) | victim |
| ESC-13 | Buyer squats the seller's return address with a direct PostgREST insert | K, E | High | CONFIRMED | victim (seller) |
| ESC-14 | Chargebacks never freeze or reverse a payout, there is no clawback, and the fraud-victim payout is unbacked | I | High | CONFIRMED | platform |
| ESC-15 | Identity person-key blocklist is effectively empty (DOB and ID number need a restricted key), so bans are evadable | J | High | CONFIRMED (per Stripe docs; confirm in test mode) | platform |
| ESC-16 | Missing Stripe key silently selects MockService, and the mock webhook secret is hard-coded | M | High | PARTIALLY-MITIGATED (config) | platform |
| ESC-17 | Authorisation budget is wrong: Visa MIT is about 4d18h against 7d assumed, SQL inspection is 72h against TS 120h, with no clamp and no re-auth | A | Medium | CONFIRMED | victim |
| ESC-18 | Bonds and fees use live FMV, which can be re-priced between acceptances or after a forced HOLDS_FAILED | D | Medium | CONFIRMED | victim |
| ESC-19 | Initiator's items are never checked AVAILABLE, and HOLDS_FAILED un-sells or un-reserves items | Q | Medium | CONFIRMED | victim |
| ESC-20 | In-person cash sale completes and pays out on the second tap, and a coerced receipt-plus-accept pays at once | G, Q | Medium | PARTIALLY-MITIGATED (UI warning only) | victim (then platform) |
| ESC-21 | HANDOVER_FAILED pre-empts the victim's dispute and turns the case into he-said/she-said | B | Medium | PARTIALLY-MITIGATED | victim |
| ESC-22 | Buyer sets the SINGLE price at initiation, can revive offer status, and can spoof `seller_id` on an offer | L, R | Medium | CONFIRMED | victim (seller), platform (fees) |
| ESC-23 | One staffer controls money outcomes with no recusal or second approver, and fraud commits before victim validation | L | Medium | CONFIRMED | victim |
| ESC-24 | One person can hold many verified accounts, including both sides of a trade | J, H | Medium | CONFIRMED | platform |
| ESC-25 | Verified Identity name is never compared with the Connect payee | J | Medium | CONFIRMED (Connect KYC partly mitigates) | victim |
| ESC-26 | Listings published without the Identity_Gate through a direct `items` insert | K | Medium | CONFIRMED | victim (off-platform bait) |
| ESC-27 | Off-platform payment lures in pre-contract messages are unscreened | P | Medium | PARTIALLY-MITIGATED | victim |
| ESC-28 | Postage carries no fee and is effectively uncapped, so fee evasion runs at a net platform loss | P, N | Medium | CONFIRMED | platform |
| ESC-29 | A failed Trade_Fee never blocks the trade, and the retry replays the cached decline | P | Medium | CONFIRMED | platform |
| ESC-30 | Return leg has no pull path and depends only on a Ship24 webhook that may never fire | E | Medium | CONFIRMED | victim (buyer funds frozen) |
| ESC-31 | Pay dialog binds to the live `terms_version`, and cash-sale postage has no upper bound | N | Low | PARTIALLY-MITIGATED | victim |
| ESC-32 | Legacy `proposeTrade` forces a counterparty into escrow | O, R | Low | PARTIALLY-MITIGATED (likely unreachable) | victim |
| ESC-33 | Hold-expiry warning goes to the hold owner, not the protected party | A | Low | CONFIRMED | victim |
| ESC-34 | Orphan authorisations: void result ignored, and a crash between provider call and DB write | O | Low | CONFIRMED | nobody |
| ESC-35 | `pushVerifiedIdentityToConnect` is an unauthenticated Server Action that takes any `profileId` | J, R | Low | CONFIRMED | nobody |
| ESC-36 | Direct inserts let evidence and attachment rows cite any stored path | K, S | Low | CONFIRMED | victim (arbitration integrity) |
| ESC-37 | Stripe settlement is not bound to the PaymentIntent id or amount, and `event.account` is ignored | M | Low | CONFIRMED (Dashboard-dependent) | platform |
| ESC-38 | Ship24 return finalisation uses the default-region payment service | M | Low | CONFIRMED | platform |
| ESC-39 | Hardening: no default `revoke execute`, anon fuzzy RPC, dead tolerance setting, `/api/errors` Origin, Ship24 secret in query string | K, M | Low | CONFIRMED | nobody |

---

## 3. Details

### ESC-01. A dispute destroys the collateral it is meant to protect (Critical)
Sources: collateral C1, dispute C1 (merged).

**Attack.**
1. A agrees an IN_PERSON trade with V and hands over a convincing fake for V's real card.
2. The trade reaches INSPECTION, by both confirming or by `HANDOVER_ASSUMED`.
3. V presses "Raise a problem" or "Report fraud". Both run `raiseConditionDispute`, which immediately partial-captures `min($20, hold)` from A's hold.
4. Stripe releases the uncaptured remainder of a partially captured PaymentIntent, and the intent cannot be captured again.
5. Staff confirm objective fraud. `fullCapture` fails on the already-captured intent (all 3 attempts replay `capture:full:${holdId}`), so the trade is terminal `FRAUD_RESOLVED` with `FULL_CAPTURE_FAILED`.

**Evidence.**
- `domain/orchestrator/disputeResolution.ts:300-311`: `const chargeable = frictionTaxChargeableCents(...)`, then `:309` `const capture = await payments.partialCapture({ holdId: disputedHold.holdRef, amount: chargeable })`
- `domain/services/stripe/StripeService.ts:674`: `{ amount_to_capture: params.amount }`, with the comment "Capturing less than the authorised amount makes Stripe release the remainder automatically". Multicapture is never requested.
- `lib/actions/trades.ts:847`: `reportFraud` calls `raiseConditionDispute({` first.
- `disputeResolution.ts:660`: `const capture = await payments.fullCapture(offendingHold.holdRef);`. It never checks `hold.status`, and `StripeService.ts:700` uses the key `capture:full:${holdId}`.
- `domain/state-machine/machine.ts:94`: `CONDITION_DISPUTE: 'DISPUTED'`, reachable from INSPECTION only.
- The tests hide it: `domain/services/testing/InMemoryService.ts:433` `fullCapture` returns the full amount even after a partial capture, and MockService does the same.
- The admin copy misleads: `components/admin/TradeDisputeActions.tsx:178` reads "Captures the other trader's collateral in full".
- The seed shows the end state: `supabase/seeds/demo_lifecycle.sql` has a hold with `amount_cents 430000`, `captured_cents 2000`, `PARTIALLY_CAPTURED`.
- It survives only if the trade entered DISPUTED through HANDOVER_FAILED first (the CONDITION_DISPUTE transition is then invalid and nothing is captured).

**Money impact.** The victim loses the full card value minus the $10 return-postage share. The attacker pays $20 plus the fee. The platform keeps $10. This applies to every member-raised trade dispute or fraud claim from INSPECTION.

**Fix.**
- Never capture at raise time. Capture the Friction_Tax only at `DISPUTE_RESOLVED`, with a staff-chosen amount.
- Better, full-capture the accused's hold into the platform balance when a claim is raised, then refund or pay the victim at resolution. This also fixes ESC-17, but it changes custody reconciliation and the licensing posture.
- Give `reportFraud` its own `FRAUD_CLAIMED` event that captures nothing.
- Make `fullCapture` refuse unless the hold is `ACTIVE`.
- Model single-capture semantics in InMemoryService and MockService, and add a property test: any dispute sequence, then fraud resolution, still captures at least hold minus tax.
- Fix the admin copy.

### ESC-02. A stale delivered tracking number pays the seller before the buyer can act (Critical)
Sources: cash-sale F1, RLS F3 variant A (merged).

**Attack.**
1. A verified seller with payouts set up takes a delivery cash sale, which reaches ESCROW_HELD with the buyer's money collected.
2. The seller ships nothing and enters the tracking number of any parcel delivered more than 7 days ago.
3. A room open, or the seller's own `syncCashSaleTracking` (web or `POST /api/mobile/cash-sale/sync-tracking`), feeds Ship24's historical `deliveredAt` into `apply_cash_sale_tracking`.
4. `inspection_deadline_at = delivered_at + 7d` is already past, so the `:07` cron completes the sale and the `:47` drain pays it.
5. The buyer gets 0 to about 60 minutes and no warning email.

**Evidence.**
- `domain/orchestrator/cashSaleOrchestrator.ts:3014-3016`: the only checks are a carrier and `trackingNumber.trim().length < 2`, then `const tracking = await deps.tracking.registerShipment(params.shipment);`. A DELIVERED status at registration is ignored.
- `cashSaleOrchestrator.ts:3098-3101`: `deliveredAt: snapshot.deliveredAt ?? null`, callable by either participant.
- `lib/tracking/refreshOnRead.ts:147-151`: `p_delivered_at: snapshot.deliveredAt`.
- `domain/services/tracking/ship24Tracking.ts:82,129`: `lastEvent = ...events?.[0]`. The carrier timestamp is unbounded. The webhook path is `app/api/webhooks/ship24/route.ts:128`.
- `supabase/migrations/0011_cash_sale_auto_settle.sql:71`: `v_delivered_at := coalesce(p_delivered_at, now());`, then `v_deadline := v_delivered_at + (... '7 days')`. There is no `greatest(..., now())` and no `shipped_at` comparison. Verified as the only definition.
- `0038_cash_sale_seller_payout.sql:129` (`auto_complete_due_cash_sales`): `inspection_deadline_at <= now()`, then `mark_cash_sale_payout_due`.
- `lib/trades/cashSaleInspectionSweep.ts:116`: `.gt('inspection_deadline_at', nowIso)`. A deadline already in the past is never warned.
- Trades have a floor (`0057:206-207` `v_floor := now() + make_interval(hours => ...floor_hours())`). Cash sales do not.
- 0132's ship-by deadline gives a seller with nothing to ship a reason to enter any number.

**Money impact.** The full price minus the fee goes to a seller who shipped nothing. It repeats across every open sale, and ESC-12 lets one number serve many sales. The buyer's only remaining remedy is a chargeback, which the platform absorbs because there is no `reverse_transfer` (ESC-14).

**Fix.**
- Compute the deadline from `greatest(coalesce(p_delivered_at, now()), shipped_at, now()) + 7 days`.
- Refuse, or route to staff, a shipment whose registration already reports DELIVERED, or a first scan or delivery before `payment_settled_at`.
- Store the raw carrier time separately for arbitration.

### ESC-03. Stolen-card cash-out through Sybil buyer and seller (Critical)
Source: identity H, with the related cash-sale NEW-3.

**Attack.**
1. Seller account S passes Identity with a mule's or stolen ID, and its Connect payouts go to the mule's bank. Buyer account B needs only an email and a card.
2. S creates a private `CASH_SALE` invite at any price (up to `AGREED_PRICE_MAX = 99_999_999_999`), with IN_PERSON one minute ahead.
3. B saves a stolen card and pays. The charge is off-session.
4. Both tap "confirm handover". The second tap completes the sale and pays out inline through `source_transaction`.
5. The chargeback arrives weeks later.

**Evidence.**
- Self-dealing is checked by profile id only:
  - `lib/actions/dealInvites.ts:309`: `if (invite.host_id === viewerId)`
  - `cashSaleOrchestrator.ts:1114`: `SELF_PURCHASE`
  - `lib/actions/tradeNegotiation.ts:695` and `0081_trade_against_shopfront.sql:115`
  - Nothing compares card fingerprint, device or IP.
- `cashSaleOrchestrator.ts:1083-1099`: private-deal opening "Needs neither the Buyer's card nor the Seller's verified identity yet".
- `StripeService.ts:745-757`: `confirm: true, off_session: true`, with the card vaulted `usage: 'off_session'` at `:467`. There is no 3DS liability shift, and `attachPaymentSource`'s `ipAddress` is unused.
- `cashSaleOrchestrator.ts:3154` ("complete on the second confirmation") and `:3183`: `const released = await payoutCashSaleSeller(...)`. `supabaseCashSaleRepository.ts:573-608` never checks `meeting_at`.
- `StripeService.ts:826`: `source_transaction` on the transfer.
- `lib/rateLimiters.ts:36-91`: `contractLimiter`, `listingLimiter` and `apiLimiter` are imported nowhere. The limiters that are used are in-memory (`lib/rateLimit.ts:5`), which does little on serverless.
- Payout checks only the ban and `canReceiveFunds` (`cashSaleOrchestrator.ts:1878, :1894`).
- The mobile `app/api/mobile/cash-sale/confirm-handover/route.ts` is the same path and is scriptable.

**Money impact.** The full price per stolen card plus a dispute fee (about A$15–25, not checked). The ceiling is issuer declines and Radar, not code. The platform bears it (`losses_collector: 'application'`, `StripeService.ts:~993`), out of a commingled balance.

**Fix.**
1. Payout holdback: COMPLETED only queues the payout. Release after N days from `payment_settled_at` for new sellers, put the rule in a pure `domain/payouts/releasePolicy.ts`, and include the in-person path.
2. On-session buyer-present payment (Payment Element confirm) plus a Radar rule requesting 3DS.
3. Store `card.fingerprint` and refuse contracts where the buyer's card, Connect bank account or identity key matches the seller's.
4. A DB or Upstash-backed limiter on `beginCardSetup`, `acceptCashSaleTerms` and invite create and claim, plus new-seller payout caps.
5. Hold the payout on an open dispute or early-fraud warning (ESC-14).

### ESC-04. Unilateral handover edits after the collateral is placed (High)
Sources: collateral C3, dispute D4, cash-sale N2 (merged).

**Attack.**
1. The holds are placed about 24h before the meeting and the trade is COLLATERAL_LOCKED.
2. A takes V's card at the meeting, then calls `updateTradeHandoverTerms` (web, or `POST /api/mobile/trades/update-handover-terms`) to do one of:
   - set `meetingAt = now + 29d`, so `advanceDueHandovers` never fires; or
   - switch to DELIVERY, which nulls `meeting_at`, and the sweep filters on IN_PERSON.
3. V cannot raise a condition dispute or a fraud claim, because both are INSPECTION or DISPUTED only.
4. V is not notified. The hold lapses, and `expire_lapsed_holds` only flags it.

**Variants.**
- Edit after acceptance (N2-A): V accepts v5 with a public venue, and A moves it to a remote car park. No version bump, V's acceptance stands, A accepts, and escrow starts on terms V never saw.
- Pre-lock griefing in COLLATERAL_PENDING: null `meeting_at` or keep pushing it back. Placement, the stale flag and retry all need `meeting_at`, so V's item stays RESERVED indefinitely.
- Both confirm after A has pushed `meeting_at` out: `inspection_deadline_at` becomes about 32 days away while the collateral dies within days.

**Evidence.**
- `lib/actions/trades.ts:901`: the comment "EDITABLE ONLY UNTIL THE COLLATERAL IS PLACED". Verified against `:930`: `trade.state !== 'NEGOTIATING' && trade.state !== 'COLLATERAL_PENDING' && trade.state !== 'COLLATERAL_LOCKED'`.
- `trades.ts:965-968`: only `{ maxDeliveryCostCents, maxMeetingLeadHours }`, with no `allowedMethods`. Compare `lib/actions/tradeNegotiation.ts:177` (`TRADE_HANDOVER_METHODS`). `domain/fulfilment/terms.ts` says "Omitted means both".
- `trades.ts:988-993`: `admin.from('trades').update({...columns}).eq('id', tradeId)`. No state predicate, no version check, no notification.
- `0101_fulfillment_no_confirm.sql`: the reset trigger covers only cash, direction, declared value and the goods description.
- `lib/trades/bondPlacementSweep.ts:166-167`: `.eq('handover_method', 'IN_PERSON')` and `.not('meeting_at', 'is', null)`. Placement needs `meeting_at` (`:73`), as does `inspectionSweep.ts:313`. Retry refuses with no holds (`tradeNegotiation.ts:476`).
- `0057_trade_fulfilment_parity.sql:207`: `greatest(v_base + 72h, now()+24h)`, with no hold-expiry clamp.
- `0046_trade_fraud_claim.sql:81`: `if v_trade.state not in ('INSPECTION', 'DISPUTED') then return false;`
- `0109_expired_collateral_escalation.sql:56,72`: EXPIRED plus `manual_reconciliation`, and nothing else.

**Money impact.** The victim loses the full goods value at zero cost to the attacker. It is recoverable only if V presses HANDOVER_FAILED and staff confirm fraud and capture before the auth lapses, which ESC-07 and ESC-17 undermine.

**Fix.**
- Restrict edits to NEGOTIATING, and to COLLATERAL_PENDING only before `meeting_at − BOND_PLACEMENT_LEAD_HOURS`.
- Add `.in('state', …)` to the UPDATE.
- Pass `allowedMethods: TRADE_HANDOVER_METHODS`.
- Require counterparty consent (a handover version), and notify them.
- Add a DB trigger refusing `meeting_at` or `handover_method` changes at or beyond COLLATERAL_LOCKED.
- Refuse `acceptTradeTerms` or `begin_trade_collateral` without IN_PERSON plus `meeting_at`.
- Allow fraud claims, and staff capture, from COLLATERAL_LOCKED.
- Make `flagStaleCollateralTrades` catch `meeting_at is null`.

### ESC-05. The trade cash leg has no collateral and is charged after the holds are released (High)
Sources: collateral C5, dispute D1 (merged).

**Attack.**
1. A offers a $5 card plus $495 `PROPOSER_PAYS` for V's $500 card. The bonds are sized on goods only.
2. Before completion, A swaps the default card for one that declines off-session or triggers 3DS (`requires_action` counts as failed).
3. On completion, both holds are voided first, and only then is the cash charged. The charge fails.

**Evidence.**
- `lib/trades/completion.ts:209`: `const holds = await voidTradeHolds(trade.id);`, then `:212` `cash = await settleTradeCash(trade);`.
- `StripeService.ts:753`: a fresh off-session `paymentIntents.create` at completion.
- `domain/trade/tradeSideValues.ts:36-52` and `tradeProposal.ts:473`: side values are goods only.
- `resolveConditionDispute` (DISPUTE_RESOLVED → COMPLETED) never settles the cash leg.

**Money impact.** The receiver loses the cash amount, bounded only by `termsProblem`'s $1,000,000.

**Fix.**
- Collect the cash into the platform balance when collateral locks, and refund it on HOLDS_FAILED or cancel.
- At minimum, add the cash to the payer's bond, settle before voiding, and capture from the hold if the charge fails.
- Settle cash on the DISPUTE_RESOLVED path too.

### ESC-06. The trade cash leg is never forwarded in platform payout mode (High)
Sources: collateral C13, dispute N1, identity N-1 (merged).

**Mechanism.** `settleTradeCash` → `requestTransfer({ ..., merchantRef })` (`lib/trades/completion.ts:150-158`). In `StripeService.ts:768` it reads `const settleDirect = params.merchantRef && this.opts.config.payoutMode === 'direct'`. When that is false it returns SETTLED after collecting only (`:769`). `PAYOUT_MODE` defaults to `platform` (`domain/services/stripe/config.ts:372`). `completion.ts:170` then writes `manual_reconciliation: false`. No trade-cash payout queue exists, and `retrySettleTradeCash` replays the same intent.

**Money impact.** The receiver is silently never paid, and the platform balance grows with nothing flagged. In `direct` mode it inverts into an instant off-session cash-out path between two Sybil traders (same mechanics as ESC-03).

**Fix.** Always collect into the platform, then `payoutToMerchant` with `sourcePaymentRef` after completion and a holdback, whatever the `PAYOUT_MODE`. Mark it settled only after the transfer. Check production `PAYOUT_MODE` now.

### ESC-07. Captures hit a dead hold row after any retry (High)
Source: collateral C4.

**Attack.**
1. A forces their own card to decline at placement, which writes FAILED rows. HOLDS_FAILED voids V's hold, leaving a VOIDED row.
2. A fixes the card, and the sweep places attempt 2 for both traders.
3. Each trader now has two rows. The dispute module's `holdForTrader` returns the first unordered match, often the dead row. A's FAILED row's `hold_ref` is the `hold:<trade>:<trader>` key, not a `pi_`.
4. The capture fails, and fraud commits terminal FRAUD_RESOLVED. 0109 deliberately skips terminal trades, so the live hold lapses without escalation.

**Evidence.**
- `domain/orchestrator/disputeResolution.ts:215`: `return holds.find((hold) => hold.traderId === traderId);` (verified)
- `supabaseDisputeResolutionRepository.ts:48`: `.eq('trade_id', tradeId);`, with no order and no status filter.
- `tradeProposal.ts:525`: the attempt counter creates the extra rows by design.
- `currentHoldsByTrader` exists in `tradeProposal.ts` and is unused here.

**Money impact.** The victim's loss goes unrecovered, unless an operator manually captures the right intent in the Dashboard before it lapses. No admin tool exists for that. It also triggers on honest declines.

**Fix.** Use one shared "current live hold" helper (`ACTIVE` or `PARTIALLY_CAPTURED`, latest `created_at`). Refuse to commit FRAUD_RESOLVED until a capturable hold is found, keeping the trade flagged and non-terminal instead.

### ESC-08. One webhook confirms the whole trade (High)
Source: collateral C2.

**Attack.** A ensures their own hold declines while V's succeeds. V's `payment_intent.amount_capturable_updated` maps to `HOLDS_CONFIRMED` for the trade, without checking the other hold.
- If it lands while A's placement is in flight, the trade is LOCKED with A unbacked. The later HOLDS_FAILED is `INVALID_TRANSITION`, so compensation never runs.
- If it lands after HOLDS_FAILED (a self-loop that voided V's hold), it locks with **no** live collateral, items AVAILABLE, and both told "collateral locked".

**Evidence.**
- `domain/webhook/mapEventToAction.ts:63`: `case 'hold.active': return { kind: 'TRADE_EVENT', tradeEvent: 'HOLDS_CONFIRMED' };`
- `lib/webhook/webhookPipeline.ts:200`: `event: action.tradeEvent,` is applied directly.
- `domain/state-machine/machine.ts:57`: `HOLDS_FAILED: 'COLLATERAL_PENDING'` (self-loop).
- `tradeProposal.ts:494`: `currentHoldsAreActive` is used only on the synchronous paths.

**Money impact.** The victim's goods are unprotected while the UI says they are protected. The loss depends on webhook latency, which is unverified.

**Fix.** Never apply HOLDS_CONFIRMED from the event alone. Re-read `pre_auth_holds`, require `currentHoldsAreActive`, and match the webhook's `holdId` to each trader's latest `hold_ref`, inside a domain side effect. Alternatively demote `hold.active` to NO_OP, since placement is synchronous.

### ESC-09. Binder plus cash collapses the attacker's bond (High)
Sources: dispute D2, collateral C7 valuation part (merged).

**Attack.** A offers a 1-cent (or $5) self-priced card plus $495 cash for "PSA 10 Charizard" out of V's binder.
- The binder side is valued at what is offered (goods only), so both bonds are about $5 and A's fee is the $1 minimum.
- `declared_value_cents = 50000` makes the room headline read $500.
- A takes the Charizard. At most $5 is capturable, and ESC-01 kills even that.

**Evidence.**
- `domain/trade/tradeSideValues.ts:51`: `counterpartSideCents: initiatorSideCents`. The initiator's own bond is the binder side, priced by the initiator.
- `:106`: `tradeSidesAreValued` refuses only `> 0` failures. `domain/validation/item.ts:77` has `FMV_MIN_CENTS = 1`.
- `tradeAgreedValueCents` shows declared value as "presentation only".

**Money impact.** The victim loses the binder card's value.

**Fix.**
- Value the binder side as initiator goods plus initiator cash.
- Better, freeze a both-accepted side value and bond on the larger of it and the goods.
- Set a minimum side value, or a fraction of the cash leg.
- Show the real bond amounts in the headline.

### ESC-10. A condition dispute caps the attacker's loss at $20, and can be weaponised (High)
Source: dispute C2.

**Attack A.** Hand over a Heavily Played copy, or a cheaper printing, of a "Near Mint" card worth $300 more. The only non-fraud outcome is `resolveConditionDispute`: DISPUTED → COMPLETED, holds voided. Nothing is captured beyond the $20, and no return is enforced. The attacker gains $300 for $20.

**Attack B.** Receive a perfect card and raise a dispute with a `DISPUTE_REASON_MIN`-length reason. $20 is captured from the honest trader immediately (`disputeResolution.ts:309`), and $10 is paid to the raiser (`payeeTraderId: params.actorId`, `:345`). There is no "unfounded" outcome to reverse it.

**Evidence.**
- `disputeResolution.ts:433-480`; `frictionTax.ts:33`.
- The `markDisputeReturnOverdue` doc: "NOTHING SCHEDULES IT YET. There is no `return_deadline_at` on `trades`".
- No classification criteria exist (`arbitrationCase.ts` is triage only, and `TradeDisputeActions.tsx` says "decide it on the evidence").
- Ops noise: `disputeResolution.ts:466` skips only `VOIDED` and `FULLY_CAPTURED`, so it tries to void the `PARTIALLY_CAPTURED` intent, fails, and flags manual reconciliation on every resolved dispute, which hides the real flags.

**Money impact.** Up to the value difference per trade against the victim. In Attack B, $20 per trade, repeatable.

**Fix.**
- Give staff three outcomes: (a) unfounded, with no capture and both released; (b) condition, with a staff-chosen capture up to the hold; (c) fraud.
- Add `return_deadline_at` and a sweep.
- Write classification criteria: counterfeit, wrong card or empty parcel is fraud.
- Treat `PARTIALLY_CAPTURED` as terminal in the void loop.

### ESC-11. Return scam: no seller inspection before the automatic refund (High)
Source: cash-sale E1.

**Attack.**
1. The buyer receives a genuine $800 card and disputes it as "not as described".
2. REFUND_BUYER with a return puts the sale in RETURN_PENDING.
3. The buyer posts a fake or a weighted empty envelope with real tracking.
4. On Ship24 delivered, the webhook calls `apply_cash_sale_return_tracking` and then, in the same request, `finalizeReturn`, so the sale is REFUNDED.
5. The seller opens the parcel later. `disputeCashSaleReturn` now returns INVALID_STATE.

**Evidence.**
- `app/api/webhooks/ship24/route.ts:196-218`: the RPC, then `createDefaultCashSaleOrchestrator(...).finalizeReturn({ cashSaleId })`.
- `cashSaleOrchestrator.ts:2350`: the only freeze is `if (sale.returnDisputedAt)`, which can only be set before delivery.
- `:2368-2410`: `refundTarget = Math.max(sale.refundCents || sale.amountCents, 0)`, then `refundPayment`, then `recordReturnFinalised` (`:2423`).
- `:2471`: contest only from `RETURN_IN_TRANSIT` or `RETURN_PENDING`.
- `0088`, `apply_cash_sale_return_tracking`: `if v_sale.return_disputed_at is null then perform cardtrade.mark_cash_sale_refund_due(...)`.
- The drain guard (`listDueRefunds` `.is('return_disputed_at', null)`) is real, but moot, because finalisation refunds directly.

**Money impact.** The seller loses the card and the price. The platform also eats the Stripe fee on a refund that includes postage and the fee.

**Fix.** Split "carrier delivered" from "refund released":
- On return delivery, stamp it and open a 48–72h seller inspection window in a `RETURN_DELIVERED` sub-state, during which `disputeCashSaleReturn` is allowed.
- Have a sweep refund when the window lapses.
- Remove the synchronous `finalizeReturn` from the webhook.

### ESC-12. Tracking numbers are unbound to the contract (High)
Sources: cash-sale F2 and E2/F3, RLS F3 variant B (merged).

**Attacks.**
- **Return leg.** The buyer cites any delivered parcel this Ship24 account has not seen before, so no return is posted at all.
- **Outbound leg.** One delivered number is entered on every open binder sale, which starts every clock at once with ESC-02. A number seen as a buyer elsewhere can also be reused.
- **Trades.** The webhook writes `initiator_carrier_delivered_at` and `counterpart_carrier_delivered_at` from the payload. This is partly mitigated by the 24h floor. The trade DELIVERY path is meant to be off but is reachable through ESC-04.

**Evidence.**
- `cashSaleOrchestrator.ts:2284`: `if (!carrier || trackingNumber.length < 2)` is the only return validation. `:2292` stores whatever status comes back, including DELIVERED.
- `ship24Tracking.ts:69,117`: `destinationCountryCode: 'AU'` is the only destination data sent.
- The webhook matches by number alone: `route.ts:145-148` `.limit(5)` (outbound), `:188-191` `.eq('return_tracking_number', trackingNumber)` (return), `:248` (trade). There is no carrier match.
- No unique index on any tracking column in any migration.

**Money impact.** It multiplies ESC-02 and ESC-11: a full refund with the goods kept, or a payout for nothing, across several contracts per number. Whether Ship24 fires `delivered` for an already-delivered parcel cannot be verified from code.

**Fix.**
- Add a partial unique index on `(lower(tracking_carrier), tracking_number)` across live sales and trades, with a combined-shipment exception.
- Make return numbers unique and different from the outbound number.
- Refuse or flag DELIVERED-at-registration, or a first scan before `dispute_resolved_at` or `payment_settled_at`.
- Send the destination postcode and compare it.
- Match the carrier in the webhook.
- Choose the `delivered` milestone event rather than `events[0]` (see section 5).

### ESC-13. The buyer squats the seller's return address (High)
Source: RLS F1.

**Attack.**
1. Before or after disputing, the buyer `POST`s to `/rest/v1/cash_sale_return_details` (Content-Profile `cardtrade`) with their own JWT: `{cash_sale_id: <own sale>, seller_id: <own uid>, address_label: <friend's address>}`.
2. After REFUND_BUYER-with-return, the real seller's `saveCashSaleReturnAddress` upsert hits the buyer-owned row. The UPDATE policy fails ("Could not save the return address"), and the seller cannot even read the row.
3. The buyer "returns" to their own address, and delivery triggers the automatic refund (ESC-11).

**Evidence.**
- Verified: `supabase/migrations/0088_return_conditional_refunds.sql:81` `with check ((select auth.uid()) = seller_id);`, `:83-87` the UPDATE policy on the same predicate, and `:120` `grant select, insert, update on cardtrade.cash_sale_return_details to authenticated;`.
- Nothing asserts `seller_id = cash_sales.seller_id`.
- `lib/actions/cashSale.ts:720` (the seller check in the action) and `:726` (the cookie-bound upsert) are bypassed by going direct.

**Money impact.** A full refund, and the buyer keeps the goods. The seller bears it.

**Fix.**
- Revoke member INSERT and UPDATE, and write with the service role after the action's checks.
- Or make both policies require `exists (select 1 from cardtrade.cash_sales cs where cs.id = cash_sale_id and cs.seller_id = auth.uid() and cs.status in ('RETURN_PENDING','RETURN_IN_TRANSIT'))`.
- Add a BEFORE trigger asserting the seller.
- Audit existing rows: `select r.cash_sale_id from cardtrade.cash_sale_return_details r join cardtrade.cash_sales cs on cs.id = r.cash_sale_id where r.seller_id <> cs.seller_id;`

### ESC-14. Chargebacks never freeze or reverse a payout (High)
Sources: identity I (I-1, I-2, I-3), cash-sale NEW-3 (merged).

**Attacks.**
- **I-1, friendly fraud after payout.** There is no buyer consequence: no Identity, no automatic ban.
- **I-2.** A charge disputed while the sale is still INSPECTION or HANDOVER is still paid out.
- **I-3.** A banned trade-fraud offender charges back the full-collateral capture after the platform has already paid the victim. A Sybil pair with a stolen card as A's collateral turns staff review into the cash-out step.

**Evidence.**
- `lib/webhook/webhookPipeline.ts:398-425`: `CHARGE_DISPUTE` calls `record_charge_dispute`, "Never a Trade_State transition".
- `0036_charge_disputes.sql:154`: admins are notified, and nothing else happens.
- `domain/services/stripe/webhook.ts:185-216`: only `.created` and `.closed` are handled. There is no `radar.early_fraud_warning.created`, and `warning_closed` is never produced.
- No `charge_disputes` reference anywhere in `domain/`. `payoutCashSaleSeller` (`cashSaleOrchestrator.ts:1847-1960`) checks only the ban and `canReceiveFunds`. The only consumer is advisory: `lib/actions/arbitration.ts:773`.
- `StripeService.ts:~885`: "`reverse_transfer` is deliberately NOT set". No `transfers.createReversal` anywhere.
- `disputeResolution.ts:697-702`: the victim payout uses `payoutToMerchant(...)` with no `sourcePaymentRef`.
- No `disputes.update` call, so evidence submission is manual.

**Money impact.** The disputed amount plus the fee per dispute. I-3 is up to 100% of the side value (`DEAL_COLLATERAL_MAX` and `DEAL_CASH_MAX` are 99,999,999,999). The platform bears all of it.

**Fix.**
- On `charge.disputed`, mark the payout `HELD_DISPUTE`, or raise a recovery case if it has already been paid.
- Handle early-fraud warnings by refunding pre-emptively.
- Pay victims with `sourcePaymentRef` after a holdback.
- Automate `disputes.update` evidence submission.
- Flag the buyer and block the card fingerprint on a lost fraud or not-received dispute.

### ESC-15. The identity person-key blocklist is effectively empty (High)
Source: identity J-1.

**Attack.** A banned scammer opens a new email, passes Identity again with the same passport, and is VERIFIED.

**Evidence.**
- `StripeService.ts:286,312`: `expand: ['verified_outputs']` only. Per Stripe's "Access verification results" page, `dob` and `id_number` need a restricted key plus an explicit expand. There is no restricted key in `config.ts`.
- So `idNumber` (`StripeService.ts:364`) and `dob` are null.
- `identityFingerprint.ts:51,60` skip and return `[]`.
- `lib/identity/applyIdentityDecision.ts:28` `if (fingerprints.length > 0)` skips the blocklist.
- `lib/auth/fraudBan.ts:136-152` blocklists nothing.
- Even with DOB available, the key uses the address country (`StripeService.ts:371`), so a passport and a licence hash differently, and first-name normalisation differs between documents.
- `verified_outputs.id_number` is not the document number; that lives at `last_verification_report.document.number`.

**Money impact.** Unlimited fresh seller and trader identities for banned actors. It defeats the sibling cascade (`fraudBan.ts:173-190`) and the Connect DOB prefill.

**Fix.**
- Use a restricted key with Identity results read, only for `readIdentityCheck`.
- Expand `verified_outputs.dob`, `verified_outputs.id_number` and `last_verification_report.document.number`, plus `issuing_country`.
- Hash the document number with the issuing country.
- Make the name+DOB key country-independent (surname plus first given name).
- Stamp keys at verification time, inside the 48h restricted-read window.
- Test against a recorded test-mode session shape.

### ESC-16. A missing Stripe key falls back to MockService (High, config-dependent)
Source: RLS F4.

**Mechanism.**
- With no Stripe key and `PAYMENTS_PROVIDER` unset in production, `providerMode.ts:37` (`return isStripeConfigured(env) ? 'stripe' : 'mock';`) leads to `index.ts:114` `new MockService`.
- `MockService.ts:331`: `requestTransfer` settles, so sales reach ESCROW_HELD (`cashSaleOrchestrator.ts:1682`) with no money taken. Payouts "settle" too (`:360`).
- With `WEBHOOK_SECRET` unset, the mock HMAC key is the public `'dev-mock-webhook-secret'` (`webhookPipeline.ts:74`, `index.ts:63`, `demo.ts:86`), so forged `transfer.settled`, `hold.active` and capture events are accepted.
- Edge case: `isLivePaymentsProvider` checks only the AU key (`providerMode.ts:48`). With `PAYMENTS_PROVIDER=stripe` and only a non-AU key, mock signatures are still accepted (`pipeline.ts:492`) while real Stripe moves money.

**Mitigations.** An explicit `PAYMENTS_PROVIDER=stripe` fails closed. Identity cannot be forged (the mock `readIdentityCheck` returns PENDING). Demo actions are gated on the server (`demo.ts:142/283/415`, `providerMode.ts:96`).

**Money impact.** On a misconfigured deployment, goods ship against fake payments. In the edge case, a real-money lock with no collateral.

**Fix.**
- Refuse mock in production unless `PAYMENTS_PROVIDER=mock` and `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true` are both set.
- Delete the default `WEBHOOK_SECRET`.
- Reject mock signatures whenever `allConfiguredRegionCodes().length > 0`.
- Report the resolved provider in `/api/health`.

### ESC-17. The authorisation budget is wrong in three places (Medium)
Sources: collateral C6, plus doc drift noted by dispute C2 and cash-sale.

**Evidence.**
- `domain/fulfilment/inspection.ts:93`: `CARD_AUTHORISATION_DAYS = 7`. But holds are `off_session: true` (`StripeService.ts:611`), and Stripe documents about 4d18h for Visa merchant-initiated authorisations. A Visa hold placed at M−24h dies around M+3d18h.
- Verified: `inspection.ts:71` `TRADE_INSPECTION_HOURS = 120` (member copy says 5 days), while `0057_trade_fulfilment_parity.sql:147-152` `trade_inspection_hours()` is `select 72`. That is the only SQL definition, and the SQL trigger sets the real deadline. Its own comment claims it is "Kept in step with TRADE_INSPECTION_HOURS".
  - So members are promised 5 days and get 3.
  - `deriveTradeInspectionDeadline`, which has the expiry clamp, is unused in app code.
  - Nothing pins TS to SQL.
  - Branch notes disagreed on which value was the "doc" and which the "code". The truth is TS 120 against SQL 72, with SQL authoritative.
- Arbitration never reads `expires_at`, and there is no re-authorisation anywhere.

**Attack.** Stretch V's patience to near the deadline ("let me check, I'll refund you"), leaving staff hours before the Visa auth dies. ESC-01 or ESC-04 then finishes it.

**Money impact.** It makes every trade remedy time-fragile. The victim bears it.

**Fix.**
- Capture into custody at dispute time (ESC-01).
- Align SQL and TS with an agreement test like `regionCurrencyAgreement`.
- Clamp the SQL deadline to the earliest `expires_at − margin`.
- Size windows from the actual `capture_before`, or place holds on-session.
- Show staff the hold expiry.

### ESC-18. Live-FMV re-pricing between acceptances, or after a forced HOLDS_FAILED (Medium)
Sources: dispute D3, collateral C7 re-price part (merged).

**Attack.** Items stay AVAILABLE while NEGOTIATING (they are reserved only at `begin_trade_collateral`, `0081:351`) and again after HOLDS_FAILED (`tradeProposal.ts:624`). FMV is editable whenever an item is not RESERVED (`itemOrchestrator.ts:170`).
- Binder trade: A drops their FMV to 1 cent, shrinking A's own bond (ESC-09).
- SINGLE trade: A inflates their FMV, inflating V's bond and V's 5% fee (for example $250 on $5,000) without consent.

Bonds and fees read live `fmv_cents` at placement (`collateralPlacement.ts:84-108`, `tradeProposal.ts:473`). The reset trigger (0101) ignores item changes. Direct PostgREST is blocked (`0072:203-211`), so the action is the hole.

**Fix.**
- Snapshot side values at TERMS_AGREED and size from the snapshot.
- Keep items RESERVED across HOLDS_FAILED retries.
- Treat an item edit on a live trade as a terms change, or refuse it.

### ESC-19. Item availability holes let one SINGLE card back two contracts (Medium)
Source: collateral C8.

**Evidence.**
- The initiator's item is checked for ownership only: `0081_trade_against_shopfront.sql:154` (`initiator-item-not-owned`) and `lib/actions/tradeNegotiation.ts:704`.
- `begin_trade_collateral` silently skips non-AVAILABLE items (`0081:353` `and status = 'AVAILABLE'`).
- HOLDS_FAILED `restoreItems` sets AVAILABLE unconditionally (`supabaseTradeProposalRepository.ts:142`), so a forced decline un-sells a SOLD item or un-reserves one held by a paid cash sale, and puts it back in the catalog.

**Money impact.** The trader victim is protected only by collateral, which ESC-01, ESC-04 and ESC-07 defeat. A cash buyer stays protected by the funds already held.

**Fix.**
- Check initiator AVAILABLE in SQL.
- Fail `begin_trade_collateral` on a short reservation.
- Restore only items reserved by this trade, by recording the reservation owner.

### ESC-20. In-person cash completion is instant and final (Medium)
Sources: collateral C9, cash-sale G1 and G2 (merged). This is also the payout engine of ESC-03.

**Attacks.**
- "Tap confirm so the app knows I'm here", then the seller drives off. Or "confirm remotely to lock it in": confirmation does not require `meeting_at` to have arrived.
- A shopfront double-sell converts to a loss when the second buyer is handed a fake at the meet.
- On a delivery sale: "mark it received so tracking updates", then accept, and the payout is immediate.

**Evidence.**
- `supabaseCashSaleRepository.ts`, `confirmHandover`: `guardedUpdate(... 'HANDOVER', { status: 'COMPLETED' ...})`.
- `cashSaleOrchestrator.ts:3154, :3183` (inline payout) and `:3133` (inspection accept pays inline).
- `:3255`: `DISPUTABLE_STATUSES = new Set(['INSPECTION', 'IN_TRANSIT', 'HANDOVER', 'ESCROW_HELD'])`.
- The guard is UI copy only (`components/sales/CashSaleView.tsx:1670-1678`). This is a deliberate product decision, but the trade side rejects it for exactly this reason.

**Money impact.** The buyer loses the price, or the platform does via chargeback.

**Fix.**
- After both confirm, open a 24–48h INSPECTION, as `BOTH_HANDOVER_CONFIRMED` does for trades. Or at minimum delay the release by N hours while the sale stays disputable.
- Refuse confirmation before `meeting_at − ε`.
- State "this pays the seller now and ends your right to dispute" in the accept dialog.

### ESC-21. HANDOVER_FAILED pre-emption (Medium, PARTIALLY-MITIGATED)
Source: collateral section B.

Either participant can report HANDOVER_FAILED from COLLATERAL_LOCKED or IN_TRANSIT (`lib/actions/trades.ts:1085`, `:1094`, and the mobile `report-handover-failed` route) with a 10–2000 character reason. After taking V's card, A reports "they never showed". That freezes the trade, captures nothing, pre-empts V's INSPECTION-only dispute, and leaves an in-person he-said/she-said with no carrier evidence.

Guards: staff resolution (`resolveTradeFraud` can still full-capture) and evidence upload (0082). V's later `reportFraud` from DISPUTED records the claim harmlessly, without the ESC-01 capture.

Gaps:
- The authorisation clock keeps running (ESC-17).
- The capture can hit the wrong row (ESC-07).
- DISPUTE_RESOLVED never settles the cash leg (ESC-05).

Fix: surface hold expiry on the case, prioritise HANDOVER_FAILED cases by `expires_at`, and capture into custody on the freeze (ESC-01).

### ESC-22. The buyer sets the price, and offers can be forged (Medium)
Source: RLS F2.

**Attack 1, buyer-set price.**
1. `initiateCashSale({ itemId, agreedPriceCents: 50 })`, from the web or `POST /api/mobile/cash-sale/initiate`.
2. `lib/actions/cashSale.ts:217` passes it through, and `cashSaleOrchestrator.ts:1190` reads `Math.trunc(params.agreedPriceCents ?? item.fmvCents)`, bounded only above zero. This contradicts the file's own rule at `:1505`, "THE SELLER SETS THE PRICE, AND ONLY THE SELLER".
3. The buyer pays, and since 0099 no seller acceptance is needed (`:1710` `if (actor !== 'BUYER')`).
4. ESCROW_HELD now refuses cancellation.

**Attack 2, offer tampering.**
- `offers.status` is member-UPDATEable (`0072:218`, policy `0078:196`) with no transition rule, so a withdrawn or declined offer can be revived to PENDING and accepted (`offers.ts:393, 443`).
- `respondToOffer` never checks `offer.seller_id === item.owner_id`, and INSERT grants `seller_id`, `offered_by`, `amount_cents` and `status` (`0077:73-75`). Two accounts can therefore forge a "seller-made" offer on a third party's item.

**Money impact.** The seller is bound to an arbitrary price, or has to dispute their way out. The platform pays card fees on every charge-and-refund cycle. Listings can be locked as griefing.

**Fix.**
- Drop `agreedPriceCents` from public input.
- Require seller acceptance when the price differs from FMV.
- Revoke member `offers` UPDATE, with legal transitions only through the service role.
- Add a trigger asserting `offers.seller_id = items.owner_id`.

### ESC-23. One staff member decides who gets the money (Medium, insider)
Source: RLS F5.

**Mechanism.**
- `resolveTradeFraud(tradeId, victimId)`, `resolveCashSaleDispute(... refundCents, requireReturn)` and `resolveCashSaleReturnCase` are `requireStaff()` only (`admin.ts:486, 618, 432`).
- There is no participant recusal, no second approver, no threshold and no delay. A colluding staffer can name their friend as victim (full capture, the counterparty banned and blocklisted), or refund with `requireReturn=false`.
- Bug: `reportObjectiveFraud` commits `FRAUD_CONFIRMED` (`disputeResolution.ts:608`) before validating the victim (`:619-621`). A wrong `victimId` strands a terminal trade with both holds live.

**Money impact.** Up to the full contract value per case. The honest counterparty bears it.

**Fix.**
- Recuse participants and related accounts.
- Require two-person approval for fraud captures, no-return refunds and anything over a threshold.
- Validate before `applyEvent`.
- Add a 24h notified delay before money moves.

### ESC-24. One identity, many accounts (Medium)
Source: identity J-2.

Person keys block only on a match against an already-banned profile (`applyIdentityDecision.ts:51-76`). Nothing caps the number of VERIFIED profiles per person, and with ESC-15 nothing links them at all. One mule can satisfy both sides of the dual Identity_Gate on a trade (the I-3 collusion in ESC-14).

Fix: refuse, or send to review, a VERIFIED write whose person key is held by another live profile. Refuse contracts between profiles that share a person key, card fingerprint or Connect bank account.

### ESC-25. The verified name is never checked against the Connect payee (Medium)
Source: identity J-3.

**Evidence.**
- `fromV2Account` reads `legalName` from `identity.individual` (`StripeService.ts:~1325`) with no comparison to `identity_check_name`; there are no `nameMatch` or `NAME_MISMATCH` hits.
- `applyComplianceUpdate` (`merchantOnboarding.ts:454-540`) stores the Connect name unchecked.
- The bank account holder name is never read.
- The disclosure falls back to `merchant_legal_entity_name` (`merchantOnboarding.ts:146`), seeded from typed input post-0069 (`:387`). `nameIsDocumentVerified` is not required.

**Money impact.** Buyers see person X's name while funds go to another account, which weakens recovery and police referral. Connect KYC partly mitigates.

**Fix.** Compare normalised given name, surname and (after ESC-15) DOB after `refreshPayoutStatus`. A mismatch makes `canReceiveFunds` false with `PAYEE_IDENTITY_MISMATCH`. Require `nameIsDocumentVerified` for disclosures created after 0069.

### ESC-26. Listings can be published without the Identity_Gate (Medium)
Source: RLS F6.

**Evidence.**
- The `items` INSERT grant includes `status`, `hidden` and `listing_kind` (`0077:58-60`), and the policy checks only `owner_id = auth.uid()`.
- `createItem` uses the cookie client (`listings.ts:495`).
- The catalog policy has no verification term (`0094:50-57`), and the query dropped the filter assuming "Publishing requires the Identity_Gate" (`listings.ts:1459`).
- Such listings also skip `validateItemSubmission`.
- Buying fails later with `SELLER_IDENTITY_UNVERIFIED`, so escrow money is safe.

**Money impact.** An off-platform bait funnel ("message me, pay by PayID") under the NoDitto brand. Feeds ESC-27.

**Fix.** Revoke member INSERT and insert through the service role after the gate, or add a verified `with check` plus validator-mirroring CHECKs. Restore the `seller_identity_verified` catalog filter.

### ESC-27. Off-platform payment lures (Medium, PARTIALLY-MITIGATED)
Source: dispute P3.

`OffPlatformWarning` (`components/sales/CashSaleView.tsx:765-769`) renders only when `payBlocked` inside a cash-sale room. `lib/actions/messages.ts` does no content screening, and listing-page DMs (`getOrCreateConversation`), where lures happen, carry no warning.

Fix: pattern-detect PayID, BSB and account numbers, phone numbers and "friends and family" in `sendMessage`. Warn inline, record a moderation signal, and show the warning in every pre-contract thread.

### ESC-28. Postage is fee-free and effectively uncapped (Medium)
Sources: dispute P1, cash-sale N1 residual (merged).

**Attack.** Item $1 + postage $499.
- The fee is computed on the item price only (`platformFeeCentsFor(agreedPriceCents, …)`, `cashSaleOrchestrator.ts:94`), so it is the $1.50 minimum.
- The seller prices postage (`:1405`). The cap is `DELIVERY_COST_MAX_CENTS = 99_999_999_999` (`domain/fulfilment/terms.ts:31`).
- `termsComplete` checks only `>= 0` (`:984`), and the SQL checks only `< 0`.
- The platform still pays about $8.80 in card costs plus the payout cost, a net loss per sale.
- Bait against a non-colluding buyer is mitigated: the version bump plus `STALE_TERMS`.

Fix: charge the fee on item + postage above an allowance, cap postage absolutely and as a ratio of the price, and flag outliers.

### ESC-29. Trade_Fee failure never blocks, and the retry replays the decline (Medium)
Source: dispute P2.

**Evidence.**
- `tradeFees.ts:44`: "Never throws and never blocks the trade". `collateralPlacement.ts:110` only warns.
- The drain reuses `nonce: row.nonce` (`tradeFees.ts:349`) as the idempotency key (`StripeService.ts:759`), with `MAX_FEE_ATTEMPTS = 8` hourly (`:257`), all inside Stripe's 24h cached-decline window. The code says so itself in `placeBondsForAgreedTrade`.

**Attack.** A prepaid card loaded to exactly the hold amount: the hold succeeds and the fee declines.

**Money impact.** 5% of the received value (minimum $1) per trade, lost to the platform.

**Fix.** Require the fee before HOLDS_CONFIRMED. After a definite decline, retry with `${nonce}:${attempt}`, extend retries past 24h, and capture the fee from the hold before voiding it as a last resort.

### ESC-30. Returns depend solely on the Ship24 webhook (Medium)
Source: cash-sale NEW-1.

`lib/tracking/refreshOnRead.ts` (header) says the Ship24 webhook "on the evidence, has never fired for this project". The outbound leg got a pull path. The return leg did not: the only caller of `apply_cash_sale_return_tracking` is the webhook (`route.ts:196`). RETURN_IN_TRANSIT sales can therefore wait forever, with buyer funds frozen and the item RESERVED until staff step in through `resolveCashSaleReturnCase`. This accidentally blunts ESC-11 and ESC-12, and breaks the "refund is automatic" promise.

Fix: add a read-triggered return check, behind the ESC-11 seller window, and alert on RETURN_IN_TRANSIT older than N days.

### ESC-31. The Pay dialog re-binds to the live terms version (Low)
Source: cash-sale N1.

The server side is sound:
- The `cash_sales_reset_acceptances` trigger (0050:115-120) bumps the version.
- `acceptCashSaleTerms` checks `sale.termsVersion !== params.termsVersion` (`:1726`).
- `claimPayment` is guarded with `.eq('terms_version', …).is('payment_nonce', null)`.
- The amount comes from the claimed row (`:1651`).

But `CashSaleView.tsx:1612` sends `sale.terms_version` from the Realtime-updated `sale` (`:468`). A postage raise while the dialog is open re-renders the label, and one click pays the new figure.

Fix: snapshot the version and `amount_cents` when the dialog opens, send `expectedAmountCents`, and refuse on mismatch. Cap postage (ESC-28).

### ESC-32. Legacy `proposeTrade` forced escrow (Low, PARTIALLY-MITIGATED)
Source: collateral C10.

`lib/actions/trades.ts:305` calls `proposeTradeWithSupabase`, which in one call:
- creates a COLLATERAL_PENDING trade the counterparty never agreed to;
- reserves the counterparty's item;
- authorises their card off-session for 100% of the attacker's FMV;
- skips the region check, the meeting and the fee.

It is still exported from `'use server'` but imported nowhere, so it is probably unreachable. That was not checked against the build manifest. Fix: delete it.

### ESC-33. The expiry warning goes to the hold owner (Low)
Source: collateral C11.

`0093_hold_expiry_warning_excludes_cancelled.sql:55` notifies `r.trader_id`, the owner of the expiring hold, who on the attack path is the attacker. The protected party hears only after the hold has lapsed (0109). Fix: notify both participants and flag staff before expiry.

### ESC-34. Orphan authorisations (Low)
Source: collateral C12.

`lib/trades/collateralPlacement.ts:227` calls `await payments.voidHold(hold.holdRef);` and marks VOIDED regardless of the result. A crash between `paymentIntents.create` and `recordHold`, followed by a retry with a changed amount, produces a second live auth. The cost is a card encumbrance, not lost money. Fix: honour the void status, and reconcile provider intents against rows.

### ESC-35. Unauthenticated `pushVerifiedIdentityToConnect` (Low)
Source: identity J-4.

`lib/actions/merchant.ts:406` exports `pushVerifiedIdentityToConnect(profileId: string)` from `'use server'` with no authentication, using `createAdminClient()` to write any member's verified outputs onto their own Connect account. It could interfere with an in-progress onboarding (unverified). Fix: move it to a `server-only` module, like `lib/trades/completion.ts`, or require `profileId === user.id`.

### ESC-36. Evidence and attachment path spoofing (Low)
Source: RLS F7.

**Evidence.** `dispute_evidence` INSERT grants `media_paths` (`0082:195`), and `messages` grants `attachment_path` and `attachment_mime` (0100). Direct PostgREST skips `verifyEvidencePaths` (`disputeEvidence.ts:119`) and `verifyMessageAttachmentPath`. The signers sign whatever a visible row cites (`signEvidenceUrls` `:144`, `messageAttachments.ts:87`).

**Effects.** An attacker can cite the counterparty's own evidence under their own name and exceed the file limits. A cross-case read needs a guessed UUID path.

Fix: a BEFORE INSERT trigger enforcing the `author_id || '/'` (or `sender_id`) prefix and the count limit, or write through the service role.

### ESC-37. Settlement is not bound to the PaymentIntent (Low)
Source: RLS F8.

`settleCashSale` takes only `cashSaleId` (`cashSaleOrchestrator.ts:1805`). Any authentic `payment_intent.succeeded` with TRANSFER metadata for the sale settles it, whatever its id or `amount_received` (`webhook.ts:114`). `translateStripeEvent` ignores `event.account`. This is exploitable only if connected accounts can create PaymentIntents (recipient-only v2 accounts should not; that is a Dashboard setting). Fix: require `intent.id === sale.payment_transfer_id` and `amount_received === amount_cents`, and drop payment, charge and identity events carrying `event.account`.

### ESC-38. The return refund uses the default-region payment service (Low)
Source: RLS minor.

`app/api/webhooks/ship24/route.ts:216` runs `finalizeReturn` with `getPaymentService()` for the default region. For a non-AU sale, the refund or relist step runs against the wrong platform account, which matters now that 0122 opened another region. Fix: resolve the service from the sale's region.

### ESC-39. Hardening notes (Low)
Source: RLS minor and cash-sale refuted notes.

- No `alter default privileges ... revoke execute on functions from public`. New `cardtrade` functions are anon- and authenticated-executable until their own migration revokes them, and 0110 and 0117 show that is done by hand.
- `suggest_items_fuzzy` (`0130:59`) is granted to anon, so the steering claim of "only two member-executable functions" is stale.
- `STRIPE_WEBHOOK_TOLERANCE_SECONDS` is parsed but never passed (the effective 300 s default is correct).
- `/api/errors` accepts requests with no `Origin`, allowing fake error groups and reopening resolved ones.
- The Ship24 webhook secret travels in a query string, so it may appear in proxy logs.

---

## 4. Refuted hypotheses (checked and found safe)

- **Participant awards themselves the fraud capture.** `resolveTradeFraud` is `requireStaff`. The victim is validated against the participants (`admin.ts:614`, `reportObjectiveFraud`), and participant `resolveDispute` was removed (`trades.ts:776-789`). The insider residual is ESC-23.
- **Bond sized on what the trader gives (SINGLE-for-SINGLE, no cash).** It is crossed correctly at `tradeProposal.ts:500`, and there is no verification exemption (`resolveTradeBonds` passes `verified: false`).
- **Zero-value side gives an unbonded trade.** `tradeSidesAreValued` refuses zero (`tradeProposal.ts:494`). Near-zero is not blocked; see ESC-09.
- **`BondPolicy.ceilingCents` under-bonds today.** It defaults to `null` (`bondPolicy.ts:53`) and no caller passes a policy (`collateralPlacement.ts:236`).
- **`declared_value_cents` sizes a bond or fee.** It is never read for either, and only skews the display (ESC-09).
- **Seller bumps postage at the instant the buyer pays.** The `terms_version` bump plus `STALE_TERMS`, `claimPayment` version-guarded, and the amount recomputed in SQL (0050:235, 266).
- **Fee charged on a declined collateral hold.** `hold-failed` returns before `chargeFeesForAgreedTrade` (`collateralPlacement.ts:236-277`).
- **Idempotency key locks out collateral after a decline.** The attempt-numbered key `hold:<trade>:<trader>:<attempt>` (`tradeProposal.ts:525`). The residual is ESC-34.
- **Delivery-path shopfront double-sell becomes a cash buyer loss.** The buyer's funds are held until acceptance and disputes refund. The in-person and trade residuals are ESC-19 and ESC-20.
- **Direct PostgREST write of `fmv_cents` or item `status`.** There is no member UPDATE grant (`0072:203-211`).
- **Direct writes to contract tables** (`cash_sales`, `cash_sale_items`, `cash_sale_events`, `trades`, `trade_items`, `pre_auth_holds`, delivery details, `deal_invites`). The blanket revoke and default-privilege fix in 0072, plus `0008:366`, `0050:53-55`, `0057:96-98` and `0103:100-103`. Confirm live with `has_column_privilege`.
- **Member-executable money RPCs.** Every contract-mutating function is revoked from public in its latest migration (0011, 0053, 0057, 0064, 0072 §3, 0081, 0088, 0090, 0110, 0124). Ship24 and cron RPCs are `service_role` only (0011:113-117, verified).
- **Offer amount or `offered_by` tampering after insert.** UPDATE is limited to `status` (0072). The status residual is ESC-22.
- **Forged SYSTEM chat events.** `kind` and `system_event` are not granted (0077).
- **Self-promotion through profile columns, or self-granted VERIFIED or payout state.** Column allowlists in 0072, 0073, 0111 and 0128, table INSERT revoked (0077), `identity_check_session_id` not updatable (`0072:189`), and `requireStaff` reads its flags with the service role.
- **Hijacking another member's Identity session.** The session id is read from the caller's own profile on the server (`lib/actions/identity.ts:277-289, 524-541`), and the webhook routes by our own stamped metadata.
- **Forging identity in mock mode.** The mock `readIdentityCheck` returns PENDING on a fresh instance.
- **Paying a fraud-banned seller.** `cashSaleOrchestrator.ts:1878`, and `canReceiveFunds` for trade cash and victim payouts (`merchantOnboarding.ts:~286`).
- **Private-deal sale paid to an unverified seller.** `acceptCashSaleTerms` requires `sellerIdentityDisclosure`, which requires the Identity_Gate (`merchantOnboarding.ts:132`), plus buyer confirmation of the version.
- **Joining your own deal with the same account.** `dealInvites.ts:309`. A second account is trivial; see ESC-03.
- **Guessing deal invite tokens.** 144-bit `randomBytes(18)`.
- **Demo actions callable in production.** Server-gated by `isPaymentDemoEnabled()`, off in production by default and when Stripe is live. Mock signatures are rejected when live (`pipeline.ts:492`), except the ESC-16 edge case.
- **Stripe signature forgery or replay.** `constructEvent` with a 300 s tolerance (`webhook.ts:58`), several secrets tried, fail-closed with none set. Dedupe on SUCCESS, and reprocessing is safe through the state guards.
- **Forged Ship24 webhook.** Fails closed (503) without `SHIP24_WEBHOOK_SECRET`, with a constant-time compare (`route.ts:87-104`).
- **Unauthenticated jobs or payout drain.** `app/api/jobs/cash-sale-payouts/route.ts` fails closed with a constant-time bearer compare, and can only pay what is owed.
- **Mobile API bypass (cash sale and trades).** Every route authenticates by cookie or `getUser(token)`, never takes a user id from the body, and calls the same Server Action. The one exception is the client-supplied amount in ESC-22.
- **Buyer edits price or postage.** `proposeCashSalePrice` is seller-only, and `updateCashSaleTerms` refuses a buyer postage change (`NOT_PERMITTED`).
- **Double refund from a duplicate return event.** The RPC is monotonic on `return_carrier_delivered_at`, `markRefundDue` is idempotent on its nonce, and finalisation skips the provider call when already SETTLED.
- **Refund drain paying a contested return.** `listDueRefunds` has `.is('return_disputed_at', null)`. It is bypassed only by ESC-11's synchronous path.
- **Card setup hijack.** `completeInstrumentSetup` checks `intent.customer === payerId`.
- **Stored XSS against staff through evidence or attachments.**
  - Private buckets with MIME allowlists that exclude SVG and HTML (`0082:175`, 0100), served from the Storage origin.
  - React escaping. The only `dangerouslySetInnerHTML` is `JsonLd`, which escapes `<`.
  - Tracking links come from server templates, and social links are normalised to https.
- **Deleting an item with a live contract.** The foreign keys are NO ACTION, so the delete fails.

---

## 5. Unverifiable from code (check operationally)

| Behaviour | Why it matters | What to check |
|---|---|---|
| Automatic platform payouts OFF | The balance is commingled, so a sweep takes members' escrow (`stripe-payments.md` control 1) | Stripe Dashboard → Balance → Payout schedule = manual, for every regional platform account |
| Radar rules and 3DS on SetupIntent and charges | The only stolen-card control in ESC-03 and ESC-14. Off-session charges get no liability shift | Radar rules (block, review, "request 3DS"), the SetupIntent 3DS rate, early-fraud-warning webhook subscription |
| Authorisation lifetime per brand | ESC-17: the code assumes 7 days, but Visa MIT is about 4d18h | Sample `capture_before` on recent `pre_auth_holds` by card brand, and compare with `meeting_at` + 72h |
| Connected-account payout schedule and delay, `source_transaction` availability | How fast ESC-03, ESC-14 and ESC-20 money reaches a mule's bank | Connect settings → payout schedule and delay days for recipient accounts |
| Production `PAYOUT_MODE` | ESC-06: trade cash is never forwarded in `platform` mode, and ESC-03 cash-out runs in `direct` | Vercel env per environment |
| `PAYMENTS_PROVIDER`, `STRIPE_SECRET_KEY_*`, `WEBHOOK_SECRET`, `SHIP24_WEBHOOK_SECRET`, `JOBS_SECRET` set per region | ESC-16 mock fallback, the public mock HMAC, and the non-AU-only key edge case | Vercel env; `/api/health` should report the resolved provider |
| Stripe idempotent replay of a declined `confirm: true` intent | ESC-29: whether fee retries can ever succeed | One test-mode decline-then-retry with the same key |
| Restricted-key access to Identity `dob`, `id_number` and document number | ESC-15: whether the blocklist ever gets keys | Inspect a test-mode `verified_outputs` with the current key, and query `count(*)` of person keys in production |
| Multicapture eligibility | An alternative fix for ESC-01 | Stripe account capabilities |
| Whether recipient v2 connected accounts can create charges | ESC-37 | Connect configuration |
| Ship24 `events[]` ordering | `events[0]` is used as the delivery instant (`ship24Tracking.ts:82,129`, `route.ts:128`). If oldest-first, every honest window is shortened by transit time | A raw Ship24 payload for a delivered parcel |
| Ship24 emitting `delivered` for a tracker created on an already-delivered parcel | Whether ESC-12's return variant fires automatically | Register a known-delivered number in a sandbox |
| Whether the Ship24 webhook fires at all | ESC-30. The code header says it never has | Ship24 dashboard delivery logs |
| Live DB grants and policies, and `is_admin()` | Every RLS verdict above is read from migration text; 0121–0124 were hand-applied | `has_column_privilege` and `pg_policies` on `cash_sale_return_details`, `items`, `offers`, `dispute_evidence`, `messages`; `\df+ cardtrade.is_admin` |
| Live body of `trade_inspection_hours()` and `apply_cash_sale_tracking` | ESC-17 and ESC-02 assume the migration text is live | `select pg_get_functiondef('cardtrade.apply_cash_sale_tracking'::regproc)` and the same for `trade_inspection_hours` |
| Whether legacy `proposeTrade` has an action id in the build | ESC-32 reachability | `.next/server/server-reference-manifest.json` |
| Hosted Connect onboarding: whether prefilled individual details are editable | ESC-25 | One test-mode onboarding |
| Supabase Auth email confirmation and signup rate limits | Sybil account cost (ESC-03, ESC-24) | Supabase Auth settings |
