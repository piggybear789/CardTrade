# Stripe — Integration Rules

Rules for anything that touches the payment provider (Stripe). Replaces the former
Pinch steering docs; the Pinch binding has been removed entirely.

## The seam is non-negotiable

`domain/services/types.ts` defines `PaymentService` / `PayerService`. Everything
else (orchestrators, state machine, server actions, UI) depends on those
interfaces only.

- The concrete binding is chosen in exactly one place: `getPaymentService()` in
  `domain/services/index.ts` via `resolvePaymentProvider()`. Credentials present
  → Stripe; `PAYMENTS_PROVIDER=mock` → Mock; explicit `PAYMENTS_PROVIDER=stripe`
  without a key fails closed (no silent fake money).
- The real binding lives in `domain/services/stripe/`: `config.ts` (env),
  `StripeService.ts` (the contract), `metadata.ts` (CardTrade context on provider
  records), `webhook.ts` (signature verification + event translation),
  `index.ts` (client + service factories).
- Never `import` the Stripe SDK outside `domain/services/stripe/**`, except
  `lib/webhook/webhookPipeline.ts`, which uses the verification and translation
  helpers. If a Stripe behaviour does not fit the interface, change the interface
  deliberately and update `MockService` and `InMemoryService` in the same pass —
  do not leak Stripe types into callers.
- `isLivePaymentsProvider()` means "a real provider", NOT "real money". A
  `sk_test_` key makes real API calls and places real authorisations that move no
  real funds. Use `isRealMoneyProvider()` for the money question, and gate demo
  panels on `isPaymentDemoEnabled()`.

## Money

Stripe amounts are integer cents, same as ours. Pass `fmvCents` / `amountCents`
straight through. No floats, no dollar conversion outside display formatting
(`lib/format.ts`). Currency is the CONTRACT's own (`cash_sales.currency`,
`trades.currency`) and is passed to every Stripe call; see "One platform, many regions".

## Escrow holds are REAL authorisations

Unlike the previous provider — which had no authorize/capture/void primitives and
forced a charge-and-refund simulation where collateral genuinely left the
trader's account — Stripe exposes the primitives directly:

| Contract | Stripe call |
| --- | --- |
| `placeHold(amount)` | `paymentIntents.create({ capture_method: 'manual', confirm: true, off_session: true })`; `holdId` is the `pi_...` id |
| `voidHold(holdId)` | `paymentIntents.cancel` |
| `partialCapture(holdId, amount)` | `paymentIntents.capture({ amount_to_capture })` — Stripe releases the remainder automatically |
| `fullCapture(holdId)` | `paymentIntents.capture()` |
| `requestTransfer(amount)` | `paymentIntents.create` + `transfers.create` when settling to a Seller |

`placeHold` moves NO funds. Verify with `scripts/smoke-stripe-test.ts`, which
asserts `amount_received === 0` on an active hold.

**Authorisations expire, and the budget is 114 hours, not 7 days (ESC-17a).** A
merchant-initiated (off-session) card auth lasts about 4 days 18 hours on the shortest
common brand. Every hold reports `expiresAt`, read from the charge's `capture_before`;
the fallback with no `capture_before` is `created + CARD_AUTHORISATION_HOURS` (114).
The trade clock is planned inside it: placement lead 24h + inspection 72h + margin
18h = 114h, pinned by `tests/unit/tradeClockAgreement.test.ts`. `readHoldExpiry` re-reads
the provider's real expiry for rows still carrying the old 7-day estimate
(`expires_at_estimated`, 0133). There is no re-authorisation: a DISPUTED trade's hold is
captured into custody before it lapses instead (see product.md). Do not treat
`expiresAt` as advisory.

**Single capture (ESC-01/07).** An authorisation is captured at most once: a partial
capture makes Stripe release the remainder, and a second capture fails. `fullCapture`
and `partialCapture` retrieve the intent first and return FAILED unless it is
`requires_capture`. `InMemoryService` and `MockService` model this exactly, with bounded
refunds, so a test cannot pass on a capture real Stripe would refuse. Every capture
targets `currentLiveHold` (`domain/bond/currentHolds.ts`), never "the first hold row".

**Hold events no longer drive transitions (ESC-08).** `hold.active` / `hold.failed`
map to `HOLD_STATUS`, a statement about ONE hold. The trade locks only through
`confirmCollateralIfComplete` (`domain/orchestrator/collateralReconcile.ts`), when
EVERY trader's current hold is ACTIVE; it sends the "collateral locked" notification
exactly once.

**Fail closed (ESC-16).** In production, a missing Stripe key resolves to
`unconfigured` and `getPaymentService` throws `PaymentsUnconfiguredError`; the mock
needs `PAYMENTS_PROVIDER=mock` AND `ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true`. There is no
default `WEBHOOK_SECRET`; mock-signed webhooks are accepted only while the mock is the
active provider and a secret is set (`acceptsMockWebhooks`).

Holds, captures and transfers report failure through their `status` field rather
than throwing, so the compensating logic (Req 4.4, 5.6, 7.6, 8.6) still runs.
`createPayer` does throw, because a payer failure must leave verification state
untouched (Req 2.6).

Collateral is **card-only** (`payment_method_types: ['card']`). BECS Direct Debit
does not support manual capture at all, and its 7-year no-questions-asked dispute
window makes it a poor fit for escrow where the platform is merchant of record.

## Bank rails for cash sales (0158)

A cash sale (only) may be paid from the buyer's bank: `US_BANK` (Instant Bank Payments,
Stripe type `link`), `IDEAL`, `BANCONTACT`, `EPS`, `P24`, `PAYTO`. The catalog, the
buyer-region and currency eligibility, and the dispute profile live in
`domain/payments/paymentMethods.ts`; each rail's clean buyer rate is `BANK_FEES`, and
its Stripe cost (what the rate is checked against) `STRIPE_BANK_COSTS`, both in
`domain/fees/processingFee.ts` (verify the costs against the Dashboard before live).
All six rails were enabled on both TEST accounts (payment method configuration) on
2026-10-21 and each opened, read back as resumable and cancelled through
`StripeService`. The LIVE accounts still need iDEAL and Przelewy24 (US) and PayTo (AU)
turned on in the Dashboard.

- The buyer picks the rail in the Pay dialog. `acceptCashSaleTerms(…, paymentMethod)`
  re-prices the fee for it (`serviceFeeForMethod` / `totalForMethod`, the same
  functions the dialog shows), ESC-31 compares the shown total for THAT rail, and
  `claimPayment` writes `payment_method_kind`, `platform_fee_cents` and `amount_cents`
  in one guarded UPDATE so the seller's net is right for the rail charged.
- `requestTransfer({ paymentMethod })` for a bank rail creates the PaymentIntent
  UNCONFIRMED with exactly that one `payment_method_types` entry (no fallback to a
  differently priced method) and returns `REQUIRES_ACTION` with the client secret. The
  room confirms it with Payment Element (`components/sales/BankPaymentForm.tsx`);
  redirect rails return to `/sales/<id>?payment=return`, which reads the payment back.
- A bank intent at `requires_payment_method` is RESUMABLE, not failed:
  `collectionStatusOf` maps it to `REQUIRES_ACTION` and `translateStripeEvent` drops its
  `payment_intent.payment_failed`. The `:47` sweep cancels it after 30 minutes and the
  sale returns to AGREEMENT. A card intent there is still a decline.
- A bank rail the provider will not open (rail not enabled, a cross-border seller
  account without the rail's capability) collected nothing, so the sale goes back to
  AGREEMENT with `NOT_SUPPORTED`, never FAILED. Cross-border accounts now request
  `ideal_payments`, `bancontact_payments`, `eps_payments`, `p24_payments`; accounts
  created before that need the capability added before EU bank rails work for them.
- Never add `us_bank_account` (ACH Direct Debit): its returns cannot be contested, and
  enabling it makes Stripe hide Instant Bank Payments. PayTo disputes are FINAL against
  the platform; US bank disputes are contested like card chargebacks; the EU rails have
  no bank dispute process.
- **US_BANK is defined but NOT OFFERED** (`offered: false`). Payment Element refuses to
  render `link` on its own ("pass both 'link' and 'card'"), so an intent for that rail
  alone cannot be approved, and one with card as well lets a buyer pay by card at the
  bank price. Offering it needs the deferred flow (the buyer picks in Payment Element,
  then the server prices the intent from the confirmation token's payment method).
- **A card is priced by where it was issued (0159).** `describeInstrument` returns
  `country` (Stripe's `card.country`), and `cardMethodFor(currency, country)` picks
  `CARD`, `CARD_UK_EEA` or `CARD_INTERNATIONAL`, each with its own clean rate and Stripe
  cost table. The tiers are what CARD is priced as, never a choice: any card kind a
  caller sends is read as card. `acceptCashSaleTerms` re-reads the saved card, refuses
  a shown total for another tier as `CARD_REPRICED` (sale untouched), and passes
  `requestTransfer({ sourceId })` so the charge is made on THAT card, not the
  Customer's default. A caller with no expected total (mobile) is held to the stored
  total. `getPaymentMethodStatus` now reads the card through the member's own region's
  platform; it read the default AU account, so a US/UK/EEA member's card was invisible.
  Verified in test mode 2026-10-22: `pm_card_visa` on the AU platform cost 454 on
  A$121.35 (table 455), charged 635; `pm_card_gb` to a German seller priced 520.
- **Buy Now needs no saved card.** `initiateCashSale` opens the agreement without one,
  like `openPrivateDealCashSale`; the card (or a bank rail) is required at Pay.
- **The cash-sale money actions are bound to the SALE'S platform** (`orchestratorFor` in
  `lib/actions/cashSale.ts`, via `regionForCashSale`): Pay, the read-back, the resume,
  inspection acceptance and the in-person handover (both pay the seller on completion),
  and a party's dispute settlement. They used the default AU account, so every EUR/USD
  sale failed at Pay ("No such on_behalf_of" / "No such customer"), found end to end on
  2026-10-21. A new provider-reaching action in that module must use `orchestratorFor`.
- Verified end to end on 2026-10-21 in TEST mode: `npm run smoke:stripe:bank-rails`
  (every rail and card: Pay, the buyer's approval in a real browser, read-back into
  escrow, ship, receive, accept, the seller transfer, and a refund over the rail) and
  `npm run test:e2e:stripe` (PayTo and iDEAL through the real contract room, including
  the bank redirect and the return to `/sales/<id>?payment=return`). Stripe's test mode
  reported no fee on the EUR on-behalf-of charges, so the EU rows of `STRIPE_BANK_COSTS`
  remain unverified estimates; PayTo (A$1.49 on A$118.48) and AU domestic card matched
  the table exactly. A US-issued card on the AU platform cost A$4.47 against a A$4.05
  fee: the documented international-card gap is real.

## Card data never touches our server

Card fields are rendered by Stripe inside its own iframe via Payment Element. The
flow is `beginCardSetup()` → SetupIntent → Payment Element →
`stripe.confirmSetup()` → `completeCardSetup(setupId)`.

Do NOT add payer instrument fields — card number, CVC, expiry, or a BSB/account
number being debited — to any zod schema, server action, form payload, component
state, or table. There is no longer any exception to this rule: the previous
provider needed raw settlement-account details for payee onboarding, and Stripe
collects those itself.

`completeCardSetup` reads the brand and last4 back FROM Stripe rather than
accepting them from the client, so a saved-method label cannot be spoofed.

## Idempotency

Every write in `StripeService` carries an explicit `idempotencyKey`:

- holds → `hold:${ref}` (stable per trade and trader, so a retry cannot
  double-authorise the same collateral)
- transfers → the persisted `nonce`, reused verbatim on retry, never regenerated
- payers → `payer:${profileId}`

The SDK is configured with `maxNetworkRetries: 2`, which is safe precisely
because every write is keyed.

A collection the payer can RETRY gets one key per ATTEMPT, never one per contract:
cash sales use `cash-sale:<id>:terms:<v>:attempt:<n>` (`cash_sales.payment_attempt`,
0138) and trade cash uses `trade-cash:collect:<tradeId>:<n>`. A fixed key made a
re-pay after an abandoned 3-D Secure check replay Stripe's cached, cancelled intent.
A crash-retry of the SAME attempt still reuses its persisted nonce.

## Buyer-present collection (ESC-03, ESC-05)

Money a member PAYS (a cash sale, a trade's cash leg) is collected with the payer
present: `requestTransfer({ presence: { kind: 'BUYER_PRESENT', threeDS } })` omits
`off_session`, sets `payment_method_options.card.request_three_d_secure` from
`domain/payments/scaPolicy.ts`, and passes `use_stripe_sdk` so the browser's
`stripe.handleNextAction` can run the check in place. `requires_action` comes back as
`REQUIRES_ACTION` with the client secret (never persisted or logged); the room runs the
check and then a read-back action (`confirmCashSalePayment`, `confirmTradeCashPayment`)
decides through `readCollection`. A secret is re-read from Stripe for "Complete
payment", so a reload or a second device can finish it. Off-session is for collateral
holds and the Trade_Fee only.

`cancelCollection` treats a refusal on a succeeded intent as `ALREADY_SETTLED`. The
`:47` job cancels a check left unfinished for 30 minutes (cash sale back to AGREEMENT,
trade cash back to NOT_COLLECTED) or settles it if it finished meanwhile.

Settlement is BOUND to the sale's own collection (ESC-37): `settleCashSale` requires the
webhook's PaymentIntent to be the recorded `transfer_id` and its `amount_received` to be
the contract amount, else `SETTLEMENT_MISMATCH` (unexpected). `translateStripeEvent`
drops `payment_intent.*`, `charge.*` and `identity.*` events carrying `event.account`:
those happened inside a member's own connected account.

## Webhooks

`app/api/webhooks/stripe/route.ts` is signature-authenticated, not
session-authenticated. Keep it that way: verify first, mutate second, log the
outcome, always ack authentic events with 200.

Only `authenticate()` in `lib/webhook/webhookPipeline.ts` is provider-specific.
Everything after it — dedupe, map, dispatch, log — is provider-agnostic.

- Verification is `stripe.webhooks.constructEvent`, which checks the HMAC over the
  exact raw bytes and enforces the replay window. **The tolerance argument is in
  SECONDS.** Passing milliseconds silently widens the window to days.
- **Two endpoints are required, not one.** Our PaymentIntents are created on the
  PLATFORM (separate charges and transfers), so `payment_intent.*`, `charge.*` and
  `identity.*` are platform events; `account.updated` for a connected account is a
  Connect event and needs `connect: true`. A single endpoint cannot serve both.
- A signing secret is returned only once, at endpoint creation, and cannot be
  re-read through the API. Copy it from the Dashboard, or use `stripe listen`
  locally, which mints its own separate secret.
- **Several secrets are supported and expected.** `readWebhookSecrets()` accepts a
  comma-, whitespace- or non-separated list in `STRIPE_WEBHOOK_SECRET` plus an
  optional `STRIPE_CONNECT_WEBHOOK_SECRET`, and verification tries each in turn. A
  delivery is authentic if ANY configured endpoint signed it, so ordering does not
  matter and a local `stripe listen` secret can sit alongside the deployed ones.
  Values that do not match `whsec_...` are dropped rather than trusted.
- Map Stripe event types in `translateStripeEvent`, then to internal actions in
  `domain/webhook/mapEventToAction.ts`. Unknown or unroutable events are a logged
  `NO_OP`, never an error.
- Routing depends on the `cardtrade_*` metadata stamped on every PaymentIntent:
  one provider event (`payment_intent.succeeded`) means different things depending
  on it. A PaymentIntent created outside `StripeService` is unroutable.
- `payment_intent.amount_capturable_updated` — not `succeeded` — is the
  authorised-but-uncaptured signal that a hold is live.
- A captured hold is a Friction_Tax when `amount_received < amount`, and fraud
  when they are equal.

## Getting paid (Connect)

Any User who RECEIVES money — a Cash_Sale Seller, or a fraud victim paid captured
collateral — must exist as a connected account.

**Use Accounts v2.** `POST /v1/accounts` is hard-blocked for new integrations and
fails at runtime even though the SDK still types the v1 `controller` parameter.
Create accounts with `stripe.v2.core.accounts.create`.

- `configuration.recipient` with `stripe_balance.stripe_transfers` requested.
  For a seller in the PLATFORM'S OWN country, request nothing else — a marketplace
  connected account never accepts payments itself, and a merchant configuration imposes
  far heavier onboarding.
- **Exception, since 0136: a CROSS-BORDER seller also gets
  `configuration.merchant.capabilities.card_payments`.** Stripe refuses
  `stripe_transfers` on an account whose country differs from the platform's without
  it (`capability_not_available_without_other_capability`, verified 2026-10-13),
  because cross-border payouts are unavailable under a recipient service agreement.
  The card capability is also what their sales are charged `on_behalf_of` (see
  below); the account never charges anyone itself. `createManagedMerchant` decides this from the
  account country vs the platform country, and `createMerchantOnboardingLink` reads
  `applied_configurations` so the hosted flow collects both. Do not remove it for a
  "recipient only" tidy-up: every UK/EEA/CA/CH seller would be unpayable.

## One platform, many regions (0136)

The US platform (`acct_1UIfsRRbOJEOZeCm`) serves the US, UK, EEA (except Hungary),
Canada and Switzerland; Australia has its own. `RegionDefinition.platform` is the
mapping, `credentialRegionFor` reads the PLATFORM's keys (`STRIPE_SECRET_KEY_US` for a
German member), and `checkRegionCompatibility` allows any two regions that share a
platform. Jobs that touch each Stripe account once (payout drain, custody) loop over
`operationalPlatforms()`, never `operationalRegions()`.

**Every Stripe money call takes the CONTRACT's currency** (`currency` on `placeHold`,
`requestTransfer`, `payoutToMerchant`). Omitting it falls back to the platform's
settlement currency, which silently charges a GBP sale in USD.

**A cross-border seller's cash sale is charged ON BEHALF OF their account**
(`domain/payments/onBehalfOf.ts`, `requestTransfer({ onBehalfOf })` → `on_behalf_of`).
It is still a separate charge on the platform: the money lands in the platform balance,
is held, and is released by an explicit transfer. But Stripe prices it at the SELLER's
country's rates (1.5% + EUR 0.25 for a standard EEA card, instead of 2.9% + 1.5%
international on the US platform) and settles it in the seller's currency, so nothing is
converted and there is no Currency_Conversion fee. Verified in test mode on 2026-10-16:
a EUR 100.00 charge on behalf of a German account landed as EUR 100.00 in the platform
balance (a plain charge landed as USD 112.17), and a EUR transfer against it went
through. The decision is the contract currency (`chargesOnBehalfOfSeller`): any currency
its platform does not settle in belongs to a cross-border seller by construction. The
cost: the seller must be payable (`canReceiveFunds`) before the buyer can pay
(`SELLER_NOT_PAYABLE`, refused with the sale untouched). The statement shows the
account's descriptor (onboarding sets `noditto.app`); Stripe may print the account's
address and phone for a cross-border settlement merchant, and
`configuration.merchant.support` is where a NoDitto support address would go.

**The platform's own settlement currency is USD, and other currencies are separate
balances.** `payoutToMerchant` reads the source charge's balance transaction: one that
settled in the contract currency (on behalf of the seller) is transferred as is. One that
was converted (a cash sale collected before on-behalf-of charging, or a trade cash leg)
is sent in USD, sized from a locked FX quote (`/v1/fx_quotes`, a PREVIEW API that only
answers under a `.preview` version) and tied to it with `fx_quote`, rounded up so the
seller receives exactly what they are owed. No quote, no payout: it stays queued.
Custody reconciles each currency against its own balance (`getCustodyPosition(region,
currency)`, `getPlatformBalance(currency)`).

**The PAYER absorbs any conversion.** `domain/fees/fxFee.ts` (`FX_FEE_BPS = 200`) now
applies only to a trade's cash leg in a converted currency, disclosed by `CurrencyNotice`
from the same function, and not refunded. Cash sales record `fx_fee_cents = 0`; rows
collected before on-behalf-of charging keep their recorded fee. `settlement_amount_cents`
/ `settlement_currency` record what the balance received and in which currency. Known
test-mode limit on the quoted path: the quote rate is not applied to test transfers, so
test sellers receive slightly more than owed; verify the first live payout.
- `responsibilities: { fees_collector: 'application', losses_collector: 'application' }`.
  Platform-owned loss liability is mandatory for separate charges and transfers,
  and must be accepted in the Dashboard before creating accounts.
- Onboarding is **provider-hosted** via `v2.core.accountLinks.create`. Links are
  single-use and short-lived: request a new one each time rather than caching.
- `stripe_transfers.status === 'active'` is the ONLY signal that means the hosted flow
  actually completed, and since 0069 it answers ONE question: whether the member can be
  PAID (`canReceiveFunds`). It is no part of the Identity_Gate. Returning from the
  hosted flow does not prove it — read the account back.
- Creating the account shell is the START of onboarding. It lands `PENDING`
  (`deriveMerchantStatus`), never APPROVED. Migration 0060 briefly made creation itself
  the verification milestone and 0061 reversed it; see `product.md` for why, and do not
  reintroduce it.
- There is no compliance simulator and none is needed: Stripe test mode approves
  for real. Never write `merchant_status` directly, and never latch it — it is
  re-derived from the provider in both directions, so an account Stripe later
  restricts stops being verified.

TWO SEQUENTIAL GATES, plus a mechanical precondition for moving money. The former
payer gate is retired.

| | Columns | Gates |
| --- | --- | --- |
| Identity_Gate (step 1) | `identity_check_status = VERIFIED` | listing, selling, trade access, being a disclosed seller |
| Payout setup (step 2) | `merchant_status = APPROVED` **and** `merchant_settlements_enabled` | nothing on its own — feeds `canReceiveFunds` |
| `canReceiveFunds` | step 2 **plus** a non-null `merchant_ref` | actual transfer attempts |

Steps 1 and 2 are independent in both directions and a member may legitimately hold
either without the other. Evaluate platform access only via
`domain/identity/identityGate.ts`, and payout attempts only via `canReceiveFunds`. A cash
Buyer is exempt from both: they never receive a transfer.

**Event types: `account.updated` is the v1 event.** Accounts are created with
`v2.core.accounts.create`, and Accounts v2 reports capability changes on
`v2.core.account.updated` / `v2.core.account[configuration.recipient].updated`. Stripe
also routes v2 account events to the **"My account"** endpoint, not the "Connected and
v2 accounts" one, so a Connect-scoped endpoint alone will not receive them. Because of
that, the reliable path for "did onboarding finish" is the v2 read-back —
`getManagedMerchant` via `refreshPayoutStatus`, which every return from the hosted flow
performs — and the webhook is a backstop. Do not make the gate depend on the webhook
alone.

## Charge type

Separate charges and transfers, not destination charges. Required because the
platform must hold funds before release AND, on Objective_Fraud, pay captured
collateral to the VICTIM rather than to whoever paid (Req 8.3).

**Every release goes through `domain/payouts/releasePolicy.ts`** (ESC-03, ESC-14): a
new seller's cash-sale proceeds and trade cash wait out the holdback from collection,
an open chargeback or early fraud warning holds them outright, and a deferral spends no
attempt. A chargeback OPENED holds an unreleased payout (cash sale, trade cash leg,
collateral disbursement) and stages evidence with `submitDisputeEvidence({ submit:
false })`; WON clears the hold; LOST as `fraudulent` / `product_not_received` blocks the
payer's saved cards (`blocked_payment_fingerprints`, 0140). An early fraud warning
(`radar.early_fraud_warning.created`, subscribe the platform endpoint to it) refunds a
sale that has not shipped and holds one that has. A payout that already left is only
ever clawed back by staff (`reverseCashSalePayout`), never automatically.

**Trade cash is held, not forwarded** (ESC-05/06, `trade_cash_settlements`, 0139): the
payer pays buyer-present before any collateral hold, the platform holds it, completion
queues a release that the `:47` drain pays with `payoutToMerchant(sourcePaymentRef)`,
and every outcome routes it (NO_EXCHANGE and abandon refund; FRAUD goes to the wronged
side). `PAYOUT_MODE` plays no part. `settleTradeCash` survives only for trades agreed
before the switch (no settlement row).

**Off-session means holds and the Trade_Fee, nothing else** (ESC-29). Every binding
refuses `requestTransfer` with a `merchantRef` and no `presence` before any API call;
the only exception is `legacyOffSessionToMember`, set by `settleTradeCash` alone (a
source-scan test pins that). The Trade_Fee is charged after the holds and is a LOCK
PRECONDITION: a decline is handled as that trader's hold failure, and every fee
attempt has its own key (`tradefee:<trade>:<trader>:<n>`).

**Orphan authorisations** (ESC-34): `listUncapturedHolds` (Stripe Search on
`requires_capture` plus the HOLD metadata kind) feeds a daily 03 UTC sweep in the `:17`
job that voids provider holds with no ACTIVE `pre_auth_holds` row. A region whose search
fails is skipped and logged; a failed row read is never read as "nothing live". Every
`voidHold` result is honoured: a non-VOIDED void keeps the row and flags the trade.

**Inspection never outlives collateral** (ESC-17b): the inspection deadline is clamped to
the earliest live hold expiry minus `collateral_margin_hours()`, and the clamp beats the
24-hour floor (0142, mirrored in `deriveTradeInspectionDeadline`).

**Do not "improve" this by moving to destination charges with delayed payouts.**
This has been proposed and rejected twice, and the second time only after checking
Stripe's own documentation, so here is the reasoning in full:

- A destination charge transfers funds to the connected account **immediately** on
  charge. The money is the Seller's from the moment of purchase. It does not hold
  anything pending Buyer acceptance.
- Delayed / manual payouts only govern when the Seller may move funds from their
  Stripe balance to their **bank**. That is payout timing, not a condition on
  ownership.
- Refunding a Buyer would then require `reverse_transfer: true` to claw funds back
  out of the Seller's balance, and if the Seller has already withdrawn, the platform
  covers the negative. Buyer protection would rest on a clawback succeeding rather
  than on the platform holding the money — strictly weaker than the current design.
- `initiateCashSale` documents that this bug was already shipped once: passing
  `merchantRef` at collection forwarded to the Seller at AGREEMENT time, before the
  goods shipped and before the Buyer could inspect. There was no escrow.

Manual capture is not an escape either: card authorisations lapse in about seven
days, and a cash sale spans postage plus an inspection window. That is why cash is
collected up front in the first place.

CONSEQUENCE, RECORDED DELIBERATELY. Holding Cash_Sale proceeds in the platform
balance, commingled with fee revenue, is INHERENT to doing hold-then-release on
Connect — not an implementation shortcut that better engineering removes. Stripe
states plainly that it does not provide escrow services or support escrow accounts.
So the mitigations are operational and regulatory, not architectural:

  1. Automatic payouts MUST be off. A scheduled sweep of the platform balance to the
     platform's own bank account takes members' money with it, because the balance is
     commingled. This is a Dashboard setting and it is the highest-value control there
     is.
  2. Watch the custody reconciliation panel on `/admin` → Payouts
     (`domain/payouts/custodyReconciliation.ts`). It is the only figure on the console
     the provider owns rather than we do, and therefore the only one that can detect a
     chargeback, a provider fee, or a sweep draining the balance — none of which write
     a row.
  3. The licensing question cannot be designed away. If holding member funds needs a
     licence or relief, that is true of this architecture and of every Connect
     alternative to it.

`application_fee_amount` is NOT compatible with this flow. The flat Platform_Fee
(Req 4.7) is collected by transferring `amount - applicationFee` and leaving the
difference in the platform balance.

## Buyer-safe seller disclosure

The disclosure is the provider-VERIFIED legal name, checked against a government
document — not anything the Seller typed. Since 0069 it comes from Stripe Identity's
`verified_outputs` (`first_name` + `last_name`), stored as `identity_check_name`, with
`merchant_legal_entity_name` as the fallback for members grandfathered from Connect
state. Persist either only from the provider's own report, and only absent→present so a
later event cannot blank a name already disclosed. The fallback is load-bearing: a null
disclosure blocks the entire buy path, so removing it breaks every pre-0069 seller.

Government registration numbers (ABN/ACN) are gone: they were a previous-provider
requirement, sellers are individuals, and Stripe does not return tax IDs.

Never expose merchant refs, contact details, address, date of birth, document
numbers, bank details, or compliance notes.

## Identity

**There IS an identity seam again, and it is not the retired KYC one.** `IdentityService`
on `domain/services/types.ts` (`createIdentityCheck`, `readIdentityCheck`) binds Stripe
**Identity**, and `identity.verification_session.*` is translated in `webhook.ts` and
routed as `IDENTITY_DECISION`.

Why this is not a reintroduction of the thing these docs told you not to reintroduce: the
old `KycService` was a SECOND verification path running in PARALLEL with Connect, so two
columns each claimed to answer "is this member verified". This is the ONLY path. Connect
contributes nothing to the gate now — `merchant.compliance.updated` decides payability
alone. `runVerification`, `getIdentitySummary`, `STRIPE_KYC_MODE` and `kyc_status` stay
retired.

`STRIPE_IDENTITY_VERIFICATION_FLOW` holds a Dashboard Verification Flow id (`vf_...`) and
is read per region, because a flow belongs to one Stripe account. Unset, the binding falls
back to an equivalent inline `type: 'document'` session — it works, but the options are
then duplicated in code instead of being owned by the Dashboard.

**`verified_outputs` is not returned by default.** `readIdentityCheck` expands it
explicitly; that is where the document-backed name comes from, and without the expansion
the name is silently null. A webhook payload may legitimately carry no outputs, which is
why the name is persisted monotonically rather than overwritten on every event.

**The read-back is the reliable path, the webhook is the backstop** — the same division as
`refreshPayoutStatus` on the Connect side, and for the same reason: a member returning from
the hosted flow will not wait for a delayed delivery before deciding the app is broken.
`refreshIdentityCheck` performs it on every return.

`createIdentityCheck` throws rather than returning a status, matching `createPayer`, so a
provider failure leaves verification state untouched (Req 2.6).

**Person keys need the restricted Identity key** (ESC-15). The fraud blocklist matches a
banned PERSON by HMAC keys built from the document. Stripe returns a session's document
number and date of birth only to a restricted key with Identity "read verification
results", only when expanded explicitly (`IDENTITY_SENSITIVE_EXPANDS`, including
`last_verification_report.document.number`), and only for 48 hours. Read with the normal
secret key they are null and the keys were silently empty. Set
`STRIPE_IDENTITY_RESTRICTED_KEY[_<REGION>]`; without it verification still proceeds, but
`PERSON_KEYS_UNAVAILABLE` is logged and `identity_keys_missing_at` is set for the `:17`
backfill. Keys are `doc:<issuingCountry>:<number>` and `namedob:<family>:<firstGiven>:<dob>`,
never the address country.

**One person, one live account** (ESC-24): a VERIFIED session whose person key belongs to
another live account is held PENDING with `identity_duplicate_of` for staff
(`resolveDuplicateIdentity`; approve only once the older account is closed).

**The payee is the verified person** (ESC-25): every payout read-back compares the Connect
account's individual name with the Identity name (`domain/identity/payeeNameMatch.ts`). A
mismatch sets `payee_identity_mismatch_at` and `canReceiveFunds` turns false; staff clear a
legitimate short form with `clearPayeeMismatch` (an HMAC of the name pair, never the
names). An unexposed payee name is logged once and never flags. The disclosure falls back
to `merchant_legal_entity_name` ONLY for members 0069 grandfathered
(`identity_grandfathered_at`), through `disclosedLegalName` in both places that disclose a
name.

Verified identity data is sensitive: server-only, never logged, never returned to a client
component. The disclosure is a name and nothing else — never document numbers, address, or
date of birth.

## Verification

Run `npx tsc --noEmit` after changing `domain/services/types.ts`. Editor
diagnostics have been observed reporting clean on files that `tsc` then fails,
including missing SDK type members — the SDK ships its types under
`node_modules/stripe/esm/`, not a `types/` directory.

`npx tsx --env-file=.env.local scripts/smoke-stripe-test.ts` exercises the whole
escrow contract against the real test API and refuses to run against a live key.
