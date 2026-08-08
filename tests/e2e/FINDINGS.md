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
