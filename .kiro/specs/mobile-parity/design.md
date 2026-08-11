# Design Document

## Overview

The Flutter app is missing a tier. The website's rules live in Server Actions over pure
orchestrators; the app skipped that layer and talks to Postgres directly, so its write
path had to be expressed as SQL function names and was invented — 22 of 23 do not
exist. This design adds the missing tier (`app/api/mobile/**`), demotes the Dart domain
ports to display logic, generates the vocabulary that can be generated, and pins what
cannot. Guards land before the code they govern, because the project's present state is
what "green with no contract enforcement" produces.

## Architecture

### The shape of the problem

The website's business rules live in TypeScript: Server Actions in `lib/actions/`
delegating to pure orchestrators in `domain/`, with RLS as a second, independent
enforcement layer. The Flutter app skipped that entire tier and talks to Postgres
directly. Two consequences follow, and both are visible in the audit output.

First, the write path had to be expressed as SQL function names, so it was invented:
22 of 23 do not exist. Second, every rule the app needed locally had to be
re-implemented in Dart, which is why `flutter_app/lib/domain/` exists at all.

The fix is not to build the missing SQL. It cannot be: `initiateCashSale` places a
Stripe hold, evaluates the Identity_Gate, checks region compatibility, and sizes
collateral. A Postgres function cannot call Stripe, and a client cannot hold the secret
that would let it. The work is to give the mobile app the tier it is missing.

```
Flutter screens
      ↓  HTTP + member JWT
app/api/mobile/**/route.ts        ← new, thin
      ↓
lib/actions/**  (unchanged)       ← the existing guards live here
      ↓
domain/**  (unchanged)
      ↓
Supabase / Stripe
```

`flutter_app/lib/domain/` keeps its ports, demoted explicitly to display logic: they
decide which buttons to render, never whether an action is permitted.

## Components and Interfaces

### The endpoint tier

**Location.** `app/api/mobile/<area>/<action>/route.ts`, mirroring the `lib/actions/`
module that owns the logic. Flat and predictable, because the guard in Requirement 2
derives the expected path from the Dart call and a naming convention it can compute.

**Authentication.** Route handlers use the cookie-bound client from
`lib/supabase/server.ts`. A Flutter client sends the Supabase session as a bearer
token rather than a cookie, so the handler must establish the session from the
`Authorization` header when no cookie is present, then proceed identically. This is the
only piece of genuinely new plumbing in the tier, so it belongs in one shared helper —
`lib/api/mobileSession.ts` — and every handler uses it. A handler that authenticates
its own way is a second opinion about who the caller is.

**Delegation.** The handler parses and validates the request shape, calls the server
action, and returns its result. It adds no guards, because the action already has them,
and duplicating one means two definitions that can disagree. It removes none either.

### The endpoint-contract guard

Same technique as the RPC audit, pointed at HTTP. `scripts/lib/mobileContract.ts` gains:

- `dartEndpointCalls()` — the endpoint paths and methods the Dart services request.
  Requires the paths to be literals or built from a single constants file, so they are
  statically visible. If a path is assembled from fragments at runtime the parser
  cannot see it, so the convention is: paths live in one Dart constants file, exactly
  as `AppRoutes` already does for navigation.
- `mobileRouteHandlers()` — the routes present under `app/api/mobile/`, with the HTTP
  methods each `route.ts` exports.
- An assertion pairing them in both directions: no Dart call without a handler, and no
  handler without a caller. The second half matters as much as the first, because a
  handler nobody calls is an unaudited public endpoint.

The existing strictness rules carry over. Parsers throw on source they cannot read.
The test asserts a non-zero parsed count. A guard that passes because it understood
nothing is worse than no guard, and this repo has already been bitten by exactly that
shape of bug in a comment-stripping regex.

## Data Models

No new tables, columns, enums or migrations. That is a design constraint, not an
omission: every fact the mobile app needs already exists, and the failure being fixed is
a missing tier rather than a missing model. A task that finds itself wanting a migration
should stop and re-read the prohibitions in the requirements.

The models that matter here are the ones crossing the new boundary:

- **`ActionResult<T, E>`** (`lib/actions/result.ts`) — the wire format for every mobile
  endpoint. Dart mirrors it as `Result<T>` in `core/result.dart`, which already exists
  and already carries an error code plus a human message.
- **Terms version** — `terms_version` on `cash_sales` and `trades`. Travels to the
  client with the contract and back with every acceptance or revision.
- **Contract contents** — `cash_sale_items` rows for a cash binder contract,
  `trades.counterpart_goods_description` for a trade one. Already modelled in Dart
  (`cash_sale_item.dart`, `trade.dart`); the gap is surfacing them.
- **Generated vocabulary** — `enums.dart`, `regions.dart` and the zero-decimal set
  become build outputs rather than sources. Their content does not change; their
  authorship does.

### Generation over agreement

Three of the duplicated artifacts are mechanical transforms and should be generated:

| Generated file | Source of truth |
| --- | --- |
| `lib/models/enums.dart` | the Postgres enum definitions plus the TS unions in `domain/state-machine/types.ts` |
| `lib/domain/region/regions.dart` | `domain/region/regions.ts` |
| the zero-decimal set in `core/money.dart` | `minorUnitDigits` in `domain/region` |

Generated output is committed, carries a do-not-edit header, and is verified by
regenerating in CI and asserting no diff. That converts three agreement tests from
"someone must fix the drift" into "the drift cannot occur".

The other five ports stay hand-written and pinned. They encode branching logic rather
than data, so generating them would mean writing a TypeScript-to-Dart compiler, and the
agreement tests already hold them exactly.

### Screen parity

`tests/unit/navigationGraph.test.ts` already walks `app/` into a route inventory and
`components/`, `lib/` into a link graph. Extending it to parse `router.dart` gives a
three-way comparison: web routes, Flutter routes, and the allowlist of deliberate
divergences.

The allowlist is the important part. Admin and arbitration are staff surfaces and
belong on the web only; that is a decision, and writing it down as an allowlist entry
with a reason is what stops it being confused with an oversight. Everything not
allowlisted is a gap with a name.

### Handoff stays

`lib/core/web_handoff.dart` covers identity verification, payout setup, and opening a
trade negotiation. The first two need Stripe sessions created with a secret key; those
are genuinely provider-hosted flows and the app's job is to open them and read the
result back afterwards.

Opening a trade negotiation is different — it is handed off only because
`open_trade_negotiation` is `service_role` only, which an endpoint over
`openTradeNegotiation` solves. That one may become native. The identity and payout ones
should not, and an agent optimising for native coverage will be tempted; the reasoning
is in the file's own header comment.

## Correctness Properties

Properties that must hold when this spec is complete, each stated so a failure is
observable rather than a matter of opinion.

### Property 1: No unreachable call site

Every endpoint the Dart services request has a route handler exporting the method they
use, and every handler has a caller. Checked by `mobileRpcContract.test.ts`; reported by
`npm run audit:mobile`, which must exit zero.

**Validates: Requirements 2.2, 2.3, 4.2**

### Property 2: No client-side authority

Every mobile write reaches Postgres through a Server Action. Nothing the Dart ports
decide can grant permission, so a tampered client gains nothing beyond what the action
would already allow.

**Validates: Requirements 3.3, 3.4, 4.1, 4.5**

### Property 3: One definition per rule

For every rule with a Dart copy, the copy agrees with the TypeScript — either because a
generator produced it or because an agreement assertion pins it. The count of
hand-written ports does not increase beyond the current eight.

**Validates: Requirements 7.1, 7.3, 7.4**

### Property 4: Gate equivalence

A member refused an action on the website is refused the same action on mobile, with the
same error code. In particular, an unverified member cannot publish a listing from
either client.

**Validates: Requirements 1.1, 1.2, 1.3, 3.5**

### Property 5: Disclosure equals charge

The trade fee shown in the app equals the fee charged, because both read
`resolveTradeSideValues`. A binder trade cannot authorise one figure and display
another.

**Validates: Requirements 8.6**

### Property 6: Acceptance binds a version

An acceptance applies only to the terms version it named. A revision voids prior
acceptances on both clients, including when the revision swaps one card for another of
identical value.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 7: No money in floats

Every money value is an integer in the currency's smallest unit from the database to the
rendered string, with `minorUnitDigits` owning the divisor.

**Validates: Requirements 10.3**

### Property 8: Write retries do not duplicate

Replaying a failed write creates at most one row. A retried `initiateCashSale` or
`makeOffer` does not produce two contracts or two offers.

**Validates: Requirements 4.4**

## Error Handling

**Refusals are data.** A Server Action returns `{ ok: false, error, message }` for every
expected failure, and the endpoint passes it through with HTTP 200. The client switches
on `error`. This is why the two clients can share refusal semantics without sharing
copy, and why `not-verified` must not become a 403 — a second error channel is a second
thing to keep in agreement.

**HTTP codes describe transport only.** 401 no session, 400 unparseable body, 404 no
such route, 500 an exception escaped. Any 500 is a bug in the tier, since the actions
below it return failures as values.

**The three error classes the Dart client must distinguish**, because the right member-
facing response differs for each:

- *Refusal* — the action said no. Show the action's message and, where the code implies
  a next step (`not-verified`, `SELLER_NOT_PAYABLE`, `REGION_MISMATCH`), offer it.
- *Transport* — offline, timeout, 5xx. Offer retry; safe only for reads.
- *Contract* — 404 or a shape the client cannot parse. A bug, not a member problem.
  Never present it as the member's fault, and never as success.

**Never report success not achieved.** `AUDIT.md` records the report button doing
exactly this. An action whose result was not confirmed shows a pending or failed state.

**Failure leaves verification state untouched.** `createIdentityCheck` and `createPayer`
throw rather than returning a status, so a provider failure cannot be mistaken for a
decision. Endpoints exposing them must not convert that throw into a soft refusal.

## Testing Strategy

Four layers, because no single one is sufficient and the current state passes two of
them:

1. **Static contract** — `npm run audit:mobile` and the guard tests. Proves the wiring.
   Cheap, runs everywhere, catches the class of bug that produced this spec.
2. **Domain agreement** — the Dart-vs-TypeScript pins, plus generation diffs. Proves
   the two copies of each rule still say the same thing.
3. **Flutter unit and widget tests** — `flutter test`. Proves screen logic. Note that
   205 of these already pass against a completely broken data layer, so this layer
   alone means very little.
4. **Endpoint smoke test** — real HTTP, real JWT, real backend. The only layer that can
   distinguish "the contract lines up" from "it works". This is why Requirement 9 is
   not optional.

Visual and interaction quality is not covered by any of the four and needs human
review. `flutter_app/AUDIT.md` is the input for that conversation, not a substitute
for it.
