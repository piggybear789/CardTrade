# Design review (round 2): local two-tester sandbox on the shared production database

Reviewed: `design.md` (99 KB, including "Responses to the design review"), read fresh against the code. No builds or tests were run.

**Verdict: CHANGES_REQUESTED.** 1 HIGH, 6 MEDIUM, 8 NIT.

The round-1 HIGHs are fixed: the definer-view function call, the `requireParticipant` money path, the tester fraud ban, and the GoTrue sign-out in the switcher. Most of the round-1 MEDIUMs are fixed too. The migration layout, the RLS conjunct, the DB pairing triggers, the launcher and the stub-by-default switcher are sound.

This round found three kinds of problem:
- The repository-decorator rule ("filter reads to empty, delegate writes") is wrong for one money entry point.
- The sandbox gate covers Server Actions only, reads cookies only, and its throw takes down the root layout.
- A few production writes and unenumerated readers are left for the implementer to decide without a rule.

---

## Findings

### 1. HIGH: An empty filtered `getHolds` can mean "place new holds"; `placeBondsForAgreedTrade` would authorise real cards

**Where:** §3 "Existing rows: scoped repositories", the decorator table, and `tests/unit/scopedRepositoryMoney.test.ts`.

**Problem:** The design's guarantee is that "every orchestrator entry point loads through a filtered read before it writes", where a filtered read returns `null` / `[]` out of scope. That fails for entry points whose only trade-scoped read is a list, because an empty list is a valid in-scope answer, not a refusal:

- **`placeBondsForAgreedTrade`** (`domain/orchestrator/tradeProposal.ts` L455–545):
  1. It calls `getProfile` ×2 and `getItem` per item. All of these are delegated unchanged.
  2. It then calls `repository.getHolds(params.tradeId)`. Under the decorator this returns `[]`, which the code reads as "no prior attempts".
  3. It calls `payments.placeHold` for each trader, with their payer ids. Both testers hold real `cus_…` ids, and piggybear holds a real `pm_…`.

  It never calls `loadTrade`. The only production caller, `lib/trades/collateralPlacement.ts` L236, is protected by the new `assertRowInScope` chokepoint and passes a raw repository. But the domain barrier the design claims doesn't exist, and the specified test ("zero `PaymentService` calls for every exported operation … with an out-of-scope row") fails for this function exactly as designed.
- **`markDisputeReturnOverdue`** (`disputeResolution.ts` L505) writes `recordReturnOverdue` with no read at all, so the "zero writes" assertion also fails.
- The decorator table omits three `DisputeResolutionRepository` writers: `flagManualReconciliation`, `markHoldVoided` and `recordReturnOverdue`. It says only "every `record*` writer", and the first two aren't `record*`.

The implementer would hit a failing behavioural test with no specified remedy. The one money function where the rule matters would be the one where it silently does the wrong thing.

**Fix:** Change the decorator semantics from "empty" to "refuse":

```ts
// domain/sandbox/scopeRepository.ts
export class OutOfScopeError extends Error { readonly code = 'SANDBOX_SCOPE' as const; }

// Every method keyed by a tradeId, READ OR WRITE (getHolds, listTradeItemIds, recordHold,
// markHoldStatus, reserveItems/restoreItems when called with a trade's ids, record*,
// flagManualReconciliation, markHoldVoided, recordReturnOverdue):
async function guard(tradeId: string) {
  if ((await tradeIsTest(tradeId)) !== (scope === 'test')) throw new OutOfScopeError();
}
```

Then:
- `loadCashSale` / `loadTrade` keep returning `null`. That is a genuine "not found" the orchestrators already handle.
- Every exported orchestrator function that takes a `tradeId` and does not start with `loadTrade` (`placeBondsForAgreedTrade`, `markDisputeReturnOverdue`, and any other the test finds) catches `OutOfScopeError` at its top and returns its existing not-found failure (`{ ok: false, error: 'trade-not-found' }` / `'NOT_FOUND'`). Add `'trade-not-found'` to `PlaceAgreedBondsResult` if it isn't there.
- Rewrite the test assertion as: zero `PaymentService` calls, and zero calls to any write method that *returned*. A guarded write that threw counts as refused.
- Name all three missing writers in the table.

### 2. MEDIUM: The sandbox gate fails open on Bearer auth and doesn't cover route handlers

**Where:** §5.2 "Session state, fail-closed" and "Mobile … delegates to the same wrapped actions, so it's covered".

**Problem 1: Bearer requests.** `getCachedAuthUser()` (`lib/supabase/cachedAuth.ts`) and `createClient()` (`lib/supabase/server.ts`) both accept `Authorization: Bearer`. The gate derives `sessionState` from cookies alone, so a Bearer request with no cookie is `'NONE'` → row 4 `ALLOW`, while every action inside it runs as that user. A non-tester's token therefore passes the gate on a sandbox server. Row-level admission still blocks contracts, but `payments.completeCardSetup` would write a mock card onto a real member's profile, and so would `profile.*` and `region.setTradingRegion`.

**Problem 2: route handlers.** These aren't `withActionLog` exports. `app/api/mobile/account/close/route.ts` calls `createDefaultAccountClosureOrchestrator().closeAccount` directly, cookie first and then bearer. A fetch from the sandbox tab therefore closes the developer's real account, bypassing the frozen `account.closeMyAccount`. `cash-sale/step-plan` and `trades/step-plan` also read contracts through `lib/api/contractStepPlan.ts`, outside every listed chokepoint.

**Fix:**
- In `lib/sandbox/sandboxGate.ts`:
  - Bearer present, or session cookie present → `'VALID'` if `getCachedAuthUser()` resolves, else `'UNRESOLVED'`.
  - `'NONE'` only when neither is present.
- In `lib/api/mobileSession.ts` `authenticateMobileRequest`, as the first statement: `if (isSandboxMode()) return { ok: false, response: Response.json({ ok: false, error: 'SANDBOX_MOBILE_DISABLED' }, { status: 404 }) };`. Every `app/api/mobile/**` handler goes through it, so the sandbox simply has no mobile API.
- Correct the §5.2 sentence about mobile.
- Add a case to `sandboxActionPolicy.test.ts` for Bearer with no cookie.

### 3. MEDIUM: Row 7's throw breaks the root layout, so a non-tester session has no in-app way out

**Where:** §5.2 row 7, §6 "the panel shows 'Signed in as a non-tester…'", and §6 Pitfalls ("Google may auto-pick the last-used Google account").

**Problem:** The gate throws for any wrapped call by a valid non-tester (or an `UNRESOLVED` session), including read-style actions called during render. `components/layout/SiteHeader.tsx` is mounted in `app/layout.tsx` and calls `listMyNotifications()`, which is wrapped, for every signed-in user. The throw escapes the root layout and lands on `app/global-error.tsx`, which replaces the whole document. That removes the switcher (it's in the root layout too), the header's Sign out and `/sign-in`.

The developer then has to clear cookies by hand in devtools, and the "Signed in as a non-tester" panel described in §6 can never render. This is the exact case the design itself predicts: Google auto-picks a different account.

**Fix:** Refuse at the edge before rendering, and keep the gate throw only as a backstop. In `proxy.ts`, which already reads the profile on every request (L173–178):
- add `is_tester, is_admin, is_support` to that select.
- When `isSandboxMode()` and the session is `UNRESOLVED`, or `VALID` with none of the three flags:
  1. set every `sb-<ref>-auth-token*` cookie to `Max-Age=0` on the response, with no GoTrue call, so the session and any stash entry stay valid;
  2. redirect to `/sign-in?sandbox=refused`.
- `/sign-in` renders a one-line notice for `sandbox=refused`.

The switcher then renders normally (no session), and the developer can switch to a stashed tester. Add a unit test for the proxy branch's decision function, kept pure in `domain/sandbox/sandboxActionPolicy.ts`.

### 4. MEDIUM: Staff in the sandbox can moderate real production content

**Where:** §5.2 row 6 ("What confines staff is the other layers…") and `SANDBOX_REAL_SIDE_EFFECT_ACTIONS`.

**Problem:** `lib/actions/admin.ts` exports these actions, none of which goes through a scoped repository or chokepoint:
- `admin.hideItem`, `admin.unhideItem` (items by id, admin client, L126);
- `admin.clearMemberAvatar`;
- `admin.setReportStatus`, `admin.setFeedbackStatus`;
- `admin.resolveErrorGroup`.

The sandbox admin console also lists real reports, feedback and error groups (`admin/(console)/page.tsx` L169–222, L344–353). A staff actor on a sandbox server therefore hides real listings, clears real avatars and closes real reports. Those side effects land on real members, which is exactly what `SANDBOX_REAL_SIDE_EFFECT_ACTIONS` exists to refuse for reports and feedback.

**Fix:**
- Add `admin.hideItem`, `admin.unhideItem`, `admin.clearMemberAvatar`, `admin.setReportStatus`, `admin.setFeedbackStatus` and `admin.resolveErrorGroup` to `SANDBOX_REAL_SIDE_EFFECT_ACTIONS`, with the message "The sandbox does not moderate real content. Use noditto.app for that."
- None of them is needed for the two-party flows. The existing name-existence test pins the list.
- State in §5.2 that the console's reports, feedback and errors tabs show production data read-only in the sandbox.

### 5. MEDIUM: The live cron bodies can't be fetched by the implementer, and nothing proves the copied bodies match production

**Where:** §1.6 "Scoped sweep functions", §4.3, and Open question 6.

**Problem:** The four `*_for(p_is_test)` bodies must equal the live definitions, because 0134 redefines the zero-arg functions pg_cron calls. The design says "I fetch the LIVE definitions read-only first". But §0 records that the Supabase MCP was unavailable, and service-role PostgREST can't run `pg_get_functiondef`. The implementer will likely copy from the migration files:
- `auto_complete_due_cash_sales`: 0038;
- `warn_expiring_holds`: 0093;
- `expire_lapsed_holds`: 0109;
- `enforce_trade_shipping_deadlines`: 0039.

The design itself says hand-applied history makes those files untrustworthy. A stale body would silently revert a production fix in an hourly money-adjacent job. The "read-only checks before applying" list names `pg_get_functiondef` but not what to compare it against, or what to do on a difference.

**Fix:** Make the migration self-verifying.
1. The implementer copies each body from the newest defining migration (named above) and computes `md5` of the exact text between the `$$` delimiters.
2. 0134 begins (after the header) with:

   ```sql
   do $$
   begin
     if (select md5(prosrc) from pg_proc
          where oid = 'cardtrade.auto_complete_due_cash_sales()'::regprocedure)
        <> '<md5 of the 0038 body>' then
       raise exception 'LIVE_BODY_DRIFT: auto_complete_due_cash_sales';
     end if;
     -- same for the other three
   end $$;
   ```

3. On `LIVE_BODY_DRIFT`, the user runs `select prosrc from pg_proc where oid = '…'::regprocedure` (read-only), and the implementer rebuilds the `_for` body from that output.
4. `testerMigration.test.ts` asserts the four guards are present.

### 6. MEDIUM: Making both real accounts test-only is irreversible, unconfirmed, and doesn't block the migration

**Where:** Open question 1, and the Preconditions (only P1–P3 block).

**Problem:** After 0134, `joys_joys` (the user's kitsunearia@gmail.com account) and `piggybear` can no longer transact with any real member on noditto.app. The pairing trigger and creation admission refuse every mixed or production-side contract, offer, invite or listing. Their existing public listings also leave the real catalog and real watchlists.

The design calls stamped rows effectively permanent, yet records this as an open question only. The user asked for test data "only visible locally", not for his own accounts to stop working in production. The implementation step can write and hand over 0134 with the question still open.

**Fix:** Promote it to **P4 (blocks writing 0134)**: "Confirm that joys_joys and piggybear become test-only accounts on noditto.app: browse yes, buy, sell, trade, offer and list no, and their three public listings leave the real catalog." Give the recommended answer and the alternative if the user says no: a pair of new tester accounts, created by the user, whose ids replace the two hardcoded ones. The migration's id and `display_name` assertions are already parameterised for that.

### 7. MEDIUM: Known contract-table readers outside the checklist are left for the implementer to decide

**Where:** §2, §4.4, the Checklist, and the statement in §Testing that "the first run will flag a set of chains… that list is the definition of 'every reader'".

**Problem:** Delegating the inventory to the static test is fine for discovery, but several readers it will flag carry a policy decision (disclosure, closure, evidence), not a mechanical filter. The design gives no rule for them, so the implementer would be making product calls. From a `.from('cash_sales'|'trades'|'offers'|'conversations'|…)` scan of `lib/`, `app/` and `domain/orchestrator/`, these are absent from the design:

| Reader | What it does | Decision to record |
|---|---|---|
| `identity.getCounterpartyIdentity` (L130–138, admin, existence check over trades/cash_sales) | Releases a provider-verified **legal name** when any contract exists between the two | `.eq('is_test', scope === 'test')` on both reads, so disclosure rests on an in-scope contract |
| `disputeEvidence.*` (L92, L105) | Uploads and reads evidence on a dispute by ref | Add `is_test` to the select; `!rowInScope(row)` → `not-authorized` |
| `demo.fireTradeWebhook` / `fireCashSaleWebhook` (L107, L261) | Fires a mock provider event at a contract | `is_test` + `rowInScope` → `not-participant`, with the pipeline check (§4.4) as backstop |
| `lib/api/contractStepPlan.ts` (L179, L275) | Mobile step plan | Covered by the Finding 2 sandbox 404; in production add `rowInScope` → not-found, matching R17 |
| `supabaseAccountClosureRepository` Money_In_Flight counts (L273–350) | Blocks account closure while money is in flight | **Exempt on purpose**: a tester's in-flight test contracts still block closing the real account (conservative). Record it |
| `lib/regionBinding.ts` (L54, L104) | Currency → Stripe binding by id | Exempt: lookup by id after a scoped load |
| `lib/actions/notifications.ts` (L53–56) | Checks that a notification's contract link still exists | Exempt: participant-only id read |
| `messageAttachments.ts` (L65) | Signed upload into a conversation | Sandbox: require `conversation.is_test`, the same rule as `sendMessage` |
| `profile/(hub)/page.tsx` L178, `listings/mine/page.tsx` L47 | Pending-offer counts | `.eq('is_test', scope)` via `offers`, consistent with R16 |

**Fix:** Add this table to §4.4 and the Checklist, so the static test's first run confirms decisions instead of making them.

### 8. NIT: Domain factories are told to call a lib function

§3 says both "each `createDefaultXOrchestrator()` factory fills it with `resolveSandboxMode(process.env)`" and "Each `createDefault*Orchestrator()` wraps its repository with `currentScope()`". The factories live in `domain/orchestrator/supabase*Repository.ts`, and `currentScope()` is in `lib/sandbox/` (server-only), which `domain/` may not import.

**Fix:** In the factories, use `testRowScope(resolveSandboxMode(process.env))` from `domain/sandbox`.

### 9. NIT: The switcher's early `return null` breaks the hooks lint rule

§6 makes `if (process.env.NODE_ENV === 'production') return null;` the switcher's first statement, ahead of its hooks. `eslint-plugin-react-hooks` flags hooks after a conditional return.

**Fix:** Make the exported `SandboxAccountSwitcher` a guard that returns `null` or `<SandboxAccountSwitcherInner {...props} />`, with all hooks in the inner component.

### 10. NIT: The overview over-claims that "a production server only ever touches real rows"

Production still writes test rows through unscoped participant paths:
- offer decline and withdraw (`offers.ts`, `update (status)`);
- `sendMessage` into test conversations (the scope rule applies in the sandbox only);
- `updateItem`, `deleteItem` and `closeShopfrontListing` on a tester's own test items via `/listings/mine`;
- deal-invite revoke.

All of these are harmless (no money), but the sentence is false as written.

**Fix:** Restate it as "a production server never creates a test row and never moves money, places a hold, runs a job or arbitrates on one. Participant-only edits to existing test offers, messages and listings stay possible and harmless." Alternatively, scope those four paths too.

### 11. NIT: `listings.listAvailableItems` is unmentioned

It's an exported, cookie-bound catalog read (`listings.ts` L956) with no callers today. Under the new RLS, a tester in production would get test rows from it.

**Fix:** Add `.eq('is_test', currentScope() === 'test')` alongside R2/R3, or delete the dead export.

### 12. NIT: The static money-primitive rule omits `lib/actions/tradeFees.ts`

`chargeTradeFees` and `refundTradeFees` are exported money primitives. Both are reached today only through `collateralPlacement.ts`, which is scoped.

**Fix:** Extend the static rule ("every exported function … calls `rowInScope`/`assertRowInScope`") to `lib/actions/tradeFees.ts`, and add `refundTradeFees` to the chokepoint table.

### 13. NIT: P2 recommends seed staff accounts whose passwords `plan.md` flagged as committed

P2 suggests frank or grace (`password123`, committed in `supabase/seed.sql`) as the sandbox staff actor. `plan.md` §5 Q1 flagged those exact accounts as production admin and support with public credentials.

**Fix:** Recommend a staff account the user controls. Otherwise make "rotate frank's and grace's passwords first" part of P2.

### 14. NIT: A mock card persists on joys_joys's real profile

Sandbox `completeCardSetup` writes a mock `payment_source_id` onto `joys_joys`'s real production profile, which has no card today. It stays there after an un-flag.

**Fix:** Record it under Risks, along with the cleanup: clear `payment_source_id` / `payment_method_label` for that id when un-flagging.

### 15. NIT: The migration test should pin every identityGate regex, not just two literals

`identityGate.test.ts` uses `select\s*\(` (whitespace, including a newline, is allowed), `\)\s+as is_verified`, `verified\s*:=\s*\(`, and the `create trigger profiles_sync_items_seller_identity_verified` pattern. 0134 is safe only because it contains none of the anchors.

**Fix:** In `testerMigration.test.ts`, assert that 0134 contains none of `as is_verified`, `into new.seller_identity_verified`, `/verified\s*:=/` or `profiles_sync_items_seller_identity_verified`. Guarding the anchors makes a stray `select (` in a comment provably harmless.

---

## Verified assumptions (read in code this round)

- **Migrations:**
  - `items_catalog_select` was last redefined in 0108. Its public branch is the parenthesised `status in (…) and closed_at is null and seller_fraud_banned = false and hidden = false`, so the conjunct has a clean home.
  - The only other items SELECT policy is `items_trade_participant_select` (0071).
  - `discoverable_profiles` is `select * from public_profiles where closed_at is null` (0111, re-created in 0127), with grants that survive `create or replace`.
- **Grants:**
  - `profiles` UPDATE is column-allowlisted (0008/0072).
  - `profiles` INSERT is revoked (0073).
  - `items` INSERT is column-granted (0077, 0106, 0129).
  - `offers` UPDATE is `(status)` only.
  - So new columns get no member write privilege by inheritance.
  - `items` SELECT is column-granted for anon, so `is_test` needs its grant.
- **Cron:** schedules exist only for the four named functions (0011, 0035 ×2, 0039). Their newest file definitions are 0038, 0093, 0109 and 0039.
- **Job routes:** `vercel.json` has exactly two crons.
  - `trade-inspections` runs `sweepTradeInspections`, `sweepCashSaleInspections`, `drainFailedTradeFees`, `placeDueTradeCollateral`, `advanceDueHandovers` and `flagStaleCollateralTrades`, matching §4.1.
  - `cash-sale-payouts` runs `processDuePayouts` / `processDueRefunds` per `operationalRegions()`.
- **Webhooks:** `dispatchEvent` cases are TRADE_EVENT, CASH_SALE_SETTLE/FAIL, CASH_SALE_REFUND_FAILED, IDENTITY_DECISION, MERCHANT_COMPLIANCE and CHARGE_DISPUTE. Each resolves a trade or sale id before acting, so one scope check point is feasible. Mock and demo never emit `charge.disputed`.
- **Server Actions:**
  - `withActionLog` has an `insideAction` AsyncLocalStorage outermost branch, which is where the gate can sit.
  - Nested calls to frozen actions only occur inside other frozen actions or the webhook pipeline (not an action), so outermost-only gating doesn't leak a frozen action.
- **Location of existing code:**
  - `requireParticipant` (trades.ts L105).
  - Both `tradeNegotiation.ts` loaders, `select('*')` at L108 and L426.
  - The `completion.ts` exports `voidTradeHolds`, `settleTradeCash(trade)` and `finalizeCompletedTrade`.
  - The `collateralPlacement.ts` exports `itemIdsFor`, `syncHolds` and `placeTradeCollateral`.
  - `getCustodyPosition` (admin.ts L761).
  - `permanentlyBanConfirmedFraudOffender` / `enforceProfileFraudBan`.
  - `auth.signOut` calls `signOut()` (global); `signOutEverywhere` uses `scope: 'global'`.
  - `sendEmail` in `lib/email/sendEmail.ts`.
  - `cashSaleInspectionSweep.ts` has 11 contract-table references.
  - The admin console reads match §4.4's line numbers.
- **Repository interfaces:** the method names in the §3 decorator table exist on `TradeProposalRepository`, `DisputeResolutionRepository` and `TradeRepository`.
- **Sessions and cookies:**
  - `hasSupabaseSessionCookie` matches names starting `sb-` that contain `auth-token`, chunks and code verifier included.
  - `getCachedProfile` selects explicit columns.
  - `app/layout.tsx` already reads cookies and mounts `<Toaster />`, so the slot position is viable.
- **Config and environment:**
  - `next.config.ts` is a plain object today (no wrappers), so a phase-function conversion is mechanical.
  - `distDir` reads `NEXT_BUILD_DIR`.
  - `npm run dev` is plain `next dev` (Turbopack default).
  - The test config is `vitest.config.mts`.
  - The only outbound integrations read from env are Stripe, SES/Rekognition (AWS), Ship24 and Google Maps. Rekognition fails open without credentials.
- **Mobile RPC test:** `mobileRpcContract.test.ts` doesn't pin a fixed member-executable set, so the `viewer_is_tester` grant won't break it.

## Unverified or wrong assumptions

- **Wrong:** "Every orchestrator entry point loads through a filtered read before it writes." `placeBondsForAgreedTrade` never loads the trade, and an empty `getHolds` leads to `placeHold`. `markDisputeReturnOverdue` writes with no read (Finding 1).
- **Wrong:** "Mobile (`app/api/mobile/**`) delegates to the same wrapped actions, so it's covered." `account/close` calls the closure orchestrator directly, and `step-plan` reads through `lib/api/contractStepPlan.ts` (Finding 2).
- **Wrong:** "No session cookie → `NONE`" is the whole session story. Bearer tokens authenticate actions through `getCachedAuthUser` and `createClient` (Finding 2).
- **Wrong:** "The panel shows 'Signed in as a non-tester. The sandbox will refuse actions.'" The root layout's `SiteHeader` → `listMyNotifications` throws first, so the panel never renders (Finding 3).
- **Wrong:** "What confines staff is the other layers." The moderation actions are unscoped (Finding 4).
- **Unverified, possibly infeasible:** "The bodies are copied from `pg_get_functiondef` on production." The implementer has no SQL access per §0 (Finding 5).
- **Unverified (the design already lists these as inferred):**
  - the `trade_fees.trade_id` FK for the `!inner` embed;
  - Supabase Auth session policy (time-box, single session, refresh-token reuse interval);
  - the redirect allowlist (P3);
  - whether Turbopack honours an `@/`-prefixed `resolveAlias` key (fallback specified);
  - `MockService` accepting real `cus_` / `pm_` formats.
- **Not checked here:** every `cashSaleOrchestrator` export starting with `loadCashSale`. The revised test in Finding 1 will show it either way.
