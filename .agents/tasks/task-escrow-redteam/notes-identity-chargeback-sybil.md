# Red team: identity / chargeback / Sybil and cash-out

Read-only review. No code changed, no Stripe or Supabase calls, `.env.local` not read. Line numbers are as of this review.

**Unverifiable from code (Stripe Dashboard or env):** Radar rules (block, review, "request 3DS"), whether 3DS fires at SetupIntent time, the connected-account payout schedule and delay, whether automatic platform payouts are off, the contents of the `STRIPE_IDENTITY_VERIFICATION_FLOW` Dashboard flow (live capture, selfie, ID number), Supabase Auth email-confirmation and signup rate limits, and the production `PAYOUT_MODE`. Wherever a verdict depends on one of these, it says so.

---

## H. Stolen-card cash-out through Sybil buyer and seller accounts — CONFIRMED

### Attack

1. Make two accounts with two emails. `S` is the seller. It passes Stripe Identity with a mule's or a stolen ID, then sets up Connect payouts to the mule's bank. `B` is the buyer. It needs no Identity, only a card.
2. `S` creates a private deal (`CASH_SALE`, host `SELLER`) with a hidden card at any price, up to `AGREED_PRICE_MAX = 99_999_999_999`. `B` opens the `/t/<token>` link.
3. `B` adds a stolen card through Payment Element (`beginCardSetup` has no rate limit). The seller sets the handover to `IN_PERSON` at any Google place, one minute in the future.
4. `B` presses Pay. The charge is off-session against the saved card, then the sale moves to `HANDOVER`.
5. Both accounts press "confirm handover". The second press completes the sale and runs `payoutCashSaleSeller` in the same request. The Stripe transfer goes out with `source_transaction`, so it does not wait for the funds to clear.
6. The money lands in the mule's Connect balance within seconds and reaches the bank on the Express payout schedule (Dashboard, unverifiable). The real cardholder's chargeback arrives weeks later and is debited from the platform.

### Evidence

- **Self-dealing checks compare profile ids only.**
  - `lib/actions/dealInvites.ts:309`: `if (invite.host_id === viewerId)`
  - `domain/orchestrator/cashSaleOrchestrator.ts:1114`: `if (item.ownerId === params.buyerId) return { ok: false, error: 'SELF_PURCHASE' }`
  - Trades use the same pattern: `lib/actions/tradeNegotiation.ts:695` and `0081_trade_against_shopfront.sql:115` (`p_initiator_id = p_counterpart_id`).
  - Nothing compares device, IP, card fingerprint (`pm.card.fingerprint`), Stripe Customer, or the buyer's card against the seller's Connect identity. A grep for `fingerprint` turns up only Identity HMACs.
- **Private-deal opening needs no card and no seller identity.**
  - `cashSaleOrchestrator.ts:1083-1099` (`openPrivateDealCashSale`): "Needs neither the Buyer's card nor the Seller's verified identity yet."
  - The card is demanded only at Pay (`acceptCashSaleTerms`, around line 1790).
- **Every charge is merchant-initiated (off-session), even though the buyer is present when they press Pay.**
  - `domain/services/stripe/StripeService.ts:745-757` (`requestTransfer`): `confirm: true, off_session: true` against the saved default payment method.
  - Cash-sale collection goes through it at `cashSaleOrchestrator.ts:1649`.
  - The card is vaulted with `usage: 'off_session'` at `StripeService.ts:467`.
  - Consequence: the charge carries no 3DS challenge and no 3DS liability shift. A fraudulent-card chargeback is always the platform's loss. No Radar session or IP is sent with the charge (`attachPaymentSource`'s `ipAddress` parameter is unused).
- **No delay between collection and payout on the in-person path.**
  - `cashSaleOrchestrator.ts:3154`: "In-person cash sales complete on the second confirmation."
  - `cashSaleOrchestrator.ts:3183`: `const released = await payoutCashSaleSeller(...)`.
  - `supabaseCashSaleRepository.ts:573-608` (`confirmHandover`): stamps the confirmation and completes with no check against `meeting_at`.
  - The meeting only has to be in the future when the terms are set (`cashSaleOrchestrator.ts:979`, `meetingAt.getTime() > now.getTime()`).
  - The buyer's inspection accept pays synchronously too (`cashSaleOrchestrator.ts:3133`). The hourly drain is only the fallback for lapsed inspections and retries.
- **The transfer does not wait for the charge to clear.**
  - `StripeService.ts:826`: `...(sourceTransaction ? { source_transaction: sourceTransaction } : {})` in `payoutToMerchant`.
- **No velocity limit, new-seller holdback or payout cap.**
  - `contractLimiter`, `listingLimiter` and `apiLimiter` are defined in `lib/rateLimiters.ts:36-91` but are imported nowhere under `lib/actions` or `app`.
  - The limiters that are in use are per-instance memory (`lib/rateLimit.ts:5`, "in-memory"), so on Vercel serverless they are close to inert.
  - Grepping for `PAYOUT_DELAY|holdback|first payout|risk score` found nothing.
- **Payout only checks that the seller is not banned and can receive funds.**
  - `cashSaleOrchestrator.ts:1878` (`fraudBannedAt`) and `:1894` (`canReceiveFunds`). It does not look at the buyer, at open chargebacks, or at the age of the account.
- **The mobile API is the same path, and easy to script.** `app/api/mobile/cash-sale/confirm-handover/route.ts` calls the same `confirmCashSaleHandover` with a Bearer JWT. `accept-terms` and `payments/*` mirror it.

### Verdict

CONFIRMED. The only guards are profile-id equality, and whatever Radar or 3DS does at SetupIntent time, which is Dashboard config and unverifiable here.

### Money impact

The full sale price per stolen card, plus Stripe's dispute fee, about A$15–25 each (from memory, not checked). The ceiling is set by issuer declines and Radar, not by code. The platform bears the loss (`losses_collector: 'application'` at `StripeService.ts:~993`, and no transfer reversal anywhere: grepping for `createReversal` and `reverse_transfer: true` finds nothing). Because the platform balance is commingled, the loss is paid out of other members' escrow until it is reconciled.

### Fixes, in priority order

1. **Payout holdback.** Do not release a Cash_Sale payout until at least N days after `payment_settled_at`, for example 7–14 days for sellers with fewer than K completed sales. Apply it to the in-person path too. `COMPLETED` should only queue the payout, never pay inline. Put the rule in a pure `domain/payouts/releasePolicy.ts`.
2. **Buyer-present payments.** Collect cash-sale payments on-session: create a PaymentIntent the browser confirms through Payment Element with `setup_future_usage` if needed. Add a Radar rule to request 3DS (Dashboard). This gets 3DS liability shift on the fraud reason codes. Keep `off_session` only for trade collateral captures.
3. **Self-dealing signals.**
   - Store `card.fingerprint` on `completeCardSetup`.
   - Refuse a sale or trade when the buyer's card fingerprint has ever been saved by the seller, or by any profile sharing a Connect external account or Identity person key with the seller.
   - Record the sign-up and pay IPs and device and flag matches for review.
4. **Velocity limits that actually hold.** Use a DB-backed or Upstash limiter on `beginCardSetup`, `acceptCashSaleTerms`, invite create and claim, plus per-seller daily payout caps for new sellers.
5. **Before every payout,** check for an open `charge_disputes` row (or a Radar early-fraud warning) on that sale and hold the release. See I.

---

## I. Chargebacks after payout: friendly fraud and captured collateral — CONFIRMED (recorded, not mitigated)

### Attack I-1: friendly fraud after the seller is paid

A real buyer pays with their own card, receives the card, accepts the inspection (or lets it auto-complete after 7 days), and the seller is paid. Within the issuer's window (often 120 days) they file "product not received" or "not as described". The platform is merchant of record and loses the amount plus a fee unless someone contests by hand and wins.

There are no consequences for the buyer. Buyers need no Identity, a lost chargeback triggers no automatic ban, and a new email plus a new card restarts everything.

### Attack I-2: a disputed charge before payout still pays out

A stolen-card buyer is disputed while the sale is still in `INSPECTION` or `HANDOVER`. Stripe has already debited the platform for the dispute, yet `payoutCashSaleSeller` still pays the seller.

### Attack I-3: reversing a trade-fraud capture

The offender in a confirmed Objective_Fraud trade has their collateral fully captured (`fullCapture`), and it is paid to the victim straight away. The offender, banned and with nothing to lose, then charges back the capture as "unauthorised" or "not recognised". The platform has already paid the victim, so it eats the loss. The same applies to the $20 Friction_Tax capture.

Combined with H: Sybil `A` (stolen card as collateral) and Sybil `B` (the "victim") run a trade in which `A` never ships. Staff see a genuine non-delivery and confirm fraud. `A`'s stolen card is captured at 100% of the side value and paid to `B`. The cardholder charges back. A human is in the loop, but the evidence staff see is real, so review is a weak control.

### Evidence

- **Disputes are recorded and admins are told. Nothing else happens.**
  - `lib/webhook/webhookPipeline.ts:398-425`: `CHARGE_DISPUTE` calls `record_charge_dispute`, "Never a Trade_State transition".
  - `supabase/migrations/0036_charge_disputes.sql:154`: `if v_is_new then insert into cardtrade.notifications ...`, which notifies admins only.
  - Translation: `domain/services/stripe/webhook.ts:185-216` handles `charge.dispute.created` and `.closed`. It does not handle `charge.dispute.updated`, `charge.dispute.funds_withdrawn` or `radar.early_fraud_warning.created`. The `warning_closed` outcome exists in the CHECK, but nothing ever produces it.
- **The payout path never reads `charge_disputes`.**
  - Grepping for `charge_disputes` in `domain/` finds nothing. `payoutCashSaleSeller` (`cashSaleOrchestrator.ts:1847-1960`) checks only the ban and `canReceiveFunds`.
  - The only consumer is the arbitration console warning: `lib/actions/arbitration.ts:773` (`openChargebackRef`), which is advisory.
- **No clawback.**
  - `StripeService.ts:~885`: "`reverse_transfer` is deliberately NOT set".
  - No `transfers.createReversal` exists anywhere, so money already transferred to a seller cannot be pulled back in code.
- **The fraud payout to the victim draws from the commingled balance immediately.**
  - `domain/orchestrator/disputeResolution.ts:697-702`: `payoutToMerchant({ merchantRef: victimPayee!.merchantRef!, amount: capturedCents, ... })` with no `sourcePaymentRef`.
  - So it does not even wait for the captured charge, which is effectively a CNP card charge, to clear.
- **Evidence submission is manual.** There is no Stripe `disputes.update` call anywhere. Contesting depends on staff working the Dashboard before `evidence_due_by`.

### Verdict

CONFIRMED. Detection exists (0036). There is no prevention, holdback, clawback or buyer consequence.

### Money impact

The disputed amount plus the fee, per dispute. I-3 can be large, because the hold is 100% of the side value and `DEAL_COLLATERAL_MAX` and `DEAL_CASH_MAX` are both 99,999,999,999 cents. The platform is the loss bearer in every case.

### Fixes

1. On `charge.disputed`, if the sale is not yet paid out, mark its payout `HELD_DISPUTE` so the drain skips it. If it has been paid, raise an arbitration case to recover the money (manual reversal or a negative-balance debit through Connect) and record `lost` against the seller and buyer for risk scoring.
2. Subscribe to and handle `radar.early_fraud_warning.created`. Refund before the chargeback arrives (this avoids the fee and the dispute count) and hold any payout.
3. Pay fraud victims with `sourcePaymentRef` set to the captured hold's charge, and only after a holdback. Consider releasing victim payouts only after the offender's dispute window or a cap.
4. Automate evidence submission (`disputes.update`) from what the contract already records: carrier tracking and delivery time, the buyer's handover, inspection-accept timestamps and IPs, the T&C acceptance, and chat.
5. Give buyers consequences: a lost `fraudulent` or `product_not_received` dispute flags the buyer's profile and blocks that card fingerprint from paying again.

---

## J. Identity versus payee, and ban evasion

### J-1: the person-key ban list is almost certainly empty in production — CONFIRMED (per Stripe docs; confirm with one test-mode session)

**Attack.** A banned scammer opens a new email, passes Stripe Identity again with the same passport, and is VERIFIED again, because no person key was ever stored for either account.

**Evidence.**

- Both reads expand only `verified_outputs` (`StripeService.ts:286` and `:312`: `expand: ['verified_outputs']`).
- Stripe's [Access verification results](https://docs.stripe.com/identity/access-verification-results) page says `verified_outputs.dob` and `verified_outputs.id_number` are sensitive. They need a restricted API key and an explicit expand of `verified_outputs.dob` and `verified_outputs.id_number`. Expanding `verified_outputs` returns only the fields a secret key can read: name, address, email and phone.
- The integration has no restricted key at all. `config.ts` builds a single client from `STRIPE_SECRET_KEY_*`.
- So `idNumber` (`StripeService.ts:364`) and `dob` both come back null. `identityFingerprint.ts:51` (`if (idNumber)`) and `:60` (`if (name && dob)`) both skip, and the function returns `[]`.
- `lib/identity/applyIdentityDecision.ts:28` (`if (fingerprints.length > 0)`) then skips the blocklist entirely and writes VERIFIED.
- `lib/auth/fraudBan.ts:136-152` (`blocklistIdentityOf`) re-reads with the same expansion, finds no keys, and returns `ok` without doing anything.
- The `verifiedDob` prefill into Connect is silently null for the same reason.
- `verified_outputs.id_number` is the output of the ID-number check, not the document number. The document number is `last_verification_report.document.number`. So even with the right key, `document-id` only exists where an ID-number check ran. The inline fallback sets `require_id_number: true` (`identitySession.ts:53`), but whether that check exists for AU is unverifiable.

**Even if DOB were readable,** the remaining `name-dob` key can be dodged by switching documents.

- The country comes from the address: `StripeService.ts:371` (`country: addr?.country`). A passport usually has no address, so the key becomes `v1:dob::name:dob`, while a licence gives `v1:dob:AU:...`. These are different hashes for the same person.
- First-name strings differ between documents ("JOHN PAUL" vs "JOHN"), which changes `normalizeName`.

**Verdict:** CONFIRMED. The guard 0105 intended is vacuous. Profile and auth bans still apply to each login.

**Money impact:** it gives unlimited fresh seller and trader identities to anyone already banned. It also defeats the sibling cascade in `fraudBan.ts:173-190`.

**Fix:**

- Create a restricted key with Identity Verification Results read. Use it only for `readIdentityCheck`, and expand `verified_outputs.dob`, `verified_outputs.id_number` and `last_verification_report.document.number` plus `issuing_country`.
- Hash the document number together with the issuing country, not the address country.
- Make the name+DOB key country-independent and based on surname plus first given name.
- Add a test that runs against a recorded test-mode session shape, not a hand-built mock.
- Note that restricted keys only read sensitive results for 48 hours unless IP-restricted, so stamp the keys at verification time. The current code already tries to.

### J-2: one identity, many accounts (Sybil sellers and both trade sides) — CONFIRMED

**What happens.** Person keys only block a match when one of the matching profiles is already banned (`applyIdentityDecision.ts:51-76`). Nothing caps how many VERIFIED profiles one person may hold. Combined with J-1, nothing links them at all. One mule can verify both `A` and `B` in the I-3 collusion. The trade's dual Identity_Gate (`acceptTradeTerms`) can then be met by a single human.

**Fix:** refuse, or send to review, a VERIFIED write whose person key already belongs to another live profile (with a staff override). Also refuse a contract between two profiles that share a person key, card fingerprint or Connect bank account.

### J-3: the verified name is never checked against the Connect payee — CONFIRMED (in code; Connect does its own KYC)

**Attack.** Verify Identity as person X (stolen or mule document, plus a selfie). In the hosted Connect onboarding, edit the prefilled individual details (whether they are editable is unverifiable) or keep X's name, and attach any bank account, such as a mule's. Buyers are shown X's name (`sellerIdentityDisclosure`, `merchantOnboarding.ts:146`) while the money goes wherever the Connect account points.

**Evidence.**

- `fromV2Account` reads `legalName` from `identity.individual` (`StripeService.ts:~1325`). Nothing compares it with `identity_check_name`; grepping for `nameMatch|NAME_MISMATCH` finds nothing.
- `applyComplianceUpdate` (`merchantOnboarding.ts:454-540`) stores the Connect name as `merchant_legal_entity_name`, with no cross-check.
- The bank account holder name is never read.
- The disclosure falls back to `merchant_legal_entity_name` whenever `identity_check_name` is null (`merchantOnboarding.ts:146`). For post-0069 members, that value is seeded from what the seller typed (`merchantOnboarding.ts:387`). The `nameIsDocumentVerified` flag exists, but the gate does not require it.

**Verdict:** CONFIRMED that the code has no link between the two. It is partly mitigated by Stripe Connect's own KYC of the account holder, which is a different check on a possibly different person, plus bank-name matching where Stripe does it (unverifiable).

**Impact:** the buyer-safety disclosure can name someone other than the person being paid, which weakens recovery and police referral.

**Fix:**

- After `refreshPayoutStatus`, compare the normalised Connect `identity.individual` given name and surname, and DOB once J-1 is fixed, with the Identity outputs.
- If they differ, set `canReceiveFunds` false with reason `PAYEE_IDENTITY_MISMATCH`.
- Require `nameIsDocumentVerified` for any disclosure created after 0069.

### J-4 (new, low): `pushVerifiedIdentityToConnect` is an unauthenticated Server Action that takes any `profileId`

**Evidence.**

- `lib/actions/merchant.ts:406`: `export const pushVerifiedIdentityToConnect = withActionLog(..., async function pushVerifiedIdentityToConnect(profileId: string)`.
- The module is `'use server'`, so every export is an addressable endpoint. The function never authenticates and uses `createAdminClient()` to read any member's `merchant_ref` and write their verified outputs onto their Connect account.

**Impact:** low. It writes a victim's own verified data onto that victim's own account and returns nothing. It is still an unauthenticated trigger of a provider write against any member, and it could interfere with a member's in-progress Connect onboarding (unverifiable).

**Fix:** move it to a `server-only` module (for example `lib/identity/pushToConnect.ts`), as `lib/trades/completion.ts` does, or authenticate it and require `profileId === user.id`.

---

## New attack recorded on this surface

### N-1: the trade cash leg is collected and never paid out in the default payout mode — CONFIRMED (in code; depends on the production `PAYOUT_MODE`)

**Evidence.**

- `lib/trades/completion.ts:151-158` calls `payments.requestTransfer({ payerId, amount: trade.cash_amount_cents, ..., merchantRef })`.
- `StripeService.ts:768` contains `const settleDirect = params.merchantRef && this.opts.config.payoutMode === 'direct'`, which returns `SETTLED` with no transfer when the mode is not `direct`.
- `config.ts:372` defaults the mode to `'platform'`.
- So in platform mode, the paying trader's card is charged, the receiver is never paid, and `manual_reconciliation` is set to `false` as if it settled.
- `retrySettleTradeCash` replays the same idempotent PaymentIntent and still makes no transfer. Grepping for `trade-cash` finds no other payout path.

**Impact.** In platform mode the receiver loses the cash-to-even amount and the platform silently keeps it. In `direct` mode the opposite problem appears: the cash leg is an off-session charge followed by an immediate transfer when the trade completes, which is another instant stolen-card cash-out path between two Sybil verified traders (same mechanics as H).

**Fix:** settle the trade cash leg the way cash sales are settled. Collect it into the platform (ideally when collateral locks), then release it with `payoutToMerchant` and `sourcePaymentRef` after completion and a holdback, regardless of `PAYOUT_MODE`.

---

## Refuted or mitigated (brief)

- **Hijacking another member's Identity session.** Refuted. The session id is read from the caller's own `profiles.identity_check_session_id` on the server (`lib/actions/identity.ts:277-289`, `:524-541`). The webhook routes by our own stamped metadata, and `identity_check_session_id` is not in the member UPDATE grant (`0072:189`).
- **Self-granting VERIFIED or payout columns.** Refuted. `0072` limits UPDATE to display name, email, region, onboarding, avatar, and `0128` adds email preferences. Table-level INSERT on profiles is revoked (`0077`).
- **Paying a fraud-banned seller.** Refuted. Blocked by `cashSaleOrchestrator.ts:1878`, and by `canReceiveFunds` for trade cash and victim payouts (`merchantOnboarding.ts:~286`).
- **Unauthenticated payout drain.** Refuted. `app/api/jobs/cash-sale-payouts/route.ts` fails closed and compares the bearer token in constant time. It can only pay what is already owed.
- **Private-deal sale paid to an unverified seller.** Refuted. `acceptCashSaleTerms` requires `sellerIdentityDisclosure`, which requires the Identity_Gate (`merchantOnboarding.ts:132`), plus buyer confirmation of the version. In platform mode, a seller without payouts simply has their payout held. That is safe, but it does not stop H.
- **Joining your own deal with the same account.** Refuted (`dealInvites.ts:309`). Joining with a second account is trivial (see H).
