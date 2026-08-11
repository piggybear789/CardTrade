# Flutter App — Rules of Engagement

`flutter_app/` is a second client over the same Postgres schema. This document is
deliberately NOT a feature spec: `flutter_app/SPEC.md` is one, it is thorough, and it
did not stop the app diverging, because prose cannot fail a build. What follows is the
set of rules the checks enforce, and where those checks live.

## Commands

```cmd
npm run audit:mobile   :: report every Dart RPC / table write vs what the schema exposes
npm run smoke:mobile   :: call every mobile API endpoint with a real session, assert no 404/500
npx vitest --run tests/unit/mobileRpcContract.test.ts      :: the reachability guard
npx vitest --run tests/unit/mobileDomainAgreement.test.ts  :: the Dart-vs-TypeScript guard
```

Inside `flutter_app/`: `flutter test`, `flutter analyze`, and
`dart run build_runner build --delete-conflicting-outputs` after touching a Freezed
model. Never run `flutter run` from an agent turn; it blocks.

## The mobile client holds a member JWT and nothing else

`SUPABASE_SERVICE_ROLE_KEY` and `STRIPE_SECRET_KEY` must never reach an app bundle,
which is not a policy but a fact about shipping software to devices. Everything below
follows from it.

**Do not invent an RPC name.** Every `.rpc('name')` in Dart is a string literal that
nothing type-checks. When this guard was first written, 23 of 23 call sites were
unreachable: 22 named functions that do not exist (`initiate_cash_sale`,
`make_offer`, `report_handover_failed`, …) and one named `accept_trade_terms`, which
exists but is granted to `service_role` alone. Several are near-misses on real
functions — the real names are `create_cash_sale_agreement`, `apply_trade_tracking`,
`decline_trade_negotiation` — so correcting the spelling is not a fix, because those
are server-only too.

**Do not close the gap by granting EXECUTE to `authenticated`.** Those functions are
the tail end of an orchestration that also places Stripe holds, evaluates the
Identity_Gate, checks region compatibility and sizes collateral. A grant would expose
the last step of a money path with the guards skipped. Only two `cardtrade` functions
are member-executable — `is_fraud_banned` and `member_sale_stats` — and that number
should grow slowly and for read-only reasons.

**The remedy is an endpoint in front of the existing orchestrator.** Authenticate the
Supabase JWT, delegate to the same `cashSaleOrchestrator` / `tradeOrchestrator` /
server action the website calls, return the same `ActionResult`. No new business
logic: if mobile needs a rule the web app already has, it needs the web app's copy of
it, not a second one. Where a native flow is not worth building, hand off to the
website as `lib/core/web_handoff.dart` already does for identity, payouts and opening
a trade negotiation — that file's reasoning is the general rule, not a special case.

**Direct table writes are for rows where RLS is the whole rule.** Watchlist entries,
read receipts, a member's own profile: fine. Anything on a contract — `cash_sales`,
`cash_sale_items`, `trades`, `trade_items`, `pre_auth_holds`, the delivery-detail
tables — is refused by `mobileRpcContract.test.ts`, because those carry invariants
enforced above the row.

## Duplicated domain logic is display-only, and it is pinned

`flutter_app/lib/domain/` hand-ports eight modules the other steering docs describe as
the ONE place a rule lives: the transition table, `bondPolicy`, `identityGate`,
`regions`, `tradeFee`, `tradeSideValues`, the fulfilment validator. `core/money.dart`
re-derives `minorUnitDigits` on top of that.

Those ports exist so the app can decide which buttons to show without a round trip.
They are **advisory**. The server re-evaluates every one of them and is authoritative;
a Dart guard that says yes is never permission.

`tests/unit/mobileDomainAgreement.test.ts` reads the Dart source and compares it to
the TypeScript, the same way `regionCurrencyAgreement.test.ts` reads migration 0068.
A failure there does not mean the Dart is wrong — it means two copies of one rule
disagree and someone has to decide which is right. Prefer generating the Dart over
re-syncing it by hand: enums, the region registry and the zero-decimal currency set
are all mechanical transforms of files that already exist.

Do not add a NINTH port. If mobile needs a new rule evaluated locally, ask first
whether the answer can come down with the data instead.

## Retired vocabulary

The web app cannot reintroduce retired concepts — the tables and types are gone, so it
would not compile. The Flutter app can, because it names things as strings, and it
did: `features/deals/screens/deals_screen.dart` is 20KB and `router.dart` wires
`DealsScreen()` to `AppRoutes.trades`, while `Deal` went with migration 0055.

`Deal`, `DittoBond`, `KYC_Status` and `Police_Evidence_Pack` are refused by name in
`mobileDomainAgreement.test.ts`. Member-facing copy says **trade collateral** and
explains it as a temporary card hold; it says **binder or bulk listing**, never
"shopfront"; and it always states that nothing is held on a binder.

## Adding a check

Parsers live in `scripts/lib/mobileContract.ts`. They are strict on purpose and throw
on source they cannot understand rather than returning an empty set — a check that
passes vacuously is worse than no check. That is not hypothetical: the first run of
the union parser read a semicolon inside a `//` comment as the end of the
declaration, dropped five members, and reported it as drift.
