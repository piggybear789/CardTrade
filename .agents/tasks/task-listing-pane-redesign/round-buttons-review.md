# "Binder or bulk listing" back in chat and trade copy, plus element-keyed action chips

Commit `6443ea4` closes the three follow-ups from the `a850778` review. `ListingActionRow` now keys each chip slot by the key `Children.toArray` assigns, not the bare index. A stale comment in `listings.spec.ts` is reworded. The last "multi-item" member copy is gone. It lived in two server-action messages (`trades.ts`, `tradeNegotiation.ts`), the `MessageLog` transcript rewrites, and the SQL `describe_cash_sale_event`, which a new migration 0133 replaces and backfills. The SQL function body differs from 0119 in exactly the two sentences and their two marker comments. The backfill reuses 0119's joins and scope verbatim.

Watch for: there is no on-disk verification record for this round. `verification-round-buttons.md` covers `a850778` only, and no test asserts any of the changed strings, so the tests prove nothing about the copy (likely, non-blocking). 0133 still has to be applied by hand with `execute_sql`, because MCP `apply_migration` fails on this project. Until it is, the DB keeps writing "multi-item" into `messages.body`, and only the contract-room `MessageLog` path translates it (likely, informational).

**Verdict**: APPROVED

## High-level view

The keying fix is one expression plus a comment. `Children.toArray` gives each child a positional key (`.0`, `.1`, `.2`) computed before nulls drop out, so Offer keeps the same key whether or not Trade renders. This removes the remount risk the prior review raised. The fallback to `index` only applies to non-element children such as strings. Nothing else in the component changed.

The e2e change touches comments only. The new wording ("Each tile also carries a short hint … that joins its accessible name") matches `ItemForm`, and the `/^One item/`-style prefix selectors are untouched.

The transcript copy is stored, not derived, and the implementer says so correctly in both the migration header and the `MessageLog` comment. The system lines are persisted in `messages.body`. 0133 rewrites existing shopfront `AGREEMENT_CREATED` / `PAYMENT_FAILED` rows from the new function, scoped exactly as 0119's backfill was. `MessageLog` keeps a read-time mapping for anything the backfill missed. That mapping is now inverted: it maps the 0119–0132 "multi-item" wording and the pre-0113 single-listing wording to the binder wording, and it leaves 0113–0116 binder rows as they are. `PAYMENT_FAILED` on a shopfront is replaced wholesale with the binder sentence, as before. So old stored rows render the binder wording in the contract room whether or not the backfill has run.

0133 is safe for `identityGate.test.ts`. It defines none of the gate expressions, and it contains no `select (`, no `as is_verified` and no `grant`. No applied migration was edited, since the commit only adds 0133. No migration between 0120 and 0132 redefines `describe_cash_sale_event`, so 0119 is the correct baseline.

<details>
<summary>Issues (2)</summary>

1. **No recorded verification for this round**: `verification-round-buttons.md` predates `6443ea4`, and no test references the changed strings, `describe_cash_sale_event` or the `MessageLog` mapping. Append a short "round 2" note to the verification file covering what was run. Non-blocking: the change is copy, comments, one key expression and SQL that the reviewer checked line by line against 0119.
2. **0133 needs a manual apply**: apply it with `execute_sql` in one transaction, per the project note on `apply_migration`, then check it with `select pg_get_functiondef('cardtrade.describe_cash_sale_event(text,text,text,text,boolean)'::regprocedure)`. Until then, new shopfront rows are written with "multi-item". Surfaces that read `messages.body` raw, outside the contract-room `saleContext` path, will show that wording.

</details>

<details><summary>Details</summary>

### SQL equivalence with 0119

`Compare-Object` over the two function bodies (0119 lines 22–165, 0133 lines 17–160) gives four differing lines. Two are the `-- THE FIRST/SECOND REWORDED SENTENCE` marker comments. The other two are the `AGREEMENT_CREATED` shopfront sentence ("for a binder or bulk listing. ") and the `PAYMENT_FAILED` shopfront sentence. The signature, `immutable`, `set search_path = ''`, every other branch and the `else` fallback are byte-identical. The function comment changes only its adjective. The backfill `update` matches 0119's text exactly: the same `left(…, 4000)`, the same joins on `cash_sale_events` / `cash_sales` / `profiles`, the same `created_at` match, and the same `from_shopfront` and two-event scope. Single-listing rows are untouched.

### MessageLog mapping order

For a shopfront `AGREEMENT_CREATED` row, the first `.replace` turns the pre-0113 "reserved the item" sentence into the binder sentence. The second turns "for a multi-item listing." into "for a binder or bulk listing.". The two inputs are disjoint, so the order does not matter, and a row already in binder wording passes through both unchanged. The mapping only runs when `saleContext` is present and the message belongs to the selected sale. That is the pre-existing scope, and it is why Issue 2 matters for any other surface.

### Server-action copy

`trades.ts` `proposeTrade` now says "This is a binder or bulk listing, and nothing in it is held." This states that nothing is held, as the product rules require. `tradeNegotiation.ts` swaps "multi-item" for "binder or bulk listing" in the same sentence. Error codes (`item-unavailable`, `invalid-terms`) are unchanged, so callers that branch on them behave the same. A repo-wide search over `app/`, `components/`, `lib/`, `domain/`, `supabase/`, `tests/` and `flutter_app/lib/` finds "multi-item" in only three kinds of place: historical migrations (0015, 0119), comments, and the legacy-input string in `MessageLog` that has to keep it.

</details>

<details><summary>File map</summary>

- `components/listings/ListingActionIcon.tsx`: `isValidElement` import; slot key uses the element key, falling back to the index.
- `components/messages/MessageLog.tsx`: legacy mapping inverted to binder wording; comment says the copy is stored.
- `lib/actions/trades.ts`, `lib/actions/tradeNegotiation.ts`: binder wording in two refusal messages.
- `supabase/migrations/0133_binder_listing_chat_copy.sql`: new `describe_cash_sale_event` with two sentences reworded; shopfront transcript backfill.
- `tests/e2e/specs/listings.spec.ts`: comment only.

Full diff: `git -C c:\dev\Marketplace show 6443ea4`.

</details>
