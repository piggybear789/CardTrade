---
inclusion: fileMatch
fileMatchPattern: '{domain/services/**,app/api/webhooks/**,lib/actions/cashSale.ts,lib/actions/trades.ts,lib/actions/kyc.ts,.env.local*}'
---

# Pinch Payments — Integration Rules

Rules for anything that touches the payment/KYC provider. Source of truth is the
Pinch docs (`https://docs.getpinch.com.au/llms.txt`); a condensed endpoint and
event cheat sheet lives in `#pinch-api-reference`.

## The seam is non-negotiable

`domain/services/types.ts` defines `PaymentService` / `KycService`. Everything
else (orchestrators, state machine, server actions, UI) depends on those
interfaces only.

- The concrete binding is chosen in exactly one place: `getPaymentService()` in
  `domain/services/index.ts` via `isLivePaymentsProvider()`:
  credentials present → Pinch; `PAYMENTS_PROVIDER=mock` → Mock; explicit
  `PAYMENTS_PROVIDER=pinch` without credentials fails closed (no silent fake
  money). KYC stays on the Mock delegate (`PINCH_KYC_MODE=mock`).
- The real binding lives in `domain/services/pinch/`: `config.ts` (env),
  `PinchClient.ts` (OAuth + transport + error normalisation), `PinchService.ts`
  (the contract), `metadata.ts` (CardTrade context on provider records),
  `webhook.ts` (signature verification + event translation). If a Pinch behaviour
  does not fit the interface, change the interface deliberately and update
  `MockService` and `InMemoryService` in the same pass — do not leak Pinch types
  into callers.
- Never `import` a Pinch SDK/HTTP client outside `domain/services/pinch/**`,
  except `app/api/webhooks/pinch/route.ts`, which uses the verification and
  translation helpers.
- With credentials + `PINCH_ENV=test`, charges hit the real Pinch test API
  (test cards, Time-Travel). `PINCH_ENV=live` moves real money — only when
  intentional. Without credentials, the Mock stays available for UI demos;
  DemoPanel / mock webhooks are gated off whenever Pinch is live.

## Money

Pinch amounts are integer cents, same as ours. Pass `fmvCents` / `amountCents`
straight through. No floats, no dollar conversion outside display formatting
(`lib/format.ts`).

## Credentials and requests

- OAuth2 client credentials against `https://auth.getpinch.com.au/connect/token`
  using an **Application ID + Secret Key**. Merchant-ID auth is deprecated;
  don't use it.
- Tokens live ~1 hour. Cache and reuse in-process; never fetch a token per call.
- Always send `pinch-version: 2020.1`. Omitting it silently opts into the latest
  version and future breaking changes.
- Base URL is environment-scoped: `https://api.getpinch.com.au/test/` vs
  `/live/`. Derive it from env, never hardcode `live`.
- Auth failure is `403`, not `401`. Field errors come back as
  `{ "errors": [{ "message", "field" }] }` on `400`. Map those to our
  `Result` type in `lib/actions/result.ts` rather than throwing raw.
- Credentials are server-only: `PINCH_APP_ID`, `PINCH_SECRET_KEY`,
  `PINCH_WEBHOOK_SECRET`, `PINCH_ENV`. Only the CaptureJS publishable key
  (`NEXT_PUBLIC_PINCH_PUBLISHABLE_KEY`, `pk_test_...`) may reach the browser.

## Card data never touches our server

Tokenise client-side with CaptureJS (`cdn.getpinch.com.au/capturejs/...`, keep
the `integrity` + `crossorigin` attributes) and send only `result.token` to a
server action. Do not add PAYER instrument fields — card number, CVC, expiry, or
the BSB/account being debited — to any zod schema, server action, form payload,
or table.

One deliberate exception: a PAYEE's disbursement account. `POST /merchants/managed`
takes `bankAccountRoutingNumber`/`bankAccountNumber` in the JSON body and Pinch
offers no tokenised equivalent for settlement accounts, so seller onboarding
(`lib/actions/merchant.ts`, `components/profile/PayoutOnboarding.tsx`) accepts
them. Keep them write-only: pass straight to the provider, never persist them,
never return them to a client, never log them.

CaptureJS tokens are short-lived and single-use. For anything we may need to
charge later (collateral, dispute captures), vault a payment source against the
Payer and store the `src_...` id — never re-use a raw token.

## Idempotency

- Every payment/refund submission carries a `nonce` generated **before** the
  call and persisted with the owning row (trade, cash sale, deal).
- On timeout or 5xx, check `POST /payments/nonce` (or `/refunds/nonce`) before
  retrying, and retry with the *same* nonce. Never generate a fresh nonce for a
  retry.
- A found nonce proves submission, not settlement. Only a `bank-results` /
  `transfer` event means funds moved.

## Webhooks

`app/api/webhooks/pinch/route.ts` is signature-authenticated, not
session-authenticated. Keep it that way: verify first, mutate second, log the
outcome, always ack authentic events with 200.

Real Pinch differs from our mock in two ways the adapter must absorb:

| | Mock (now) | Real Pinch |
| --- | --- | --- |
| Header | `x-pinch-signature`, hex HMAC of raw body | `pinch-signature: t=<unix>,v2=<hmac>` |
| Signed payload | raw body | `{t}.{rawBody}` |
| Replay window | none | reject if `t` is older than 5 minutes |
| Body shape | our `WebhookEvent` | `{ Id, Type, EventDate, Metadata, Data }` (PascalCase default, camelCase configurable) |

Both formats are accepted: the route picks the scheme from the header, verifies,
then runs one shared verify → dedupe → map → dispatch → log pipeline.
`translatePinchEvent` converts Pinch's envelope into internal `WebhookEvent`s,
using the CardTrade `metadata` stamped on each payment to decide whether an
approved charge means "hold active" or "cash sale settled". A `bank-results`
delivery reports many payments, so one request can produce several events; each
gets the idempotency key `{pinchEventId}:{paymentId}`. Routing depends on that
metadata — a payment created outside `PinchService` is unroutable and logs as a
NO_OP.

Map Pinch event types to our internal ones in `domain/webhook/mapEventToAction.ts`;
unknown or unroutable events are a logged `NO_OP`, never an error.

## Escrow holds are charge-and-refund

The public Pinch API has **no authorize/capture/void primitives** and no partial
capture — only payments, refunds, and vaulted sources. `PinchService` therefore
realises the `PreAuthHold` contract as:

| Contract | Pinch call |
| --- | --- |
| `placeHold(amount)` | `POST /payments/realtime` — `holdId` is the `pmt_...` id |
| `voidHold(holdId)` | `POST /refunds` for the full charge |
| `partialCapture(holdId, amount)` | `POST /refunds` for (charged − amount), keeping the Friction_Tax |
| `fullCapture(holdId)` | no call; the charge is simply kept (payment re-read to confirm) |
| `requestTransfer(amount)` | `POST /payments/realtime` |

Funds genuinely move on `placeHold`, unlike a true authorization hold. Do not
invent Pinch pre-auth endpoints; if a real hold primitive is needed, confirm it
with Pinch (`integrations@getpinch.com.au`) before changing this mapping.

Holds, captures and transfers report failure through their `status` field rather
than throwing, so the existing compensating logic (Req 4.4, 5.6, 7.6, 8.6) still
runs. `createPayer` does throw, because Req 2.6 expects KYC_Status to stay
unchanged when payer creation fails.

A realtime charge needs a vaulted source on the Payer — a payer with no source
gets a 400 and the hold comes back `FAILED`. Use `attachPaymentSource` (server
action `attachPaymentSource` in `lib/actions/payments.ts`) with a CaptureJS token
before expecting any charge to succeed.

## Managed Merchants (getting paid)

Pinch settles only into a merchant's own bank account, so any User who *receives*
money — a Cash_Sale seller, a fraud victim paid captured collateral — must exist
as a Managed Merchant under the platform's parent merchant.

Two distinct gates, do not conflate them:

| | Column | Gates | Provider concept |
| --- | --- | --- | --- |
| Payer identity | `kyc_status` | listing, offering, buying, trading | payer-side verification |
| Payee onboarding | `merchant_status` | being paid | `POST /merchants/managed` + compliance |

A trade-only User never needs the second. `merchant_status` is `APPROVED` only
when the provider's `settlementsEnabled` flag is true — that is the only flag that
means money can actually arrive. Onboarding is submitted via
`lib/actions/merchant.ts` (which must read `ipAddress`/`userAgent` from the
request; the provider requires them) and the decision arrives on the
`compliance-updated` webhook.

Pinch models the payee as a merchant entity. Creation may omit a registration
number at the API layer, but current compliance guidance requires a
`business-registration` document (ABN registration, ASIC extract, or equivalent)
before live approval. Do not represent casual individuals without registration
as settlement-ready unless Pinch confirms a specific exception.

For Cash Sales, merchant approval is also the Seller identity gate. Show only the
buyer-safe approved projection (legal entity, optional trading name,
registration number, approval date), require explicit Buyer acknowledgement, and
persist an immutable snapshot/version on the sale. Never expose merchant refs,
contact/address/DOB, bank details, documents, credentials, or compliance notes.
An approved Seller posts no separate Cash Sale bond; this does not change Trade
bond rules.

## Payer records are per merchant

A provider Payer belongs to the merchant it was created under, so a Buyer paying a
seller's sub-merchant needs a payer record *on that sub-merchant*. Hence:

- `payer_refs` maps (profile, merchant) → `payer_id`; `merchant_ref = ''` is the
  platform merchant.
- `profiles.payment_token` holds the reusable CaptureJS token so that payer can be
  created with an inline `source` — no re-tokenising when a seller onboards after
  the Buyer's card was captured. This depends on multi-use token reuse being
  enabled on the parent merchant by Pinch (ticketed request, already done for our
  merchant ids).
- Treat `payment_token` as a credential: service-role reads only, never returned
  to a client, never logged.

`PinchClient.request` takes a per-call `merchantRef` that overrides
`PINCH_MERCHANT_ID` via the `Current-Merchant` header. Collateral holds stay on
the platform merchant (the platform holds the stake); only sale proceeds route to
a sub-merchant, with the flat Platform_Fee passed as `applicationFee`.

`PAYOUT_MODE` selects behaviour: `platform` (default, unchanged demo flows) or
`direct` (sub-merchant settlement plus the seller payability gate).

## Test-mode simulation

Pinch's test environment lives inside production behind the `/test/` base URL, so
these hooks are real provider behaviour, not our mock:

| Hook | How | Wired in |
| --- | --- | --- |
| `Time-Travel: <iso>` | Treats the request as arriving at that instant; triggers overnight direct-debit processing and settlement on demand | `PinchClient.request` (test only), `PINCH_TIME_TRAVEL`, or per-call `timeTravel` |
| Dishonour triggers | A code prefixed with `#` in the payment `description` forces that failure | `PinchService.withDishonourTrigger`, `PINCH_TEST_DISHONOUR_CODE` |
| Test cards / bank accounts | Documented test PANs; any BSB/account is accepted in test | CaptureJS tokenisation |

Compliance approval has **no** simulation endpoint — it is a human review at
Pinch delivered as `compliance-updated`. So `simulateComplianceDecision`
(`domain/services/pinch/simulateCompliance.ts`) builds a Pinch-shaped envelope,
signs it with `PINCH_WEBHOOK_SECRET` in the real `t=...,v2=...` format, and POSTs
it to our own webhook route. The whole production path then runs: verify →
translate → dedupe → orchestrator → `merchant_status`. Never write
`merchant_status` directly to fake an approval, and never let this run outside
`test` (it hard-refuses on `environment !== 'test'`).

## KYC

Pinch Glassbox KYC is not covered by the public REST docs above. Keep it behind
`KycService` and treat the mock as the contract until real Glassbox details are
confirmed. `PinchService.runVerification` does confirm the Payer exists on real
Pinch before returning the delegate's outcome, so a bad payer reference is
rejected rather than reported verified. Verified identity data feeding the Police_Evidence_Pack is sensitive:
server-only, never logged, never returned to a client component.
