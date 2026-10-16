# Local two-party test setup: findings and plan

## Summary

"Local only" can't be done safely inside the database you develop against today. `.env.local` points at the NoDitto Supabase project (`kyyaqnsmqthqmnhaqhzq`, ap-southeast-2). It's the only NoDitto project on the account, so it's almost certainly the production database. Two things follow:

- Fixture listings only stay out of the catalog if they're `hidden`. A hidden listing is invisible to the second persona too, so catalog buy, offers, binder buys and "propose trade" from a listing page can't be tested with them.
- Fixture contracts written there are picked up by production machinery. That includes the Vercel payout drain against real Stripe, the pg_cron auto-complete, admin custody reconciliation and the arbitration queue.

**Recommendation:** create a separate "NoDitto Sandbox" Supabase project and point a dedicated `npm run sandbox:dev` launcher at it. Clone the schema with the existing `scripts/bootstrap-region-project.mjs`, seed it with the existing `supabase/seed.sql` personas, and run the dev server in forced `mock` mode. Create fixtures and scenarios by driving the real UI with the Playwright helpers already in `tests/e2e/support/**`, not with raw SQL. You switch users with two browser profiles signed in side by side. Nothing ever touches the production database.

**Separate urgent finding (needs your decision, not part of this plan's code):** the seeded staff account `frank@example.com` (`66666666-…`) exists in that database with `is_admin = true`. Its password is committed in `supabase/seed.sql` and `tests/e2e/support/users.ts`. It signed in on 2026-10-02 per the auth admin API, and `grace@example.com` has `is_support = true`. If this project backs production, anyone with repo access can sign in to `/admin`. Details are in §5.

---

## 1. Findings: current setup

### 1.1 Where local dev points

From `.env.local`. I read key names only and printed no values.

| Key | State |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Remote, the NoDitto project `kyyaqnsmqthqmnhaqhzq`. It's defined twice, and both entries are remote |
| `SUPABASE_SERVICE_ROLE_KEY` | set |
| `PAYMENTS_PROVIDER` | `stripe` |
| `STRIPE_SECRET_KEY` / `STRIPE_SECRET_KEY_US` | `sk_test_…` |
| `STRIPE_LIVE_KEY`, `STRIPE_PROD_KEY` | set. The app doesn't read these names, but live keys sitting in a dev env file is worth noting |
| `ENABLE_PAYMENT_DEMO`, `ERROR_LOGGING`, `DEFAULT_REGION` | unset |
| `WEBHOOK_URL` | set (port 3000 per `playwright.config.ts` comments) |
| AWS SES keys, `SHIP24_*` | absent, so email is skipped and tracking falls back to manual |

Other environment checks:

- **Supabase projects:** `list_projects` (metadata only) shows "NoDitto" (`kyyaq…`, created 2026-09-10), "Pokedle" (`emojq…`, ap-northeast-1, which old e2e logs used) and "Studitory". There's no dev or staging NoDitto project.
- **Local stack:** there's no `supabase/config.toml`, and neither the Supabase CLI nor Docker is installed. `scripts/bootstrap-region-project.mjs` documents that `supabase/migrations/` is not replayable (0001 creates tables in `public`, several migrations were hand-applied), so `supabase start` + `db reset` would not build this schema anyway.
- **Production DB not verified:** I could not confirm that Vercel production uses `kyyaq…` without pulling Vercel env, which I did not do. The inference rests on it being the only NoDitto project.

### 1.2 What already exists in that database

I ran read-only PostgREST GETs with the service role and printed no PII.

- 14 profiles in total. Seed personas `11111111…` (alice) through `77777777…` (grace) are present: `identity_check_status = VERIFIED`, `region_code = AU`, `merchant_status = APPROVED`, onboarding complete, and a fake `payer_id` / `merchant_ref` (`payer_alice`, `mch_seed_alice` from seed.sql).
- frank has `is_admin = true` and grace has `is_support = true`.
- Seed persona items: 3, all owned by alice, all `hidden = true`, AVAILABLE. Almost every item in the table is `hidden = true`; one sampled AVAILABLE item is public.

### 1.3 Reusable assets

- **`supabase/seed.sql`:** idempotent personas with password `password123` and confirmed emails. They're Identity_Gate-verified, payable (fake refs), onboarded and AU, plus admin/support staff and a US pair (uma/victor, 0122). This is already the persona set; no new personas are needed.
- **`tests/e2e/support/users.ts`:** typed personas, `storageStatePath()`.
- **`auth.ts`:** `ensureFreshSession` handles refresh-token rotation and the rate limiter.
- **Flow helpers:** `listings.ts` (`createListing` is SINGLE-only and doesn't expose kind), `payments.ts` (`ensureSavedCard` using "Save demo card" under mock), `deals.ts` (`composeCashDeal`, `composeSwapDeal`), `places.ts` (stubbed Places API), `messageSeller.ts`, `db.ts` (service-role REST helper without supabase-js).
- **`tests/e2e/specs/*.spec.ts`:** already drive every two-party flow with two `browser.newContext({ storageState })`: cash-sale, offers, trade, private-deal, journeys, admin.
- **`playwright.config.ts` `SERVER_ENV`:** the exact env recipe two-party flows need. It sets `PAYMENTS_PROVIDER=mock`, `ENABLE_PAYMENT_DEMO=true`, `WEBHOOK_URL` back to the same port, `AUTH_RATE_LIMIT_PER_MINUTE=100`, a separate `NEXT_BUILD_DIR`, and a dummy Maps key with intercepted Places calls.
- **Demo panels (`lib/actions/demo.ts`):** confirm/fail holds, settle cash payments and fire identity webhooks. They're gated by `isPaymentDemoEnabled()` (`domain/services/providerMode.ts`), so they're off under your current `stripe` setting. That's why the flows feel blocked locally.
- **`scripts/e2e/cleanup-test-data.ts`:** the full FK-ordered delete graph, keyed on the `[E2E]` marker and `e2e-` emails. It skips `arbitration_notes` by design.
- **`supabase/seeds/demo_lifecycle.sql`:** stale and not reusable. It still seeds the retired `deals` ledger, its accounts can't sign in, and it's raw SQL that predates 0064, 0069 and 0103.
- **`scripts/simulate-cash-sale.ts`:** a Stripe-test pattern for a single sale. Not two-party.

### 1.4 What a persona needs to be fully usable

| Need | Field(s) | How the sandbox gets it |
|---|---|---|
| Can sign in | confirmed `auth.users` row + password | seed.sql |
| Not sent to `/onboarding` | `profiles.onboarding_completed_at` | seed.sql |
| Can trade at all | `region_code = 'AU'` (tradingEnabled) | seed.sql |
| List, sell, trade escrow | `identity_check_status = 'VERIFIED'` + `identity_check_name` | seed.sql, or the mock "identity verified" demo webhook (`fireIdentityWebhook`) for a fresh signup |
| Receive payout (`canReceiveFunds`) | `merchant_status = APPROVED`, `merchant_settlements_enabled`, `merchant_ref` | seed.sql. Under mock the fake ref works; under Stripe test it would fail at transfer |
| Buy / post collateral | a saved card (`payment_source_id`) | "Save demo card" under mock, via `ensureSavedCard` |
| Not banned | `fraud_banned_at` null | default |

The derived values must stay consistent: `items.seller_identity_verified`, `public_profiles.is_verified` and `set_row_currency_from_region`. All of these are triggers, so they stay consistent when listings and contracts are created through the app rather than inserted raw. That's the main reason the plan creates listings through the UI.

### 1.5 Visibility rules that constrain a shared-DB approach

`items_catalog_select` (0108) admits a non-owner only if the item is `hidden = false` (and not closed or banned), or if that member holds a live contract on it. A hidden fixture listing therefore can't be opened by the second persona until a contract exists. A private-deal invite (`/t/[token]`, 0103) is the one designed path that reaches a hidden card.

---

## 2. Options

### A. Separate cloud Supabase sandbox project + mock launcher (recommended)

Create "NoDitto Sandbox" in ap-southeast-2. Run `scripts/bootstrap-region-project.mjs --source kyyaq… --target <sandbox>`; it's read-only against the source and resumable. Then apply seed.sql there.

Pros:
- Full isolation. Fixture listings can be normal public listings, so every flow is reachable: catalog buy, offers, binder buys, propose trade, private deals, disputes, returns, reviews and admin.
- Free reset, and no production schema change.
- Production cron and custody never see the data.
- The e2e suite can move off production too.

Cons:
- A second project. The free tier allows 2 per org, and the org already has Studitory + NoDitto, so this may need a paid plan or another org.
- One-time setup: storage buckets, auth settings (email confirmation off), and pg_cron if not replayed.
- Schema drift must be kept in step. Re-run bootstrap after each migration, or apply new migrations to both.

### B. Dev-only data inside the shared database (fallback)

Keep the personas in the current database and keep fixture listings `hidden`. Reach them only through private-deal invites, or through contracts the scenario runner opens.

Pros: no new project, and it works today.

Cons:
- Catalog buy, offers, binder (shopfront) buys and propose-trade-from-listing stay untestable.
- Local mock-mode contracts land in what's likely production. The hourly `/api/jobs/cash-sale-payouts` there runs real Stripe against `mch_seed_*` refs, producing failed payouts in `/admin` and error_logs rows.
- pg_cron auto-completes fixture sales.
- Custody reconciliation counts mock "collected" funds the Stripe balance never received.

Making listings visible to personas only would need a production RLS change (`is_test` on profiles and items, plus catalog, fuzzy-suggest and facet filters). That's a lot of production surface for a test convenience. Rejected.

### C. Local Docker stack

Install the Supabase CLI and Docker, take a schema-only dump of `cardtrade` + storage + cron from production as the baseline, and run `supabase start`. Fully offline and free, but neither tool is installed and the migration history can't be replayed, so the baseline would be a hand-maintained dump. Heavier than A for the same isolation. Revisit only if a second cloud project is a blocker.

**Decision: A.** It's the only option where "visible only locally" is literally true, because the data lives only in a database only your local server talks to, and where every requested flow is reachable. If you decline a second project, B covers private deals only, and §4 notes what to change.

---

## 3. Recommended design

### 3.1 Files

| File | Purpose |
|---|---|
| `.env.sandbox.local` (gitignored by `.env*`) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` for the sandbox project, plus `SANDBOX_SUPABASE_REF=<ref>`. Nothing else |
| `scripts/sandbox/guard.ts` | Pure `assertSandboxEnv(env)`; rules in §3.2. Shared by every sandbox script and the launcher |
| `scripts/sandbox/env.mjs` | Loads `.env.local`, overlays `.env.sandbox.local`, applies the forced overrides (§3.3) and runs the guard. Used by the launcher and the Playwright config |
| `scripts/sandbox/dev.mjs` | Launcher: builds the env, then spawns `next dev -p 3000` (Windows-safe, `shell: true`, like `scripts/e2e/run-prod.mjs`) |
| `scripts/sandbox/seed.ts` | Applies `supabase/seed.sql` to the sandbox through the Management API (pattern: `scripts/apply-sql.mjs`, ref from `SANDBOX_SUPABASE_REF`, refused for the production ref) and confirms the personas' emails |
| `scripts/sandbox/reset.ts` | Deletes every contract, listing, conversation, offer, invite, notification, review and report involving a seed persona, then re-runs fixtures. Reuses the FK order from `cleanup-test-data.ts`, refactored into `scripts/lib/cleanupGraph.ts` with two selectors: the `[E2E]` marker (existing) and the persona-ids/`[SANDBOX]` marker (new). `arbitration_notes` stays untouched; the sandbox reset may also remove them, and only with `--include-notes`, since the database is disposable |
| `playwright.sandbox.config.ts` | `testDir: tests/sandbox`, `baseURL http://localhost:3000`, `reuseExistingServer: true` with no `webServer` start (you run `sandbox:dev`), no cleanup in global setup or teardown, `workers: 1`, desktop Chrome only. Its `globalSetup` calls the guard |
| `tests/sandbox/auth.setup.ts` | Signs in the personas and writes `playwright/.auth/sandbox/<name>.json` (separate from the e2e jars). Reuses `ensureFreshSession` |
| `tests/sandbox/fixtures.spec.ts` | Builds the standing fixture set (§3.4) through the UI |
| `tests/sandbox/scenarios/*.spec.ts` | One spec per target state (§3.5). Each prints the room URL and which persona to open it as |
| `tests/e2e/support/listings.ts` | Add an optional `kind: 'SINGLE' \| 'SHOPFRONT'` to `createListing` (default SINGLE, so e2e is unchanged) |
| `tests/e2e/support/marker.ts` | Add `SANDBOX_MARKER = '[SANDBOX]'` + `sandboxMarked()` |
| `tests/unit/sandboxGuard.test.ts` | Domain-project unit test for the guard |
| `package.json` | Scripts listed in §3.6 |

### 3.2 Safety guard rules (`assertSandboxEnv`)

The guard refuses, with a clear message, unless all of these hold:

1. `SANDBOX_SUPABASE_REF` is set, and the host of `NEXT_PUBLIC_SUPABASE_URL` is exactly `<SANDBOX_SUPABASE_REF>.supabase.co`, or `127.0.0.1` / `localhost` for a future option C.
2. That ref is not the production ref. The production ref `kyyaqnsmqthqmnhaqhzq` is hardcoded as a denylist; it's public in every client bundle, so it isn't a secret. This holds even if someone pastes the production URL into `.env.sandbox.local`.
3. `PAYMENTS_PROVIDER === 'mock'` after the overrides, and no value starting `sk_live_` is present in any `STRIPE_*` key.
4. `VERCEL_ENV` is unset and `NODE_ENV !== 'production'`.

There are deliberately no app-runtime changes. No dev route, no persona-switch endpoint, no Server Action, and no flag read by `app/` or `lib/`. Production code is untouched, so nothing can fail open in production.

### 3.3 Forced launcher overrides

Mirror `playwright.config.ts` `SERVER_ENV`, plus isolation:

- Payments: `PAYMENTS_PROVIDER=mock` and `ENABLE_PAYMENT_DEMO=true`. Every `STRIPE_*` and `NEXT_PUBLIC_STRIPE_*` key is deleted from the child env, so neither Stripe region discovery (`allConfiguredRegionCodes()` scans env) nor Stripe Identity can wake up.
- Webhooks: `WEBHOOK_URL=http://localhost:3000/api/webhooks/stripe`.
- Logging and auth: `ERROR_LOGGING=off` and `AUTH_RATE_LIMIT_PER_MINUTE=100`.
- Build: `NEXT_BUILD_DIR=.next-sandbox`, so the cache isn't shared with normal dev or e2e.
- Maps: keep your real `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, so you can pick real places by hand. Scenario specs stub Places themselves (`tests/e2e/support/places.ts`).
- Delete `JOBS_SECRET` and replace it with `SANDBOX_JOBS_SECRET` (random, generated into `.env.sandbox.local` on first seed). That stops `sandbox:jobs` from ever reusing the production bearer.

### 3.4 Standing fixtures

Created by `npm run sandbox:fixtures`, idempotent, titles prefixed `[SANDBOX]`. All of these are public listings in the sandbox, so every persona can reach them from the catalog.

| Owner | Listing | Exercises |
|---|---|---|
| alice (seller) | SINGLE "Charizard – buy me" $120 | catalog buy → cash sale |
| alice | SINGLE "Pikachu – make an offer" $80 | offers (offer, counter, accept → cash sale) |
| alice | SINGLE "Mewtwo – trade bait" $250 | trade (both DELIVERY and IN_PERSON variants) |
| alice | SHOPFRONT "Binder – bulk" from $5 | binder buy with line items; binder as the traded-for side |
| bob (buyer / trader) | SINGLE "Blastoise – counter side" $250 | the other side of the swap (equal FMV with alice's Mewtwo) |
| carol | SINGLE "Gengar" $60 | a third party for "item is now reserved" checks |
| bob, carol | saved demo card | via `ensureSavedCard` |

Personas are the existing seed.sql set. alice (seller), bob (buyer/trader), carol (second buyer), frank (admin), grace (support). Dave and erin are spares, and uma/victor are the US pair for region-mismatch checks. For onboarding tests, sign up a fresh `e2e-*@example.com` account and verify it with the mock identity demo button.

### 3.5 Scenarios

`npm run sandbox:scenario -- <name>` runs one spec in `tests/sandbox/scenarios/` with `--grep`. Each scenario drives the real UI and server actions, so the orchestrators, triggers, RLS, snapshots and fee calculation all run for real. When it finishes it prints, for example: `Open http://localhost:3000/sales/<id> as alice (seller) and bob (buyer)`.

The states are reached the same way the existing e2e specs do: demo webhook buttons, the record-shipment dialog, manual tracking delivered, and confirm handover.

| Scenario | End state | Built from |
|---|---|---|
| `cash-agreement` | Cash_Sale AGREEMENT, terms set by seller | cash-sale.spec steps |
| `cash-escrow` | ESCROW_HELD (paid via mock settle) | cash-sale.spec |
| `cash-in-transit` | IN_TRANSIT (shipment recorded) | cash-sale.spec |
| `cash-inspection` | INSPECTION (manual delivery confirmed) | cash-sale.spec |
| `cash-disputed` | DISPUTED with evidence | cash-sale.spec / journeys |
| `cash-return-pending` | RETURN_PENDING (grace resolves REFUND_BUYER) | admin.spec |
| `binder-sale` | shopfront Cash_Sale with two line items, AGREEMENT | new, mirrors `ContractLineItems` |
| `offer-countered` | Offer PENDING → COUNTERED | offers.spec |
| `trade-negotiating` | Trade NEGOTIATING (alice proposed) | trade.spec |
| `trade-locked-delivery` | COLLATERAL_LOCKED, DELIVERY | trade.spec + demo hold confirm |
| `trade-inspection-inperson` | INSPECTION via BOTH_HANDOVER_CONFIRMED | trade.spec |
| `deal-cash-invite` / `deal-swap-invite` | an unclaimed `/t/<token>` from alice, printed for bob | private-deal.spec |
| `completed-for-review` | COMPLETED cash sale, both can leave a review | cash-sale.spec |

Raw SQL is rejected for scenarios. The contract RPCs are service-role only and expect the orchestrator to have placed holds, frozen the identity snapshot and computed fees (see the `flutter.md` rule on not skipping guards). Rows hand-built to look like ESCROW_HELD would test a state the app can't produce. The trade-off is speed: a scenario takes 30–90 s rather than 1 s, which is fine for a manual set-up command.

Jobs: `npm run sandbox:jobs` POSTs/GETs `/api/jobs/cash-sale-payouts` and `/api/jobs/trade-inspections` on localhost:3000 with `SANDBOX_JOBS_SECRET`, so you can trigger payouts and timeouts on demand. Clock-dependent states (an inspection deadline lapsed) are the one exception where a targeted, guard-protected service-role `PATCH` of a deadline column (`inspection_deadline_at`) is acceptable. Keep it in a clearly named `scripts/sandbox/expireDeadline.ts`.

### 3.6 npm scripts

```
"sandbox:dev":       "node scripts/sandbox/dev.mjs",
"sandbox:seed":      "tsx scripts/sandbox/seed.ts",
"sandbox:fixtures":  "playwright test --config=playwright.sandbox.config.ts tests/sandbox/fixtures.spec.ts",
"sandbox:scenario":  "playwright test --config=playwright.sandbox.config.ts tests/sandbox/scenarios --grep",
"sandbox:reset":     "tsx scripts/sandbox/reset.ts",
"sandbox:jobs":      "tsx scripts/sandbox/runJobs.ts"
```

The tsx scripts load env through `scripts/sandbox/env.mjs`, not `--env-file=.env.local`, so they can't accidentally read the production URL.

### 3.7 Switching between the two users

Primary option: **two browser profiles side by side.** For example, a Chrome profile "NoDitto – alice" and one "NoDitto – bob", or Chrome and Edge. Sign in once in each with `password123`. Both windows are live at once, so Realtime contract rooms, chat and notifications can be watched updating on both sides. That matters more than a toggle. Incognito works for a quick second user but loses its session on close.

- **Zero-setup alternative:** `http://localhost:3000` for one persona and `http://127.0.0.1:3000` for the other, in the same browser. Cookies are host-scoped. It may need `allowedDevOrigins: ['127.0.0.1']` in `next.config.ts` for dev resources, and the Maps key's HTTP-referrer restriction must allow 127.0.0.1. Treat it as optional.
- **Rejected: a dev "switch persona" endpoint.** Any sign-in-as route or `'use server'` export is a reachable endpoint. A backdoor guarded only by env checks is the kind of thing that eventually ships enabled, and it adds production code for something two browser profiles already solve.

---

## 4. Implementation plan (for the coding step, after you approve option A)

- [ ] 0. **Manual, by you:** create the "NoDitto Sandbox" Supabase project (ap-southeast-2). Run `node scripts/bootstrap-region-project.mjs --source kyyaqnsmqthqmnhaqhzq --target <sandbox>`, then `--list-missing` and `--apply-file` for any hand-applied migrations it reports. Create the `item-images` (and avatar/attachment) storage buckets if bootstrap didn't, turn off email confirmation in Auth, and put the three sandbox keys + `SANDBOX_SUPABASE_REF` in `.env.sandbox.local`.
      Verify: Supabase dashboard shows the `cardtrade` schema with tables through 0133.
- [ ] 1. Add the `scripts/sandbox/guard.ts` pure guard and `tests/unit/sandboxGuard.test.ts`. Cover: production ref refused, URL/ref mismatch refused, `sk_live_` refused, `VERCEL_ENV` set refused, valid sandbox env accepted.
      Files: scripts/sandbox/guard.ts, tests/unit/sandboxGuard.test.ts
      Verify: `npx vitest --run tests/unit/sandboxGuard.test.ts` passes.
- [ ] 2. Add `scripts/sandbox/env.mjs` and the `scripts/sandbox/dev.mjs` launcher, plus the `sandbox:dev` script.
      Files: scripts/sandbox/env.mjs, scripts/sandbox/dev.mjs, package.json
      Verify: you run `npm run sandbox:dev`. Sign in as alice works, and `/profile` shows the mock demo identity controls. With `.env.sandbox.local` pointed at the production URL, it refuses to start.
- [ ] 3. Add `scripts/sandbox/seed.ts`, which applies `supabase/seed.sql` to the sandbox ref only, plus the `sandbox:seed` script.
      Files: scripts/sandbox/seed.ts, package.json
      Verify: `npm run sandbox:seed` reports 11 personas present, and running it twice is a no-op.
- [ ] 4. Extract the delete graph from `scripts/e2e/cleanup-test-data.ts` into `scripts/lib/cleanupGraph.ts` with marker and persona selectors. Keep `cleanup-test-data.ts` behaviour identical, then add `scripts/sandbox/reset.ts` and `sandbox:reset`.
      Files: scripts/lib/cleanupGraph.ts, scripts/e2e/cleanup-test-data.ts, scripts/sandbox/reset.ts, package.json
      Verify: `npm run sandbox:reset` against the sandbox empties persona contracts and listings. The e2e cleanup dry behaviour is unchanged (run it with the sandbox env, not production).
- [ ] 5. Add the `kind` option to `createListing` (SHOPFRONT tile + "from" price) and `sandboxMarked()` to `marker.ts`.
      Files: tests/e2e/support/listings.ts, tests/e2e/support/marker.ts
      Verify: the existing `tests/e2e/specs/listings.spec.ts` still passes in the sandbox (step 9).
- [ ] 6. Add `playwright.sandbox.config.ts`, `tests/sandbox/auth.setup.ts` and `tests/sandbox/fixtures.spec.ts` (fixture table §3.4), plus `sandbox:fixtures`.
      Files: playwright.sandbox.config.ts, tests/sandbox/auth.setup.ts, tests/sandbox/fixtures.spec.ts, package.json
      Verify: with `sandbox:dev` running, `npm run sandbox:fixtures` passes, and a second run creates no duplicates. As bob, the catalog shows alice's four `[SANDBOX]` listings.
- [ ] 7. Add the scenario specs (§3.5), reusing the e2e step sequences, plus `sandbox:scenario`.
      Files: tests/sandbox/scenarios/cashSale.spec.ts, trade.spec.ts, offers.spec.ts, deals.spec.ts, disputes.spec.ts, package.json
      Verify: `npm run sandbox:scenario -- cash-in-transit` prints a `/sales/<id>` URL that opens in IN_TRANSIT for both alice and bob. Repeat for each scenario.
- [ ] 8. Add `scripts/sandbox/runJobs.ts` and `scripts/sandbox/expireDeadline.ts`, plus `sandbox:jobs`.
      Verify: after `cash-inspection` + `expireDeadline`, `npm run sandbox:jobs` moves the sale to COMPLETED and queues and drains the mock payout.
- [ ] 9. Optional but recommended: point the e2e suite at the sandbox. `playwright.config.ts` loads env through `scripts/sandbox/env.mjs` and `globalSetup` calls the guard, so `npm run test:e2e` can never write to production again.
      Verify: `npm run test:e2e -- tests/e2e/specs/cash-sale.spec.ts` passes against the sandbox.
- [ ] 10. Docs: a short "Local two-party testing" section in `.kiro/steering/tech.md` covering the commands, the guard, and "never point sandbox scripts at production". Also correct the stale "migrations through 0124" line, since the tree is at 0133.

If you choose option B instead, skip 0, 2 and 9. The guard then has to allow the shared ref only for invite-based scenarios, fixtures stay `hidden = true`, and the catalog, offer and binder scenarios are dropped. Production payout drain and custody would still see the mock contracts, which is why B isn't recommended.

---

## 5. Open questions and decisions for you

1. **Is `kyyaqnsmqthqmnhaqhzq` the production database?** That's the inference, because it's the only NoDitto project. If it is:
   - Frank (`is_admin`) and grace (`is_support`) have committed passwords on production. Options, from least to most destructive: rotate those auth users' passwords; clear `is_admin` / `is_support` on them; delete all seed personas from production (after option A gives you a sandbox).
   - All of these are production writes, so I haven't made any. Tell me which you want.
   - Also check whether the GitHub repo `piggybear789/CardTrade` is public, which makes this urgent.
2. **A second Supabase project:** OK to create one, given a possible plan cost? The org already has two projects. If not, choose B or C knowing their limits.
3. **The e2e suite currently writes to this database:** it creates public `[E2E]` listings during runs and mock contracts. Move it to the sandbox (step 9)?
4. **Mock vs Stripe test mode in the sandbox:** mock is recommended for speed and the demo buttons. Real Stripe test (test card, Identity test mode, Connect test onboarding) per persona is possible later, but needs per-persona real `cus_` / `acct_` ids rather than seed.sql's fakes.
5. **`STRIPE_LIVE_KEY` / `STRIPE_PROD_KEY` in `.env.local`:** consider removing live keys from the dev env file entirely. The sandbox launcher strips them regardless.
