# Stripe — Integration Rules

Rules for anything that touches the payment/KYC provider. Replaces the former
Pinch steering docs; the Pinch binding has been removed entirely.

## The seam is non-negotiable

`domain/services/types.ts` defines `PaymentService` / `KycService`. Everything
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
(`lib/format.ts`). Currency is `aud` end to end.

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

**Authorisations expire.** Online card auths last about 7 days. Every hold reports
`expiresAt`, read from the charge's `capture_before`. After it passes, the
provider releases the funds itself and `voidHold` / `partialCapture` will fail.
A Trade must resolve inside that window, or the collateral must be re-authorised
before it. Do not treat `expiresAt` as advisory.

Holds, captures and transfers report failure through their `status` field rather
than throwing, so the compensating logic (Req 4.4, 5.6, 7.6, 8.6) still runs.
`createPayer` does throw, because a payer failure must leave verification state
untouched (Req 2.6).

Collateral is **card-only** (`payment_method_types: ['card']`). BECS Direct Debit
does not support manual capture at all, and its 7-year no-questions-asked dispute
window makes it a poor fit for escrow where the platform is merchant of record.

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
  Do NOT request a `merchant` configuration or card payment capabilities — a
  marketplace connected account never accepts payments itself, and asking imposes
  far heavier onboarding.
- `responsibilities: { fees_collector: 'application', losses_collector: 'application' }`.
  Platform-owned loss liability is mandatory for separate charges and transfers,
  and must be accepted in the Dashboard before creating accounts.
- Onboarding is **provider-hosted** via `v2.core.accountLinks.create`. Links are
  single-use and short-lived: request a new one each time rather than caching.
- `stripe_transfers.status === 'active'` is the ONLY signal that means money can
  actually arrive. It is what gates `merchant_status = APPROVED`. Returning from
  the hosted flow does NOT prove payability.
- There is no compliance simulator and none is needed: Stripe test mode approves
  for real. Never write `merchant_status` directly.

Two distinct gates, do not conflate them:

There is now ONE gate, not two. The former payer gate is retired.

| | Columns | Gates |
| --- | --- | --- |
| Identity_Gate | `merchant_status` + `merchant_settlements_enabled` | listing, selling, trade escrow, cash deals, being paid |

A cash Buyer is exempt: they never receive a transfer. Evaluate the gate only via
`domain/identity/identityGate.ts`.

A trade-only User never needs the second.

## Charge type

Separate charges and transfers, not destination charges. Required because the
platform must hold funds before release AND, on Objective_Fraud, pay captured
collateral to the VICTIM rather than to whoever paid (Req 8.3).

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

The disclosure is the provider-VERIFIED legal name
(`identity.individual.given_name` + `surname`), checked against a government
document — not anything the Seller typed. Persist it only from the provider's own
report, and only absent→present so a later event cannot blank a name already
disclosed.

Government registration numbers (ABN/ACN) are gone: they were a previous-provider
requirement, sellers are individuals, and Stripe does not return tax IDs.

Never expose merchant refs, contact details, address, date of birth, document
numbers, bank details, or compliance notes.

## Identity

**There is no KYC seam.** `KycService`, `runVerification`, `beginIdentityCheck`,
`getIdentitySummary`, `STRIPE_KYC_MODE` and the `identity.verification_session.*`
translations have all been removed. Do not reintroduce a second verification path.

Identity is the Identity_Gate: Connect onboarding APPROVED with settlements
enabled. It arrives on `account.updated`, the same event that decides payability,
and `applyComplianceUpdate` persists both the status and the provider-verified
legal name. Identity is therefore state this integration already reports, not a
call it has to make.

`createPayer` stays on the seam (as `PayerService`) and still throws rather than
returning a status, because a payer is a payment prerequisite and a failure must
leave verification state untouched.

**Accepted assurance limit, recorded deliberately.** Connect's verification burden
on a recipient-only account is generally lighter than a document-and-selfie check,
and Stripe may defer document collection until volume thresholds. So
`stripe_transfers.status === 'active'` proves payability and yields a
provider-verified legal name, but does NOT prove a government document was
inspected at that moment. Never write copy claiming a document or selfie check.
Re-adding Stripe Identity as a higher tier on top of the gate remains possible —
it would be an addition, not a reversal — and in Australia Identity is self-serve
public beta that must be activated on the account.

Verified identity data is sensitive: server-only, never logged, never returned to a
client component.

## Verification

Run `npx tsc --noEmit` after changing `domain/services/types.ts`. Editor
diagnostics have been observed reporting clean on files that `tsc` then fails,
including missing SDK type members — the SDK ships its types under
`node_modules/stripe/esm/`, not a `types/` directory.

`npx tsx --env-file=.env.local scripts/smoke-stripe-test.ts` exercises the whole
escrow contract against the real test API and refuses to run against a live key.
