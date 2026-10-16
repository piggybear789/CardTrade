# Design: local two-tester sandbox on the shared production database

## Overview

The developer tests every two-party flow from a local `next dev` server pointed at the production Supabase project (`kyyaqnsmqthqmnhaqhzq`). He tests between his own two accounts, `joys_joys` and `piggybear`, and switches between them without signing in again. There is no second Supabase project; the user refused one. That makes the prior `plan.md` recommendation (option A, a separate sandbox project) **void**. This design implements a hardened version of what the plan called option B. Isolation lives inside the one database and the one codebase, as five layers:

1. **Tester flag and stamped test rows.** `profiles.is_tester` is writable only by the service role or a migration. Every row a tester creates is stamped `is_test` by a trigger at insert, and the flag is immutable after that.
2. **Visibility.** RLS hides tester listings from everyone except other testers and the owner. A handful of service-role or anon readers get explicit filters.
3. **Pairing.** A pure domain rule (`checkTesterCompatibility`) and SECURITY DEFINER triggers in the DB both refuse any contract, offer, invite or on-listing conversation that mixes a tester with a non-tester.
4. **Environment scope.** A pure rule (`checkSandboxAdmission` / `testRowScope`) means:
   - a sandbox server only ever touches test rows, under the mock payment provider;
   - a production server never creates a test row, and never moves money, places or voids a hold, runs a job, sends email or arbitrates on one. Real Stripe can therefore never be called for a test row. Participant-only edits to *existing* test rows stay possible from production and are harmless (no money, no provider call): declining or withdrawing a test offer, `sendMessage` into a test conversation, `updateItem` / `deleteItem` / `closeShopfrontListing` on a tester's own test listing from `/listings/mine`, and revoking a test deal invite.

   Every scheduled job, sweep, admin queue, webhook route, read-triggered tracking refresh and exported money primitive is scoped this way. The scope check sits at **chokepoints** (row loaders, scoped repositories that *refuse* rather than return empty, and money primitives), not at individual callers, and a repo-wide static test enforces it (§3, §Testing).
5. **Sandbox launcher and gate.** `npm run sandbox:dev` builds a provably mock-only child env. `withActionLog` gains a sandbox-only gate, so in sandbox mode a non-tester, non-staff member cannot run any Server Action, whether authenticated by cookie or by Bearer token; actions that would rewrite real provider state are frozen; and actions whose side effects land on real members (reports, feedback, moderation of real content, DMs to non-testers, reviews of real sources, watching real listings) are refused. The mobile API returns 404 in sandbox mode, and the root layout renders a refusal screen (with the switcher still on it) instead of throwing when a non-tester session is present.

Two cross-cutting guards sit beside the layers:
- **A tester is never fraud-banned**, in either environment, in code and in the DB (§4.4). A sandbox Objective_Fraud finding must not ban the developer's real accounts or blocklist his real identity.
- **The switcher never calls GoTrue sign-out.** Every "leave this account" path clears the local auth cookies instead, because every GoTrue sign-out scope revokes the session the stash depends on (§6).

On top of this sits a dev-only floating **account switcher**. It restores Supabase sessions the developer already obtained himself; it is not an impersonation endpoint. It exists in the module graph only under `next dev` with the sandbox flag set: production builds resolve it to a null stub at build time (§6).

**Technology (locked):**
- Next.js 16.3.4. Installed per `node_modules/next/package.json`; `tech.md` still says 15. Middleware is `proxy.ts`.
- React 19, TypeScript strict, Supabase (`cardtrade` schema).
- `@supabase/ssr` 0.12.3 and `@supabase/supabase-js` 2.110.8.
- Vitest 3 + fast-check, @testing-library/react.
- Plain Node ESM for the launcher scripts, as in `scripts/e2e/run-prod.mjs`.
- No new dependencies.

---

## 0. Resolved identities (read-only lookup, done in this step)

I used read-only service-role `GET`s against PostgREST and the GoTrue admin API, host `kyyaqnsmqthqmnhaqhzq.supabase.co`. No writes were made and only ids and handles are recorded here. The Supabase MCP tool wasn't available in this step.

| Handle | Profile / auth id | Notes |
|---|---|---|
| `joys_joys` | `216cdd7d-ef4a-466d-bffe-6a55f64d4dc1` | Identical to the auth user for **kitsunearia@gmail.com** (Google provider). AU, Identity VERIFIED, Connect APPROVED with settlements on, real `acct_…` ref, real `cus_…` payer, **no saved card**, onboarded |
| `piggybear` (the user said "piggybear789") | `27cf7959-22ec-438d-9521-0cc8dc53c706` | Google provider, gmail. No profile has the display name `piggybear789`, and this account's email local part is not `piggybear789` either; "piggybear789" matches the GitHub owner name. AU, VERIFIED, APPROVED, real `acct_…`, real `cus_…`, **real saved card (`pm_…`)**, onboarded |

Neither account has a password identity, so both are Google OAuth only.

Existing rows that involve them (counts only):

- **Items.** `joys_joys` has 2 hidden AVAILABLE singles and 1 public SOLD single. `piggybear` has 1 public AVAILABLE SHOPFRONT, 1 public AVAILABLE single and 2 hidden singles.
- **Cash sales.** 1 `COMPLETED`, `piggybear → joys_joys`, `seller_payout_status = SETTLED`. This was a real payout.
- **Other rows.** Trades: 0 in the whole table. Offers: 1 PENDING, tester↔tester. Deal invites: 5 unclaimed, hosted by testers. Conversations: 3 on listings, tester↔tester. **No mixed tester/non-tester rows exist.**

These ids are hardcoded in the migration (§1). The migration also asserts each id's `display_name` (`'joys_joys'`, `'piggybear'`), so a wrong id fails the whole transaction rather than silently making some other account test-only.

**Precondition P1 (user):** confirm that "piggybear789" means profile `27cf7959…` (display name `piggybear`). The implementation step must not write 0134 with this id until the user confirms; see Open questions.

---

## 1. Tester flag and stamped test rows (migration `0134_tester_sandbox_isolation.sql`)

The highest existing migration is `0133_binder_listing_chat_copy.sql`, confirmed by a directory listing. The new file is **0134**.

### Decision: stamped `is_test`, not derived

Contract rows carry `is_test boolean not null default false`, set by a BEFORE INSERT trigger from the participants' `is_tester`. I chose stamping over deriving at read time, for these reasons:

- **History stays truthful.** The existing COMPLETED sale between the two accounts had a real settled payout and must keep counting in custody and payout history. A derived flag would retroactively turn it into "test" the moment the profiles are flagged.
- **Un-flagging is safe.** Un-flagging a tester later must not convert fabricated test listings into real public listings. A stamped value keeps them test forever.
- **Simpler filters.** Every job and queue filter becomes a single-column predicate (`.eq('is_test', …)`) instead of a join to `profiles` on each sweep. That matters for pg_cron SQL and PostgREST alike.

Columns added (all `boolean not null default false`):
- `profiles.is_tester`
- `items.is_test`
- `cash_sales.is_test`
- `trades.is_test`
- `offers.is_test`
- `deal_invites.is_test`
- `conversations.is_test`

Child rows (`cash_sale_items`, `trade_items`, `pre_auth_holds`, `trade_fees`, messages, events) inherit through their parent and are filtered by joining to it, so they get no column of their own.

### Migration file order

The order is load-bearing. The `identityGate.test.ts` regexes and the immutability trigger both constrain it.

1. **Header comment.** It must not contain the literal `select (` or `as is_verified`. Describe policies in prose without them.
1a. **Live-body drift guard.** A `do $$ … $$` block compares `md5(prosrc)` of each of the four cron functions against the md5 of the body the `_for` copy was built from, and raises `LIVE_BODY_DRIFT: <name>` on any difference, before anything else runs (step 6, "Scoped sweep functions", has the full procedure). Because it is first, a drift aborts the whole transaction with nothing applied.
2. **`alter table … add column`** for all seven columns, plus `comment on column`.
3. **Assert, then set the testers, in one `do $$ … $$` block** whose `declare` section holds the only four literals naming the accounts, so swapping in different testers (P4's alternative) is a four-literal edit:

   ```sql
   do $$
   declare
     tester_a_id   constant uuid := '216cdd7d-ef4a-466d-bffe-6a55f64d4dc1';
     tester_a_name constant text := 'joys_joys';
     tester_b_id   constant uuid := '27cf7959-22ec-438d-9521-0cc8dc53c706';
     tester_b_name constant text := 'piggybear';
   begin
     -- raise unless each id exists with its display_name; a missing id or a
     -- mismatched name aborts the transaction
     update cardtrade.profiles set is_tester = true where id in (tester_a_id, tester_b_id);
     -- raise unless exactly 2 rows now have is_tester
   end $$;
   ```
4. **Pre-check.** A `do` block raises if any *live* mixed row exists: a PENDING offer, an unclaimed invite or a non-terminal contract with one tester and one non-tester. Today there are none; the check protects against drift before apply.
5. **Backfill, before the immutability trigger exists:**
   - `items` owned by a tester → `is_test = true`. This is all 8 of them; see Open question 1.
   - `offers` whose buyer and seller are both testers → true.
   - `deal_invites` hosted by a tester → true.
   - `conversations` whose participants are both testers → true.
   - `cash_sales` and `trades` are **not** backfilled. The one completed sale stays real.
   - **Intentional parent/child mismatch.** That real COMPLETED sale (`is_test = false`) references a SOLD item that this backfill marks `is_test = true`. It is the only row of its kind and is deliberate: the money was real, and the listing belongs to a now-test account. The stamp triggers only fire on INSERT, and `keep_is_test_immutable` only compares a row with itself, so nothing refuses it. Any future consistency check or assertion over sale/item `is_test` agreement must exclude `cash_sales.created_at < <0134 apply time>` or this sale's id explicitly.
6. **Functions.** All `security definer`, `set search_path = cardtrade, pg_temp`, and `stable` where read-only.
   - `cardtrade.profile_is_tester(p uuid) returns boolean`. Body, exactly: `select coalesce((select is_tester from cardtrade.profiles where id = p), false)`. The outer `coalesce` over a scalar subquery returns `false` for a missing profile; a bare `select coalesce(is_tester, false) from profiles where id = p` returns NULL when there is no row, and `new.is_test := NULL` would violate NOT NULL inside the stamp triggers. Internal only, revoked from public/anon/authenticated. **No view or policy may call it**, because a function called from a view or policy is checked against the *querying* role (see step 8).
   - `cardtrade.viewer_is_tester() returns boolean`. It returns `cardtrade.profile_is_tester(auth.uid())`, which is false for anon. It is SECURITY DEFINER, so its own call to `profile_is_tester` runs as the owner and the revoke doesn't affect it. This is the only tester function a policy calls, and it is granted to anon/authenticated (step 9).
   - The trigger functions are security definer because a member inserting a conversation through the cookie-bound client cannot read the *other* participant's profile under owner-only RLS. An invoker-rights trigger would silently see `null`.

   | Trigger | Table / timing | Rule |
   |---|---|---|
   | `stamp_item_is_test` | items, BEFORE INSERT | `new.is_test := profile_is_tester(new.owner_id)`. Overrides any member-supplied value |
   | `stamp_cash_sale_is_test` | cash_sales, BEFORE INSERT | `b := tester(buyer)`, `s := tester(seller)`. If `b <> s`, raise `TESTER_MISMATCH`. If `items.is_test <> b`, raise `TESTER_MISMATCH`. Then `new.is_test := b` |
   | `stamp_trade_is_test` | trades, BEFORE INSERT | Same rule over `initiator_id`/`counterpart_id` and both non-null `*_item_id`s |
   | `check_trade_item_is_test` | trade_items, BEFORE INSERT | `items.is_test` must equal the parent `trades.is_test`, else raise |
   | `stamp_offer_is_test` | offers, BEFORE INSERT | Buyer/seller/item, same rule |
   | `stamp_deal_invite_is_test` | deal_invites, BEFORE INSERT, and BEFORE UPDATE OF `claimed_by`, `host_item_id` | Insert: `new.is_test := tester(host)`, and `host_item_id`'s `is_test` must match. Claim: when `claimed_by` goes from null to non-null, `tester(claimed_by)` must equal `is_test`, else raise. Host item change: a non-null new `host_item_id` must have `items.is_test = is_test`, else raise. `updateDealInvite` (0124) edits the item row, not `host_item_id`, so today this branch never fires; it costs nothing and closes the path if that changes |
   | `stamp_conversation_is_test` | conversations, BEFORE INSERT | `a`, `b` are the participants. If `item_id` or `trade_id` is set and `a <> b`, raise. If `item_id` is set, the item's `is_test` must match. `new.is_test := a and b`. An item-less DM with mixed participants is allowed and stays `false` |
   | `keep_is_test_immutable` | all six contract/item tables, BEFORE UPDATE | `if new.is_test is distinct from old.is_test then raise` |
   | `refuse_tester_fraud_ban` | profiles, BEFORE UPDATE OF `fraud_banned_at` | `if new.fraud_banned_at is not null and old.fraud_banned_at is null and new.is_tester then raise exception using errcode = 'P0001', message = 'TESTER_FRAUD_BAN_REFUSED'` |
   | `refuse_tester_identity_ban` | identity_bans, BEFORE INSERT | `if new.source_profile_id is not null and profile_is_tester(new.source_profile_id) then raise … 'TESTER_FRAUD_BAN_REFUSED'`. With `ignoreDuplicates` upserts this aborts the statement, which is the intent |

   Each pairing raise uses `raise exception using errcode = 'P0001', message = 'TESTER_MISMATCH: <table>'`. **Every** writer that can hit one maps a message beginning `TESTER_MISMATCH` to the `TESTER_MISMATCH` failure, not `persistence-error`: the four Supabase repositories, and the lib-layer direct inserts in `offers.ts` (offer insert), `messages.ts` (conversation insert), `dealInvites.ts` (invite insert and claim update, admin client) and `listings.ts` (item inserts). The mapping is one helper, `isTesterMismatch(error)` in `lib/sandbox/dbErrors.ts`, so the string lives in one place.

   The fraud-ban triggers deliberately guard `identity_bans` (the blocklist) and not `identity_person_keys`. Person keys are written at every real Identity verification, and refusing them for testers would change how real verification records keys; the harmful write is the blocklist row and the profile ban, and both are refused.

   These triggers fire for **every** writer, service role included. That is why the DB, not only the orchestrator, owns the pairing invariant: the contract RPCs (`create_cash_sale_agreement` and the rest) run on the service-role path and can't be trusted to remember a check.

   **Scoped sweep functions.** 0134 redefines the zero-arg functions pg_cron calls, so each `_for` body must equal the LIVE production body plus the scope predicate; a stale copy would silently revert a production fix in an hourly money-adjacent job. The implementer has no SQL access (§0), so the migration proves the match itself rather than trusting the files:
   1. **Copy** each body from its newest defining migration: `auto_complete_due_cash_sales` from 0038, `warn_expiring_holds` from 0093, `expire_lapsed_holds` from 0109, `enforce_trade_shipping_deadlines` from 0039. Before relying on those, the implementer greps every later migration for `function cardtrade.<name>` and uses the newest hit if one exists.
   2. **Hash** the exact text between that definition's `$$` delimiters (byte for byte, including the leading and trailing newline) with `md5`, and record the four hex digests as literals in step 1a. A one-off `node -e` over the migration file is enough; the digests and the source migration number are written in a comment beside each check. Note: `prosrc` is the stored body verbatim, so the digest matches only if the live function was created from that exact text.
   3. **Guard** (step 1a), one `if` per function:

      ```sql
      do $$
      begin
        if (select md5(prosrc) from pg_proc
             where oid = 'cardtrade.auto_complete_due_cash_sales()'::regprocedure)
           is distinct from '<md5 of the 0038 body>' then
          raise exception 'LIVE_BODY_DRIFT: auto_complete_due_cash_sales';
        end if;
        -- same for warn_expiring_holds, expire_lapsed_holds, enforce_trade_shipping_deadlines
      end $$;
      ```

      `is distinct from` also catches a missing function (NULL digest).
   4. **On `LIVE_BODY_DRIFT`** the transaction has rolled back, so nothing changed. The user runs, read-only, `select prosrc from pg_proc where oid = 'cardtrade.<name>()'::regprocedure` and hands the output to the implementer, who rebuilds that `_for` body from it and replaces that digest with `md5` of the live text. The drift itself is reported to the user, because it means production carries an unrecorded hand-applied change.
   5. **Then**, for each function:
      - create `cardtrade.<name>_for(p_is_test boolean)` with the same return type and language as the verified definition (the `database.types.ts` entry in §3 follows that return type) and the verified body, plus `and <row>.is_test = p_is_test` on the contract scan (§4.3 names the row per function);
      - redefine the zero-arg `<name>()` as `select cardtrade.<name>_for(false)`. The pg_cron commands and schedules are untouched;
      - revoke all on both from `public, anon, authenticated` and grant execute to `service_role`.
7. **Policy.** Drop and recreate `items_catalog_select` with the 0108 text verbatim, plus one conjunct on the public branch:

   ```sql
   and (is_test = false or (select cardtrade.viewer_is_tester()))
   ```

   The `(select …)` wrapper makes Postgres evaluate it once per statement, as an initplan (0078 pattern). The owner, live-cash-sale and live-trade branches are unchanged: a counterparty to a test contract is by construction a tester. `items_trade_participant_select` (0071) is unchanged for the same reason.
8. **View.** `create or replace view cardtrade.discoverable_profiles` keeps `select *` over `public_profiles`, with an inlined base-table subquery instead of a function call:

   ```sql
   create or replace view cardtrade.discoverable_profiles as
     select *
     from cardtrade.public_profiles
     where closed_at is null
       and not exists (
         select 1 from cardtrade.profiles p
         where p.id = public_profiles.id and p.is_tester
       );
   ```

   Testers drop out of seller search for everyone. **Why not call `profile_is_tester`:** a non-`security_invoker` view checks *table* access against the view owner, but functions called inside it are checked against the querying role (PostgreSQL docs, CREATE VIEW → Notes). `suggestSellers` reads this view as anon, so a call to the revoked function would fail every production seller search with "permission denied for function". The subquery reads `profiles` with the owner's privileges, which the definer view already has. The text contains neither `select (` nor `as is_verified`. Its columns are unchanged, so `create or replace` is valid. **`public_profiles` is deliberately NOT redefined.** That view carries the `is_verified` expression that `tests/property/identityGate.test.ts` parses from the newest defining migration, and touching it buys nothing the seller-page guard (§2) doesn't already give.
9. **Grants, LAST in the file** (tech.md rule):
   - `grant select (is_tester) on cardtrade.profiles to authenticated;`
   - `grant select (is_test) on cardtrade.items to anon, authenticated;` This is load-bearing: `items` is granted column by column, so a `select('*')` fails without it (0097 note).
   - `grant select (is_test) on cardtrade.cash_sales, cardtrade.trades, cardtrade.offers, cardtrade.conversations, cardtrade.deal_invites to authenticated;` This is harmless where table-level SELECT already exists.
   - `grant execute on function cardtrade.viewer_is_tester() to anon, authenticated;` It's read-only and reveals only the caller's own flag. `flutter.md` asks member-executable functions to grow slowly and for read-only reasons, and this is one.
   - **No INSERT or UPDATE grant on any new column.** `profiles` inserts are column-allowlisted since 0072/0073, so a member can't insert `is_tester`. Members can never set it at all.

No Connect column appears in any expression. The Identity_Gate expressions aren't touched.

### Applying (the user does this, not the agent)

The Supabase MCP `apply_migration` fails on this project (42P10), so the user applies the file through `execute_sql` as a single transaction. **No agent step may apply it or run write SQL against production.**

Read-only checks before applying:
- None is needed for the four sweep bodies: the step 1a drift guard compares them inside the transaction and aborts on any difference.
- `select jobname, command from cron.job`, to confirm the four jobs are the only ones touching contract tables. Any other job gets the §4.3 treatment, and its body the same digest guard.
- `information_schema.column_privileges` for profiles/items/cash_sales/trades.
- `to_regclass` is not needed; the columns are new.

Read-only checks after applying:
- `is_tester` count = 2.
- The policy text, via `pg_policies`.
- That `authenticated` has no INSERT or UPDATE privilege on `is_tester` or `is_test`.
- **Anon can still read the views**, run inside a transaction that is rolled back: `begin; set local role anon; select count(*) from cardtrade.discoverable_profiles; select count(*) from cardtrade.items where status = 'AVAILABLE'; rollback;`. Both must succeed. The same pair under `set local role authenticated`.

**Rollout order is fixed: migration first, code second.** The new code selects `is_test` and `is_tester` explicitly and fails on a schema that lacks them. The migration is backward compatible with the currently deployed code: the defaults hold, the grants keep `select('*')` working, and the triggers only refuse mixed tester rows.

One risk sits in the window between the two: until the new code deploys, a production contract between the two testers would still run through real Stripe. Don't transact between the tester accounts on noditto.app in that window.

---

## 2. RLS isolation and every catalog reader

Among testers, tester listings are ordinary public listings, so catalog buy, offers, binder buys and propose-trade all work. Each reader and its change:

| # | Reader | Client | Change |
|---|---|---|---|
| R1 | `items_catalog_select` policy | all member/anon reads | Public-branch conjunct (§1.7). This is the primary control |
| R2 | `searchCatalog` (`lib/actions/listings.ts`) | cookie-bound | Covered by R1. Also adds `.eq('is_test', testRowScope() === 'test')`, so a sandbox catalog shows only test listings and the production catalog never shows a tester their test listings |
| R3 | `listCatalogItems` (`listings.ts`, ~L1078) | cookie-bound | Same as R2 |
| R3a | `listAvailableItems` (`listings.ts` L956, exported, no callers today) | cookie-bound | Same as R2: `.eq('is_test', currentScope() === 'test')`. Kept rather than deleted, because removing an export is outside this task |
| R4 | `readCatalogFacets` (`listings.ts`) | anon `publicCatalogClient`, `unstable_cache` | No code change. Anon gets `viewer_is_tester() = false`, so test rows are excluded for everyone, testers included. Accepted: the price-slider ceiling and histogram ignore test listings in the sandbox |
| R5 | `loadSuggestions` / `suggestItems` | anon, cached | Same as R4, no change. Typed suggestions don't surface test listings in the sandbox |
| R6 | `cardtrade.suggest_items_fuzzy` (0130) | SECURITY INVOKER, anon | Same as R4, no change |
| R7 | `suggestSellers` → `discoverable_profiles` | anon | View redefinition (§1.8). Testers are never discoverable |
| R8 | `app/sitemap.ts` | **admin client (bypasses RLS)** | Add `.eq('is_test', false)`. This is the one hard leak. Seller URLs derive from these rows, so they're covered too |
| R9 | `/listings/[id]` page | cookie-bound | Covered by R1: a non-tester gets 404. Its "own items to offer" query (`canProposeTrade`) adds `.eq('is_test', scope)` so a tester can't pick a real item to offer in the sandbox |
| R10 | `/sellers/[id]` page | `public_profiles` + cookie-bound items | Items are covered by R1. **New guard:** after `sellerRow` resolves, `isTesterProfile(id)` (server-only, admin client, selects only `is_tester`) is checked. If the target is a tester and the viewer isn't a signed-in tester (`getCachedProfile()?.is_tester`), call `notFound()`. `generateMetadata` (~L83) gets the same guard so the OG title can't leak. Both item queries add `.eq('is_test', scope)` |
| R11 | `/trades/new` page | cookie-bound | The requested item is covered by R1. The own-items list adds `.eq('is_test', scope)` |
| R12 | `/t/[token]` preview (`dealInvites.ts` ~L785, admin client) | **admin** | If `invite.is_test` and the viewer isn't a signed-in tester, render the existing "invite not available" state. A test token pasted into a real browser therefore shows nothing |
| R13 | Watchlist (`/saved`, `lib/actions/watchlist.ts`) | cookie-bound | Covered by R1. A real member who watched one of the testers' existing public listings sees it disappear |
| R14 | Messages / offers / notification-context readers | participants or admin-by-id | No change. Only participants read them, and test rows have tester participants only |
| R15 | Flutter direct catalog reads | member JWT under RLS | Covered by R1. No Dart change |
| R16 | Member contract and invite lists: `account.getMyPurchases`, `getMySales`, `getMyTrades` (behind `/purchases`, `/sales`, `/trades`), `dealInvites.listMyDealInvites`, and `lib/actions/statement.ts` | cookie-bound / admin | `.eq('is_test', currentScope() === 'test')` on every `cash_sales`, `trades` and `deal_invites` read. Production lists and statements show a tester only real rows (so the historical real sale stays on his statement and no mock money line appears); sandbox lists show only test rows |
| R17 | Contract rooms: `app/(workspace)/sales/[id]/page.tsx`, `app/(workspace)/trades/[id]/page.tsx` | cookie-bound | The loaded row already carries `is_test` (`CASH_SALE_PUBLIC_SELECT`; trades `select('*')`). When `checkSandboxAdmission` refuses, the page calls `notFound()` before rendering anything, so no room component, `ensureTradeConversation` call or read-triggered tracking refresh (§4.4) runs for an out-of-scope row |

**What the sandbox catalog shows (by design, not a bug).** R2/R3 narrow the main catalog grid to test listings. R4–R7 are anon and cached, so in the sandbox the price facets, typed suggestions and seller search surface **real** listings and sellers, not test ones. Following one leads to a refused flow: a real listing's page still renders in the sandbox (RLS shows it to anyone), but any contract, offer, conversation or watch on it is refused with `TESTER_MISMATCH` / `SANDBOX_SCOPE`. The developer should navigate test listings from the grid, `/listings/mine` or the seller page of the other tester.

**Explicitly not changed:** `public_profiles` (see §1.8). A tester's display name and rating remain readable to anyone who already holds the id, the same as today. The pages that would *present* them are guarded by R7, R8 and R10.

---

## 3. Contract pairing: the pure domain rule and its call sites

### New module: `domain/sandbox/` (pure, no imports from lib, app or components)

The module mirrors the `checkRegionCompatibility` style:

- **`testerIsolation.ts`**
  - `type TesterMismatch = { reason: 'TESTER_MISMATCH' }`
  - `checkTesterCompatibility(...participants: boolean[]): { ok: true; isTest: boolean } | { ok: false; mismatch: TesterMismatch }`. It's ok iff all the flags are equal, and `isTest` is that common value. It takes any number of flags, so a third party later is a call-site change only.
  - `type EnvironmentScope = 'real' | 'test'`
  - `testRowScope(sandboxMode: boolean): EnvironmentScope`
  - `checkSandboxAdmission({ sandboxMode, isTest }): null | { reason: 'SANDBOX_SCOPE'; direction: 'TEST_ROW_IN_PRODUCTION' | 'REAL_ROW_IN_SANDBOX' }`. It's null exactly when `isTest === sandboxMode`.
  - `testerMismatchMessage()` and `sandboxScopeMessage(direction)`, the member-facing copy:
    - "This is a test account and can only deal with other test accounts."
    - "This is a sandbox test contract. Open it from the local sandbox."
    - "This local sandbox only handles test contracts."
- **`sandboxMode.ts`.** `resolveSandboxMode(env: EnvLike): boolean`. It's true iff all of these hold:
  - `env.SANDBOX_MODE === '1'`
  - `env.NODE_ENV !== 'production'`
  - `!env.VERCEL`
  - `resolvePaymentProvider(env) === 'mock'` (import from `domain/services/providerMode.ts`)

  Like `providerMode.ts`, it's a pure function of an env object. A misconfigured "sandbox" (say, Stripe still active) resolves to **false**, so the server behaves as production: test rows are refused and no mock money touches them. Every misconfiguration fails toward refusing test rows.
- **`sandboxActionPolicy.ts`**
  - `SANDBOX_FROZEN_ACTIONS`: a readonly set of action names (§5.2).
  - `SANDBOX_REAL_SIDE_EFFECT_ACTIONS`: a readonly map from action name to `'REPORTING' | 'MODERATION'`, for actions whose side effects land on real members or the real admin queue regardless of row scope (§5.2). The kind picks the message.
  - `SANDBOX_AUTH_MODULE = 'auth'`: always admitted, so anyone can sign in or out of the sandbox.
  - `type SandboxSessionState = 'NONE' | 'VALID' | 'UNRESOLVED'`, and `deriveSandboxSessionState({ hasSessionCookie, hasBearer, userResolved }): SandboxSessionState`. `'NONE'` only when neither a session cookie nor a Bearer header is present; otherwise `'VALID'` when a user resolved and `'UNRESOLVED'` when not (§5.2).
  - `sandboxActionDecision({ actionName, actor: { sessionState, isTester, isStaff } })`. It returns `'ALLOW' | { refuse: 'SANDBOX_PROVIDER_STATE_FROZEN' } | { refuse: 'SANDBOX_REAL_SIDE_EFFECT'; kind: 'REPORTING' | 'MODERATION' } | { refuse: 'SANDBOX_TESTERS_ONLY' }`. The full table is in §5.2.
  - `sandboxLayoutDecision({ sandboxMode, sessionState, isTester, isStaff }): 'RENDER' | 'REFUSE'`. `'RENDER'` when `!sandboxMode`, when `sessionState === 'NONE'`, or when `VALID` and (`isTester` or `isStaff`); `'REFUSE'` otherwise. It is the same admission as rows 4–7 of the action table, so the layout and the gate cannot disagree about who is admitted (§5.2, "Refusal before render").
- **`index.ts`** re-exports the three modules.

Error codes added to `EXPECTED_CODES` in `domain/errors/errorLog.ts`, because these are refusals, not breakages. That set holds **normalized** codes (matched after `.toLowerCase().replace(/_/g, '-')`), so the entries are `'tester-mismatch'`, `'sandbox-scope'`, `'sandbox-testers-only'`, `'sandbox-provider-state-frozen'` and `'sandbox-real-side-effect'`. The codes returned to callers stay upper-snake (`TESTER_MISMATCH`, …). `TEST_ROW_OUT_OF_SCOPE` (the webhook anomaly, §4) and `TESTER_FRAUD_BAN_REFUSED` (§4.4) are deliberately left unexpected.

### Where pairing and creation admission are enforced

Creation points evaluate `checkTesterCompatibility`, then `checkSandboxAdmission({ sandboxMode, isTest })`. "Test rows are created only from the sandbox; real rows only outside it."

| Creation point | Layer | Data needed (added to the existing loads) |
|---|---|---|
| `openAgreement` in `cashSaleOrchestrator.ts`, behind `initiateCashSale` and `openPrivateDealCashSale` | domain, beside `checkRegionCompatibility` and before the identity disclosure | `BuyerRecord.isTester`, `ItemRecord.isTest`, `ItemRecord.ownerIsTester`, from `supabaseCashSaleRepository.loadBuyer` / `loadItem` |
| `proposeTrade` (`tradeProposal.ts`) | domain | Initiator, counterpart and item flags, from `supabaseTradeProposalRepository` |
| `openTradeNegotiation` (`lib/actions/tradeNegotiation.ts` ~L652) | lib, beside the existing region check | Extend the profiles `region_code` query to select `is_tester`, and the item query (~L611) to select `is_test` |
| `trades.proposeTrade` (`lib/actions/trades.ts` ~L250) | lib → domain | `targetItem` selects `is_test` |
| `offers.makeOffer` / `counterOffer` | lib | The item query (~L129) selects `is_test`. Caller and seller flags come from `profiles` |
| `dealInvites.createDealInvite` | lib | Host flag. The single-party admission is `checkSandboxAdmission({ sandboxMode, isTest: hostIsTester })` |
| `dealInvites.claimDealInvite` | lib | `invite.is_test` versus the claimant flag, then the orchestrator re-checks on open |
| `messages.getOrCreateConversation` | lib | When `itemId` is set: the item's `is_test` and both participant flags (both environments). **In the sandbox, always**: both participants must be testers, item or not, else `TESTER_MISMATCH`. An item-less DM between a tester and a real member is therefore possible only from production, where it is an ordinary real conversation |
| `messages.sendMessage` | lib | In the sandbox, the loaded conversation must have `is_test = true`, else `SANDBOX_SCOPE`. This stops a tester in the sandbox posting into his existing real conversations, which would notify real members |
| `listings.createItem` and `createPrivateTradeItem` (`listings.ts` ~L497, ~L626) | lib | Single-party: `checkSandboxAdmission({ sandboxMode, isTest: actorIsTester })`. In production a tester can't create listings; in the sandbox a non-tester never reaches here (§5 gate) |

`sandboxMode` reaches orchestrators the same way `operationalRegions` does. It's a new optional dep, `sandboxMode?: boolean`, on `CashSaleOrchestratorDeps`, `TradeProposalDeps`, `TradeOrchestratorDeps` and `DisputeResolutionDeps`. Each `createDefaultXOrchestrator()` factory (they live in `domain/orchestrator/supabase*Repository.ts`) fills it with `resolveSandboxMode(process.env)` and computes the decorator scope as `testRowScope(resolveSandboxMode(process.env))`, both from `domain/sandbox`. The factories never import `lib/sandbox/*`, because `domain/` may not import `lib/`. Tests inject both.

The lib layer gets `lib/sandbox/sandboxMode.ts`: `server-only`, exporting `isSandboxMode()` and `currentScope()`, both thin wrappers over the domain functions with `process.env`.

### Existing rows: scoped repositories (one chokepoint per orchestrator)

`domain/sandbox/scopeRepository.ts` exports pure decorators over the four repository interfaces. **Out-of-scope contract ids are refused, not emptied.** An empty list is a valid in-scope answer, so returning `[]` from a per-trade read can be read as "nothing yet, go ahead": `placeBondsForAgreedTrade` (`tradeProposal.ts` L455) never calls `loadTrade`, reads `getHolds(tradeId)` as "no prior attempts" and then calls `payments.placeHold` with the testers' real `cus_…` / `pm_…` ids. `markDisputeReturnOverdue` (`disputeResolution.ts` L505) writes `recordReturnOverdue` with no read at all. So the rule is:

```ts
// domain/sandbox/scopeRepository.ts
export class OutOfScopeError extends Error {
  readonly code = 'SANDBOX_SCOPE' as const;
}

/** Runs `fn`; an OutOfScopeError becomes the caller's existing not-found result. */
export async function refuseOutOfScope<T>(fn: () => Promise<T>, notFound: T): Promise<T> {
  try { return await fn(); }
  catch (e) { if (e instanceof OutOfScopeError) return notFound; throw e; }
}
```

Every repository method is classified into exactly one of six kinds:

| Kind | Decorator behaviour |
|---|---|
| `loader` (loads the contract row itself) | Returns `null` when the row's `isTest` disagrees with the scope. A genuine "not found" the orchestrators already handle. Seeds the scope memo (below) |
| `guarded` (any read **or write** keyed by a contract id: `tradeId`, `cashSaleId`, `params.tradeId`, `params.cashSaleId`) | Before delegating, `await guard(id)`: looks the id up in the memo, else calls the scope lookup; throws `OutOfScopeError` when it disagrees with the scope **or** the row is missing. Nothing is delegated after a throw |
| `list` (job queues) | Overwrites `params.isTest` with the decorator's scope, then delegates |
| `create` (`createAgreement`, `createTrade`) | Delegated. Guarded upstream by creation admission (§3, "Where pairing…") and by the DB stamp triggers |
| `profile` (profile and item loaders: `loadBuyer`, `loadSellerPayee`, `loadItem`, `findPayerRef`, `getProfile`, `getItem`, `getTraderPayee`) | Delegated. They are not contract rows |
| `child-ref` (keyed by a hold ref or item ids: `markHoldStatus`, `markHoldVoided`, `recordFullCapture`, `reserveItems`, `restoreItems`) | Delegated. Every call site obtains the hold ref from a `guarded` `getHolds`, or the item ids from a `guarded` `listTradeItemIds` or a creation-admitted proposal, of the same contract. The behavioural test (below) proves that no out-of-scope path reaches one |

The classification is a typed record per interface, for example `const TRADE_PROPOSAL_SCOPE: Record<keyof TradeProposalRepository, ScopeKind>`, and the decorator is generated from it. Adding a method to a repository interface therefore fails `tsc` until someone classifies it.

| Decorator | `loader` | `guarded` | `list` | other kinds |
|---|---|---|---|---|
| `scopeCashSaleRepository(repo, scope, cashSaleIsTest)` | `loadCashSale` | every method taking a cash-sale id, read or write: `loadLineItems`, `disputeOriginStatus`, `claimPayment`, `settlePayment`, `recordShipment`, `markPayoutDue`, `recordPayoutResult` and every other id-keyed writer (the typed record forces the full list) | `listDuePayouts`, `listDueRefunds` | `createAgreement` (create); `loadBuyer`, `loadSellerPayee`, `loadItem`, `findPayerRef` (profile) |
| `scopeTradeRepository(repo, scope, tradeIsTest)` | `loadTrade` | `commitTransition`, `insertTransition` | none | none |
| `scopeTradeProposalRepository(repo, scope, tradeIsTest)` | none | `getHolds`, `listTradeItemIds`, `recordHold` | none | `createTrade` (create); `getProfile`, `getItem` (profile); `reserveItems`, `restoreItems`, `markHoldStatus` (child-ref) |
| `scopeDisputeResolutionRepository(repo, scope, tradeIsTest)` | none | `getHolds`, `recordDisputeParticipants`, `recordFrictionTaxCapture`, `recordPartialCaptureFailure`, `recordFrictionTaxReturnResult`, `recordReturnOverdue`, `recordFraudParticipants`, `flagManualReconciliation` | none | `getTraderPayee` (profile); `markHoldVoided`, `recordFullCapture` (child-ref) |

**Scope lookup and memo.** `tradeIsTest` / `cashSaleIsTest` are `(id) => Promise<boolean | null>`: a one-column `select is_test` by id, supplied by the Supabase factory, `null` for a missing row. Each decorator instance keeps a `Map<id, boolean>`, seeded by its `loader` results, so the normal path (load, then write) costs no extra query. Caching is safe for the life of the instance and beyond, because `keep_is_test_immutable` makes `is_test` immutable.

**Entry points that don't start with a loader.** Every exported orchestrator function whose first repository call is not a `loader` wraps its body in `refuseOutOfScope(…, <its existing not-found result>)`:
- `placeBondsForAgreedTrade` → `{ ok: false, error: 'trade-not-found' }`. `'trade-not-found'` is added to `PlaceAgreedBondsResult`, and `lib/trades/collateralPlacement.ts` maps it to its `SANDBOX_SCOPE` failure. Its profile and item reads run first and have no side effect; the guarded `getHolds` throws before the `placeHold` loop.
- `markDisputeReturnOverdue` → `{ ok: false, error: 'trade-not-found' }`. Its return type widens from `{ ok: true }` to `{ ok: true } | { ok: false; error: 'trade-not-found' }`. It has no callers today (checked), so the change is free.
- Any other export the behavioural test finds that throws `OutOfScopeError` out of the orchestrator gets the same treatment with its own existing not-found code. Functions that start with `loadTrade` / `loadCashSale`, or go through `applyEvent` (the dispute functions do), already return not-found and need no wrapper.

**Callers outside the factories.** `lib/trades/collateralPlacement.ts` builds its own proposal repository and passes it to `placeBondsForAgreedTrade` (L236). It wraps that repository with `scopeTradeProposalRepository(…, currentScope(), tradeIsTest)` too, in addition to its own `assertRowInScope` first statement, so the domain barrier holds even if the lib check is removed.

The list interface change: `listDuePayouts` and `listDueRefunds` gain a **required** `isTest: boolean` param on `CashSaleRepository`, implemented in `supabaseCashSaleRepository.ts` as `.eq('is_test', params.isTest)` and in every in-memory fake. `processDuePayouts` / `processDueRefunds` pass `isTest: testRowScope(deps.sandboxMode ?? false) === 'test'`; the decorator overwrites it with the same value, so a caller that forgets cannot widen the scope.

Each `createDefault*Orchestrator()` wraps its repository with `testRowScope(resolveSandboxMode(process.env))` (domain functions only, see above). The orchestrators then report their existing not-found codes for out-of-scope rows. In this environment the row does not exist, and every action on it, money-moving or not, fails before any repository write that completes and before any `PaymentService` call.

To make that possible:
- The domain `CashSale` and `Trade` records gain `isTest: boolean`, mapped from `is_test`.
- `'is_test'` is added to `CASH_SALE_PUBLIC_SELECT` (`lib/supabase/cashSaleProjection.ts`).
- The `trades` select lists in `supabaseTradeRepository.ts` / `tradeLifecycleStore.ts` gain it too.
- `lib/supabase/database.types.ts` gains:
  - `is_tester` on `profiles` Row (not in Insert or Update);
  - `is_test` on the six tables' Row;
  - the four `*_for` functions in `Functions`: `Args: { p_is_test: boolean }`, `Returns` matching the live return type (`number` for `integer`, `undefined` for `void`);
  - `viewer_is_tester`: `Args: Record<string, never>`, `Returns: boolean`.

`CachedProfile` and `getCachedProfile` in `lib/supabase/cachedAuth.ts` also select `is_tester`, for the gate in §5 and the seller-page guard in §2.

### Existing rows outside the repositories: chokepoints

Lib code that loads a trade or sale by id outside the repositories is scoped at its **chokepoints**, not at each caller, so a new caller of an existing loader is covered automatically. `lib/sandbox/rowScope.ts` (server-only) exports:
- `rowInScope(row: { is_test: boolean }): boolean`, a pure check against `currentScope()` for loaders that already hold the row;
- `assertRowInScope(admin, table, id): Promise<{ ok: true } | { ok: false; reason: 'SANDBOX_SCOPE' }>` for primitives that only hold an id. It selects `is_test` alone, never throws, and treats a missing row as out of scope.

| Chokepoint | File | Out-of-scope result (the function's existing failure shape) |
|---|---|---|
| `requireParticipant` | `lib/actions/trades.ts` (~L105). The row is `select('*')`, so `is_test` is already present: `if (!rowInScope(trade)) return { ok: false, error: 'not-participant' }` | `not-participant`. This covers every action built on it: `ensureTradeConversation`, the lifecycle actions (~L452), `retrySettleTradeCash` (~L603), `raiseDispute`, `claimFraud`, `updateTradeHandoverTerms` (~L926), `reportHandoverFailed`, `saveTradeDeliveryAddress` (~L1161), `syncTradeTracking` (~L1315) |
| Both trade loaders | `lib/actions/tradeNegotiation.ts` (~L108 and ~L426, admin client, `select('*')`) | `not-participant`. Covers `acceptTradeTerms`, `proposeTradeTerms`, `retryTradeCollateral` and everything else built on them |
| `voidTradeHolds(tradeId)` | `lib/trades/completion.ts` | `assertRowInScope(admin, 'trades', tradeId)` first; out of scope returns its failure variant with `detail: 'SANDBOX_SCOPE'` and voids nothing |
| `settleTradeCash(trade)` | `lib/trades/completion.ts` | `rowInScope(trade)` first; out of scope returns `{ ok: false, error: 'not-ready', detail: 'SANDBOX_SCOPE' }` before any provider call. This is the one that would otherwise make a **real Stripe transfer** for a mock-funded trade |
| `finalizeCompletedTrade(…, trade)` | `lib/trades/completion.ts` | `rowInScope(trade)` first, then its existing failure shape with `detail: 'SANDBOX_SCOPE'` |
| `itemIdsFor`, `syncHolds`, `placeTradeCollateral` | `lib/trades/collateralPlacement.ts` (every export) | `assertRowInScope(admin, 'trades', tradeId)` first. `itemIdsFor` returns `[]`; `syncHolds` returns without writing; `placeTradeCollateral` returns its failure variant with `SANDBOX_SCOPE`, placing no hold |
| `chargeTradeFees`, `refundTradeFees` | `lib/actions/tradeFees.ts` (every exported money primitive, not only the drain) | `assertRowInScope(admin, 'trades', tradeId)` first, before any provider call or `trade_fees` write. Out of scope, `chargeTradeFees` returns `{ collectedCents: 0, anyFailed: true }` (nothing charged, nothing recorded) and `refundTradeFees` returns `0` (nothing refunded); neither shape changes. Both are reached today only through the scoped `collateralPlacement.ts`; the check makes that independent of the caller |
| `tradeLifecycleStore.ts` writers | `lib/actions/tradeLifecycleStore.ts` | `assertRowInScope` before each write keyed by trade id |
| `saveCashSaleReturnAddress` | `lib/actions/cashSale.ts` (~L715, cookie client direct upsert) | Add `is_test` to its select; `!rowInScope(sale)` returns `cash-sale-not-found` before the upsert and the notification |

`syncCashSaleTracking` goes through `orchestrator().syncTracking`, so the scoped repository already covers it.

The static coverage test (§Testing) requires every exported function in `lib/trades/completion.ts`, `lib/trades/collateralPlacement.ts` and `lib/actions/tradeFees.ts` to call `rowInScope` or `assertRowInScope` (`drainFailedTradeFees`, a list sweep, satisfies it through its `is_test` filter instead), so a new money primitive added there without a check fails the suite.

### Contract room banner

`components/sandbox/TestContractBanner.tsx` is a server-renderable, fixed-height, single-line notice: "Sandbox test contract · mock payments." It renders in `CashSaleView` and `TradeContract` when the row's `is_test` is true. Because rooms in the wrong scope now `notFound()` (R17), a test room is only ever rendered in the sandbox, so the banner has one wording. It costs nothing extra because `is_test` comes with the row.

---

## 4. Production machinery ignores test rows

**Decision:** production-side code skips test rows entirely (scope `real`). The same code, run by the sandbox server, processes only test rows (scope `test`) under mock. There is one code path with an environment-chosen scope, not a second implementation. The alternatives were weaker:
- Letting production jobs process test rows "because the mock ids would just fail" is wrong. Both testers hold real `cus_…`, `pm_…` and `acct_…` ids. A production fee retry would charge piggybear's real card, and a production payout drain would transfer real money to a real Connect account for a sale paid with mock money.
- Only filtering money calls would leave the admin queues, emails and SLA flags polluted.

### 4.1 Vercel job routes

The route code itself is unchanged: the bearer check and fail-closed behaviour stay. Each sub-sweep reads `currentScope()`:

| Path | Function | Change |
|---|---|---|
| `/api/jobs/cash-sale-payouts` | `orchestrator.processDuePayouts()` (per region) → `repo.listDuePayouts` | `listDuePayouts({ …, isTest })` adds `.eq('is_test', isTest)` (§3). The scoped repository's per-sale load is the second barrier |
| same route | `orchestrator.processDueRefunds()` → `repo.listDueRefunds` | Same |
| `/api/jobs/trade-inspections` | `sweepTradeInspections` (`lib/trades/inspectionSweep.ts`: due INSPECTION ~L110, closing-warning ~L224) | `.eq('is_test', isTest)` on both selects |
| same route | `flagStaleCollateralTrades` (`inspectionSweep.ts` ~L307) | Same |
| same route | `sweepCashSaleInspections` (`lib/trades/cashSaleInspectionSweep.ts`) | `.eq('is_test', isTest)` on **every** `cash_sales` read in the file (the review counted 11 references; the set is defined by the coverage test, not by a hand count). Update-by-id calls that follow a scoped select need no filter of their own and carry the exemption comment |
| same route | `drainFailedTradeFees` (`lib/actions/tradeFees.ts`) | `.select('*, trades!inner(is_test)').eq('trades.is_test', isTest)` |
| same route | `placeDueTradeCollateral` / `advanceDueHandovers` (`lib/trades/bondPlacementSweep.ts` ~L70, ~L163) | `.eq('is_test', isTest)`. This one matters most: it **places real authorisations** |

### 4.2 Sandbox jobs on demand

`npm run sandbox:jobs` runs `scripts/sandbox/jobs.mjs`. It:
1. Reads the per-launch jobs secret from `.next-sandbox/sandbox-jobs.json`, which the launcher writes (`.next-*` is gitignored).
2. Calls `GET http://localhost:<port>/api/jobs/trade-inspections`, then `/api/jobs/cash-sale-payouts`, with the bearer. Those run with scope `test` and the mock provider, because the server is in sandbox mode.
3. Calls the four `*_for(true)` RPCs with the service role from `.env.local`. These are the pg_cron equivalents, and by construction they touch only test rows.

It refuses to run unless `GET /` answers on the port **and** the secrets file exists, which proves a `sandbox:dev` launcher is running. Output is the JSON counts.

### 4.3 pg_cron jobs

| Job | Function | Change |
|---|---|---|
| `cardtrade_auto_complete_cash_sales` (:07) | `auto_complete_due_cash_sales()` | Now `select …_for(false)`. The `_for` body adds `and is_test = p_is_test` to the INSPECTION loop |
| `cardtrade_warn_expiring_holds` (:17) | `warn_expiring_holds()` | Same, joining `trades t … and t.is_test = p_is_test` |
| `cardtrade_expire_lapsed_holds` (:27) | `expire_lapsed_holds()` (0109) | Same join predicate |
| `cardtrade_enforce_trade_shipping_deadlines` (:37) | `enforce_trade_shipping_deadlines()` (0039) | `and is_test = p_is_test` on the trades scan |

The bodies are copied from the newest defining migration (0038, 0093, 0109, 0039) and proven equal to production by the `md5(prosrc)` drift guard at the top of 0134 (§1, steps 1a and 6). Hand-applied history means the files may be stale; if one is, the migration aborts with `LIVE_BODY_DRIFT` and the body is rebuilt from a read-only `prosrc` query. The user also confirms through `cron.job` that no other job touches contract tables. If one does, it gets the same treatment and is added to this table.

### 4.4 Other production machinery

| Machinery | File | Change |
|---|---|---|
| Custody reconciliation | `lib/actions/admin.ts` `getCustodyPosition` (~L776) | `.eq('is_test', isTest)` on the `cash_sales` read. `domain/payouts/custodyReconciliation.ts` stays pure and unchanged: the filter belongs to its input producer. In the sandbox it compares test obligations against the mock balance |
| Admin payout drain button | `admin.drainCashSalePayouts` | Goes through the same orchestrator, so it's covered by 4.1 |
| Admin payout retry | `admin.retryCashSalePayout` | Covered by the scoped repository (`NOT_FOUND` out of scope) |
| Staff resolutions | `admin.resolveCashSaleReturnCase`, `resolveCashSaleDispute`, `resolveTradeConditionDispute`, `resolveTradeFraud`, `clearTradeReconciliationFlag` | Covered by the scoped repositories / `assertRowInScope`. A staff member on a sandbox server can never "mock-refund" a real dispute |
| **Fraud ban** | `lib/auth/fraudBan.ts` `permanentlyBanConfirmedFraudOffender`, `enforceProfileFraudBan` | **A tester is never fraud-banned, in any environment.** Both functions first read `profiles.is_tester` for the target (`enforceProfileFraudBan` adds it to its existing `fraud_banned_at` select; `permanentlyBanConfirmedFraudOffender` calls `enforceProfileFraudBan` first and skips `blocklistIdentityOf` when it reports a tester). For a tester they return `{ ok: true, alreadyBanned: false }` and write nothing: no `fraud_banned_at`, no listing hide, no Auth `ban_duration`, no `identity_person_keys` stamping, no `identity_bans` row, no cascade. In the sandbox they log one console line ("sandbox: fraud ban skipped for tester"). `resolveTradeFraud` still moves the (mock) collateral and reaches `FRAUD_RESOLVED`, so the arbitration flow is testable end to end. The DB triggers `refuse_tester_fraud_ban` and `refuse_tester_identity_ban` (§1.6) are the backstop; if one ever fires, the code check was bypassed, so it surfaces as the unexpected `TESTER_FRAUD_BAN_REFUSED`. In production this cannot happen legitimately: a tester can only transact with another tester, and only in the sandbox |
| Read-triggered tracking | `lib/tracking/refreshOnRead.ts` `scheduleCashSaleTrackingCheck`, `scheduleTradeTrackingCheck` | Add `is_test` to both initial selects inside `after()`, and `return` when `!rowInScope(row)`, before the claim, the Ship24 call and the `apply_*_tracking` RPC. R17 already stops production rendering a test room, so this is the second barrier for lists and any future caller |
| Admin console counts and tabs | `app/(workspace)/admin/(console)/page.tsx`: payouts tab ~L245, reconciliation tab ~L264, the counts ~L358, 363, 367, 371 | `.eq('is_test', isTest)` on each `cash_sales`/`trades` read. `charge_disputes` only ever references real Stripe charges, so it gets no change |
| Arbitration queue | `lib/actions/arbitration.ts` `getArbitrationQueue` (~L286, 296, 311) | `.eq('is_test', isTest)` on the cash_sales and trades reads. Chargebacks are real by construction |
| Arbitration case and actions | `getArbitrationCase`, `assignArbitrationCase`, `addArbitrationNote` | `assertRowInScope` on the case's sale or trade. Out of scope behaves like not found |
| Member payouts dashboard | `lib/actions/payouts.ts` `getPayoutsDashboard` | `.eq('is_test', isTest)` on its sales/trades reads. Otherwise a tester in production would see test sales as owed forever |
| Stripe / mock webhook routing | `lib/webhook/webhookPipeline.ts` `dispatchEvent` | After the target sale or trade resolves from the `cardtrade_*` metadata or mock payload, check `checkSandboxAdmission({ sandboxMode, isTest })`. Out of scope → outcome `NO_OP`, logged to `webhook_logs` as usual. In production this "cannot happen", because test rows never touch Stripe, so it's also `logBackgroundFailure({ name: 'webhook.payments.scope', errorCode: 'TEST_ROW_OUT_OF_SCOPE', context: { eventId, tradeId?, cashSaleId? } })`, unexpected on purpose. In the sandbox, `IDENTITY_DECISION` and Connect/merchant events are always `NO_OP`, because they would rewrite the testers' real provider state (§5). `authenticate()` is unchanged; production already refuses mock-signed deliveries |
| Ship24 webhook | `app/api/webhooks/ship24/route.ts` | Contract lookups by tracking number add `.eq('is_test', isTest)`. The sandbox launcher blanks `SHIP24_*`, so local never registers trackers whose callbacks would reach production |
| Email | `lib/email/sendEmail.ts` | Early return (console line in development) when `isSandboxMode()`. The launcher also blanks `AWS_*` and `AWS_SES_*`. Production never emails about test rows, because every production path to them is refused or scoped |
| Error capture | `lib/errors/errorLog.ts` `writeErrorLog` | Return early when `isSandboxMode()`, including member REPORT rows. The launcher also sets `ERROR_LOGGING=off` |
| UX events | `recordUxEvent` (0121) | No-op when `isSandboxMode()`, so sandbox browsing doesn't pollute production analytics |

Each of these reads the scope through `currentScope()` / `isSandboxMode()`. No module branches on `SANDBOX_MODE` directly.

**Admin console tabs in the sandbox.** The reports, feedback and errors tabs (`admin/(console)/page.tsx` L169–222, L344–353) read production tables that have no `is_test` column, so in the sandbox they show **real production data, read-only**. Every action that would change those rows, or moderate real content, is refused by the gate (§5.2, `SANDBOX_REAL_SIDE_EFFECT_ACTIONS`, kind `MODERATION`). No filter is added: the data is not test data, and hiding it would only make the sandbox console look emptier than production.

### 4.5 Other contract-table readers: recorded decisions

A `.from('cash_sales' | 'trades' | 'offers' | 'conversations' | …)` scan of `lib/`, `app/` and `domain/orchestrator/` found these readers outside the tables above. Each carries a policy decision, recorded here so that the static coverage test's first run confirms decisions rather than making them. Exempt rows carry `// test-scope: exempt — <reason>` with the reason below.

| Reader | What it does | Decision |
|---|---|---|
| `identity.getCounterpartyIdentity` (`lib/actions/identity.ts` L130–138, admin client, existence check over `trades` / `cash_sales`) | Releases a provider-verified **legal name** when any contract exists between the two members | **Filter.** `.eq('is_test', currentScope() === 'test')` on both reads, so a disclosure always rests on an in-scope contract. A test contract never discloses in production, and a real one never discloses in the sandbox |
| `disputeEvidence.*` (`lib/actions/disputeEvidence.ts` L92, L105) | Uploads and reads evidence on a dispute by contract ref | **Refuse.** Add `is_test` to the select; `!rowInScope(row)` → `not-authorized` before any Storage call |
| `demo.fireTradeWebhook`, `demo.fireCashSaleWebhook` (`lib/actions/demo.ts` L107, L261) | Fires a mock provider event at a contract | **Refuse.** Add `is_test` to the select; `!rowInScope(row)` → `not-participant`. The webhook pipeline's scope check (§4.4) remains the backstop |
| `lib/api/contractStepPlan.ts` (L179, L275) | Mobile step plan for a sale or trade | In the sandbox, unreachable: the mobile API returns 404 (§5.2, "Route handlers"). In production, **refuse**: add `is_test` to the select; `!rowInScope(row)` → the existing not-found response, matching R17 |
| `supabaseAccountClosureRepository` Money_In_Flight counts (L273–350) | Blocks account closure while money is in flight | **Exempt, on purpose.** A tester's in-flight test contracts still block closing his real account from production. That is the conservative direction: closing is irreversible, and a mock contract left open is a reason to look before closing. Exemption reason: "closure check counts every contract; conservative" |
| `lib/regionBinding.ts` (L54, L104) | Resolves the currency → Stripe binding for a contract by id | **Exempt.** It runs after a scoped load of the same row and reads only `currency` / region. Reason: "lookup by id after a scoped load" |
| `lib/actions/notifications.ts` (L53–56) | Checks that a notification's contract link still exists | **Exempt.** A participant-only id read with no side effect; a tester's own notification pointing at his own test contract is harmless. Reason: "participant-only id read" |
| `lib/actions/messageAttachments.ts` (L65) | Signs an upload into a conversation | **Refuse in the sandbox**, the same rule as `sendMessage` (§3): the conversation must have `is_test = true`, else `SANDBOX_SCOPE` before signing |
| `app/(workspace)/profile/(hub)/page.tsx` L178, `app/(workspace)/listings/mine/page.tsx` L47 | Pending-offer counts | **Filter.** `.eq('is_test', currentScope() === 'test')` on the `offers` read, consistent with R16 |

If the first run of `testRowScopeCoverage.test.ts` flags a reader not in this section or §2–§4.4, the implementer applies the closest matching rule above (filter a list, refuse a by-id action, exempt a read that follows a scoped load) and adds a row here. A reader that fits none of them is reported to the user rather than decided.

---

## 5. Local sandbox mode

### 5.1 Launcher: `npm run sandbox:dev` → `node scripts/sandbox/dev.mjs [--port 3000]`

`scripts/sandbox/sandboxEnv.mjs` is a pure ESM module so Vitest can import it. It exports `buildSandboxEnv(parentEnv, { port, jobsSecret, webhookSecret })` and `assertSandboxEnv(childEnv)`. `dev.mjs`:

1. Loads env exactly as Next will, using `loadEnvConfig(process.cwd(), true)` from `@next/env`, which ships with Next and so isn't a new dependency. This gives the full set of keys `.env.local` defines.
2. **Blanks keys by setting them to the empty string, not by deleting them.** I verified in `node_modules/@next/env/dist/index.js` that Next only fills keys whose `process.env` value is `undefined`. A deleted `STRIPE_SECRET_KEY` would come straight back from `.env.local`. The blanked set:
   - every key matching `^(STRIPE_|NEXT_PUBLIC_STRIPE_)`, which also covers `STRIPE_LIVE_KEY` and `STRIPE_PROD_KEY`;
   - `JOBS_SECRET`, `CRON_SECRET`;
   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_SES_*`;
   - `SHIP24_*`;
   - `VERCEL*`.
3. Forces these values:
   - `SANDBOX_MODE=1`, `NEXT_PUBLIC_SANDBOX_MODE=1`
   - `PAYMENTS_PROVIDER=mock`, `ENABLE_PAYMENT_DEMO=true`
   - `WEBHOOK_URL=http://localhost:<port>/api/webhooks/stripe`
   - `WEBHOOK_SECRET=<random 32 bytes hex, per launch>`
   - `JOBS_SECRET=<random 32 bytes hex, per launch>`, written to `.next-sandbox/sandbox-jobs.json`
   - `ERROR_LOGGING=off`
   - `NEXT_BUILD_DIR=.next-sandbox`
   - `DEFAULT_REGION=AU`
   - `NEXT_PUBLIC_SITE_URL=http://localhost:<port>`. `signInWithGoogle`'s `resolveOrigin`, `/auth/callback`, `/auth/confirm` and `/identity/return` all prefer this variable, so without forcing it a non-default port would send the OAuth callback to whatever `.env.local` says
4. `assertSandboxEnv` refuses to start, with exit code 1 and a reason, unless all of these hold:
   - `resolveSandboxMode`-equivalent conditions are true;
   - no non-empty value starts with `sk_`, `rk_`, `pk_` or `whsec_`;
   - the `JOBS_SECRET` value differs from the parent's `JOBS_SECRET` and `CRON_SECRET`;
   - `NEXT_PUBLIC_SUPABASE_URL`'s host is `kyyaqnsmqthqmnhaqhzq.supabase.co`, the project whose tester ids the migration hardcodes;
   - `SUPABASE_SERVICE_ROLE_KEY` is present;
   - the port is in `SANDBOX_PORTS = [3000, 3001]`, and `NEXT_PUBLIC_SITE_URL` equals `http://localhost:<port>` exactly.
5. **Redirect allowlist check (read-only, optional).** If `SUPABASE_ACCESS_TOKEN` (a personal access token) is set in the parent env, `dev.mjs` calls `GET https://api.supabase.com/v1/projects/kyyaqnsmqthqmnhaqhzq/config/auth` and refuses to start unless `uri_allow_list` contains an entry matching `http://localhost:<port>/**` (or `http://localhost:<port>/auth/callback`). Without the token it prints a one-line reminder of precondition P3 instead and continues. It never prints the token or the response body.
6. Spawns `npx next dev -p <port>` with `{ stdio: 'inherit', shell: true, env: childEnv }` (the `run-prod.mjs` pattern) and forwards SIGINT. It prints a banner: "SANDBOX · mock payments · production database · testers only". It never echoes a value.

The Google Maps browser key is passed through unchanged, so real place picking works.

**Precondition P3 (user, one-time, Supabase Dashboard):** Auth → URL Configuration → Redirect URLs must include `http://localhost:3000/**` and `http://localhost:3001/**`. If a `redirectTo` isn't on that list, GoTrue silently falls back to the Site URL (`https://noditto.app`), and the new session lands on production where the local switcher never sees it. Google's own console needs no change: Google redirects to Supabase's `/auth/v1/callback`, not to localhost. This precondition is the first thing to confirm, because "I can't access them locally" may be exactly this.

**Agent prohibitions.** Every one of these writes to the production database, so no agent step runs any of them; the user runs them by hand: applying 0134 or any write SQL, `npm run sandbox:dev` (it serves a server that writes test rows), `npm run sandbox:jobs` (it calls the `*_for(true)` write RPCs), `npm run sandbox:reset`, `scripts/sandbox/expire.mjs`, `scripts/sandbox/captureAuth.mjs` and any `playwright.sandbox.config.ts` scenario. Agents may only write the files and run the pure unit/component tests when the user asks.

### 5.2 The sandbox gate (the only universal chokepoint)

`withActionLog` is the wrapper every Server Action must be exported through; `tests/unit/actionLogCoverage.test.ts` enforces that. It gains a check at the **outermost** call only, right where `insideAction` is entered: `if (isSandboxMode()) { … }`. That one branch is unreachable in production, because `resolveSandboxMode` is false there.

The check works like this:
- `lib/sandbox/sandboxGate.ts` exports `sandboxGate(name)`. It reads the actor through `getCachedAuthUser()` and `getCachedProfile()`, which are already request-cached. From the profile it takes `is_tester`, `is_admin` and `is_support`.
- **Session state, fail-closed.** `getCachedAuthUser()` swallows GoTrue errors and returns null, so null alone cannot mean "signed out". And both `getCachedAuthUser()` (`lib/supabase/cachedAuth.ts`) and `createClient()` (`lib/supabase/server.ts`) accept an `Authorization: Bearer` header as well as cookies, so cookies alone cannot mean "no credential". `lib/sandbox/sandboxGate.ts` exports `readSandboxActor()`, which gathers:
  - `hasSessionCookie`: `hasSupabaseSessionCookie((await cookies()).getAll())` (`lib/supabase/sessionCookie.ts`, as `app/layout.tsx` already does);
  - `hasBearer`: `(await headers()).get('authorization')` is `Bearer <token>` (case-insensitive scheme) and the token has the JWT shape (three non-empty base64url segments separated by dots). Only a JWT can authenticate a Supabase user, so a non-JWT bearer, such as the hex jobs secret, is not a member credential and does not count;
  - `userResolved`: `getCachedAuthUser()` is non-null;
  - `isTester`, `isStaff` from `getCachedProfile()`.

  It passes the first three to the pure `deriveSandboxSessionState` (§3):
  - neither a session cookie nor a Bearer header → `sessionState: 'NONE'`;
  - either present and a user resolved → `'VALID'`;
  - either present but the user is null (expired, revoked, a forged token or a transient auth failure) → `'UNRESOLVED'`, which is refused like a non-tester.
  - `cookies()` / `headers()` themselves throw (no request scope, e.g. a wrapped function called from a script) → `'NONE'`, matching `getCachedAuthUser`'s existing `try`. Job routes run inside a request and carry only the jobs bearer, which is not a JWT, and no cookie, so they are `'NONE'`; their own bearer check is what admits them.
- It then evaluates `sandboxActionDecision`, first match wins:

| # | Condition | Decision |
|---|---|---|
| 1 | Module is `auth` (`signIn`, `signInWithGoogle`, `signUp`, `signOut`, `signOutEverywhere`, `requestPasswordReset`, `resendConfirmation`, `updatePassword`) | `ALLOW`, for every actor, so anyone can leave or enter the sandbox from the app UI |
| 2 | `name ∈ SANDBOX_FROZEN_ACTIONS` | Return `{ ok: false, error: 'SANDBOX_PROVIDER_STATE_FROZEN', message: 'The sandbox does not change real identity, payout or provider state.' }`. The frozen actions all return `ActionResult`, except `merchant.pushVerifiedIdentityToConnect`, which returns `void`, and the gate returns `undefined` for it. A test pins the list to actions whose return type is known |
| 3 | `name ∈ SANDBOX_REAL_SIDE_EFFECT_ACTIONS` | Return `{ ok: false, error: 'SANDBOX_REAL_SIDE_EFFECT', message }`, where `message` is "The sandbox does not file reports or feedback. Use noditto.app for that." for kind `REPORTING` and "The sandbox does not moderate real content. Use noditto.app for that." for kind `MODERATION`. All of these actions return `ActionResult` / `AdminActionResult`, which share the `{ ok: false, error, message }` shape. `AdminActionError` (`admin.ts` L65) is a closed union, so it gains `'SANDBOX_REAL_SIDE_EFFECT'`; the gate's return is otherwise produced generically, the same way as row 2 |
| 4 | `sessionState === 'NONE'` | `ALLOW`. Public reads stay public, and mutating actions refuse unauthenticated callers themselves |
| 5 | `sessionState === 'VALID'` and `isTester` | `ALLOW` |
| 6 | `sessionState === 'VALID'` and `isStaff` (`is_admin` or `is_support`) | `ALLOW`, in every module. A staff actor has to render the whole app (notification bell, inbox, profile reads) to reach `/admin`, so a module allowlist would break the page around the console. What confines staff is the other layers: creation admission refuses them as non-testers (`SANDBOX_SCOPE`), the scoped repositories and chokepoints hide real rows, rows 2–3 apply (row 3 includes every admin moderation action, so staff cannot hide, unhide, clear avatars or close reports, feedback or error groups on real content), and the sandbox conversation rule refuses non-tester participants |
| 7 | Otherwise (`UNRESOLVED`, or a valid non-tester non-staff member) | **Throw** `SandboxRefusal` (`SANDBOX_TESTERS_ONLY`). It throws rather than returning, because the action may be a read-style function with any return shape. This is a **backstop**: in the browser, the root layout refuses the same actor before rendering anything that calls an action (below), so row 7 fires only for a client-invoked action from a page that was already open when the session changed, or a direct POST. Such a throw lands in `app/error.tsx` or the client's action promise, never in the root layout. Error logging is off, so nothing is recorded |

`SANDBOX_FROZEN_ACTIONS` lists the actions that would rewrite **real** production-profile state the mock provider cannot honestly produce, or that are irreversible on a real account:

| Module | Frozen actions |
|---|---|
| `identity` | `beginIdentityCheck`, `beginEmbeddedIdentity`, `refreshIdentityCheck` |
| `merchant` | `createPayoutOnboardingLink`, `startIdentityVerification`, `beginEmbeddedPayout`, `pushVerifiedIdentityToConnect`, `refreshPayoutStatus`, `submitMerchantOnboarding` |
| `demo` | `fireIdentityWebhook` |
| `account` | `closeMyAccount`. Closing a tester from the sandbox would close the developer's real production account (0111), and nothing in the two-party flows needs it |

Both testers are already VERIFIED and APPROVED, so nothing in the two-party flows needs these. `identity.getIdentityCheckState` and `merchant.getMerchantState` were checked by the review and are pure reads with no provider call or write, so they are not frozen.

`SANDBOX_REAL_SIDE_EFFECT_ACTIONS` lists actions whose effect lands on real members or production's real queues no matter which rows they name:

| Kind | Actions |
|---|---|
| `REPORTING` | `reports.reportItem`, `reports.reportUser`, `feedback.submitFeedback` |
| `MODERATION` | `admin.hideItem`, `admin.unhideItem`, `admin.clearMemberAvatar`, `admin.setReportStatus`, `admin.setFeedbackStatus`, `admin.resolveErrorGroup` |

None of the moderation actions is needed for the two-party flows. They act by id on real items, profiles, reports, feedback and error groups through the admin client, with no scoped repository or chokepoint in between, so without this a staff actor on a sandbox server would hide real listings and close real reports. The existing name-existence test pins the list; all six names were confirmed as `withActionLog('admin.<name>'` strings in `lib/actions/admin.ts`.

### Refusal before render (root layout)

Row 7 alone would break recovery. `components/layout/SiteHeader.tsx` is mounted in `app/layout.tsx` and calls the wrapped `listMyNotifications()` for every signed-in user, so a throw there escapes the root layout and lands on `app/global-error.tsx`, which replaces the whole document: no switcher, no Sign out, no `/sign-in` link. That is exactly the case §6 predicts (Google auto-picks a different account), and the developer would have to clear cookies in devtools.

So the refusal happens before anything renders:

- `lib/sandbox/sandboxGate.ts` exports `sandboxLayoutState(): Promise<'RENDER' | 'REFUSE'>`. When `!isSandboxMode()` it returns `'RENDER'` immediately with **no I/O**, so production pays nothing. Otherwise it calls `readSandboxActor()` (request-cached, so `SiteHeader` reuses the same reads) and returns the pure `sandboxLayoutDecision(…)` (§3).
- `app/layout.tsx` awaits it. On `'REFUSE'` it renders, inside the same `<html>` / `<body>`:
  - `components/sandbox/SandboxRefusedNotice.tsx`, a plain Server Component with a fixed-height card: "This local sandbox only works for test accounts. Switch to a tester below, or sign out." It has a `<form action={signOut}>` button labelled "Sign out of this account". `auth.signOut` is admitted by row 1, and in sandbox mode it only clears cookies (below), so the session stays valid;
  - `<Suspense fallback={null}><SandboxSlot /></Suspense>`, so the switcher can switch to a stashed tester or "Add another account";
  - `<Toaster />`.

  It renders **none** of `SiteHeader`, `StartDealProvider`, `children`, `PageViewTracker`, `Analytics` or `SpeedInsights`, so nothing in the root layout calls a wrapped action. If Next still evaluates the page segment in parallel and it throws, that throw lands in `app/error.tsx`, inside the root layout, so the switcher survives either way. The implementer confirms this by hand once (sign in as a non-tester under `sandbox:dev`; the notice and switcher must render).
- **Why the layout and not `proxy.ts`.** The proxy matcher (`proxy.ts` `config.matcher`) does not cover `/sellers/[id]`, `/t/[token]`, `/sign-in`, `/help`, `/terms`, `/privacy` or `/safety`, and the matcher must be static, so widening it for the sandbox would add a session read to those routes in production. The root layout renders on every page. Expiring cookies in the proxy would also be unnecessary: the notice's Sign out and the switcher both clear them locally on request.
- The sign-in page needs no change: a refused session never reaches it through a redirect.

### Route handlers

`withActionLog` covers Server Actions only. Every route handler was enumerated (`app/**/route.ts*`):

| Route | Sandbox status |
|---|---|
| `app/api/mobile/**` (every handler goes through `authenticateMobileRequest`, checked: none skips it) | **Disabled in sandbox mode.** The first statement of `authenticateMobileRequest` in `lib/api/mobileSession.ts` becomes `if (isSandboxMode()) return { ok: false, response: Response.json({ ok: false, error: 'SANDBOX_MOBILE_DISABLED' }, { status: 404 }) };`. This closes `mobile/account/close`, which calls `createDefaultAccountClosureOrchestrator().closeAccount` directly and would otherwise close the developer's real account past the frozen `account.closeMyAccount`, and `cash-sale/step-plan` / `trades/step-plan`, which read contracts through `lib/api/contractStepPlan.ts`. The sandbox simply has no mobile API; Flutter is not part of this task |
| `app/api/jobs/*` | Bearer-checked as today; scope `test` under the sandbox (§4.1–4.2) |
| `app/api/webhooks/stripe`, `app/api/webhooks/ship24` | Signature-checked; scoped (§4.4) |
| `app/api/errors` | Writes through `writeErrorLog`, which is a no-op in sandbox mode (§4.4) |
| `app/auth/callback`, `app/auth/confirm`, `app/identity/return`, `app/api/health`, `app/og`, `app/.well-known/assetlinks.json` | Unchanged. The auth routes complete a sign-in; `identity/return` only redirects |

The coverage test asserts that every `app/api/mobile/**/route.ts` calls `authenticateMobileRequest`, so a new mobile handler cannot bypass the sandbox 404.

Three further sandbox-only refusals live in the action body, not the gate, because they depend on the row:

| Action | Sandbox rule | Refusal |
|---|---|---|
| `reviews.leaveReview` | The source row (`cash_sales` or `trades`, by `source_type`/`source_id`) is selected with `is_test`; `!rowInScope(source)` refuses. Applied in both environments, so production can't review a test source either | `SANDBOX_SCOPE` |
| `watchlist.toggleWatch` | The item's `is_test` must match the scope (both environments) | `SANDBOX_SCOPE` |
| `messages.getOrCreateConversation`, `messages.sendMessage` | See §3 | `TESTER_MISMATCH` / `SANDBOX_SCOPE` |

`messages.markConversationRead` is left open: it only writes the caller's own read receipt.

**Sign out in the sandbox.** `auth.signOut` calls `supabase.auth.signOut()`, which defaults to global scope and revokes every session of that user, the stash included. In sandbox mode only, `auth.signOut` instead deletes the `sb-<ref>-auth-token*` cookies (base, chunked `.N`, and `-code-verifier`) through `cookies()` from `next/headers` and makes no GoTrue call. The session it held stays valid, so its stash entry still works. `signOutEverywhere` is unchanged: a deliberate global revoke is what that action means.

**Card setup.** It isn't frozen, because `joys_joys` has no saved card and needs a demo one for trade collateral. But in sandbox mode, `payments.completeCardSetup` refuses with `SANDBOX_PROVIDER_STATE_FROZEN` when the profile's existing `payment_source_id` starts with `pm_`, so piggybear's real card isn't overwritten. The mock card it does write onto `joys_joys`'s production profile persists (see Risks for the cleanup). `MockService.placeHold` treats the payer id as opaque, so the real `cus_` and `pm_` values work under mock unchanged; I checked the signature, not the full body.

**The two directions together.**
- **In the sandbox:** the gate admits only tester and staff actors. Pairing and creation admission make every new row a test row, and refuse any row a staff non-tester would create. The scoped repositories and chokepoints refuse real rows. Reports, feedback, moderation of real content, the mobile API, DMs to real members, real conversations, reviews of real sources and watches of real listings are refused.
- **In production:** creation admission refuses test rows, the scoped repositories hide existing test rows from every action and job, and the webhook check and job scopes skip them.

Real Stripe is never called for a test row, and mock is never used for a real row.

Mobile (`app/api/mobile/**`) is **disabled** in sandbox mode by the `authenticateMobileRequest` 404 ("Route handlers" above), because some handlers call orchestrators directly rather than through wrapped actions. In production it is unchanged and covered by the same row-level scoping as the web (creation admission, scoped repositories, chokepoints, and `contractStepPlan.ts`'s `rowInScope` check, §4.5). No Flutter change and no Dart port is added, which respects the `flutter.md` "no ninth port" rule.

---

## 6. Account switcher (no re-login, no impersonation)

### Build-time module selection

A constant-false branch is not enough: Next builds the client-reference manifest from the module graph before minification removes dead branches, so a static import of a `'use client'` switcher from the root layout would likely ship its chunk, the session store and its zod schema in every production build. The switcher therefore enters the graph only through a build-time alias:

- **`components/sandbox/SandboxSlot.tsx`** is the **default** and the stub: `export default function SandboxSlot() { return null; }`. It imports nothing.
- **`components/sandbox/SandboxSlot.dev.tsx`** is the real slot (an async Server Component, below).
- **`next.config.ts`** becomes a phase function, `export default (phase: string): NextConfig => ({ …existing config, turbopack: { resolveAlias } })`, using `PHASE_DEVELOPMENT_SERVER` from `next/constants`. `resolveAlias` maps `@/components/sandbox/SandboxSlot` → `./components/sandbox/SandboxSlot.dev.tsx` **only when** `phase === PHASE_DEVELOPMENT_SERVER && process.env.SANDBOX_MODE === '1' && process.env.NEXT_PUBLIC_SANDBOX_MODE === '1'`. In every other case there is no alias and the stub resolves. The default is fail-safe: if the alias ever stops matching, the switcher simply doesn't appear locally, which is noticed at once, and production is unaffected.
- **No `webpack` alias.** The review suggested one alongside Turbopack, but Next 16 builds with Turbopack by default and *fails* `next build` when a custom `webpack` config is present (`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`). The stub-by-default design makes a webpack alias unnecessary anyway: a `--webpack` build would simply get the stub.
- **Alias-key check during implementation.** Turbopack's `resolveAlias` docs (`…/next-config-js/turbopack.md`) show package-style keys. If the `@/` key does not take effect under `sandbox:dev` (because tsconfig paths resolve first), use the bare specifier `sandbox-slot` instead: the layout imports `'sandbox-slot'`, `tsconfig.json` and `vitest.config.mts` gain `"sandbox-slot": ["./components/sandbox/SandboxSlot.tsx"]`, and `resolveAlias` maps `sandbox-slot` to the dev file. Same fail-safe default.
- **`app/layout.tsx`** imports `SandboxSlot` and mounts `<Suspense fallback={null}><SandboxSlot /></Suspense>` after `<Toaster />`. No other module imports `SandboxSlot.dev.tsx`, `SandboxAccountSwitcher` or `sandboxSessionStore`; the coverage test asserts that.
- **`scripts/sandbox/assertNotInBuild.mjs`** is the proof. The user runs it after any `npm run build`. It walks `<distDir>/static/**` and `<distDir>/server/**` (distDir from `NEXT_BUILD_DIR` or `.next`), greps for `noditto.sandbox.sessions` and `SandboxAccountSwitcher`, prints the offending file paths, and exits 1 on any hit. `package.json` gains `"sandbox:check-build": "node scripts/sandbox/assertNotInBuild.mjs"`.

### Files

- **`components/sandbox/SandboxSlot.dev.tsx`.** An async Server Component. It returns `null` unless `isSandboxMode()` (a second, runtime check). Otherwise it reads `getCachedAuthUser()` and `getCachedProfile()` and renders `<SandboxAccountSwitcher current={{ userId, displayName, isTester, isStaff } | null} />`.
- **`components/sandbox/SandboxAccountSwitcher.tsx`** (`'use client'`). The exported `SandboxAccountSwitcher` is a hook-free guard: `return process.env.NODE_ENV === 'production' ? null : <SandboxAccountSwitcherInner {...props} />;`, a third check. Every hook lives in the unexported `SandboxAccountSwitcherInner` in the same file, so no hook follows a conditional return and `react-hooks/rules-of-hooks` stays clean.
- **`components/sandbox/sandboxSessionStore.ts`.** Client-safe helpers with no React:
  - `readStash()`, `saveEntry(session, label)`, `removeEntry(userId)`;
  - a zod schema validating entries, so malformed storage is dropped;
  - the storage key `noditto.sandbox.sessions.v1:<supabase-ref>`, where the ref is parsed from `NEXT_PUBLIC_SUPABASE_URL`;
  - `noditto.sandbox.active` for cross-tab sync.

  - `clearLocalAuthCookies()`: expires every cookie whose name starts with `sb-<ref>-auth-token` (the base name, the chunked `.0`, `.1`, … parts, and `sb-<ref>-auth-token-code-verifier`) with `document.cookie = name + '=; Max-Age=0; path=/'`. It makes **no network call**. The names are read from `document.cookie`, so the chunk count isn't guessed.

  An entry has the shape `{ userId, label, role: 'tester' | 'staff', accessToken, refreshToken, expiresAt, savedAt }`.

### How it works

Supabase sessions live in `document.cookie`. I verified that `createBrowserClient` defaults to a document.cookie adapter, that it's a singleton in the browser, and that the server's Set-Cookie isn't httpOnly by default. So the browser client always reads the latest cookie.

1. **Capture.** On mount, if `current?.isTester || current?.isStaff`, read `supabase.auth.getSession()`, which comes from the cookie and so includes any rotation the proxy or server performed. Save it if `session.user.id === current.userId`, with `role` set from the flags (tester wins if both). Then subscribe to `onAuthStateChange`: on `INITIAL_SESSION`, `SIGNED_IN` or `TOKEN_REFRESHED`, save the session if its user id is `current.userId` or already a stash key. This keeps the stash on the newest refresh token through rotation. Staff are stashed so testing arbitration doesn't need a fresh sign-in each time (precondition P2); they are still not testers, and §5.2 row 6 governs what they can do. If `current` is neither, nothing is ever stored, and the panel shows "Signed in as a non-tester. The sandbox will refuse actions." This panel is reachable because the root layout renders the switcher on its refusal screen (§5.2, "Refusal before render"); from there "Switch" restores a stashed tester and "Add another account" clears the non-tester cookies locally.
2. **Switch A → B.**
   - (a) Call `getSession()` again and save A, to capture a rotation that happened since mount.
   - (b) Call `supabase.auth.setSession({ access_token: B.accessToken, refresh_token: B.refreshToken })`. If B's access token has expired, auth-js refreshes it with the refresh token.
   - (c) On error: remove B's entry, restore A by calling `setSession` with A's entry, and show a toast: "B's saved session has expired. Sign in to it once more."
   - (d) On success: save `data.session` for B immediately, write `noditto.sandbox.active = B.userId`, then call `window.location.reload()`.

   **This deviates from the brief's `router.refresh()`.** Layout-level client state survives a refresh and would show A's data under B's cookie: the inbox provider and its single Realtime channel (`components/messages/InboxProvider.tsx`), the notification bell, and Realtime channels authorised with A's JWT. A full reload is still not a re-login.
3. **Add another account.** Save the current session, call `supabase.auth.stopAutoRefresh()` (local timer only, so the in-memory client can't write the cookie back before the navigation), call `clearLocalAuthCookies()`, then `window.location.assign('/sign-in')`. The full navigation discards the singleton client and its in-memory session. The developer signs in with Google as the other account once, and the switcher captures it on the next mount.

   **No GoTrue sign-out, in any path.** In auth-js 2.110.8, `_signOut` calls `POST /logout?scope=<scope>` whenever a session exists, before clearing storage. `scope: 'local'` revokes *the current session* on the server, which is exactly the session the stash just saved, so the next switch back would fail and force a fresh Google sign-in. The switcher never calls `supabase.auth.signOut`, and the app's own Sign out avoids it in the sandbox (§5.2).
4. **Forget.** Removes an entry locally; no network call.
5. **Other tabs.** A `storage` event on `noditto.sandbox.active` triggers `location.reload()` in other tabs, because the cookie is shared per origin.

### UI

A fixed bottom-left pill reads "SANDBOX · <active label>". It opens the existing `components/ui/popover` with:
- a list of stashed accounts, with the active one marked `aria-current="true"` and an "active" text label, and staff entries labelled "staff";
- a "Switch" button per inactive entry;
- "Add another account" and "Forget" controls.

Every control is a real `<button>` with an accessible name, keyboard-reachable through the Radix primitive, and icons come from Hugeicons. The pill's height is fixed, so it doesn't shift layout.

### Security reasoning

- **No impersonation path.** There is no server endpoint, route or `'use server'` export. The switcher only replays tokens this browser already held as cookies after the developer signed in himself.
- **Narrow storage.** Tokens sit in localStorage on `localhost` in a development build, for tester and staff accounts only. That's equivalent in exposure to the non-httpOnly auth cookie the browser already holds.
- **Production-absent.** Production builds don't contain it: the stub is the default module, the alias exists only in the dev-server phase with both flags set, and `sandbox:check-build` proves the output is clean. The server-side `isSandboxMode()` and the client `NODE_ENV` check are further runtime guards.

### Pitfalls the UI states

- In the sandbox, the app's **Sign out** clears cookies locally (§5.2), so it no longer revokes the stash. **Sign out everywhere** (account security settings) still revokes every session of that user globally, stash included; the popover says "Sign out everywhere will invalidate saved sessions."
- Google may auto-pick the last-used Google account; use the account chooser. If the wrong account signs in, the app shows the sandbox refusal screen with the switcher on it, not an error page. If that Google account has never used NoDitto, the sign-in still provisions a real (non-tester) production profile through `/auth/callback`, exactly as it would on noditto.app.
- If a Google sign-in lands on noditto.app instead of localhost, precondition P3 (the redirect allowlist) isn't met.

---

## 7. OPTIONAL: scenario seeding and reset (not blocking)

- **Storage states.** The testers are Google-only, so the password helpers in `tests/e2e/support/auth.ts` don't apply. `scripts/sandbox/captureAuth.mjs` opens a **headed, persistent** Chrome (`channel: 'chrome'`, which Google blocks less) at `/sign-in`. The developer signs in by hand, and the script writes `playwright/.auth/sandbox/<handle>.json`. Each capture is its own refresh-token family, so it doesn't collide with the switcher's stash. `ensureFreshSession` logic is reused to keep the files fresh.
- **`playwright.sandbox.config.ts`.**
  - `testDir: tests/sandbox`, `workers: 1`, desktop Chrome only.
  - No `webServer` (the developer runs `sandbox:dev`); `reuseExistingServer`.
  - `globalSetup` asserts the sandbox jobs file exists, which proves a sandbox server is up.
- **`tests/sandbox/scenarios/*.spec.ts`.** These reuse the step sequences in `tests/e2e/specs/{cash-sale,offers,trade,private-deal,journeys}.spec.ts` and the helpers in `tests/e2e/support/**`, driving the real UI between the two tester storage states. Listings are titled with a `[SANDBOX]` marker; `tests/e2e/support/marker.ts` gains `sandboxMarked()`, and `createListing` gains an optional `kind: 'SINGLE' | 'SHOPFRONT'`. Each scenario prints the room URL and which tester to open it as.
- **`npm run sandbox:reset` → `scripts/sandbox/reset.ts`.**
  - It deletes **only** `is_test = true` rows, reusing the FK order from `scripts/e2e/cleanup-test-data.ts`. That graph is refactored into `scripts/lib/cleanupGraph.ts` with two selectors: the existing `[E2E]` marker, unchanged, and the new `is_test`.
  - It never touches `profiles`, `auth.users` or the seed accounts frank and grace.
  - `--dry-run` is the default; `--yes` is required to delete.
  - It refuses unless the target host is the known ref. That makes it a destructive operation on production tables, scoped by a flag no real row carries, so the user runs it, not an agent.
- **`scripts/sandbox/expire.mjs --table cash_sales|trades --id <uuid> --field <allowlisted>`.** This is the single accepted raw write. Allowlisted fields:
  - `cash_sales`: `inspection_deadline_at`, `return_deadline_at`, `ship_by_at`
  - `trades`: `inspection_deadline_at` and the shipping-deadline column, whose name is read from the live schema at implementation

  It sets the field to `now() - 1 minute` through a service-role PATCH filtered `?id=eq.<id>&is_test=eq.true`, and exits non-zero if 0 rows matched. No other raw state fabrication is permitted.

---

## Error handling summary

| Operation | Failure | Recoverable? | Caller receives | Logged |
|---|---|---|---|---|
| Contract or offer or invite or conversation creation, tester ↔ non-tester | Pure check | Yes (pick another counterparty) | `{ ok: false, error: 'TESTER_MISMATCH', message }` | ACTION, expected (prod only; sandbox logging off) |
| Same, slipping past the app | DB trigger raise | Yes | The repository maps it to `TESTER_MISMATCH` | Same |
| Test row created or acted on in production / real row in sandbox | Creation admission or scoped repo | Yes, by switching environment | `SANDBOX_SCOPE` with the direction message, or the orchestrator's `NOT_FOUND` | ACTION, expected |
| Non-tester (cookie or Bearer) loads a page in the sandbox | Root layout `sandboxLayoutState` | Yes (switch or sign out from the refusal screen) | Refusal notice + switcher; no header, no page content | Not logged (`ERROR_LOGGING=off`) |
| Non-tester invokes an action anyway (backstop) | Gate row 7 | Yes | Thrown `SandboxRefusal` → `app/error.tsx` or the client's rejected promise, never the root layout | Not logged |
| Frozen provider action in the sandbox | Gate | n/a | `SANDBOX_PROVIDER_STATE_FROZEN` | Not logged |
| Report, feedback or moderation action in the sandbox | Gate | Yes (use noditto.app) | `SANDBOX_REAL_SIDE_EFFECT` with the kind's message | Not logged |
| Session cookie or JWT Bearer present but user unresolved, in the sandbox | Layout, then gate | Yes (sign in again or switch) | Refusal screen; thrown `SandboxRefusal` as backstop | Not logged |
| Any mobile API call in the sandbox | `authenticateMobileRequest` | n/a (use the web UI) | `404 { ok: false, error: 'SANDBOX_MOBILE_DISABLED' }` | Not logged |
| Orchestrator entry point reaches a guarded repository method with an out-of-scope id | Scoped decorator throws `OutOfScopeError`; `refuseOutOfScope` converts it | n/a | The function's existing not-found result (`trade-not-found`, `NOT_FOUND`, …); no write completes, no provider call | As that not-found is logged today. An `OutOfScopeError` that escapes an orchestrator is a missing wrapper: it reaches the action as a throw and is logged unexpected (prod) |
| 0134 applied against a production body that differs from the migration file | Drift guard | Yes (rebuild the body from the live `prosrc`) | `LIVE_BODY_DRIFT: <name>`, transaction rolled back | Reported to the user by whoever applied it |
| Message, review or watch that crosses the scope | Action body | Yes | `TESTER_MISMATCH` / `SANDBOX_SCOPE` | ACTION, expected (prod only) |
| Money primitive (`settleTradeCash`, `voidTradeHolds`, `placeTradeCollateral`, …) called on an out-of-scope trade | Chokepoint | n/a | That function's existing failure shape with `detail: 'SANDBOX_SCOPE'`; no provider call | As its caller logs that failure today |
| Fraud resolution against a tester | `fraudBan.ts` early return | n/a | `{ ok: true, alreadyBanned: false }`; the trade still reaches `FRAUD_RESOLVED` | Console line in the sandbox only |
| Fraud ban reaching the DB for a tester anyway | `refuse_tester_fraud_ban` / `refuse_tester_identity_ban` | Fatal for that write | The Supabase `{ error }`, which `fraudBan.ts` already returns as `{ ok: false, message }` | `TESTER_FRAUD_BAN_REFUSED`, unexpected (a code-path bug) |
| Redirect allowlist missing localhost (token configured) | Launcher | Fix in Dashboard | Exit 1 + reason | Console |
| Production webhook resolves to a test row | Scope check | n/a | `200 NO_OP` | `webhook_logs` NO_OP + `logBackgroundFailure` `TEST_ROW_OUT_OF_SCOPE` (unexpected) |
| Launcher env unsafe | `assertSandboxEnv` | Fix the env | Exit 1 + reason | Console |
| Switcher restore fails | `setSession` error | Yes (sign in once) | Entry pruned, previous session restored, toast | Console only |
| `sandbox:jobs` without a running sandbox | Precheck | Yes | Exit 1 | Console |

---

## Testing (the user runs the suites; the agent does not run build, lint or tests unless asked)

**Unit and property tests (`domain` project):**
- `tests/unit/testerIsolation.test.ts` + `tests/property/testerIsolation.test.ts` (fast-check):
  - compatibility is symmetric and order-independent;
  - any mix of true and false is refused;
  - `isTest` is true iff all participants are testers;
  - for every `(sandboxMode, isTest)` pair, `checkSandboxAdmission` admits exactly when they're equal;
  - so no row is admissible in both environments.
- `tests/unit/sandboxMode.test.ts`: each failing condition of `resolveSandboxMode` gives false (`NODE_ENV=production`, `VERCEL` set, Stripe provider, flag absent).
- `tests/unit/sandboxActionPolicy.test.ts`:
  - the full §5.2 decision table, one case per row, including: `auth.*` admitted for a non-tester and for `UNRESOLVED`; `UNRESOLVED` refused for a non-auth action; staff admitted outside `admin`/`arbitration`; a frozen name refused even for a tester; `reports.*` and `feedback.submitFeedback` refused for a tester with the `REPORTING` message; each of the six `admin.*` moderation names refused for a staff actor with the `MODERATION` message;
  - `deriveSandboxSessionState`: a JWT-shaped Bearer with no cookie and no resolved user is `UNRESOLVED` (refused), with a resolved non-tester user is `VALID` and refused by row 7; a non-JWT Bearer (the hex jobs secret) with no cookie is `NONE`; neither is `NONE`;
  - `sandboxLayoutDecision`: `RENDER` outside sandbox mode for every actor; in sandbox mode `RENDER` for `NONE`, a tester and staff, `REFUSE` for `UNRESOLVED` and a valid non-tester; and, as a property, it agrees with `sandboxActionDecision` rows 4–7 on every actor for a non-auth, non-listed action name;
  - every name in `SANDBOX_FROZEN_ACTIONS` and `SANDBOX_REAL_SIDE_EFFECT_ACTIONS` exists as a `withActionLog('<name>'` string in `lib/actions/**`, read from source the way `actionLogCoverage.test.ts` does.
- `tests/unit/sandboxRowRules.test.ts`, the decision table for the in-body sandbox refusals, with fake Supabase clients: `getOrCreateConversation` (tester↔non-tester refused in the sandbox with and without `itemId`; allowed item-less in production), `sendMessage` (real conversation refused in the sandbox), `leaveReview` (out-of-scope source refused in both environments), `toggleWatch` (real item refused in the sandbox, test item refused in production), `saveCashSaleReturnAddress` (out-of-scope sale refused before the upsert).
- `tests/unit/sandboxEnv.test.ts`, importing `scripts/sandbox/sandboxEnv.mjs`:
  - blanked keys are `''`, not deleted;
  - `sk_`, `pk_` and `whsec_` survivors are refused;
  - a reused production `JOBS_SECRET` is refused;
  - the wrong host is refused;
  - `NEXT_PUBLIC_SITE_URL` is forced to `http://localhost:<port>`, and a port outside `SANDBOX_PORTS` is refused.
- `tests/unit/scopedRepositoryMoney.test.ts`. For every exported operation of `cashSaleOrchestrator`, `tradeOrchestrator`, `disputeResolution` and `tradeProposal` (enumerated from the module's exports at test time, so a new export is covered automatically), run it through the scoped decorator over an in-memory repository holding only an out-of-scope row, plus a spy `PaymentService` (`domain/services/testing/InMemoryService`). The **inner** repository (beneath the decorator) is wrapped in a recording `Proxy` that logs every method that was actually delegated to it. Assert:
  - **zero** `PaymentService` calls;
  - **zero** delegated calls to any method classified `guarded`, `create` or `child-ref` (§3). A guarded call that the decorator refused by throwing never reaches the inner Proxy, so it counts as refused; `loader`, `list` and `profile` calls are allowed;
  - the operation **returns** (no `OutOfScopeError` escapes it), and returns a failure (`ok: false`) or, for list sweeps, an empty result. An escaping `OutOfScopeError` names the export that needs a `refuseOutOfScope` wrapper.

  This explicitly covers `placeBondsForAgreedTrade` (returns `trade-not-found`, no `placeHold`, no `recordHold`) and `markDisputeReturnOverdue` (returns `trade-not-found`, no `recordReturnOverdue`). The Proxy means the existing fakes need no changes beyond the new `isTest` list param. A second block asserts `listDuePayouts`/`listDueRefunds` receive the decorator's `isTest` even when the caller passes the opposite. A third asserts the scope memo: after a `loader` call, a following `guarded` call makes no scope lookup.
- `tests/unit/libMoneyScope.test.ts`, mocking `@/lib/supabase/admin`, the cookie client and `getPaymentService` with spies: with an out-of-scope trade row, `retrySettleTradeCash`, `retryTradeCollateral`, `syncTradeTracking`, `settleTradeCash`, `voidTradeHolds`, `placeTradeCollateral`, `syncHolds`, `chargeTradeFees` and `refundTradeFees` make no provider call, no Ship24 call and no write, and return their documented `not-participant` / `SANDBOX_SCOPE` / zero-outcome shapes. A second block: with `isSandboxMode()` true, `authenticateMobileRequest` returns 404 `SANDBOX_MOBILE_DISABLED` before reading cookies or the Bearer header.
- `tests/unit/fraudBanTester.test.ts`, with a fake admin client and a spy `auth.admin.updateUserById`: for a tester offender, `permanentlyBanConfirmedFraudOffender` and `enforceProfileFraudBan` return `{ ok: true, alreadyBanned: false }` and issue no `profiles` update, no `items` update, no `updateUserById`, no `identity_person_keys` upsert and no `identity_bans` upsert. A non-tester offender still gets all of them (regression guard).
- `tests/unit/testRowScopeCoverage.test.ts`. A strict static parser, in the style of `scripts/lib/mobileContract.ts`, that throws on source it can't read. It scans **all** of `lib/**`, `app/**` and `domain/orchestrator/**` (not an enumerated list), and:
  - every `.from('cash_sales' | 'trades' | 'trade_fees' | 'pre_auth_holds' | 'deal_invites')` chain must mention `is_test` in the same chain, sit inside a function that calls `rowInScope`/`assertRowInScope`, or carry `// test-scope: exempt — <reason>` on the line above (for example an update-by-id after a scoped load, or a participant-only read);
  - every exported function in `lib/trades/completion.ts`, `lib/trades/collateralPlacement.ts` and `lib/actions/tradeFees.ts` calls `rowInScope` or `assertRowInScope` (the list sweep `drainFailedTradeFees` instead carries the `is_test` filter);
  - every `app/api/mobile/**/route.ts` calls `authenticateMobileRequest`, and `authenticateMobileRequest`'s first statement is the `isSandboxMode()` 404;
  - the readers in §4.5 carry their recorded decision: a filter, a `rowInScope` refusal, or the exemption comment with the recorded reason;
  - `requireParticipant` in `lib/actions/trades.ts` and both trade loaders in `lib/actions/tradeNegotiation.ts` call `rowInScope`;
  - `lib/tracking/refreshOnRead.ts` selects `is_test` in both reads;
  - only `app/layout.tsx` imports `SandboxSlot`, and nothing imports `SandboxSlot.dev`, `SandboxAccountSwitcher` or `sandboxSessionStore` except the sandbox folder itself.
  The first run will flag a set of chains; each gets a filter or a reasoned exemption, and that list (not a hand count) is the definition of "every reader".
- `tests/unit/testerMigration.test.ts`, reading `supabase/migrations/0134_*.sql`:
  - no `grant insert` or `grant update` mentions `is_tester` or `is_test`;
  - the column grants appear after the last `create … function`;
  - the two hardcoded ids and their asserted display names (`joys_joys`, `piggybear`) are present;
  - the `discoverable_profiles` definition references no function that the same file revokes from `anon` (it must not mention `profile_is_tester`);
  - `profile_is_tester`'s body has the outer `coalesce((select …), false)` form;
  - `refuse_tester_fraud_ban` and `refuse_tester_identity_ban` are defined;
  - the four drift guards are present: for each of `auto_complete_due_cash_sales`, `warn_expiring_holds`, `expire_lapsed_holds` and `enforce_trade_shipping_deadlines`, a `md5(prosrc)` comparison against a 32-hex-digit literal and a `LIVE_BODY_DRIFT: <name>` raise, all appearing before the first `alter table`;
  - none of the `identityGate.test.ts` anchors appears anywhere in the file, comments included: the literals `as is_verified`, `into new.seller_identity_verified` and `profiles_sync_items_seller_identity_verified`, and the regex `/verified\s*:=/`. Guarding the anchors (not just `select (`) is what makes a stray `select (` elsewhere in 0134 provably harmless to that parser.
- **Existing guards that must stay green:**
  - `tests/property/identityGate.test.ts` (0134 must not contain `select (` before its functions, nor `as is_verified`);
  - `actionLogCoverage.test.ts`;
  - `mobileRpcContract.test.ts` (the new RPCs are service-role only and unused by Dart);
  - `regionCurrencyAgreement.test.ts`.

**Component tests (`component` project):**
- `tests/component/SandboxAccountSwitcher.test.tsx` with the Supabase browser client mocked:
  - it renders null when `NODE_ENV=production` (`vi.stubEnv`), and the exported guard calls no hook (the inner component is not rendered);
  - it never writes storage for a non-tester;
  - switch calls `setSession` with the stashed tokens, then saves the returned session, then reloads;
  - a failed `setSession` prunes the entry and restores the previous session;
  - a `TOKEN_REFRESHED` event updates the stash;
  - a staff `current` is stashed with `role: 'staff'` and labelled "staff";
  - "Add another account" calls `stopAutoRefresh`, expires every `sb-<ref>-auth-token*` cookie present in `document.cookie` (including chunked parts and the code verifier), and navigates to `/sign-in`;
  - **`supabase.auth.signOut` is never called by any switcher path** (asserted on the mock across every test in the file).

**Manual or integration (not automatable here):**
- RLS behaviour: anon, a non-tester and a tester each read a test item.
- The DB triggers, including the two fraud-ban triggers (a rolled-back `update profiles set fraud_banned_at = now() where id = <tester>` must raise).
- The anon/authenticated view read checks in §1 "Applying".
- pg_cron scoping.
- After any `npm run build`: `npm run sandbox:check-build` exits 0.
- Precondition P3: one Google sign-in under `sandbox:dev` lands back on `http://localhost:<port>`.
- Refusal screen: signed in as a non-tester under `sandbox:dev`, every page shows the refusal notice and the switcher (not `global-error`), and "Switch" to a stashed tester works from it.

These are verified after the user applies the migration, with read-only queries and the two accounts in the sandbox.

---

## Checklist: every production reader and writer touched

**Catalog and visibility (§2):**
1. `items_catalog_select` RLS policy (migration 0134)
2. `discoverable_profiles` view (migration 0134) → `suggestSellers`
3. `app/sitemap.ts` admin-client listing query
4. `lib/actions/listings.ts` `searchCatalog`
5. `lib/actions/listings.ts` `listCatalogItems`
5a. `lib/actions/listings.ts` `listAvailableItems` (R3a)
6. `app/(workspace)/listings/[id]/(detail)/page.tsx` own-items-to-offer query
7. `app/(workspace)/sellers/[id]/page.tsx` page + `generateMetadata` tester guard, and both item queries
8. `app/(workspace)/trades/new/page.tsx` own-items query
9. `lib/actions/dealInvites.ts` `/t/[token]` preview (admin client)
10. Unchanged by decision, covered by RLS: `readCatalogFacets`, `loadSuggestions`, `suggest_items_fuzzy`, watchlist reads, Flutter catalog reads (in the sandbox these surface real rows; §2 note)
10a. `account.getMyPurchases` / `getMySales` / `getMyTrades`, `dealInvites.listMyDealInvites`, `lib/actions/statement.ts` (R16)
10b. `app/(workspace)/sales/[id]/page.tsx`, `app/(workspace)/trades/[id]/page.tsx` out-of-scope `notFound()` (R17)

**Pairing and creation (§3):**

11. `cashSaleOrchestrator.openAgreement` (initiate + private deal)
12. `tradeProposal.proposeTrade`
13. `tradeNegotiation.openTradeNegotiation`
14. `trades.proposeTrade`
15. `offers.makeOffer` / `counterOffer`
16. `dealInvites.createDealInvite` / `claimDealInvite`
17. `messages.getOrCreateConversation` (sandbox: tester↔tester always) and `messages.sendMessage` (sandbox: `is_test` conversations only)
18. `listings.createItem` / `createPrivateTradeItem`
19. DB triggers on items, cash_sales, trades, trade_items, offers, deal_invites (insert, claim, `host_item_id`) and conversations
19a. `TESTER_MISMATCH` mapping (`lib/sandbox/dbErrors.ts`) in the four repositories and the lib-layer inserts in `offers.ts`, `messages.ts`, `dealInvites.ts`, `listings.ts`
19b. `reviews.leaveReview` source scope, `watchlist.toggleWatch` item scope

**Machinery (§4):**

20. `/api/jobs/cash-sale-payouts`: `listDuePayouts`, `listDueRefunds` (`supabaseCashSaleRepository.ts`)
21. `/api/jobs/trade-inspections`: `lib/trades/inspectionSweep.ts` (3 selects)
22. `lib/trades/cashSaleInspectionSweep.ts` (every `cash_sales` read; the coverage test defines the set)
23. `lib/trades/bondPlacementSweep.ts` (2 selects)
24. `lib/actions/tradeFees.ts` `drainFailedTradeFees` (filter), `chargeTradeFees` and `refundTradeFees` (`assertRowInScope`; every export, statically enforced)
25. `lib/trades/completion.ts`: `voidTradeHolds`, `settleTradeCash`, `finalizeCompletedTrade` (every export)
26. `lib/trades/collateralPlacement.ts`: `itemIdsFor`, `syncHolds`, `placeTradeCollateral` (every export)
26a. `lib/actions/trades.ts` `requireParticipant` (covers `retrySettleTradeCash`, `updateTradeHandoverTerms`, `syncTradeTracking`, `saveTradeDeliveryAddress` and the other participant actions)
26b. `lib/actions/tradeNegotiation.ts` both trade loaders (~L108, ~L426; covers `retryTradeCollateral`, `acceptTradeTerms`, `proposeTradeTerms`)
26c. `lib/tracking/refreshOnRead.ts` both scheduled checks
26d. `lib/actions/cashSale.ts` `saveCashSaleReturnAddress`
26e. `lib/auth/fraudBan.ts` `permanentlyBanConfirmedFraudOffender`, `enforceProfileFraudBan` (tester never banned) + the two fraud-ban DB triggers
27. pg_cron `auto_complete_due_cash_sales` → `_for`
28. pg_cron `warn_expiring_holds` → `_for`
29. pg_cron `expire_lapsed_holds` → `_for`
30. pg_cron `enforce_trade_shipping_deadlines` → `_for`
30a. The `md5(prosrc)` live-body drift guard for 27–30, first in 0134
31. `admin.getCustodyPosition` (custody reconciliation input)
32. `admin.drainCashSalePayouts`, `retryCashSalePayout`
33. `admin.resolveCashSaleReturnCase`, `resolveCashSaleDispute`, `resolveTradeConditionDispute`, `resolveTradeFraud`, `clearTradeReconciliationFlag`
34. Admin console page: payouts tab, reconciliation tab, 4 counts
35. `arbitration.getArbitrationQueue` (3 reads)
36. `arbitration.getArbitrationCase` / `assignArbitrationCase` / `addArbitrationNote`
37. `payouts.getPayoutsDashboard`
38. `lib/webhook/webhookPipeline.ts` `dispatchEvent` scope check
39. `app/api/webhooks/ship24/route.ts` lookups
40. `lib/email/sendEmail.ts` sandbox no-op
41. `lib/errors/errorLog.ts` sandbox no-op
42. `recordUxEvent` sandbox no-op
43. Scoped repository decorators over `supabaseCashSaleRepository`, `supabaseTradeRepository`, `supabaseDisputeResolutionRepository` and `supabaseTradeProposalRepository` (refuse semantics: typed per-method classification, `OutOfScopeError`, scope memo), plus the `tradeNegotiation` / `tradeLifecycleStore` writers via `assertRowInScope`
43a. `refuseOutOfScope` wrappers: `tradeProposal.placeBondsForAgreedTrade` (+ `'trade-not-found'` in `PlaceAgreedBondsResult`, mapped in `collateralPlacement.ts`), `disputeResolution.markDisputeReturnOverdue` (widened return type), and any export the behavioural test flags
43b. `lib/trades/collateralPlacement.ts` passes a scoped proposal repository to `placeBondsForAgreedTrade`
43c. §4.5 readers: `identity.getCounterpartyIdentity` (filter), `disputeEvidence.*` (refuse), `demo.fireTradeWebhook` / `fireCashSaleWebhook` (refuse), `lib/api/contractStepPlan.ts` (refuse in production), `supabaseAccountClosureRepository` Money_In_Flight (exempt), `lib/regionBinding.ts` (exempt), `lib/actions/notifications.ts` link check (exempt), `lib/actions/messageAttachments.ts` (sandbox refuse), `profile/(hub)/page.tsx` and `listings/mine/page.tsx` offer counts (filter)
43d. Admin console reports, feedback and errors tabs: read-only production data in the sandbox (no change; the actions are refused)

**Infrastructure:**

44. `lib/errors/withActionLog.ts` (sandbox gate, with the cookie-or-JWT-Bearer fail-closed session rule and the `auth` exemption) and `lib/sandbox/sandboxGate.ts` (`readSandboxActor`, `sandboxLayoutState`)
44a. `lib/actions/auth.ts` `signOut` (sandbox: local cookie clear, no GoTrue call)
44b. `SANDBOX_REAL_SIDE_EFFECT_ACTIONS` `MODERATION` kind: `admin.hideItem`, `unhideItem`, `clearMemberAvatar`, `setReportStatus`, `setFeedbackStatus`, `resolveErrorGroup`; `AdminActionError` gains `'SANDBOX_REAL_SIDE_EFFECT'`
44c. `app/layout.tsx` refusal branch + `components/sandbox/SandboxRefusedNotice.tsx`
44d. `lib/api/mobileSession.ts` `authenticateMobileRequest` sandbox 404 (covers every `app/api/mobile/**` handler, including `account/close` and both `step-plan` routes)
45. `lib/supabase/cachedAuth.ts` (`is_tester`)
46. `lib/supabase/cashSaleProjection.ts` (`is_test`)
47. `lib/supabase/database.types.ts`
48. `domain/errors/errorLog.ts` `EXPECTED_CODES` (normalized lowercase-hyphen entries)
49. `app/layout.tsx` (imports the `SandboxSlot` stub) and `next.config.ts` (phase function + dev-only `turbopack.resolveAlias`)
50. `CashSaleView` / `TradeContract` (banner, sandbox wording only)
51. `package.json` scripts: `sandbox:dev`, `sandbox:jobs`, `sandbox:check-build`, and optionally `sandbox:auth`, `sandbox:scenario`, `sandbox:reset`
52. Docs: a short "Local sandbox" section in `tech.md`; `domain/sandbox/` and `components/sandbox/` added to `structure.md`; and corrections to `tech.md`'s stale "Next.js 15" and "migrations through 0124"

---

## Preconditions on the implementation step (user answers)

- **P1 — piggybear's identity (blocks §1).** Confirm "piggybear789" is profile `27cf7959-22ec-438d-9521-0cc8dc53c706` (display name `piggybear`). The migration hardcodes it, and stamped test rows stay test forever, so a wrong id is effectively irreversible. Recommended answer: yes, confirm. The migration's display-name assertion fails the transaction if the id is wrong, but it can't tell whether this is the account the user meant.
- **P2 — staff account for sandbox arbitration (does not block §1).** Testing dispute, return and fraud resolution needs an `is_admin` or `is_support` actor. Recommended answer: a staff account **the user controls** (his own Google or email login), used as a **non-tester staff** actor, which §5.2 row 6 admits and the switcher stashes as "staff". Don't flag it as a tester, and don't give a tester `is_support`, because that makes a party arbitrate their own case. Do **not** use the seed accounts frank and grace as they stand: `plan.md` §5 Q1 flagged them as production admin and support accounts whose passwords (`password123`) are committed in `supabase/seed.sql`. If they are the only staff accounts, rotating their passwords in the Supabase Dashboard is a prerequisite to using either (and is worth doing regardless of this task). The migration doesn't depend on this answer: staff are not testers, so the "exactly 2 testers" assertion holds. Until P2 is answered, arbitration testing waits; the rest of the flows don't need it.
- **P3 — redirect allowlist (blocks local sign-in).** See §5.1.
- **P4 — the two real accounts become test-only on noditto.app (blocks writing 0134).** After 0134, `joys_joys` (kitsunearia@gmail.com) and `piggybear` can still sign in to and browse noditto.app, but they can no longer buy, sell, trade, offer, open an invite or list there with any real member: the pairing triggers and creation admission refuse every mixed or production-side contract. Their three public listings (piggybear's binder and single, joys_joys's SOLD single) leave the real catalog and any real member's watchlist. Because test rows stay test forever and un-flagging does not turn them back, this is effectively irreversible for the rows it stamps. The user asked for test data "only visible locally", not explicitly for these accounts to stop working in production, so it needs a yes.
  - **Recommended answer: yes.** These are the accounts the user named as most important, they already deal only with each other (no mixed rows exist, §0), and the history that matters (the one real COMPLETED sale and its payout) stays real.
  - **If no:** the user creates two fresh accounts (Google or email) that he controls, onboards them through Identity on noditto.app as today, and gives their profile ids and display names. Those replace the two hardcoded ids and the asserted `display_name`s in 0134 (the id and name assertions are already parameterised as four literals at the top of the file), the backfill then stamps nothing pre-existing, and `joys_joys` and `piggybear` stay fully real. The cost: fresh accounts need Identity verification and payout setup before they can sell or trade (both are frozen in the sandbox, §5.2), so this path is slower to start.
  - The implementation step must not write 0134 until P1 and P4 are answered.

## Open questions

1. **Hiding your existing public listings.** Promoted to precondition P4, which blocks writing 0134. The backfill marks all 8 tester-owned items `is_test`; not backfilling would leave public listings that any real buyer is refused on (`TESTER_MISMATCH`), which is worse.
2. **Staff for sandbox arbitration.** Moved to precondition P2, with a recommended answer.
3. **Supabase Auth session policy.** If time-boxed sessions, an inactivity timeout or single-session-per-user is enabled on the project, stashed sessions will expire or be revoked, and the switcher will ask for one more sign-in. I couldn't read these settings.
4. **Is "piggybear789" the `piggybear` profile (`27cf7959…`)?** Moved to precondition P1. No profile or email uses the exact string.
5. **The e2e suite on production.** Separate from this task: the e2e suite already writes mock-paid contracts for the seed personas into this production database, and the production payout drain will consider them (they're real rows). Flagging the seed personas as testers and running e2e under `SANDBOX_MODE` would fix that with this same machinery. It isn't done here, because frank and grace are off-limits.
6. **Live function bodies.** Resolved by design: 0134's drift guard proves the copied bodies equal production, or aborts with `LIVE_BODY_DRIFT` (§1). The `cron.job` list is still a read-only check for the user before applying; any extra job becomes a row in §4.3.

## Risks

- **A missed reader** is the main risk of sharing a production database. The mitigation is layered: RLS is default-deny for test listings, the DB pairing triggers apply to every writer, the scoped repositories and lib chokepoints return not-found for out-of-scope rows, every money primitive checks scope itself, `testRowScopeCoverage.test.ts` scans the whole of `lib/`, `app/` and `domain/orchestrator/` statically, `scopedRepositoryMoney.test.ts` and `libMoneyScope.test.ts` check behaviourally, and the sandbox gate covers every Server Action.
- **Real accounts harmed from the sandbox.** Fraud bans, account closure (web action and mobile route), provider-state rewrites, reports, feedback, staff moderation and messages to real members were the known paths; each is now refused in code, and the fraud ban is also refused in the DB. A new action with a real-world side effect would still need adding to `SANDBOX_REAL_SIDE_EFFECT_ACTIONS`.
- **The hottest RLS policy changes.** The added conjunct is one initplan PK lookup per statement, against measured ~0.15 ms catalog queries. It's negligible, but it's still a production policy change that the user applies.
- **Real profiles touched from mock.** The frozen actions plus the `pm_` card guard block the known writers. Any action not yet identified that reads back from the provider and writes `profiles` would still be a hole until it's added to the list.
- **The migration-to-deploy window** (§1, Applying).
- **A mock card on a real profile.** Sandbox `payments.completeCardSetup` writes a mock `payment_source_id` / `payment_method_label` onto `joys_joys`'s production profile, which has no real card today. It is harmless while he is a tester (production refuses every contract that would charge it), but it outlives an un-flag. Cleanup, part of un-flagging and run by the user: `update cardtrade.profiles set payment_source_id = null, payment_method_label = null, payment_token_type = null where id = '216cdd7d-ef4a-466d-bffe-6a55f64d4dc1' and payment_source_id not like 'pm\_%';` (the `not like` keeps a real card he may have added since). piggybear's real `pm_…` card is never overwritten (§5.2).
- **Staff see real moderation data in the sandbox.** The console's reports, feedback and errors tabs show production rows read-only (§4.4). Every action on them is refused, so this is exposure to the staff member already entitled to see them, not a write path.
- **Next env refill.** If someone edits the launcher to delete keys instead of blanking them, Stripe keys silently come back. `sandboxEnv.test.ts` pins this.
- **Regex parsers.** `identityGate.test.ts` parses migration text, so a careless comment in 0134 fails it. That fails loudly, not silently.

## What was verified versus inferred

**Verified by reading code or running read-only queries:**
- The tester ids and the email mapping, existing rows, and the absence of mixed rows.
- The highest migration is 0133.
- The `items_catalog_select` 0108 text and the 0071 policy.
- `public_profiles` / `discoverable_profiles` (0127; definer views).
- The column-grant convention (0066, 0069, 0072, 0091, 0097).
- That `suggest_items_fuzzy` is security invoker.
- That facets and suggestions use the anon client under `unstable_cache`.
- That `sitemap.ts` uses the admin client.
- That `searchCatalog` uses the cookie client.
- Both job routes and their sub-sweeps, and the queue queries.
- `drainFailedTradeFees` charging the stored `payer_id`.
- The custody input query.
- The admin console reads.
- The arbitration queue reads.
- That the webhook pipeline refuses mock deliveries when the provider is live.
- The `withActionLog` structure.
- That `getCachedProfile` uses explicit columns.
- `proxy.ts`.
- The `@supabase/ssr` browser defaults (document.cookie, singleton).
- That auth-js `signOut` defaults to `global`.
- That `@next/env` doesn't override preset keys.
- Next 16.3.4.
- `operationalRegions` under mock.
- The `MockService.placeHold` signature.
- That `createPayer` runs only when `payer_id` is absent.

**Verified in this revision:**
- The repository interfaces' method names (`CashSaleRepository`, `TradeRepository`, `TradeProposalRepository`, `DisputeResolutionRepository`), which define the decorator table in §3.
- `lib/trades/completion.ts` exports `voidTradeHolds`, `settleTradeCash`, `finalizeCompletedTrade`; `lib/trades/collateralPlacement.ts` exports `itemIdsFor`, `syncHolds`, `placeTradeCollateral`.
- `requireParticipant` (`trades.ts` ~L105) and both `tradeNegotiation.ts` loaders read `select('*')`, so `is_test` arrives with the row once the column exists.
- `lib/auth/fraudBan.ts`'s write sequence (profile flag, listing hide, Auth ban, person-key stamping, `identity_bans` upsert, cascade), and that `identity_bans` has `source_profile_id`.
- `refreshOnRead.ts`'s two `after()` reads and the RPCs they call.
- `syncCashSaleTracking` goes through the orchestrator; `saveCashSaleReturnAddress` upserts directly with the cookie client.
- `updateDealInvite` (0124) updates the item row and never changes `deal_invites.host_item_id`.
- The action names used in the gate sets (`reports.reportItem`, `reports.reportUser`, `feedback.submitFeedback`, `account.closeMyAccount`, `reviews.leaveReview`, `watchlist.toggleWatch`, `messages.sendMessage`, the `auth.*` set).
- `auth.signOut` calls `supabase.auth.signOut()` (global); `signOutEverywhere` passes `scope: 'global'`.
- `hasSupabaseSessionCookie` exists in `lib/supabase/sessionCookie.ts` and is already used by `cachedAuth.ts`, `app/layout.tsx` and `proxy.ts`.
- Next 16 builds with Turbopack by default and fails `next build` when a custom `webpack` config is present; `turbopack.resolveAlias` is the supported alias option; `PHASE_DEVELOPMENT_SERVER` is exported from `next/constants`.
- `vitest.config.mts` aliases `server-only` to its empty entry, so `tests/unit` can import `lib/` modules marked `server-only`.
- The review confirmed `getIdentityCheckState` / `getMerchantState` are pure reads.

**Verified in round 2:**
- `placeBondsForAgreedTrade` (`tradeProposal.ts` L455) reads profiles and items, then `getHolds(tradeId)`, then calls `placeHold` per trader, with no `loadTrade`; `PlaceAgreedBondsResult` has no `trade-not-found` today. Its only callers are `lib/trades/collateralPlacement.ts` L236 and `tests/unit/tradeProposal.test.ts`.
- `markDisputeReturnOverdue` (`disputeResolution.ts` L505) calls `recordReturnOverdue` with no read and returns `{ ok: true }`; it has no callers.
- The full `TradeProposalRepository` and `DisputeResolutionRepository` method lists, which define the §3 classification table. Hold-ref-keyed writers (`markHoldStatus`, `markHoldVoided`, `recordFullCapture`) are called only with refs from a preceding `getHolds` of the same trade.
- `authenticateMobileRequest` (`lib/api/mobileSession.ts`) tries cookies, then Bearer; every `app/api/mobile/**/route.ts` calls it (none skips it).
- The complete list of non-mobile route handlers (§5.2, "Route handlers"); `app/identity/return/route.ts` only redirects.
- `app/layout.tsx` mounts `SiteHeader` in a `Suspense` inside `StartDealProvider`, plus `PageViewTracker`, `Analytics` and `SpeedInsights`; `proxy.ts`'s matcher excludes `/sellers`, `/t`, `/sign-in` and the marketing routes.
- The six admin moderation actions exist as `withActionLog('admin.<name>'` in `lib/actions/admin.ts`; `AdminActionResult`'s error is the closed `AdminActionError` union.
- `chargeTradeFees` returns `TradeFeeOutcome { collectedCents, anyFailed }`, `refundTradeFees` returns a number, and `lib/actions/tradeFees.ts` is not `'use server'`.
- `profiles` carries `payment_source_id`, `payment_method_label` and `payment_token_type`.

**Inferred, to confirm during implementation:**
- The full `cron.job` list (the four bodies themselves are now proven by the drift guard).
- That the md5 digest of the migration-file body text matches `prosrc` for a function created from that file (whitespace is stored verbatim; any mismatch fails closed as `LIVE_BODY_DRIFT`).
- That Next does not let a page segment's error escape to `global-error` when the root layout omits `children` (the manual check in Testing confirms it; either outcome keeps the switcher).
- That the `trade_fees.trade_id` foreign key exists for the `!inner` embed.
- That no other pg_cron or `pg_net` trigger touches contract tables.
- The Supabase Auth session settings, and the current redirect allowlist (P3).
- That `MockService` never validates a `pm_` / `cus_` format.
- That a `resolveAlias` key of `@/components/sandbox/SandboxSlot` matches under Turbopack (fallback specified in §6).

---

## Responses to the design review (round 1)

Every HIGH and MEDIUM finding is addressed. Hard constraints are unchanged: shared production database, no second Supabase project, mock-only sandbox, no impersonation endpoint, no agent-applied writes.

| # | Sev | Response |
|---|---|---|
| 1 | HIGH | **Addressed.** `discoverable_profiles` uses an inlined `not exists` subquery over `profiles` (§1.8); `profile_is_tester` is documented as never callable from a view or policy. The migration test asserts it, and the post-apply checks read both views as `anon` and `authenticated` in a rolled-back transaction |
| 2 | HIGH | **Addressed.** Scope is enforced at chokepoints: `requireParticipant`, both `tradeNegotiation` loaders, and every export of `completion.ts` and `collateralPlacement.ts` (§3 table). The coverage test now scans all of `lib/`, `app/` and `domain/orchestrator/` and requires the money-primitive checks. `libMoneyScope.test.ts` covers `retrySettleTradeCash`, `retryTradeCollateral` and `syncTradeTracking` |
| 3 | HIGH | **Addressed, one deviation.** A tester is never fraud-banned: early return in both `fraudBan.ts` functions (§4.4), backed by `refuse_tester_fraud_ban` on `profiles` and `refuse_tester_identity_ban` on `identity_bans`, plus `fraudBanTester.test.ts`. Deviation: the DB guard is on `identity_bans` (the blocklist), not `identity_person_keys`, because person keys are written at every real verification; the code path already skips stamping them for a tester |
| 4 | HIGH | **Addressed.** No switcher path calls GoTrue sign-out. "Add another account" stops auto-refresh, clears the `sb-<ref>-auth-token*` cookies locally and does a full navigation (§6). The component test asserts `signOut` is never called |
| 5 | MED | **Addressed.** `refreshOnRead.ts` selects `is_test` and skips out-of-scope rows (§4.4). `saveCashSaleReturnAddress` is scoped. `syncCashSaleTracking` is covered by the scoped repository, `syncTradeTracking` by `requireParticipant`. Going further, out-of-scope contract rooms now `notFound()` (R17), so production never renders a test room at all; the banner keeps only its sandbox wording |
| 6 | MED | **Addressed.** In the sandbox, conversations require tester↔tester always, `sendMessage` requires an `is_test` conversation, `leaveReview` and `toggleWatch` require a scope match, and `reports.*` / `feedback.submitFeedback` are refused by a new `SANDBOX_REAL_SIDE_EFFECT_ACTIONS` set (§5.2). Decision-table tests in `sandboxActionPolicy.test.ts` and `sandboxRowRules.test.ts`. Also added `account.closeMyAccount` to the frozen set, because closing a tester from the sandbox would close a real account |
| 7 | MED | **Addressed, one deviation.** The stub is the default module and a dev-phase-only `turbopack.resolveAlias` swaps in the real slot (§6); `sandbox:check-build` greps the build output. Deviation: no `webpack` `resolve.alias`, because Next 16 fails `next build` when a custom webpack config exists, and the stub-by-default design doesn't need one |
| 8 | MED | **Addressed.** The launcher forces `NEXT_PUBLIC_SITE_URL=http://localhost:<port>`, `assertSandboxEnv` checks it, and ports are limited to `SANDBOX_PORTS = [3000, 3001]`. Precondition P3 documents the Redirect URL allowlist, with an optional read-only Management API check when `SUPABASE_ACCESS_TOKEN` is set (§5.1) |
| 9 | MED | **Addressed as preconditions.** P1 (piggybear id) blocks writing 0134; P2 (staff) no longer affects the migration. The migration asserts `display_name` per id. The stash rule is `isTester || isStaff`, with staff labelled. Both still need the user's answer, since they decide which real account becomes test-only and which account arbitrates |
| 10 | MED | **Addressed.** The decorators filter named read methods only, list methods take a required `isTest`, writes delegate unchanged (§3 table). `scopedRepositoryMoney.test.ts` asserts zero repository write calls as well as zero `PaymentService` calls, through a recording Proxy |
| N1 | NIT | Addressed: normalized `EXPECTED_CODES` entries (§3) |
| N2 | NIT | Addressed: exact `profile_is_tester` body (§1.6), pinned by the migration test |
| N3 | NIT | Addressed: route functions renamed to `processDuePayouts` / `processDueRefunds`; the `cashSaleInspectionSweep` count is defined by the coverage test |
| N4 | NIT | Addressed: §2 note on real rows surfacing in sandbox facets and suggestions |
| N5 | NIT | Addressed: `auth.*` exempt from the gate; sandbox `auth.signOut` clears cookies locally (§5.2) |
| N6 | NIT | Addressed: the intentional parent/child mismatch is documented in the backfill step (§1.5) |
| N7 | NIT | Addressed: `updateDealInvite` was checked and never changes `host_item_id`, but the trigger covers `BEFORE UPDATE OF host_item_id` anyway at no cost |
| N8 | NIT | Addressed: R16 scopes `statement.ts`, `listMyDealInvites` and the `/sales`, `/purchases`, `/trades` lists |
| N9 | NIT | Addressed: explicit agent prohibitions in §5.1 |
| N10 | NIT | Addressed: one `isTesterMismatch` helper used by the repositories and the lib-layer inserts (§1.6) |
| N11 | NIT | Addressed: `sessionState: 'UNRESOLVED'` (session cookie present, user null) is refused (§5.2) |

## Responses to the design review (round 2)

Every HIGH and MEDIUM finding is addressed; every NIT is addressed. Hard constraints are unchanged: shared production database, no second Supabase project, mock-only sandbox, no impersonation endpoint, no agent-applied writes. The seven required pieces and the enumerated checklist are kept and extended. Round 1's response to its finding 10 ("writes delegate unchanged") is superseded by round 2 finding 1 below.

| # | Sev | Response |
|---|---|---|
| 1 | HIGH | **Addressed.** The decorators now refuse instead of emptying (§3): every repository method is classified (`loader`, `guarded`, `list`, `create`, `profile`, `child-ref`) in a typed per-interface record, so a new method fails `tsc` until classified. `guarded` methods, reads and writes alike, throw `OutOfScopeError` for an out-of-scope or missing contract id, with a per-instance memo seeded by loaders so the normal path costs no extra query. `placeBondsForAgreedTrade` and `markDisputeReturnOverdue` wrap their bodies in `refuseOutOfScope` and return `trade-not-found` (added to `PlaceAgreedBondsResult`; the second's return type widens, and it has no callers). The table names all dispute writers, including `flagManualReconciliation`, `markHoldVoided` and `recordReturnOverdue`. `collateralPlacement.ts` passes a scoped repository too. The test counts only calls actually delegated to the inner repository, so a refused guarded call counts as refused, and it fails on an escaping `OutOfScopeError` |
| 2 | MED | **Addressed.** `deriveSandboxSessionState` treats a JWT-shaped Bearer like a session cookie: `NONE` only when neither is present (§5.2). A non-JWT bearer (the jobs secret) is not a member credential, so job routes stay `NONE`. `authenticateMobileRequest` returns 404 `SANDBOX_MOBILE_DISABLED` in sandbox mode, which closes `mobile/account/close` and both `step-plan` routes. Every route handler is now enumerated with its sandbox status; the coverage test asserts every mobile route uses the helper. The "mobile is covered" sentence is corrected. Bearer cases added to `sandboxActionPolicy.test.ts` |
| 3 | MED | **Addressed, with a different chokepoint than proposed.** The refusal moves before render, but into the root layout rather than `proxy.ts`: `sandboxLayoutState()` (no I/O outside sandbox mode) makes `app/layout.tsx` render a refusal notice, a Sign out form and the switcher instead of `SiteHeader` and the page. Reason: the proxy matcher is static and excludes `/sellers/[id]`, `/t/[token]`, `/sign-in` and the marketing routes, so a proxy-only fix leaves those paths on `global-error`, and widening the matcher would add a session read to them in production. Keeping the session (rather than expiring cookies) also lets the switcher switch in place. The gate throw stays as a backstop. The pure `sandboxLayoutDecision` is unit-tested and pinned to agree with the action table |
| 4 | MED | **Addressed.** The six moderation actions join `SANDBOX_REAL_SIDE_EFFECT_ACTIONS` under a `MODERATION` kind with "The sandbox does not moderate real content. Use noditto.app for that." `AdminActionError` gains the code. §4.4 states that the console's reports, feedback and errors tabs show production data read-only in the sandbox |
| 5 | MED | **Addressed.** 0134 opens with an `md5(prosrc)` drift guard per cron function, against digests of the bodies copied from 0038, 0093, 0109 and 0039 (after a grep for any later definition). Drift aborts the transaction as `LIVE_BODY_DRIFT: <name>`, and the recovery is a read-only `prosrc` query by the user. `testerMigration.test.ts` pins the four guards and their position |
| 6 | MED | **Addressed as P4, blocking 0134.** It states the consequence in full, recommends yes, and gives the alternative (two fresh user-created accounts). The account ids and names are now four `declare` constants in one block, so the alternative is a four-literal edit. This needs the user's answer because it changes what happens to his real accounts; it is recorded as a precondition rather than decided |
| 7 | MED | **Addressed.** New §4.5 records the decision for every reader the review listed (filter, refuse, or exempt with a reason), and gives the rule for anything the static test's first run adds. Checklist item 43c lists them |
| 8 | NIT | Addressed: the factories use `testRowScope(resolveSandboxMode(process.env))` from `domain/sandbox` (§3) |
| 9 | NIT | Addressed: the exported switcher is a hook-free guard rendering `SandboxAccountSwitcherInner` (§6) |
| 10 | NIT | Addressed: the overview now says production never creates a test row or moves money, holds, jobs, email or arbitration on one, and names the harmless participant edits that remain |
| 11 | NIT | Addressed: `listAvailableItems` gets the R2 filter (R3a). Not deleted, to stay in scope |
| 12 | NIT | Addressed: `chargeTradeFees` and `refundTradeFees` are chokepoints with concrete out-of-scope returns, and the static every-export rule covers `lib/actions/tradeFees.ts` |
| 13 | NIT | Addressed: P2 recommends a staff account the user controls, and makes rotating frank's and grace's committed passwords a prerequisite to using either |
| 14 | NIT | Addressed: recorded under Risks with the un-flag cleanup statement |
| 15 | NIT | Addressed: `testerMigration.test.ts` asserts 0134 contains none of the `identityGate.test.ts` anchors, comments included |
