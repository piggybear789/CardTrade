---
inclusion: manual
---

# Pinch API Reference (condensed)

Pull this in with `#pinch-api-reference` when writing or reviewing Pinch calls.
Distilled from the official docs — content rephrased for compliance with
licensing restrictions. Authoritative index:
[llms.txt](https://docs.getpinch.com.au/llms.txt) ·
[Core concepts](https://docs.getpinch.com.au/docs/pinch-payments-api-core-concepts) ·
[Things to know](https://docs.getpinch.com.au/reference/things-to-know)

## Environments and headers

| | Value |
| --- | --- |
| Token endpoint | `POST https://auth.getpinch.com.au/connect/token` (`grant_type=client_credentials`) |
| Test base URL | `https://api.getpinch.com.au/test/` |
| Live base URL | `https://api.getpinch.com.au/live/` |
| Required headers | `Authorization: Bearer <token>`, `pinch-version: 2020.1`, `Content-Type: application/json` |
| Act as sub-merchant | `Current-Merchant: mch_XXXX` |

Amounts are integer cents. Token TTL ~1 hour.

## Id prefixes

`pyr_` payer · `src_` source · `pmt_` payment · `evt_` event · `mch_` merchant ·
`whsec_` webhook secret · `pk_test_` / `pk_live_` CaptureJS publishable key.

## Entity model

Merchant → Payer → (Source | Agreement | Subscription). Payment belongs to a
Payer, contains one or more Attempts (at most one successful), and settles into a
Transfer. Subscription = Plan bound to a Payer. Refund reverses a settled
Payment.

- **Source** types: `bank-account` (BSB + account) or `credit-card` (tokenised).
  A Payer can hold several; omit `sourceId` and Pinch picks the first valid one.
- **Agreement**: Direct Debit Request authorisation, required for bank-account
  debits (created → authorised → cancelled).
- **Attempt**: carries amount, transaction date, status, source, dishonour
  detail, settlement detail, fees. `payment.attemptId` points at the latest one.
- **Metadata**: free-form JSON on Payer, Payment, Plan, Subscription.
- **Surcharge**: pass a list like `["credit-card"]` on a payment/subscription to
  push processing fees onto the payer.

## Endpoints we care about

| Purpose | Call |
| --- | --- |
| Create/update payer | `POST /payers` |
| Get / list / delete payer | `GET /payers/{id}` · `GET /payers` (paged) · `DELETE /payers/{id}` |
| Add source | `POST /payers/{payerId}/sources` |
| Delete source | `DELETE /payers/{payerId}/sources/{sourceId}` |
| Charge card now | `POST /payments/realtime` |
| Schedule payment | `POST /payments` (with `transactionDate`) |
| Get payment | `GET /payments/{id}` |
| List payments | `GET /payments/scheduled` · `GET /payments/processed` · by payer |
| Nonce lookup | `POST /payments/nonce` · `POST /refunds/nonce` |
| Refund | `POST /refunds` (omit `amount` for full) |
| Preview fees | `GET /fees` · `POST /fees/calculate` |
| Payment links | `POST /payment-links` (hosted page, no frontend work) |
| Events | `GET /events` (filter by type/date) · `GET /events/{id}` |
| Transfers | `GET /transfers` · `GET /transfers/{id}` · `GET /transfers/items/{id}` |
| Webhooks | `POST /webhooks` · `GET /webhooks` · `DELETE /webhooks/{id}` |
| Managed merchants | `POST /merchants` · `GET /merchants` · upload compliance docs |
| Tokenise server-side | `POST /tokenise` (native apps only, needs Pinch approval) |

There is **no** authorize/void/partial-capture endpoint. See the escrow gap note
in the Pinch integration rules.

## Payment statuses

`scheduled` → `processing` → `approved` → `settled`; `dishonoured` (processed
then failed, e.g. insufficient funds), `cancelled` (killed before processing).
Scheduled payments can be edited or deleted only while still `scheduled`.

## Event types

`payment-created`, `realtime-payment`, `scheduled-process`, `bank-results`,
`transfer`, `payer-created`, `payer-updated`, `refund-created`, `refund-updated`,
`subscription-created`, `subscription-complete`, `subscription-cancelled`,
`dispute-created`.

Result routing: card payments report both success and failure in `bank-results`;
direct debit reports only failures there, with success arriving via `transfer`.

## Webhook delivery

```
POST <your uri>
pinch-signature: t=<unix>,v2=<hmac-sha256 of "{t}.{rawBody}">

{ "Id": "evt_...", "Type": "...", "EventDate": "...", "Metadata": {}, "Data": {} }
```

Verify: split the header, rebuild `{t}.{rawBody}`, HMAC-SHA256 with the
`whsec_...` secret, compare, then reject stale timestamps (5 minute window is the
SDK default). Payload casing is PascalCase by default, camelCase optional per
webhook. `webhook.site` is handy for inspecting deliveries in dev.

## Errors

`400` invalid/missing field (body `{ errors: [{ message, field }] }`) ·
`403` auth failed or token expired · `404` missing/deleted resource ·
`5xx` Pinch-side, retry after a delay (nonce-check first for payments).

List endpoints are paged and return `totalPages` / `currentPage`; SDK
"fetch all" helpers exist but are discouraged on large datasets.

## Useful guides

[Credit card payments](https://docs.getpinch.com.au/docs/credit-card-payments) ·
[Direct debit](https://docs.getpinch.com.au/docs/direct-debit-payments) ·
[CaptureJS tokenisation](https://docs.getpinch.com.au/docs/capturejs-tokenisation) ·
[Vault a payment source](https://docs.getpinch.com.au/docs/vault-payment-source) ·
[Idempotent nonce](https://docs.getpinch.com.au/docs/idempotent-payment-nonce) ·
[Webhooks](https://docs.getpinch.com.au/docs/webhooks) ·
[Events](https://docs.getpinch.com.au/docs/events) ·
[Dishonour codes](https://docs.getpinch.com.au/docs/dishonour-codes) ·
[Refunds](https://docs.getpinch.com.au/docs/refunds) ·
[Transfer reconciliation](https://docs.getpinch.com.au/docs/transfer-reconciliation) ·
[Managed merchants](https://docs.getpinch.com.au/docs/managed-merchants) ·
[Test and live mode](https://docs.getpinch.com.au/docs/test-and-live-mode) ·
[Support](https://docs.getpinch.com.au/docs/support)
