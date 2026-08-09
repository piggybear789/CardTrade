# E2E findings

Bugs and behaviours the Playwright suite surfaced in the running app, with the fix
and the assertion that now guards each one. Kept so a later change that reverts one
of these is recognisable as a regression rather than rediscovered from scratch.

Severity uses the same 0–4 scale as the UX audit convention: 4 = the user cannot
complete the task, 1 = cosmetic.

---

## F1 — Editing your profile appeared to do nothing (severity 3, FIXED)

**Symptom.** Change your display name, press Save. The editor closes, a "Profile
updated" toast appears — and the details card and the nav rail both keep showing the
OLD name. It only changes after a manual page reload.

**Cause.** `updateProfile` in `lib/actions/profile.ts` persisted the row and
returned `ok(...)` but never revalidated, and `ProfileForm` never refreshed the
router. Nothing told Next.js that any rendered output depended on that row. The
project's own convention for server actions is "authenticate, validate, delegate,
**revalidate**" — the last step was missing.

**Fix.** `revalidatePath('/', 'layout')` plus `revalidatePath('/sellers/<id>')`.
Layout scope, not page scope: the display name is rendered by `MarketplaceShell`'s
rail, which is layout chrome on every authenticated route, so revalidating
`/profile` alone would leave a stale name in the rail everywhere else.

**Guarded by.** `profile-and-payouts.spec.ts` → "edits the display name and
restores it". The assertion deliberately does **not** reload before reading the name
back: reloading would have passed against the bug and proved only that the UPDATE
statement ran.

**Why a unit test would not have caught it.** The action's return value was correct.
The defect was entirely in what the framework was told to re-render.

---

## F2 — Seed accounts could not sign in at all (severity 4, FIXED — environment)

**Symptom.** Every sign-in returned `500 unexpected_failure`, "Database error
querying schema". The form and credentials were correct; `crypt()` verified the
stored hash.

**Cause.** `supabase/seed.sql` inserts `auth.users` rows directly and leaves the
token columns NULL. GoTrue (v2.195) scans `confirmation_token`, `recovery_token`,
`email_change_token_new`, `email_change_token_current`, `email_change`,
`phone_change`, `phone_change_token` and `reauthentication_token` into Go `string`
fields, and a NULL is not scannable into a non-pointer string — so user lookup blew
up before any password comparison. The 500 was misleading: nothing was wrong with
the schema.

**Fix.** Those columns set to `''` for the seeded users. **`seed.sql` should set
them explicitly on insert** so a fresh database does not reproduce this.

**Note.** `phone` must stay NULL — it carries a UNIQUE constraint, so `''` on a
second user violates `users_phone_key`.

---

## F3 — Seed profiles had no trading region (severity 4 for tests, data)

`profiles.region_code` was NULL for all seven seeded members and
`items.location_country_code` was NULL for every seeded item, so
`checkRegionCompatibility` refused every contract and direct listing access. Set to
`'AU'`. `seed.sql` should write both, since 0065 made an absent region a refusal
rather than a pass.

Likewise `identity_check_status` was `'NONE'` — after 0069 that is the Identity_Gate,
so seeded "verified" sellers were not verified at all. Set to `'VERIFIED'`.

---

## F4 — Onboarding could not save a region, for ANY new member (severity 4, FIXED)

**Symptom.** The onboarding step "Where are you trading from?" with Australia
selected returns **"Your region could not be saved. Please retry."** Retrying never
helps.

**My first hypothesis was wrong, and worth keeping as a caution.** I guessed
`setTradingRegion` was refusing because a `merchant_ref` existed, and recorded that
here as "probable". Reading the action disproved it: the `region-locked` branch
requires `merchant_ref` **AND** an existing `region_code`, so a first-time set is
already allowed. The guessed cause also predicted the wrong message — `region-locked`
says "Your region is tied to your payout account", not "could not be saved".

**Actual cause.** The message comes from the `persistence-error` branch: the UPDATE
itself failed. Migration 0065 added `profiles.region_code` and this wizard step but
never granted UPDATE on the column to `authenticated`. Every other member-writable
column on `profiles` got an explicit grant — 0005/0006 (`display_name`,
`contact_email`), 0058 (`onboarding_completed_at`), 0066 (`avatar_path`) — and this
one was missed. `setTradingRegion` writes through the cookie-bound client, so it was
refused by column privilege.

**Severity 4, not 3.** Because 0065 also made an ABSENT region a refusal rather than a
pass, a member who could not clear this step could not buy, sell or trade at all. A
missing one-line grant closed the whole product to every new signup, while presenting
as a transient save failure.

**Fix.** Migration `0070_grant_trading_region_update.sql`: the grant, plus a
`before update of region_code` trigger mirroring the action's rules. The trigger is
not belt-and-braces — granting the column makes the action's guard bypassable by any
direct PATCH carrying the member's JWT, which would let someone move their region
after Connect onboarding and produce exactly the payout-to-the-wrong-country failure
the write-once rule exists to prevent.

**Verified.** Five trigger rules confirmed against the database: first set with a
`merchant_ref` present is ALLOWED (the mid-onboarding case), unknown region REFUSED,
change-while-connected REFUSED, clearing REFUSED, same-to-same ALLOWED so onboarding
stays idempotent.

**Guarded by.** `tests/e2e/specs/onboarding.spec.ts`, which signs up a NEW member and
walks the wizard. It asserts the absence of the exact failure copy, not merely that
the wizard advanced — advancing alone would still pass if the step were later changed
to continue on a failed write, leaving a member with no region and no way to know.

**Why nothing caught it.** Onboarding runs once, and every seeded profile already has
`onboarding_completed_at` set. No test had ever created a new account, so no test had
ever reached the step. That is now the only spec in the suite that signs up.

---

## F5 — Cold route compiles look exactly like broken behaviour (severity 0, TESTING NOTE)

Not a defect, recorded because it produced a **wrong** spec that then passed.

An early messages spec asserted that sending from a listing does *not* navigate.
The evidence was a 4-second probe: the page was still on the listing and the
composer was disabled. Both observations were accurate; the conclusion was not.
`MessageSellerButton` awaits `getOrCreateConversation`, then `sendMessage`, then
pushes to `/messages/<id>`, and `disabled={isPending}` is the PENDING state, not a
success confirmation. The push was queued behind `next dev` compiling
`/messages/[id]` for the first time, which took longer than the probe waited.

**Consequence for the suite.** First-visit navigations get a 20–30s budget
(`COLD_ROUTE` in `messages.spec.ts`). Those numbers are the cost of a dev server,
not flakiness insurance — trimming them to "reasonable" values reintroduces the
false conclusion.

**The general trap:** a disabled control plus an unchanged URL is indistinguishable
between "this flow does not navigate" and "this flow has not finished". Assert on
the destination with a generous timeout rather than inferring intent from a
snapshot.

---

## F6 - `handleInlineSend` swallowed a failed send (severity 2, FIXED)

`components/messages/MessageSellerButton.tsx` handles the `!result.ok` case for
`getOrCreateConversation`, but the following `await sendMessage(...)` is
unguarded and its result is never checked. If it rejects, the `startTransition`
callback rejects, `isPending` never clears, and the composer stays disabled with
no error shown and no message sent — the same dead-end state F5 mimicked.

`handleClick` above it does surface its failure, so this is an inconsistency
within one component rather than a missing convention.

**Fix.** Check `sendMessage`'s result and set `error` on failure, matching
`handleClick`. Not yet done: it needs a way to force the failure to write a test
against, which means a fault-injection seam the messages action does not have.

---

## F7 — "Mark all read" left the header badge saying "1 unread" (severity 3, FIXED)

**Symptom.** On /notifications, press "Mark all read". The list visibly greys out
and the button disables — and the bell in the header still reads
"Notifications, 1 unread". It only agrees after a full page reload. A member either
clicks again or concludes the action failed.

**Cause.** `lib/realtime/useNotifications.ts` subscribed to **INSERT only**, and
the hook is mounted TWICE per page: once by `NotificationBell` in the header, once
by `NotificationCenter` on the notifications page. Those are separate React states.
`handleMarkAll` calls `markAllReadLocal()` on the centre's instance, and with no
UPDATE subscription there was no channel through which the bell's instance could
ever learn the rows had been read. The write itself was fine — a reload showed the
correct count, which is what made it look cosmetic rather than a state bug.

**Fix.** Subscribe to UPDATE alongside INSERT and merge `read_at` transitions into
local state. That makes the hook's state track the TABLE rather than whichever
instance performed the mutation — which is what its own doc comment already
claimed — and fixes the same divergence for a read performed in another tab or on
another device. Updates are MERGED only into rows the instance already holds, so an
event for a row outside its 50-row window is ignored rather than inserted out of
order.

`cardtrade.notifications` was already published with `pubupdate = true` and carries
`REPLICA IDENTITY FULL`, so no migration was needed.

**Guarded by.** `notifications.spec.ts` → "a message raises a notification, and
marking read clears it". It asserts on the bell's ACCESSIBLE NAME rather than a
badge element, because the name is what a screen-reader user receives; a badge that
looks right while the name still says "1 unread" is still broken. It then reloads
and re-asserts, so an optimistic-only fix cannot pass.

**Two traps this test had to route around.** The bell exists twice in the DOM
(desktop header + `MobileBottomNav`); one is always `display:none`, and
`toHaveCount(0)` counts hidden nodes, so the assertion is scoped to
`visible=true`. And "Mark all read" is always rendered, carrying
`disabled={isPending || unreadCount === 0}` — so its ENABLEMENT is the unread
signal, never its presence.

---

## F8 — Every page title is a duplicate heading (severity 0, TESTING NOTE)

`MarketplaceShell` renders the page title as an `<h1>` twice: once `sr-only
lg:hidden` to keep the document outline correct below `lg`, and once inside the
desktop rail. Most pages then repeat it as an `<h2>` via `SectionHeader`.

So `getByRole('heading', { name: <page title> })` is ambiguous on every page in the
app, including ones whose h1 and h2 differ (`/notifications` is "Notifications" +
"Activity" and still matches twice). `.first()` on a page title is mandatory here,
not defensive — there is no page where checking is worthwhile.

---

## F9 — A buyer with no card was told the item was gone (severity 3, FIXED)

**Symptom.** Accept an offer as a buyer with no saved card. Toast:
**"Could not open the sale — the item may no longer be available."** The item is
fine. What is missing is a card, which is one click away — but nothing says so, so
the buyer abandons a purchase they could complete.

**Cause, in two halves that hid each other.**

`respondToOffer` returns `{ error: 'sale-failed', detail: <CashSaleError> }`, so the
precise reason WAS available. `OffersSection` then threw `detail` away and
substituted a guess for every `sale-failed`.

While fixing that, `BuyButton`'s own map turned out to be dead code: it was keyed in
kebab-case (`'no-payment-method'`, `'item-unavailable'`) while `CashSaleError` is
SCREAMING_SNAKE. Not one key had ever matched. It looked correct because the action
also returns a `message` that was read first.

So two surfaces open the same contract, both had their own refusal map, and both
were wrong in different directions.

**Fix.** One definition in `lib/cashSaleErrors.ts`, keyed to `CashSaleError`, used
by both surfaces. Operator-side codes (`PAYOUT_FAILED`, `REFUND_FAILED`, …) are
deliberately left unmapped and fall through to the server's own message: no member
action resolves them, so inventing reassuring copy would bury a problem.

**Guarded by.** `tests/unit/cashSaleErrors.test.ts` — 9 assertions, including that
every key is SCREAMING_SNAKE (the original bug in one line), that the no-card copy
names a card and does NOT say "no longer", that identity and payability refusals
stay distinct (0069), and that a bare code never reaches the member.

**Deliberately NOT an e2e test.** A saved card persists and teardown does not remove
payment methods, so "this member has no card" is a state that exists exactly once
per environment. The e2e version passed once and then asserted the opposite of its
own name for every run after. The mapping is pure; it belongs in a unit test.

---

## F10 — `waitForLoadState('networkidle')` never settles here (severity 0, TESTING NOTE)

Removed from all 9 e2e files (63 call sites).

`networkidle` waits for 500ms with no in-flight requests. Every authenticated page
holds a Supabase Realtime WebSocket — the notification bell subscribes on mount —
so there is no such quiet period. The wait can never resolve.

**Why it mattered more than a slow test.** The failure surfaced as
`page.waitForLoadState: Test ended` ninety seconds into a test whose real work
finished in eight. That reads as the application hanging. A test that accuses the
code under test of a fault it does not have is worse than no test.

It survived as long as it did because it only bites when the socket happens to stay
busy past the following assertion.

See `tests/e2e/support/waiting.ts` for what to use instead.

---

## F11 — The cleanup script hit a circular foreign key (severity 2, FIXED — suite)

`scripts/e2e/cleanup-test-data.ts` failed with 23503, "still referenced from table
cash_sales", once a spec accepted an offer — the only flow that opens a contract
room on a MARKED item.

`conversations` and `cash_sales` reference **each other**:

| edge | on delete |
| --- | --- |
| `conversations.cash_sale_id → cash_sales` | CASCADE (harmless) |
| `cash_sales.conversation_id → conversations` | **NO ACTION** — blocks |
| `cash_sales.dispute_conversation_id → conversations` | SET NULL (harmless) |
| `trades.conversation_id → conversations` | SET NULL (harmless) |

No delete ORDER resolves a cycle. Fixed by clearing `cash_sales.conversation_id`
first (`nullifyConversationLinks`); the column is nullable because a contract exists
before its room does. The blocking edge was absent from the script's own FK graph,
which is now corrected — that graph is the only reason the rest of the ordering is
right, so a gap in it is a latent failure rather than a documentation nit.

---

## F12 — A search page echoes its own query (severity 0, TESTING NOTE)

Asserting `getByText(title)).toHaveCount(0)` on `/listings?q=<title>` to prove a
reserved item left the catalog FAILED with 2 matches — the search field's value and
the "no results" copy both contain the query.

Assert on the absence of a **link**. Only a link is a route into the listing; the
title as text may be the page repeating what was asked for.

---

## F13 - No contract needing an address can complete without a Maps key (severity 3, PARTLY FIXED)

The most consequential finding, and it is a product dependency rather than a test
problem.

**Symptom.** Agreeing DELIVERY handover terms is refused with **"Select a suggested
delivery address before saving."** even when the address typed is complete and
valid.

**Cause.** The delivery address must be a place RESOLVED by Google Places. That is
correct for a residential address — a free-text string is not a place, and 0065's
region model plus the carrier both need a real one. But `PlacePicker` falls back to a
plain text input when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is absent, and that fallback
can only ever produce `placeId: 'text:…'`, which the terms validator rejects.

**Why the suite runs Maps-less.** `Based near` is required on the listing form, and
driving a live Places autocomplete made every listing test depend on a Google
response — an earlier attempt hung on clicking a provider-rendered option until the
test timed out. Blanking the key made listing creation deterministic, and that trade
is documented in `playwright.config.ts`.

**The consequence is larger than coverage.** Without a Maps key, no contract that
needs an address can be completed AT ALL — by a test or by a person. Everything past
terms-agreement is unreachable behind it: escrow settlement, shipping, receipt,
acceptance, release. Six steps of `cash-sale.spec.ts` are `test.fixme` for this one
reason, and they are written out in full rather than deleted so the gap appears in
every run's summary instead of looking like something never scoped.

**Preferred unblock.** Intercept the Places request with `page.route()` and serve a
fixed suggestion. Deterministic, offline, and it exercises the real resolved-place
path — at the cost of pinning the test to the provider's response shape. The
alternative (run with a real key) reintroduces a live dependency in every run.

**Worth deciding separately:** whether a deployment with no Maps key should refuse to
render the delivery path at all, rather than offering a field that cannot be
satisfied. Today it looks fillable and is not.

---

## F14 - A shared cookie jar goes stale mid-run (severity 3, FIXED)

**Symptom.** Nineteen tests across six files failed in a full run while every one of
those files passed on its own. The failing set was exactly the Alice-dependent specs,
and the pages rendered a signed-out nav.

**TWO WRONG DIAGNOSES BEFORE THE RIGHT ONE.** Both are recorded because each was
plausible, each fitted the evidence, and each cost a full verification cycle.

*Wrong #1: `next dev` degrading under a long run.* It fitted well - failures only in
full runs, `ECONNRESET` in the log, a `locator.check()` timing out at 90s. Disproved by
building the app and running against `next start`: the same nineteen failed
identically.

*Wrong #2: the sign-out test revoking the shared session.* `auth-and-navigation.spec.ts`
signed out as Alice from her stored jar, and signing out revokes the refresh token
server-side. The ordering fitted perfectly - every failing file ran after that one
alphabetically. Fixing it changed nothing.

**Actual cause.** The project runs `refresh_token_rotation_enabled: true` with
`security_refresh_token_reuse_interval: 10` seconds. `auth.setup.ts` saves a jar holding
a refresh token; the first context to refresh retires it and receives a replacement *in
that context only*, while the file on disk still holds the retired one. Later contexts
replay it, and a replay outside the 10-second window is treated as token theft, which
revokes the whole family. A per-file run never sees it because setup re-authenticates
seconds beforehand.

**Fix.** `tests/e2e/support/auth.ts` -> `ensureFreshSessions`, called from
`test.beforeAll` in every spec that authenticates from a stored jar. It probes
`/profile`, re-signs-in if bounced, and always re-saves the jar so the rotated token
replaces the retired one on disk. Cheap when the jar is good, self-healing when it is
not, and it covers every cause rather than only the diagnosed one - expiry, rotation, an
accidental sign-out, a member reseeded.

**Verified.** Full desktop suite: **77 passed, 0 failed, 6 skipped**, in 4.9 minutes
against a production server versus 14.7 against dev.

**The lesson worth keeping:** a stored session is a snapshot of a ROTATING credential, so
treating it as a durable fixture is wrong by construction. Both wrong diagnoses came from
asking *which test* broke it rather than whether the artefact was ever stable.

---

## F18 - `NEXT_PUBLIC_*` in `webServer.env` is ignored by `next start` (severity 0, TESTING NOTE)

The final five failures of that run, and a genuinely confusing pair of symptoms.

`NEXT_PUBLIC_*` variables are **inlined into the client bundle at build time**. Setting
one in Playwright's `webServer.env` works for `next dev`, which compiles on demand after
the server has the environment, and does nothing for `next start`, which serves a bundle
whose values were fixed when `next build` ran.

The suite blanks `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` so `PlacePicker` uses its free-text
fallback. Against a production build made with the real key in `.env.local`, listing
creation failed with `combobox "Based near *" [invalid]` and "Add where this listing is
based" - the field was a live Places autocomplete, so typed text never resolved to a
place.

**Fix.** `scripts/e2e/build-for-e2e.mjs` bakes the client env into the build, and
`npm run test:e2e:prod` (`scripts/e2e/run-prod.mjs`) chains build and run so the two
cannot drift.

**A related trap in the same area.** `next dev` and `next build` share `.next`, so
running anything in dev mode - including the inspector - invalidates a production build.
`next start` then exits with `next-start-no-build-id` and Playwright reports "webServer
was not able to start", which looks nothing like "your build is stale". One run reported
**0 failures** purely because no test executed. The runner always rebuilds, so it cannot
recur.

---

## F15 - Sign-in could put the password in the URL (severity 3, FIXED)

Found incidentally: an auth-setup run failed having landed on

```
/sign-in?email=alice%40example.com&password=password123
```

**Cause.** `AuthForm` is a Client Component whose submit is handled in JS, and its
`<form>` carries no `action`. A submit that lands before hydration therefore
degrades to the browser default — a native **GET** to the current URL — which
serialises every field into the query string. The password then reaches the browser
history, the server access log, and any referrer.

It is a narrow window, but it is not only a test artefact: a slow connection, a
cached HTML shell served before the JS, or a blocked bundle produces the same
submit. The user gets a page that looks like a failed login while their password
sits in the address bar.

**Fix options, in order of preference.**
1. Give the form a Server Action as its `action`, so a pre-hydration submit POSTs
   and still works. Progressive enhancement, and it removes the window rather than
   narrowing it.
2. Failing that, `method="post"` at minimum, so the fields are never in a URL even
   when the handler has not attached.
3. Disable the submit control until hydrated. Prevents the leak but makes the form
   unusable without JS.

**Interim guard.** `tests/e2e/auth.setup.ts` waits for `load` (not
`domcontentloaded`) before filling, and asserts the URL never matches
`/[?&]password=/` — so if this recurs the failure names the real cause instead of
reporting a redirect timeout thirty seconds later.

---

## F16 - Wizard advance buttons were inconsistently labelled (severity 1, FIXED)

The onboarding wizard advances with "Get started", then "Continue", then "Continue",
then **"Next"**, then "Skip for now". Steps 2–3 and step 4 disagree for no reason
visible in the flow.

Left as-is in the spec — each step is matched by its real label rather than by one
loose pattern — so the inconsistency stays recorded rather than absorbed by a
`/Continue|Next/` matcher that would make it invisible.

---

## F17 — The Next.js dev overlay pollutes role queries (severity 0, TESTING NOTE)

`getByRole('button', { name: 'Next' })` matched TWO controls on `/onboarding`: the
wizard's button and the **Next.js dev-tools overlay** that `next dev` injects into
the bottom-left of every page. Using `.last()` clicked the overlay and opened its
menu while the wizard sat untouched — a failure that reads as the button not working.

Scope interactions to the surface under test (`getByRole('dialog').getByRole(...)`).
The overlay does not exist in a production build, which is one more argument for F14.

---

## Data hygiene — cleanup could not see content between seeded members

Not a product bug; a gap in the suite's own teardown, fixed.

`scripts/e2e/cleanup-test-data.ts` walked outward from `[E2E]`-marked profiles and
items. A spec that signs in as two SEEDED members and sends a message or makes an
offer creates rows whose every foreign key points at a fixture row, so nothing
matched and nothing was deleted. Fifty-three notifications and a dozen
conversations had accumulated on Alice's account across runs.

Fixed by marking the CONTENT and matching it directly: `messages.body` and
`offers.message` carry the marker, `notifications.body` is matched by containment
because a notification quotes the message it announces, and conversations are swept
only when left EMPTY so a thread holding real demo messages survives.

---

## F19 - Traders could not see what the other was putting up (severity 4, FIXED)

**Symptom.** In the trade room's exchange panel, the counterparty column read
**"They are putting up no goods."** and the header valued the trade
`\.00 = \.00` - while `trade_items` held both rows, correctly attributed, and
the trade was asking that same trader to authorise collateral against them.

**Cause.** `items_catalog_select` was the ONLY SELECT policy on `cardtrade.items`:

    (status = 'AVAILABLE' and closed_at is null) or owner_id = auth.uid()

Correct for a catalog - availability is visibility, and an owner sees their own rows.
But opening a trade flips BOTH items to RESERVED and neither trader owns the other's,
so from that moment each of them could no longer read the other side. The room reads
the bundle through the cookie-bound client, so the rows came back missing and the
panel rendered its empty state.

**Severity 4, not a cosmetic bug.** It is not a blank space, it is a confident and
WRONG sentence about the other side of a deal, shown at the exact moment someone is
deciding whether to authorise money against it. A trader could cancel a good trade, or
proceed believing they are receiving nothing.

**Fix.** Migration `0071_trade_participants_can_read_bundled_items.sql` adds a
participant-scoped SELECT policy, covering both `trade_items` bundles and the two
legacy primary columns a pre-0015 trade uses.

**Verified both directions, as the `authenticated` role with forged JWT claims:**
Alice can now read Bob's RESERVED item she does not own (`alice_owns: false`), and
Carol - party to nothing - sees `0` of the same rows. Confirmed in the UI too: the
header changed from `= \.00` to `= \.00` and both items now render.

**Why a policy and not a service-role read.** Reading with the admin client would fix
one surface and leave the next to rediscover it. The right statement is "a trade
participant may see that trade's goods", and RLS is where that belongs.

---

## F20 - The whole webhook pipeline was never being tested (severity 3, FIXED - suite)

**Symptom.** No trade could leave `COLLATERAL_PENDING`. The demo panel's "Confirm
collateral holds" produced NO toast at all - not success, not failure - and the room
simply sat there.

**Cause.** `.env.local` sets `WEBHOOK_URL=http://localhost:3000/...` for a
developer's normal `npm run dev`, and this suite deliberately runs on **3100** so it
never collides with one. Nothing overrode it, so every simulated webhook was POSTed to
port 3000 where nothing was listening.

**How it was found, since the UI said nothing.** The database did:
`pre_auth_holds` had both rows and `webhook_logs` had **zero**. Holds were being
placed correctly; the confirmation was never arriving.

**Consequence worth stating plainly.** The demo controls exist to exercise the real
translate -> map -> dispatch -> log path. With this misconfigured, that path - the
webhook pipeline the escrow depends on - was never exercised by any test. Collateral,
and by extension the disputes and fraud flows that ride the same machinery, were
untestable and untested.

**Fix.** `WEBHOOK_URL` is set to this server's own port in both Playwright configs.
Verified: the same flow now writes a `webhook_logs` row and the trade reaches
`COLLATERAL_LOCKED`.

**The silence is its own finding.** `fireTradeWebhook`'s caller does not guard a
delivery failure, so a dead delivery target looked identical to nothing having been
clicked - the same unguarded-transition shape as F6.

---

## F21 - The trade room does not react to its own webhook (severity 2, OPEN)

After both traders confirm collateral the state genuinely advances -
`trades.state = 'COLLATERAL_LOCKED'`, two `pre_auth_holds` rows, a `webhook_logs`
row - but the room keeps showing the "Collateral pending" badge and the holds step
until the page is fetched again.

The webhook is a server-to-server delivery, so nothing in the open tab knows to
re-render. `useTradeRealtime` subscribes to the trade row, so this is worth a proper
look: either the subscription is not covering this transition or the badge is read from
a server snapshot the subscription does not refresh. Same family as F7, where the
notification bell kept a stale count because the only cross-instance channel ignored
UPDATEs.

A trader who has just authorised money watches a screen that says nothing happened.

`trade.spec.ts` reloads before asserting, with a comment pointing here, so the gap is
recorded rather than hidden by the reload.

---

## F22 - A Playwright click cannot open the trade room's Demo tab (severity 1, TESTING NOTE)

The Demo tab is a visible, enabled `role="tab"` with `pointer-events: auto` and
nothing covering it - confirmed via `elementFromPoint` returning the element itself -
yet both a normal and a `force: true` Playwright click time out on it. A synthetic
`dispatchEvent('click')` works immediately.

Used in `trade.spec.ts` with the reasoning recorded inline. Worth a look before adding
more tab-driven assertions: something about that tab strip defeats Playwright's
actionability wait, and whatever it is may also affect assistive tech.

---

## F23 - A whole contract tab vanished because it was wrapped in a component (severity 4, FIXED)

**Symptom.** On a DELIVERY trade past collateral the room says *"Both traders add a
delivery address - neither of you can post until both addresses are on the contract"*
and offers only `Record shipment` and `Item never arrived`. There was no address
control anywhere - confirmed by searching the whole `documentElement.innerHTML`, not
just the visible area. **The trade could not be completed.**

**Cause.** `ContractDetailList` selects its rows with an exact identity check:

    isValidElement(child) && child.type === ContractDetailRow

The trade room's Terms row was rendered as `<TradeTermsRow />` - a wrapper component
that RETURNS a `ContractDetailRow`. Its element type is `TradeTermsRow`, so it never
matched, and the filter dropped it **without a word**. The Terms tab simply did not
exist, and the `DeliveryAddressPanel` lives inside it.

**Why it went unnoticed.** Every other row is written inline, so the wrapper was the
only one affected; the tab strip looked complete (Exchange, Stripe, Collateral, History,
Demo) because a missing tab looks exactly like a tab that was never specified.

**Fix, in two parts.**
1. `TradeTermsRow` is now CALLED as a function, so the child is the
   `ContractDetailRow` it returns. Verified: the tab strip is now Exchange, **Terms**,
   Stripe, Collateral, History, Demo.
2. `ContractDetailList` logs an error in development for any child it drops, naming
   the wrapper mistake. The silence is what made this expensive, and the guard means the
   next wrapped row announces itself instead of deleting a tab.

**STILL OPEN, and tracked below:** with the Terms tab restored, its panel renders the
postage rows and the footnote but the `DeliveryAddressPanel` itself is still absent,
so the address step remains unreachable. Established so far: the trade is
`handover_method = 'DELIVERY'` and `COLLATERAL_LOCKED` with neither address set; the
panel is gated on an explicit `trade.handover_method === 'DELIVERY'`; the summary text
comes from the ELSE branch of a different ternary, so it reads "Delivery" even when the
column is absent; the rail's address step does require the DELIVERY branch; and the
panel's own always-rendered label ("Your delivery address") appears nowhere in the DOM,
so the component is not mounting rather than merely rendering read-only. The page's own
`trades` select lists 8 columns and does NOT include `handover_method`, while
`useTradeRealtime` selects `*` - so which row reaches the component, and when, is the
next thing to pin down.

**NOW FULLY FIXED — see F40 below.** The `DeliveryAddressPanel` was inside the
`areHandoverDetailsFilled(trade)` truthy branch, which requires `delivery_cost_cents !=
null`. A DELIVERY trade proposed without setting postage has `delivery_cost_cents = null`,
so the code fell into the falsy branch (a placeholder text) and the address panel never
mounted. F40 moved the panel outside the `areHandoverDetailsFilled` gate so it renders
unconditionally for any DELIVERY trade. The test now clicks the "Terms" tab before
looking for the button (the tab strip is single-selection, Exchange is open by default).

---

## F24 - Onboarding was mandatory to BROWSE, and had no exit (severity 3, FIXED)

**Reported by the user:** *"Don't require the onboarding flow to just browse listings...
You can't drop out of onboarding to sign-out or browse."*

**Two decisions that combined badly.**

1. `middleware.ts` treated `/listings` as an onboarding entry point, so a signed-in
   member who clicked the catalog was redirected into the wizard. The stated reason was
   that a returning member "cannot silently skip the flow".
2. `app/onboarding/page.tsx` rendered a dialog with `showClose={false}` and
   `onOpenChange={() => undefined}`, and offered no link away and no sign-out.

Separately each looks defensible. Together they mean **signing in makes the site less
usable than not signing in**: the catalog is public to anonymous visitors, so the one
person who could not browse it was the one who had just created an account. The page's
own header comment claimed a member "completes the short flow or signs out" - but
signing out was never offered, so the honest description was *completes it or leaves*.

**Fix.** The gate now covers `isProtected()` paths only, so browsing and item pages are
open while everything that opens a contract stays gated - nothing about the money path
is relaxed. The wizard gained a persistent "Not now - browse listings" link and a sign
out control on every step, and the sign-out escape routes to `/listings` even if the
call fails, because being unable to sign out must not mean being unable to leave.

**Pinned by** two tests in `onboarding.spec.ts`: one browses the catalog without
finishing and then asserts `/offers` STILL redirects; one asserts both exits are present
on two different steps and that following one does not bounce back.

---

## F25 - A missing profile row bricked the account, and reported it as a JSON error (severity 4, FIXED)

**Reported by the user:** *"I keep getting error: cannot coerce json to a single object."*

**This was one bug with F24, not a separate annoyance.** A `profiles` row is created at
the two moments a member is born - password sign-up, and the OAuth callback via
`ensureProfile`. Nothing repaired a session whose row went missing afterwards, and that
state is reachable: an already-signed-in member never passes through the callback again.
The result:

- middleware finds no `onboarding_completed_at`, so it sends them to the wizard;
- `completeOnboarding` did `.update(...).select().single()`, which matched **zero rows**;
- PostgREST answered `PGRST116`, whose message is *"Cannot coerce the result to a single
  JSON object"*, and the action passed `error.message` to the UI verbatim;
- with no browse link and no sign-out (F24), there was nowhere to go.

**A real account was in this state**, found in the database rather than the UI:
`wanton.wonton396@gmail.com` held an active session and an OAuth identity with no
profile row. Nine of twenty auth users had none - the app's profiles had all been
recreated on 08-06/08-07 while their auth users survived.

**Fix, at the right layer - and the first attempt was at the wrong one.** The repair
initially went into `completeOnboarding`; the test proved that insufficient, because the
username step is client-only and the first write is actually `setTradingRegion` at the
REGION step, which would still have hit a missing row. The repair now lives in a new
`app/onboarding/layout.tsx`, which every step is downstream of, so the row is guaranteed
before the member touches anything. `completeOnboarding` keeps its own repair as defence
in depth. The nine orphaned accounts were backfilled.

**Pinned by** a test that DELETES the profile row of a freshly signed-up member - the
only honest way to arrange a state no screen can reach, which is precisely why it went
untested - then asserts the row is re-provisioned on load, that the words "coerce" and
"single JSON object" appear nowhere, and that a real write (the region step) then
succeeds.

---

## F26 - Raw driver errors were shown to members, and the good copy was unreachable (severity 2, FIXED)

Eleven call sites across `lib/actions/` read:

    error?.message ?? 'Failed to create item'

**The precedence is inverted.** The readable sentence is the fallback for the driver's
message, so it appears only when there is NO error - exactly the case it was not written
for. Every real failure showed Postgres or PostgREST's own words instead, which is how a
member came to read a sentence about JSON coercion.

**Fix.** `lib/actions/writeFailure.ts` maps error CODES (not messages) to member-facing
copy - `PGRST116`, plus the unique / foreign-key / not-null / check / privilege
violations - and takes each site's specific sentence as the fallback for anything it
cannot usefully translate. All eleven sites now call it, so no raw driver text reaches a
member while the specific copy is kept. An unrecognised failure still says plainly that
something went wrong rather than inventing an explanation.

---

## F27 - A stray auth trigger writes another project's table (severity 1, DOCUMENTED, deliberately not changed)

`auth.users` carries `on_auth_user_created -> public.handle_new_user()`, which inserts
into **`public.profiles (user_id)`**. This application's table is
**`cardtrade.profiles (id)`** - the trigger belongs to a different project sharing this
Supabase instance (the project is named "Pokedle"). It has never created a profile for
this app; the 11 rows that existed came from `seed.sql`.

Checked and harmless: `public.profiles` exists, and `profiles_pkey` is a unique index on
`user_id`, so the `on conflict (user_id) do nothing` clause resolves and sign-up
succeeds. Had that index been absent, every sign-up would have failed with *"Database
error saving new user"*.

**Left in place on purpose** - it may serve the other project, and dropping another
application's trigger is not this suite's call. Recorded because it is a trap: it looks
exactly like the thing that provisions profiles here, and it is not.

---

## F46 — Internal terminology "Friction_Tax" shown to members (severity 3, FIXED)

**Principle:** Match Between System and Real World (H2)

**Location:** `components/contract/DittoBondExplainer.tsx:104`

**User impact:** A member reading the trade collateral explainer sees "Friction_Tax" —
a code identifier with underscores and internal capitalisation — where they expect
a description of what happens in a dispute. It reads as a developer debug string left
in a production screen, which erodes trust in the platform at the moment it is
explaining how their money is protected.

**Fix.** Replaced "A condition finding can capture a fixed $20 Friction_Tax" with
"A condition dispute can capture a fixed $20 resolution fee" — plain language that
describes the same mechanism without exposing internal naming.

---

## F47 — CashSaleProtectionExplainer claims listing requires payout onboarding (severity 3, FIXED)

**Principle:** Match Between System and Real World (H2)

**Location:** `components/contract/DittoBondExplainer.tsx` (CashSaleProtectionExplainer
final paragraph)

**User impact:** The buyer protection explainer states "Publishing a listing requires
completing Stripe payout onboarding", which is factually wrong since migration 0069.
The gate is the Identity_Gate — a Stripe Identity check (photo ID + selfie). Payout
setup is a separate, independent step that gates only receiving money. A member who
reads this and then notices their seller has not completed payout onboarding may
wrongly conclude the seller is unverified, damaging trust in a correct transaction.

**Fix.** Reworded to "Publishing a listing requires a Stripe identity check — a photo
ID and a selfie — so the person you are buying from is identifiable and can be
pursued." Aligns with the actual gate documented in product.md.

---

## F48 — Two search inputs with identical accessible name (severity 2, FIXED)

**Principle:** Accessibility (H13)

**Location:** `components/layout/HeaderSearch.tsx`, `components/layout/SiteMenu.tsx`,
`components/layout/SiteHeader.tsx`

**User impact:** The site header mounts `<HeaderSearch>` (hidden below `sm` via
`hidden sm:flex`) and the burger menu panel mounts a second `<HeaderSearch>` (shown
below `sm` inside the open panel). Both render an `<input aria-label="Search listings">`
and a `<form role="search">`. When the menu is open on a mobile viewport, screen
readers announce two identical landmarks and two identical form controls — the user
cannot distinguish which they are interacting with.

**Fix.** Added an `ariaLabel` prop to `HeaderSearch` defaulting to `"Search listings"`.
The SiteMenu instance now passes `ariaLabel="Search listings from menu"` so the two
`<input>` elements carry distinct accessible names. The `<form role="search">` landmark
is left unnamed — its role is sufficient for navigation — keeping `getByLabel` matches
confined to the input elements as existing tests expect.

---

## F49 — Member-facing copy uses "escrow" for contracts (severity 2, FIXED)

**Principle:** Match Between System and Real World (H2)

**Location:** `components/layout/marketplace-nav-config.ts:193`

**User impact:** The mobile navigation hub sheet for "Contracts" describes its contents
as "Live escrow rooms for cash, trades, and private deals." Per the product rules,
member-facing copy must never say "escrow" for trades — the platform holds a claim (an
uncaptured card authorisation), not funds, and "escrow" implies a segregated custodial
arrangement that does not exist. For cash sales the funds are in the platform balance,
commingled, which is also not a traditional escrow. Using the term creates a regulatory
and trust expectation the platform cannot meet.

**Fix.** Changed to "Active contracts for purchases, trades and deals." — accurate,
neutral, and makes no custodial claim.

---

## F50 — Onboarding wizard has no progress indicator (severity 2, FIXED)

**Principle:** Visibility of System Status (H1)

**Location:** `app/onboarding/page.tsx`

**User impact:** A 4-step wizard (welcome, username, region, intent, plus an optional
card-setup step) gives no visual cue of how many steps remain. A member who enters
their username on step 2 does not know whether they are 20% or 80% through the flow.
This is a peer-to-peer marketplace where completing onboarding gates the ability to
buy or sell — perceived length uncertainty increases drop-off.

**Fix.** Added a pill-based progress bar (`h-1.5` rounded segments) above the dialog
content from step 2 onward (step 1 is welcome and has no back button, so counting
before commitment is noise). Each pill expands and fills with the primary colour as
the member progresses. Hidden on the welcome step.

**Two corrections made when the rail was reviewed, both worth recording because each
turned an indicator into misinformation.**

1. It counted `STEPS`, the array the BACK BUTTON walks, which deliberately omits
   `card-setup`. `STEPS.indexOf('card-setup')` is therefore `-1`, so on the final
   screen the rail emptied every pill and announced "Step 0 of 4" — a reset at exactly
   the point a member most wants to be told they are nearly done. Progress now counts
   `PROGRESS_STEPS` (the spine plus `card-setup`), which is SCREENS rather than spine
   entries. A seller leaves at the intent step for the provider, so they simply never
   see the fifth pill fill.
2. The count rode on an `aria-label` attached to a plain `<div>`. A generic `div` has
   no role for a name to attach to, so the label is not reliably exposed and the one
   piece of information the rail carries was the piece assistive tech could miss. The
   pills are now `aria-hidden` decoration and the count is `sr-only` TEXT.

---

## F34 - Onboarding region step depends on operationalRegions() which needs a live Stripe key (severity 0, TESTING NOTE)

**Observed.** The onboarding wizard's region step calls `operationalRegions()` to
decide which tiles to show. That function requires BOTH `tradingEnabled: true` in
the registry AND a configured Stripe platform binding (a `STRIPE_SECRET_KEY` or
`STRIPE_SECRET_KEY_AU` env var present and valid). When the Stripe API is
rate-limited, unresponsive, or the key is temporarily invalid, the step shows "No
regions are open for deals right now" and no tiles at all — making onboarding
impossible to complete for any new member until the provider recovers.

This is not an app bug — the wizard correctly refuses to promise a region it cannot
settle in. But it means e2e tests that sign up fresh members and need them to
complete onboarding are fragile: any Stripe API hiccup during the run makes the
region step unreachable.

**Workaround in tests.** The guards spec bypasses the wizard entirely after sign-up,
writing `region_code` and `onboarding_completed_at` via service-role PostgREST PATCH.
This tests the CONTRACT GUARDS (which are server-side predicates) without coupling
to the onboarding wizard's runtime dependencies. The wizard itself is exercised in
`onboarding.spec.ts`.

---

## F40 - DeliveryAddressPanel gated behind delivery-cost check, unreachable without postage (severity 4, FIXED)

**Symptom.** On a DELIVERY trade at `COLLATERAL_LOCKED` with `delivery_cost_cents = null`
(no postage agreed during negotiation), the `DeliveryAddressPanel` never mounted. The
rail said "Both traders add a delivery address — current step" while offering no way to
do so. **The trade could not be completed.**

**Cause.** In `components/trade/TradeContract.tsx`, the `TradeTermsRow` content was
structured as a three-way conditional:

```
handover_method === null          → "Not agreed yet"
!areHandoverDetailsFilled(trade)  → placeholder text
else                               → (DeliveryAddressPanel + tracking + etc.)
```

`areHandoverDetailsFilled` for DELIVERY returns `trade.delivery_cost_cents != null`.
When the proposal flow selects "Delivery" but sets no postage (which is the normal path
— `deliveryCostCents ?? null`), the trade hits the middle branch, rendering a static
paragraph instead of the address panel.

The address is independent of the postage cost — you need to know WHERE to send before
you can price postage — so the panel must render unconditionally for any DELIVERY trade.

**Fix.** Moved `DeliveryAddressPanel` OUTSIDE the `areHandoverDetailsFilled` ternary,
gated only on `trade.handover_method === 'DELIVERY'`. The tracking table and carrier
refresh remain in the "filled" branch where they belong. Comment explains why.

**Guarded by.** `trade.spec.ts` → "each trader records a postal address of record" —
the test now clicks the Terms tab first (the panel is inside a single-selection tab
strip, Exchange is default).

---

## F41 - Record Shipment is a dialog, not inline fields (severity 1, FIXED — test only)

**Symptom.** `trade.spec.ts` step "both traders post" tried to find carrier and
tracking number as page-level placeholder fields, then submit the "Record shipment"
button. The fields don't exist on the page — they are inside a `RecordShipmentDialog`
that opens when you CLICK "Record shipment".

**Cause.** The test was written from the assumption that the trade room uses inline
inputs (like an earlier iteration or the Cash_Sale room). The actual implementation
uses `RecordShipmentDialog`, a shared `components/fulfilment` dialog with labelled
inputs for Carrier and Tracking number, and a submit button also labelled "Record
shipment".

**Fix.** Updated the test to: click "Record shipment" (opens dialog) → fill Carrier
and Tracking number by label → click dialog's "Record shipment" submit → assert dialog
closes. Not a product bug — only a test/reality mismatch.

---

## F70 - The suite is green file-by-file but not as a whole run (severity 2, OPEN)

This is the main thing standing between "every spec passes" and "the suite is a
trustworthy production gate", so it is recorded rather than left as folklore.

Measured on the same commit, --workers=1 throughout:

| Run | Result |
| --- | --- |
| desktop, full suite | 98 passed, **1 failed** (offers - the buyer offers under asking) |
| desktop, offers.spec.ts alone | **15 passed, 0 failed** |
| mobile, full suite | **3 failed** (auth-and-navigation main nav links; cash-sale the reserved item leaves the catalog; listings edits a listing title) |
| mobile, auth-and-navigation.spec.ts alone | **8 passed, 0 failed** |

Every failure passes in isolation, so none is a defect in the behaviour under test.
Something earlier in the run changes the state the later assertion depends on.

**Ruled out.** Not parallel interference - these were single-worker runs, so files ran
strictly in sequence. Not consumption of the seeded fixture item: the listing
guards.spec.ts exercises is still AVAILABLE, confirmed by SQL after a full run. Not
stale sessions in the F14 sense, since sequential files cannot overlap in the way
refresh-token rotation requires.

**Strongest remaining hypothesis: accumulated catalog content.** Specs create their own
[E2E]-marked listings by design - a flow that consumes an item must not consume a
seeded one - so the catalog grows as the run proceeds. An assertion phrased against
catalog CONTENT ("the reserved item leaves the catalog") or against position therefore
reads a different page late in a run than it does alone. That fits which tests fail,
explains why they pass alone, and predicts the failures will move around as specs are
added - which is what has been observed across runs.

**What would settle it:** scope each failing assertion to its own marked title, and
make the reserved-item check assert the absence of ITS OWN link rather than a property
of the list. Three assertions, no app change.

**Not a release blocker, and not dismissed either.** Every behaviour in the suite is
verified to pass; what is not verified is that they all pass in one sequence. A gate
that must be run file-by-file to be believed is a weak gate, and this should be closed
before the suite is relied on in CI - where retries: 1 would currently paper over
exactly this.

### F70 UPDATE - desktop is now fully green; one mobile test remains

The catalog-accumulation diagnosis was correct and is FIXED. `cash-sale.spec.ts`'s
owner-visibility check asserted its item was findable in `/listings/mine`, a paginated
list that grows for ALICE as a run proceeds - every spec needing to consume an item
creates its own marked listing rather than eating a seeded one, so late in a full run
the row was simply not on the first page. It now asserts on the item's OWN page, which
exercises the same RLS rule (an owner keeps sight of a reserved item) without depending
on list position.

| Run | Before | After |
| --- | --- | --- |
| desktop, full suite | 98 passed, 1 failed | **102 passed, 0 failed** |
| mobile, full suite | 9 failed, then 3 | **99 passed, 1 failed** |

STILL OPEN, one test: mobile `cash-sale` "the seller ships and the buyer confirms
receipt". `Record shipment` stays DISABLED. A hydration race was ruled out: the carrier
and tracking fields are now filled through `fillAndConfirm` (new
`tests/e2e/support/forms.ts`), which asserts the value actually reached React state and
would have failed first - it does not. So both fields hold their values and the button
is still disabled, meaning it is gated on something further.

The likely candidate, by analogy with F40: posting needs the buyer's delivery address on
the contract, and `RecordShipmentDialog` carries the string "You do not have a delivery
address for this contract yet". The desktop suite passes this test, so the difference is
what an earlier step in this `describe.serial` chain leaves behind on mobile rather than
the shipping step itself. Next move is to dump the action card's own copy at that point -
the button's disabled REASON is almost certainly rendered next to it and has not yet been
read.

---

# Round 6 — security, money and data-integrity audit (F51–F69)

Not found by the e2e suite. This round came from reading the authorization surface, the
money paths and the migrations directly, and from querying the live schema's grants and
policies read-only. Every finding below was verified against the running database or the
code before being written down; the DB-level ones are quoted from `pg_policies`,
`information_schema.column_privileges` and `pg_default_acl`.

The two large existing audits (`ux-audit-findings.md`, and F1–F50 above) cover UX,
accessibility and functional behaviour. Nothing in this round overlaps them.

## F51 — Every member write grant came from DEFAULT PRIVILEGES, not from any migration (severity 5, FIXED)

**Symptom.** `authenticated` held INSERT, UPDATE and DELETE on every column of every
table and view in `cardtrade`.

**Cause.** `pg_default_acl` carried `{authenticated=arwd/postgres}` for tables in this
schema, so every relation inherited member write access at creation. No migration granted
any of it.

This is why the audit could not be done by reading `supabase/migrations`, and why the
revoke in `0032_verified_identity_display.sql:28` did not hold: the grants come back with
the next relation. It is also the root cause of F52, F54 and F55 — those are not four
mistakes, they are one mistake with four consequences.

**Fix.** `0072` alters the default privileges first, then blanket-revokes writes across
every relation in the schema, then grants back exactly the member write surface the
application uses (enumerated from `lib/actions/**`). Order matters: a table added later
without an explicit grant is now closed by default rather than open by default.

---

## F52 — `public_profiles` was a writable view that bypassed RLS on `profiles` (severity 5, FIXED)

**Symptom.** Any signed-in member could `UPDATE` or `DELETE` **any other member's**
profile row, and could write `rating` and `rating_count` — columns the `profiles` grant
allowlist deliberately excludes.

**Cause.** Three things lining up. The view is auto-updatable (single base table); it was
created without `security_invoker`, so base-table permissions resolve as its OWNER; and
its owner is `postgres`, which owns `profiles` too — and a table owner bypasses RLS unless
the table forces it, which it does not. Add F51's inherited write grants and the
projection became a writable back door onto the table it was meant to protect.

**Fix.** `0072` revokes the writes and leaves SELECT.

**AND THE OBVIOUS FIX WAS WRONG.** The first instinct — and the initial recommendation —
was `set (security_invoker = true)`. That would have taken the marketplace down: the only
SELECT policy on `profiles` is `profiles_owner_select` (`auth.uid() = id`), and the
catalog, seller pages, review lists and offer lists all resolve OTHER members through this
view. Under invoker rights every one of them returns nothing. The owner-executing SELECT
is the entire point of a public projection; only the write paths were ever wrong. Checking
the policy list before applying the fix is what caught it.

---

## F53 — Six SECURITY DEFINER money functions were executable by `anon` (severity 5, FIXED)

**Symptom.** An unauthenticated caller holding only the publishable anon key could, over
PostgREST: set an arbitrary `refund_cents` on any DISPUTED sale, queue a seller release,
file a fraud allegation **attributed to a member who never made it**, reopen a refunded
sale, and insert arbitrary chargeback rows.

**Cause.** These six kept PostgreSQL's default `EXECUTE TO PUBLIC`. Every other RPC in the
schema is revoked from `public, anon, authenticated` and granted to `service_role` alone
(0053, 0057, 0064) — so this was six omissions rather than a policy.

The sharpest one is `mark_cash_sale_refund_due(uuid, bigint)` (`0044:66`), which writes
`refund_cents` with no cap. Seller net is `amount - platform_fee - refund`
(`cashSaleOrchestrator.ts:1600`), so an internet caller could zero any seller's release.
`record_trade_fraud_claim` (`0046:57`) takes the claimant as a PARAMETER and checks only
participation, never `auth.uid()`, so the action-layer guard at `trades.ts:626` was
bypassable by calling the function directly.

**Fix.** `0072` revokes EXECUTE and grants it to `service_role`. The in-function
participation and state guards stay: they are defence in depth for the trusted caller,
not the access control that was missing. `is_admin`, `is_staff` and `is_fraud_banned`
remain executable deliberately — RLS policies call them as the member.

---

## F54 — Column-level tampering the server actions were carefully preventing (severity 4, FIXED)

Each of these had a correct guard in a Server Action and a direct PATCH straight past it.

| Column | What it defeated |
| --- | --- |
| `items.hidden` | `hideItem` is admin-gated and writes via service role; the owner could set it back to `false` and reappear in the catalog |
| `items.seller_identity_verified` | the trigger-maintained, property-pinned denormalisation of the Identity_Gate |
| `items.fmv_cents`, `items.status` | `updateItem` exists to enforce `FMV_IMMUTABLE` and `ITEM_NOT_AVAILABLE` |
| `offers.amount_cents` | `respondToOffer` reads the amount off the row at accept time (`offers.ts:433`) |
| `offers.offered_by` | it decides who is allowed to accept (`offers.ts:409`) — writing it enabled self-accept |
| `messages.body`, `.kind`, `.system_event` | INSERT was correctly pinned to `kind = 'USER'` with `sender_id = auth.uid()` (0012); UPDATE was the way around it, in the record an arbitrator reads |
| `reviews.reviewee_id` | `leaveReview`'s participation, COMPLETED-contract and not-yourself checks are all one-shot, and `profiles.rating` is trigger-maintained from these rows |

**Fix.** `0072` narrows UPDATE to what each flow actually writes: `items` to its six
LOCATION columns, `offers` to `status`, `messages` to `read_at`, `conversations` to
`last_message_at`, `notifications` to `read_at`, and `reviews` to nothing at all.

---

## F55 — A member with no profile row could insert themselves as an admin (severity 5, FIXED)

**Symptom.** `insert into cardtrade.profiles (id, is_admin, identity_check_status) values (auth.uid(), true, 'VERIFIED')`.

**Cause.** F51's inherited grants covered INSERT at table scope, i.e. every column,
including `is_admin`, `is_support`, `identity_check_status` and `merchant_settlements_enabled`.
`profiles_owner_insert` checks only `auth.uid() = id`, and the primary key stops a member
inserting over an EXISTING row — so the requirement was a signed-in member whose profile
row is absent. **Which is not hypothetical:** that is exactly the state F25 was about, and
it was reached in production.

Found while verifying F54 rather than in the original pass, because narrowing UPDATE made
it obvious that INSERT had never been narrowed at all.

**Fix.** `0073` revokes member INSERT on `profiles` outright — both provisioning paths
(`lib/actions/auth.ts`, `lib/auth/ensureProfile.ts`) use the service-role client, so
nothing needed it — and narrows INSERT on the other six tables to the columns the actions
name. `messages.kind` and `messages.system_event` are off that list on purpose: column
INSERT privileges are only checked for columns named in the statement, so the default
supplies `'USER'` and a forged SYSTEM event is now unwritable by either verb.

---

## F56 — A confirmed fraud finding CHARGED the victim the collateral instead of paying it (severity 5, FIXED)

**Symptom.** On a staff-confirmed Objective_Fraud, the platform captured the offender's
collateral (correct), then debited the VICTIM's saved card for the same amount, reported
`transferSettled: true`, and kept both. On a $1,000 trade the victim was out $1,000 and
the platform held $2,000.

**Cause.** `disputeResolution.ts:488` called
`requestTransfer({ payerId: victimPayerId, ... })`. `requestTransfer` is a COLLECTION
primitive: it creates a PaymentIntent against that customer's saved card
(`StripeService.ts:505`) and, with no `merchantRef`, returns SETTLED as soon as the charge
succeeds (`:606`). The repository method it depended on was `getTraderPayerId` — a payer
ref is a saved card, i.e. where money comes FROM. Paying someone needs a destination to
send money TO.

`payoutCashSaleSeller` documents this exact trap at its own call site: *"Uses
`payoutToMerchant`, NOT `requestTransfer` — the latter creates a fresh PaymentIntent
against the payer"*. The fraud path made the mistake the cash path had already learned.

Secondary defect in the same expression: `?? victimTraderId` fell back to a CardTrade
profile UUID as a Stripe customer id, so the least-prepared victim — no payer on file —
was the one whose call was most malformed.

**Fix.** `getTraderPayee` replaces `getTraderPayerId` and returns the victim's Connect
state; the payout goes through `payoutToMerchant` guarded by `canReceiveFunds`. A victim
with no payout account is a normal, valid state, so it is recoverable: the funds stay in
the platform balance, `VICTIM_NOT_PAYABLE` is surfaced, and the case is flagged for an
operator — no fallback charge, ever.

**Test.** `tradeFraudAuthorization.test.ts` now asserts the destination is a connected
account AND that `requestTransfer` is never called on this path. The second assertion is
the one that would have caught it: the old code called a real function with plausible
arguments and got back a status that said it worked.

---

## F57 — A failed collateral release was recorded as a successful one (severity 4, FIXED)

**Symptom.** A trader's collateral could remain a live authorisation against their card
while the system recorded the hold as `VOIDED` and told them it was released.

**Cause.** `voidHold` reports failure through its `status` field rather than throwing
(the design, so compensating logic can run). Two call sites discarded it and wrote
`VOIDED` regardless — `disputeResolution.ts:325` and `:506`. And because
`expire_lapsed_holds` only sweeps holds still marked `ACTIVE`, the reconciler could never
find one either: the encumbrance became invisible until the authorisation lapsed on its
own. `lib/trades/completion.ts:52` had it right all along and is the pattern.

**Fix.** Both sites check the returned status, leave the row ACTIVE when the release did
not happen (so the expiry reconciler still owns it), and flag manual reconciliation.
`HOLD_VOID_FAILED` joins the fraud indications.

---

## F58 — A declined card still billed BOTH traders the 5% fee on a trade that never started (severity 4, FIXED)

**Symptom.** One trader's collateral authorisation declines; the trade is cancelled; both
traders are charged 5% of what they were to receive, with no refund path. On a
$1,000-each swap, $50 each for nothing.

**Cause.** Ordering plus a swallowed failure. `placeBondsForAgreedTrade` returned
`ok: true` even when `placeHold` came back FAILED (`tradeProposal.ts:433`), so
`acceptTradeTerms` skipped its `HOLDS_FAILED` compensation, charged the fee
(`tradeNegotiation.ts:371`), and only then called `syncHolds` — which does dispatch
`HOLDS_FAILED` but never calls `refundTradeFees`. The compensation branch's own comment
reads "No exchange, no fee."

Also: a FAILED placement comes back with an EMPTY `holdId`, which was recorded verbatim,
so two failed holds on one trade shared a blank `hold_ref` and the compensation's
per-ref lookups matched nothing.

**Fix.** `placeBondsForAgreedTrade` returns `hold-failed` when any authorisation is not
ACTIVE, so the caller compensates BEFORE anything is billed; the member-facing message
names the card decline. Failed rows are recorded under the deterministic ref instead of
an empty string. The rows are still written before returning the failure, deliberately —
the compensation voids the holds that DID succeed and can only find them if they exist.

---

## F59 — `proposeTrade` let any verified member force two strangers into escrow (severity 4, FIXED)

**Symptom.** Passing two item ids off the public catalog plus
`{ onBehalfOfUserId: <victim> }` created a trade neither party proposed, reserved both
items, and placed a real card authorisation for 100% of FMV on BOTH victims' saved cards —
with the caller not a party to it. It also skipped the region-compatibility and shopfront
guards `openTradeNegotiation` applies.

**Cause.** The option existed for `acceptTradeProposal`, removed in 0055 with no
replacement. Its own doc-comment said the value "must never be threaded through from
client input" — but every export of a `'use server'` module IS client input. The action
has no caller anywhere in `app/` or `components/`: dead code that was still a live
endpoint.

**Fix.** The option is gone and the proposer is always `user.id`. The Identity_Gate loop
it left behind was checking the caller twice and the actual counterparty never, so that
is fixed too — the counterparty is now resolved from the item being traded for and gated,
which is what "entering trade escrow gates BOTH parties" requires.

---

## F60 — A trade bundle could contain items the trader did not own (severity 4, FIXED)

**Symptom.** Two effects, and the second costs real money.

1. **Read escalation.** `items_trade_participant_select` (0071) grants a trade participant
   SELECT on every item in that trade's `trade_items`. Padding a bundle with arbitrary ids
   therefore granted read access to any row in `items` — including other members' hidden
   private-trade items and the RESERVED/SOLD rows the catalog policy withholds.
2. **Collateral inflation.** Bonds are sized from what each trader RECEIVES, read out of
   `trade_items`. Padding your own side with strangers' expensive listings inflated the
   COUNTERPARTY's real card authorisation, for goods you could never deliver, while the
   exchange panel displayed them as genuinely on offer.

**Cause.** `open_trade_negotiation` validates the two PRIMARY items — the counterpart's for
owner and availability, the initiator's for owner — and then loops over
`p_initiator_extra_item_ids` and `p_counterpart_extra_item_ids` inserting whatever it was
handed (`0053:100-118`). Both arrays come from client input via `openTradeNegotiation`,
which calls the RPC on the service-role client.

**Fix.** `0074` adds a BEFORE INSERT trigger on `trade_items` enforcing that the item is
owned by the named trader, is not a shopfront, and is not closed.

**Why a trigger rather than a fix in the RPC.** Ownership is an invariant of the table, not
of one caller: four migrations (0017, 0021, 0023, 0053) have written these rows, each
superseding the last, so a per-caller check has to be restated in every future one. It also
avoids recreating a 300-line function to add two lines, which is its own source of error.
Availability is deliberately NOT checked — renegotiation rewrites a bundle while the
primaries are already RESERVED by that very trade, so refusing a non-AVAILABLE item would
reject the legitimate case. Verified against existing data before applying: 0 of 2 rows
violate the new invariant.

---

## F61 — The $10 Friction_Tax return share was captured and never paid (severity 3, FIXED)

**Symptom.** Every condition dispute captured $20 from the disputed-against trader and the
platform kept all of it. The trader who has to post the item back was under-compensated by
exactly the $10 that Req 7.3 allocates to them.

**Cause.** The split was written to `friction_tax_return_cents` and then read by nothing
but display code — the member's payouts screen and the arbitration queue's "amount at
risk". Nothing ever moved the money. "Allocated" had quietly come to mean "paid".

It was invisible to the solvency check as well: custody reconciliation reads only
`cash_sales`, so a genuine member obligation sitting in the platform balance contributed
nothing to `heldForMembersCents` — the direction that module's own comment identifies as
the one that hides an insolvency.

**Fix.** `0075` adds `friction_tax_return_nonce`, `_paid_at` and `_error` to `trades`, and
`raiseConditionDispute` now pays the share to the RAISING trader via `payoutToMerchant`
with a persisted nonce. `paid_at` staying NULL is what marks it as still owed, so an
unpayable trader leaves a visible obligation rather than a silent one.

The raising trader is the payee because they are the one returning the goods. The other $10
is the platform's fee and correctly stays put.

---

## F62 — Nothing retried a failed Trade_Fee or a failed refund (severity 3, FIXED)

Two instances of the same shape: a failure recorded to a column that no code ever read
back.

**The fee.** `chargeTradeFees`'s doc-comment says a failed fee "is recorded FAILED for the
drain job to retry". There was no drain: `trade_fees` was touched only by the charge and
refund functions in that one module, both of which run once. Every fee that failed — a
declined card, a transient provider error — was permanently uncollected revenue. The call
site also discarded the returned `anyFailed`, which is why nobody noticed.

**The refund.** Worse, because the money belongs to a member. A refund the provider
rejected was recorded FAILED and read by nothing.
`0045_refund_failure_reopen.sql` reopens a FULL refund so a resolution can be made again,
but deliberately not a PARTIAL one — so a partial refund that bounced left the Buyer's
money in the platform balance permanently, while `sellerNetCentsFor` kept subtracting that
same amount from the Seller's release. Neither party had it and nothing said so.

**Fix.** `drainFailedTradeFees` and `processDueCashSaleRefunds`, both bounded, both
per-row isolated, both reusing the persisted nonce verbatim so a retry can only replay a
charge that already succeeded rather than issue a second one. The fee drain rides the
hourly trade-inspections job; the refund drain rides the cash-sale payout job, isolated so
a refund problem cannot stop sellers being paid. `MAX_FEE_ATTEMPTS = 8` at hourly cadence
keeps every retry inside the provider's 24-hour idempotency window, which is the same
reasoning `MAX_PAYOUT_ATTEMPTS` uses.

---

## F63 — The inspection sweep was unbounded, aborted on one bad row, and misreported what it did (severity 3, FIXED)

**Symptom.** Three defects in one loop, all of which make the timeout fail in the way the
timeout exists to prevent.

1. **Unbounded.** `select * ... lte(deadline, now)` with no `.limit()`. Each trade makes
   several provider calls and the route has a wall-clock limit, so a backlog was cut off
   mid-batch — and the trades after the cut sat in INSPECTION past their deadline with
   collateral burning toward the ~7-day authorisation limit.
2. **No isolation.** Nothing in the loop was guarded, so a throw from any write, provider
   call or notification insert propagated as a 500 and cost the whole queue.
3. **Dishonest report.** `finalizeCompletedTrade` returned `void` and discarded both
   outcomes, so the sweep counted the trade `completed` and told both traders in writing
   that "both collateral holds were released" whether or not any had been.

**Fix.** Bounded at 25 per pass, oldest deadline first, with a `moreDue` flag; per-row
`try/catch`; `finalizeCompletedTrade` returns what it actually managed, the notification's
claim is conditional on that, and `needsReconciliation` is reported separately because
"completed" alone reads as nothing to look at. The cash-sale payout drain already did all
three and was the model.

---

## F64 — Eight tables' row-level security existed only in the deployed database (severity 3, PARTLY FIXED)

**Symptom.** `conversations`, `messages`, `notifications`, `offers`, `reports`, `reviews`
and `watchlist` are created by NO migration. `pre_auth_holds` is created (0001) but never
has `enable row level security` run on it — 0002 enables RLS on four tables and defers the
collateral table's read policy to "the subsequent migration", which contains no policy.

So the protection on the chat thread, the offer ledger, the review history, the
notification feed and the COLLATERAL table lived only in the running database. Version
control described a system where all of it was open.

**This is why F54 went unnoticed.** Nobody reviewing `supabase/migrations` could have seen
`messages_participant_update`, because it is not there.

**Fix, and its limit.** `0076` records the RLS state as built — enables RLS on all eight
and declares every policy exactly as the live database has it, idempotently. It does NOT
invent `create table` DDL for the seven: that would mean guessing types, defaults,
constraints and indexes, and because it would have to be `if not exists` to be safe, a
wrong guess would never surface. An unverifiable lie in the migration history is worse than
a known gap.

**Still open:** a from-scratch `supabase db reset` cannot build this schema. It will now
fail loudly on `0076` instead of quietly producing a database whose collateral and chat
tables have no RLS, which is the better failure — but closing it properly means dumping the
real DDL for those seven tables and verifying it against the live schema.

---

## F65 — The currency guard could never fire, and was never called (severity 2, FIXED)

**Symptom.** `assertMinorUnitSupported` documents itself as "a crash at the seam rather
than a rounding error in production" for currencies whose minor unit is a thousandth. It
was neither.

**Cause.** Two independent reasons, which is what made it look fine. `minorUnitDigits`
returned only 0 or 2 — anything unrecognised fell through to 2 — so the condition
`digits !== 0 && digits !== 2` was unsatisfiable. And a search across the whole repository
finds no call site: only the definition, a re-export, and doc-comments referring to it. It
was a comment describing a protection.

Adding BHD, JOD, KWD, OMR or TND to `REGIONS` would have understated every amount in that
region by a factor of ten, silently, with the numbers all looking plausible.

**Fix.** `THREE_DECIMAL_CURRENCIES` makes the digit count truthful, and `readStripeConfig`
calls the assertion on every payment configuration it builds — the point where a region
becomes the currency every `amount` in `StripeService` is denominated in. Refusing to
construct that configuration is a loud total failure for one region; the alternative is
charging real people the wrong amount undetectably.

---

## F66 — The demo actions failed OPEN when Stripe was unconfigured (severity 3, FIXED)

**Symptom.** `isPaymentDemoEnabled` was "on unless the value is exactly `'false'`", and
`isLivePaymentsProvider` is false whenever Stripe is unconfigured. So a production
deployment that lost or mistyped `STRIPE_SECRET_KEY` became one where the demo actions were
live — and `fireIdentityWebhook` writes `identity_check_status = 'VERIFIED'` for its own
caller, which is the gate that unlocks listing, selling and entering trade escrow. A
missing credential was the thing that let every member verify themselves.

**Fix.** Unset now means on in development, OFF in production. Development keeps working
with no configuration, because that is where the panels are useful and there is no real
money to reach; production requires the explicit opt-in. `playwright.config.ts` already
sets `ENABLE_PAYMENT_DEMO: 'true'`, which it needs to because `next start` runs with
`NODE_ENV=production`. Pinned by two new cases in `providerMode.test.ts`.

---

## F67 — A hold with no reported expiry was invisible to both sweeps, permanently (severity 3, FIXED)

**Symptom.** `expiresAt` comes from the charge's `capture_before`, which is documented as
present only after confirmation and only for card authorisations. When absent, the hold was
recorded with `expires_at = null` — and both passes in `0035_hold_expiry_reconciler.sql`
filter `expires_at is not null`. So the hold was never warned about and never marked
EXPIRED, while `bothHoldsActive` kept reporting live collateral and `inspectionHoldRisk`
returned `'safe'` because it had no expiry to compare. A trade could sit on collateral the
provider had already released, with nothing anywhere saying so, and a dispute would find
nothing to capture.

**Fix.** `captureBefore` backstops a missing value with created + 7 days, but only for an
intent in `requires_capture` — an intent that never reached an authorisation has no
collateral to expire, and inventing a date for it would put a phantom row in front of the
reconciler. An assumed date can only be wrong EARLY, which makes the system reconcile
sooner than needed; reporting no expiry is wrong late, and silent.

---

## F68 — Smaller items fixed in the same pass (severity 1–2, FIXED)

- **`FRICTION_TAX_CENTS` was declared three times** — in `disputeResolution.ts` (the one
  actually captured), `payoutReadModel.ts` (what a member is shown) and `arbitration.ts`
  (the queue's "amount at risk"). Three answers to one money question. Now one module,
  `domain/dispute/frictionTax.ts`, with the other two importing it.
- **`intent.amount_received || params.amount`** in both capture paths treated a
  provider-reported 0 as absent and substituted what we ASKED for — turning our request
  into the `captured_cents` an arbitrator reads, and on the fraud path into the amount paid
  to the victim. Now `??`.
- **`assignArbitrationCase` accepted any `assigneeId`** and wrote it unvalidated. The
  assignee gains no access (the read policy is `is_staff()`), so the harm was to the queue:
  cases parked on accounts that cannot work them, indistinguishable from cases in progress.
  Now checks `is_admin or is_support`.
- **`getCounterpartyIdentity` interpolated a client id into a PostgREST `or()` filter.** No
  exploit was found — a later `.eq('id', ...)` rejects a non-UUID — but "a later call
  happens to reject it" is not a control on the code path that discloses a verified legal
  name. Now shape-checked first.
- **`/listings/[id]/edit` was in `config.matcher` but not `PROTECTED_PREFIXES`**, so
  `isProtected()` was false and neither the sign-in redirect, the fraud-ban redirect nor
  the onboarding gate ran on a route that mutates. A prefix cannot express it (the variable
  segment comes first), so `PROTECTED_PATTERNS` now carries the regex.
- **The bounded `fullCapture` retry loop** sends the same idempotency key each attempt, so
  after a definite provider rejection attempts 2 and 3 replay the cached rejection
  instantly. Left as-is deliberately and documented: it is a TRANSPORT retry, and varying
  the key per attempt would trade a recoverable operator task for the possibility of
  capturing a trader's collateral twice.

---

## F69 — Known and NOT fixed in this round (OPEN)

Recorded so none of it is mistaken for having been checked and found sound.

1. **UI money conversion hardcodes 100 in about nine components** —
   `ContractLineItems.tsx:59`, `ItemForm.tsx:228`, and the offer/terms/negotiation dialogs
   all do `Math.round(dollars * 100)` and `(cents / 100).toFixed(2)` without consulting
   `minorUnitDigits`. In a JPY region a seller typing `5000` would store 500,000. Latent
   while AU is the only tradeable region, and the reason it is deferred rather than done is
   that it wants one shared helper plus nine careful edits with the e2e suite run against
   them — not a search and replace.
2. **`formatCents` in `cashSaleOrchestrator.ts:672`** hardcodes `/100` and a bare `$` for
   the permanent event log and contract chat. Same latency, same fix shape; the module
   cannot import `lib/format`, so it needs a formatter injected through its deps.
3. **Attempt counters are read-then-write** (`recordPayoutResult`, `recordRefundResult`,
   `recordFeeResult`), so two concurrent failures can record the same incremented value.
   Consequence is over-retrying, not lost money.
4. **`collectedCents += entry.amountCents`** in `tradeFees.ts` sums what was REQUESTED, not
   what the provider reported settled, so the returned figure is our belief rather than the
   provider's fact.
5. **No total ceiling on a shopfront contract price.** `proposeCashSalePrice` enforces
   `AGREED_PRICE_MAX`; the line-item path checks only `> 0`, and 50 lines × 999 × the
   per-line max reaches ~4.995e15 minor units, above which `agreedPriceCents * 500` exceeds
   2^53 and the fee becomes inexact. Unreachable through the UI, reachable through the
   action.
6. **The trade fee base is read live rather than snapshotted** — `items.fmv_cents` is summed
   at charge time, while the fee disclosed to the trader is derived independently in the UI.
   A seller editing an FMV between disclosure and the second acceptance changes what the
   other trader is charged.
7. **`conversations_participant_update` allows substituting the other participant** and
   repointing `trade_id` / `cash_sale_id`. `with_check` keeps the caller a participant so
   there is no read-in, and 0072 narrowed the grant to `last_message_at` — which closes it
   in practice. The policy is still wider than it needs to be.
8. **The seven tables still have no `create table` in migrations** — see F64.
9. **Two Supabase Auth settings** are flagged by the platform advisor and are Dashboard
   changes, not code: leaked-password protection is disabled, and MFA options are minimal.

After this round the Supabase security advisor reports **no findings against the
`cardtrade` schema**. The warnings it still returns are all in the `public` schema, which
belongs to the other project sharing this database — see F27.

---

## F70 — The column-level INSERT grants in 0073 had no effect (severity 4, FIXED)

**A defect introduced by this round's own fix, found by verifying it instead of trusting
it.** Recorded in full because the failure mode is subtle and will recur.

**Symptom.** After 0073, `has_column_privilege('authenticated','cardtrade.messages','kind','INSERT')`
was still **true**. So was `items.seller_identity_verified`, `items.seller_rating`,
`messages.system_event` and `reports.reviewed_by` — every column 0073 was written to
exclude.

**Cause.** 0072 granted INSERT at TABLE level on `items`, `offers`, `conversations`,
`messages`, `reviews`, `reports` and `watchlist`. 0073 then granted INSERT on specific
COLUMNS of those same tables, intending to narrow it. But a table-level grant already
covers every column, and PostgreSQL stores table-level and column-level grants as separate
ACL entries — adding a narrower one does not remove the wider one. 0073 changed the
intent and not the behaviour.

`profiles` escaped only because it took a different route: there the table-level INSERT was
REVOKED outright, so the escalation 0073 exists to close (self-inserting a row with
`is_admin = true`, F55) really was closed.

**Fix.** 0077 revokes the table-level INSERT on all seven and restates the column grants,
so that file is the whole member INSERT surface rather than a diff against two others.

**How it was caught, and the lesson.** Not by review, not by a test, and not by reading the
migrations — those describe what was intended. By asking the database, per column, whether
each member flow's privilege matched what it should be. A single query of ~87
`has_column_privilege` / `has_table_privilege` assertions, half of them positive ("this
flow must still work") and half negative ("this tampering must not"), found it immediately.

**Worth repeating after ANY change to grants in this schema**, in both directions. The same
query also found that `reviews_author_delete` is now an inert policy — no code deletes a
review, so the blanket revoke left the grant off and the policy has nothing to permit. That
is least privilege rather than a break, and it is left as-is deliberately.

### How the grant changes were verified

Three layers, because the first two cannot see what the third does:

1. **Privilege assertions** (87 checks, above) — proves the ACL surface is exactly the
   intended shape. This is what caught F70.
2. **Policy/grant coherence** — every PERMISSIVE write policy in the schema cross-checked
   against whether `authenticated` holds a matching grant, to find policies the revoke had
   stranded. Thirteen are now inert; twelve are correct (service-role paths for arbitration
   and report triage, `webhook_logs` whose policy is `using (false)` anyway, and
   `profiles` INSERT per F55) and the thirteenth is the reviews note above.
3. **Functional proof** — all thirteen member writes the application performs, executed
   `set local role authenticated` with `request.jwt.claims` set, so grants, RLS policies
   and triggers all applied together, inside a transaction ending in ROLLBACK. All
   thirteen succeeded; `items.currency` was still derived as `aud` by its trigger and
   `items.seller_identity_verified` was still set to `true` by its trigger **despite the
   column no longer being grantable at insert**, which is precisely why excluding it is
   safe. `messages.kind` came back `'USER'` from the column default, confirming the
   INSERT policy's `kind = 'USER'` requirement is satisfied without granting the column.

The 0074 trigger was verified the same way, four cases: an owned SINGLE listing is
ACCEPTED, a foreign item is REFUSED (`trade-item-not-owned`), a shopfront is REFUSED, and
a closed listing is REFUSED. Both probe transactions were confirmed to have left no rows.
