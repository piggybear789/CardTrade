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
