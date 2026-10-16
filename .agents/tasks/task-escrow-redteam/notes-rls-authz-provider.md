# Red team: data layer, authorisation, provider trust

Scope: hypotheses K, L, M, R, S. Read-only code review. Nothing was run against Supabase or Stripe, so every grant and RLS conclusion comes from the migration text (latest definition wins). It has not been checked with `has_column_privilege`. 0077 is a reminder of why that matters: the files once said one thing and the database did another.

Severity is from the attacker's point of view: what money moves, and who ends up paying for it.

---

## Confirmed findings

### F1. A buyer can squat the seller's return address and receive the "return" themselves (K) — HIGH

How the attack works
1. The buyer has a sale they can dispute and wants to keep the goods and get their money back.
2. Using only the anon key and their own JWT, they call `POST /rest/v1/cash_sale_return_details` (Content-Profile `cardtrade`) with `{cash_sale_id: <own sale>, seller_id: <their own uid>, address_label: "<a friend's address>"}`. This works at any time, even before a dispute is raised.
3. RLS checks only that `seller_id` equals the caller. It never checks that the caller is the sale's seller, and nothing checks `seller_id = cash_sales.seller_id`.
   - `0088_return_conditional_refunds.sql:81`: `with check ((select auth.uid()) = seller_id);`
   - `0088:120`: `grant select, insert, update on cardtrade.cash_sale_return_details to authenticated;`
4. The buyer disputes. Staff award `REFUND_BUYER` with a return, and the sale moves to `RETURN_PENDING`.
5. The real seller cannot fix the row. `saveCashSaleReturnAddress` upserts through the cookie-bound client (`lib/actions/cashSale.ts:726`). The `ON CONFLICT DO UPDATE` hits a row whose `seller_id` is the buyer, so the UPDATE USING policy (`0088:83-87`) fails and the seller sees "Could not save the return address." The seller also cannot read the row, because `seller_select` requires their own uid.
6. The buyer reads "the seller's return address" (their own row, through `seller_select`) and posts any parcel to it. When Ship24 reports `DELIVERED`, `apply_cash_sale_return_tracking` calls `mark_cash_sale_refund_due(... amount_cents)` (0088, refund branch), and the refund goes out automatically unless the seller has already contested the return.

Verdict: CONFIRMED. The action's own seller check (`cashSale.ts:720`) is bypassed by going straight to PostgREST.

Money impact: a full refund, and the buyer keeps the goods. The seller bears the loss, or the platform if it makes the seller whole.

Fix:
- Revoke the member INSERT/UPDATE on this table and write it with the service role inside `saveCashSaleReturnAddress`, after its seller and status checks.
- Alternatively, make both policies `with check (exists (select 1 from cardtrade.cash_sales cs where cs.id = cash_sale_id and cs.seller_id = (select auth.uid()) and cs.status in ('RETURN_PENDING','RETURN_IN_TRANSIT')))`.
- Add a BEFORE INSERT/UPDATE trigger asserting `seller_id = cash_sales.seller_id`.
- Audit existing data: `select r.cash_sale_id from cardtrade.cash_sale_return_details r join cardtrade.cash_sales cs on cs.id = r.cash_sale_id where r.seller_id <> cs.seller_id;`

### F2. The buyer sets the price of a SINGLE listing, and the seller never consents before payment (L, R) — MEDIUM

How the attack works
1. The buyer calls `initiateCashSale({ itemId, agreedPriceCents: 50, ... })`. It is a public Server Action, and mobile exposes it as `POST /api/mobile/cash-sale/initiate` (passes `body.agreedPriceCents`).
   - `lib/actions/cashSale.ts:217` passes `agreedPriceCents: input.agreedPriceCents` straight through.
   - `cashSaleOrchestrator.ts:1190`: `: Math.trunc(params.agreedPriceCents ?? item.fmvCents);` The only bound is greater than zero.
   - This contradicts the rule the same file states at `:1505`: "THE SELLER SETS THE PRICE, AND ONLY THE SELLER". That rule is enforced only in `proposeCashSalePrice`.
2. The buyer sets the fulfilment terms. `updateCashSaleTerms` stops the buyer changing postage and stops the seller setting the address. Nothing stops the buyer choosing `IN_PERSON` with a suggested place and a future time. (I read this from the code and did not exercise it.)
3. The buyer pays. Since 0099, paying is buyer-only and needs no seller acceptance (`:1710`: `if (actor !== 'BUYER')`). The sale goes to `ESCROW_HELD`, the item is RESERVED, and cancelling is now refused, because cancel works only from `AGREEMENT`.
4. A second route reaches the same result. `offers.status` is member-UPDATEable (`0072:218`, policy `0078:196`) with no transition rule. A buyer can revive a counter-offer the seller WITHDREW (or one the buyer DECLINED) back to `PENDING`, then accept it (`offers.ts:393, 443`). Also, `respondToOffer` never checks `offer.seller_id === item.owner_id`, and `offers` INSERT grants `seller_id`, `offered_by`, `amount_cents` and `status` (`0077:73-75`). An attacker with two accounts can therefore insert a "seller-made" offer on a third party's item and accept it with the other account. The contract opens against the real owner at the attacker's price.

Verdict: CONFIRMED. No guard compares the buyer-supplied price with `item.fmv_cents`, and none asks the seller to accept it.

Money impact:
- The seller is bound to an arbitrary price. A careless or bulk seller who ships is paid almost nothing. A careful seller has to raise a dispute or settle to get out.
- The platform pays non-refundable card fees on every charge-and-refund cycle.
- The listing can be locked as a griefing tactic.

Fix:
- Drop `agreedPriceCents` from the public `initiateCashSale` input. Only the server-side offer-accept path should pass a price.
- Require a seller acceptance of `terms_version` whenever `agreed_price_cents <> item.fmv_cents`.
- Revoke the member `offers` UPDATE and do every status change through the service role in `respondToOffer`, with legal transitions only.
- Add a BEFORE INSERT trigger asserting `offers.seller_id = items.owner_id`.

### F3. Ship24's delivery time and tracking numbers are trusted as if they belonged to the sale (M, provider trust) — HIGH

How the attack works
- **Variant A, a stale tracking number.** The seller records a tracking number for any parcel that was delivered more than 7 days ago. `recordCashSaleShipment` checks only that the number is at least 2 characters (`cashSaleOrchestrator.ts:3016`). Ship24 reports `delivered` using the carrier's original timestamp (`ship24/route.ts:128`; `syncCashSaleTracking` passes `snapshot.deliveredAt` at `:3101`). `apply_cash_sale_tracking` then sets `inspection_deadline_at = p_delivered_at + 7 days` with no floor (`0011:71`: `v_delivered_at := coalesce(p_delivered_at, now());`, `:81`). The deadline is already in the past, so the `:07` cron (`0038:129`: `inspection_deadline_at <= now()`) completes the sale and the `:47` drain pays the seller. The buyer has no more than about an hour, and nothing ever shipped.
- **Variant B, reusing another sale's number.** Tracking numbers are not unique and are not tied to a sale (there is no unique index in any migration). The webhook updates every live sale carrying the number (`ship24/route.ts:145`, `.limit(5)`). A seller can reuse a number they saw as a buyer elsewhere, or their own parcel to a different person, and get "carrier-confirmed delivery" on a sale where nothing was sent.
- Trades are protected and cash sales are not. `0057:206`: `v_floor := now() + make_interval(hours => ...floor_hours())`.

Verdict: CONFIRMED. The Ship24 secret authenticates the webhook (`route.ts:87-104`), but nothing binds the data to the contract.

Money impact: the full sale price goes to a seller who shipped nothing. The buyer bears the loss, then the platform via chargeback, since it is merchant of record.

Fix:
- Compute the deadline as `greatest(delivered_at, now(), shipped_at) + 7 days`.
- Treat `delivered_at < shipped_at` as a red flag: hold the clock and alert an operator.
- Add a partial unique index on `(lower(tracking_carrier), tracking_number)` across non-terminal cash sales and trades, and the return leg too.
- Where Ship24 exposes a destination postcode, compare it with the buyer's delivery address.

### F4. A missing Stripe key silently switches to MockService, and the mock webhook secret is public (M) — HIGH, depends on configuration

How the attack works
- In production, if `STRIPE_SECRET_KEY` is missing and `PAYMENTS_PROVIDER` is unset, `resolvePaymentProvider` returns `'mock'` (`providerMode.ts:37`: `return isStripeConfigured(env) ? 'stripe' : 'mock';`), and `getPaymentService` returns `new MockService` (`index.ts:114`).
- The mock's `requestTransfer` returns `SETTLED` straight away (`MockService.ts:331`), so `submitClaimedPayment` puts the sale in `ESCROW_HELD` (`cashSaleOrchestrator.ts:1682`) without any money being taken. Payouts also "settle" in the mock (`:360`).
- Nothing at startup or in `/api/health` refuses mock in production.
- With mock active and `WEBHOOK_SECRET` unset, the webhook route accepts an HMAC keyed with the hard-coded `'dev-mock-webhook-secret'` (`webhookPipeline.ts:74`, `index.ts:63`, `demo.ts:86`). Anyone can POST forged `transfer.settled` (any `cashSaleId`), `hold.active` / `hold.failed` (any `tradeId`), or capture events.
- An edge case in the real-money direction: `isLivePaymentsProvider` checks only the AU key (`providerMode.ts:48`). With `PAYMENTS_PROVIDER=stripe` and only a non-AU key (US trading opened in 0122), mock-signed webhooks are still accepted (`pipeline.ts:492` gates on that function) while real Stripe moves US money. A forged `hold.active` locks a US trade with no real collateral, and a forged `transfer.settled` releases goods with no payment collected.
- What mitigates it:
  - Identity cannot be forged. The mock's `readIdentityCheck` keeps per-instance state and returns `PENDING`, so a forged `identity.verified` writes nothing.
  - The demo actions are gated on the server (`demo.ts:142/283/415`) and are off in production by default (`providerMode.ts:96`).

Verdict: PARTIALLY-MITIGATED. Setting `PAYMENTS_PROVIDER=stripe` explicitly fails closed. An unset value fails open. I could not check the real Vercel environment from code.

Money impact: on a misconfigured deployment, every sale "settles" with no money. Sellers who already passed verification ship to buyers who paid nothing, and their payouts are fake. In the US-only-key edge case, the platform loses real money.

Fix:
- When `VERCEL_ENV`/`NODE_ENV` is production, refuse mock unless `PAYMENTS_PROVIDER=mock` and an explicit `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true` are both set.
- Remove the default `WEBHOOK_SECRET` and fail closed when it is unset.
- Reject mock signatures whenever `allConfiguredRegionCodes().length > 0`.
- Make `/api/health` report the provider that resolved.

### F5. One staff member decides who gets the money, and nothing stops self-dealing (L, insider) — MEDIUM-HIGH

How the attack works
- `resolveTradeFraud(tradeId, victimId)`, `resolveCashSaleDispute(... refundCents, requireReturn)` and `resolveCashSaleReturnCase` are all `requireStaff()` only (`admin.ts:486, 618, 432`).
- One support worker colluding with a trader can do any of these:
  - Name that trader as the fraud victim. The counterparty's collateral (100% of FMV) is captured and paid out, and the counterparty is banned for life and their identity blocklisted.
  - Award `REFUND_BUYER` with `requireReturn=false`, so the refund goes out with no return.
  - Release the money to a colluding seller.
- None of these exist:
  - a check that the staffer is not a participant in the case
  - a second approver
  - an amount threshold
  - a cooling-off delay before the money moves
- A related bug: `reportObjectiveFraud` commits `FRAUD_CONFIRMED` before it validates the victim (`disputeResolution.ts:608` then `:619-621`). A wrong `victimId` leaves the trade terminal in `FRAUD_RESOLVED`, with nothing captured and both holds left live, so they strand until they lapse.

Verdict: CONFIRMED. The only bound is that the victim must be a participant and a partial refund must be below the amount collected.

Money impact: up to the full value of the contract per case. The honest counterparty bears it.

Fix:
- Refuse when the staffer is a participant, and when the staffer is related to one (same payout account or identity fingerprint).
- Require two-person approval for every fraud capture, every refund with `requireReturn=false`, and anything over a threshold.
- Validate `victimId` before `applyEvent`.
- Notify both parties and wait 24 hours before the capture or transfer runs.

### F6. Listings can be published without passing the Identity_Gate, by inserting directly (K) — MEDIUM

How the attack works
- The `items` INSERT grant includes `status`, `hidden` and `listing_kind` (`0077:58-60`). The policy checks only `owner_id = auth.uid()`.
- `createItem` inserts through the cookie-bound client (`listings.ts:495`), so the gate exists only in the action.
- The catalog policy has no verification term (`0094:50-57`). The catalog query drops the filter on the stated assumption that "Publishing requires the Identity_Gate" (`listings.ts:1459`).
- So an unverified account, or a throwaway one, can publish catalog listings that also skip `validateItemSubmission` (category, condition, price bounds, and whose images they use). Buying such a listing fails later with `SELLER_IDENTITY_UNVERIFIED`, so escrow money is not at risk. The listing works as bait to pull buyers off the platform ("message me, pay by PayID").

Verdict: CONFIRMED.

Money impact: no escrow money is at risk, but it opens an off-platform scam funnel under NoDitto's name.

Fix:
- Revoke the member INSERT on `items` and insert with the service role after the gate.
- Or add `with check (exists (select 1 from cardtrade.profiles p where p.id = auth.uid() and p.identity_check_status = 'VERIFIED'))` and CHECK constraints that mirror the validator.
- Restore the `seller_identity_verified` filter in the catalog query as a second check.

### F7. Direct inserts let evidence and attachment rows point at any stored file (K, S) — LOW

- `dispute_evidence` INSERT grants `media_paths` (`0082:195`). `messages` INSERT grants `attachment_path` and `attachment_mime` (0100).
- Going straight to PostgREST skips `verifyEvidencePaths` (`disputeEvidence.ts:119`, the prefix and existence check) and `verifyMessageAttachmentPath`.
- The signers sign whatever a visible row cites (`signEvidenceUrls` `:144`; `messageAttachments.ts:87` only checks that the path sits in a message the caller can see).
- Effects:
  - An attacker can cite the counterparty's own evidence files under their own name, which misleads the arbitrator.
  - They can attach more files than the limit.
  - A cross-case read is possible only by guessing `authorUuid/randomUuid`.

Verdict: CONFIRMED, LOW.

Fix: a BEFORE INSERT trigger asserting each path starts with `author_id || '/'` (or `sender_id || '/'`) and that the count is within the limit. Better still, write through the service role.

### F8. Stripe settlement is not tied to a specific payment or amount (M, defence in depth) — LOW

- `settleCashSale` takes only `cashSaleId` (`cashSaleOrchestrator.ts:1805`). Any authentic `payment_intent.succeeded` with TRANSFER-kind metadata for that sale settles it, whatever the PaymentIntent id or `amount_received` (`webhook.ts:114`).
- `translateStripeEvent` never looks at `event.account`, so Connect-endpoint events from connected accounts are translated the same way as platform events. This can only be exploited if a connected account can create PaymentIntents with chosen metadata. Recipient-only v2 accounts cannot; that is set in the Dashboard and I could not verify it.

Fix: require `intent.id === sale.payment_transfer_id` and `amount_received === amount_cents`, and drop payment, charge and identity events that carry `event.account`.

### New minor issues found along the way

- The Ship24 return leg calls `finalizeReturn` with `getPaymentService()` for the default region (`ship24/route.ts:216`). For a non-AU sale, the refund or relisting step runs against the wrong platform account.
- No `alter default privileges ... revoke execute on functions from public` exists. Every NEW `cardtrade` function can be executed by anon/authenticated until its own migration revokes it. Today they all do; 0110/0117 show this is remembered by hand, not enforced.
- Member-executable functions are `is_fraud_banned`, `member_sale_stats` and also `suggest_items_fuzzy` (`0130:59`, granted to anon). It is read-only, but the steering claim of "only two" is out of date. `is_admin()` is not in any migration, so its definition and grants cannot be checked from code.
- `STRIPE_WEBHOOK_TOLERANCE_SECONDS` is parsed in `config.ts` but the pipeline never passes it. That is a dead setting; the effective window is the 300 s default, in seconds, which is correct.
- `/api/errors` accepts requests with no `Origin` header. Within the rate limit, a non-browser caller can inject fake CLIENT error groups or reopen resolved ones. Low; this is noise for admins, not money.

---

## Refuted, with the guard that stops each one

- **Direct writes to contract tables** (`cash_sales`, `cash_sale_items`, `cash_sale_events`, `trades`, `trade_items`, `pre_auth_holds`, `cash_sale_delivery_details`, `trade_delivery_details`, `deal_invites`). Blocked by the blanket revoke and default-privilege fix in 0072, plus `0008:366`, `0050:53-55`, `0057:96-98` and `0103:100-103`. All writes go through the service role. Caveat: confirm with `has_column_privilege`.
- **Member-executable SECURITY DEFINER or money RPCs.** Every function that mutates a contract is revoked from public in its latest migration (0011, 0053, 0057, 0064, 0072 §3, 0081, 0088, 0090, 0110, 0124). The functions left unrevoked are trigger functions or pure helpers (`add_business_days`, `describe_*`, `*_hours`, `is_staff`).
- **Offer amount or `offered_by` tampering after insert.** UPDATE is limited to `status` (0072). F2 is the residual risk.
- **Forged SYSTEM chat events** (`kind`, `system_event`). Not granted (0077).
- **Self-promotion through profile columns.** The column allowlists in 0072, 0073 and 0111 cover it, and `requireStaff` reads its flags with the service role.
- **Demo actions callable in production.** Gated on the server by `isPaymentDemoEnabled()`, which is off in production by default and off when Stripe is live. Mock signatures are rejected when live (`pipeline.ts:492`). The exception is the edge case in F4.
- **Stripe signature or replay.** `constructEvent` runs with a 300-second tolerance (`webhook.ts:58`). Several secrets are tried, and the pipeline fails closed with none configured. Dedupe works on SUCCESS; reprocessing a FAILURE or NO_OP is safe because of the state guards.
- **Ship24 or jobs endpoints without credentials.** Both fail closed and compare secrets in constant time.
- **Mobile API bypass.** Every route authenticates by cookie or by a bearer token validated with `getUser(token)`, never takes a user id from the body, and calls the same Server Action as the web. The one client-supplied amount that matters is `cash-sale/initiate` `agreedPriceCents`, which is F2 and affects the web equally.
- **Card setup hijack.** `completeInstrumentSetup` checks that `intent.customer === payerId`.
- **Stored XSS against staff through evidence or attachments.**
  - Both buckets are private, with MIME allowlists that exclude SVG and HTML (`0082:175`, 0100).
  - Files are served from the Supabase Storage origin, not the app origin.
  - Text is escaped by React. The only `dangerouslySetInnerHTML` is `JsonLd`, which escapes `<`.
  - Tracking links come from server-side carrier templates.
  - Social links are normalised to https.
  - Path traversal is blocked by the prefix check plus the Storage existence check. Whether `..` segments are normalised is up to the Storage API and cannot be verified from code.
- **Deleting an item that has a live contract.** The foreign keys have no `ON DELETE CASCADE` (NO ACTION), so the delete fails.
- **Guessing deal invite tokens.** Tokens are 144-bit `randomBytes(18)`.
- **Forging identity verification in mock mode.** The mock's `readIdentityCheck` returns PENDING on a fresh instance.

## Depends on runtime or Dashboard settings (cannot verify from code)

- The real grants and policies in the live database (`has_column_privilege`, `pg_policies`), and the definition of `is_admin()`.
- Vercel env: whether `STRIPE_SECRET_KEY`, `PAYMENTS_PROVIDER`, `WEBHOOK_SECRET`, `SHIP24_WEBHOOK_SECRET` and `JOBS_SECRET` are set, and per region.
- Stripe Dashboard: whether connected accounts can create charges; the Connect endpoint's event selection; whether automatic payouts are off.
- Ship24: the order of `events[]` and whether a tracker registered for an already-delivered parcel immediately emits `delivered`.
