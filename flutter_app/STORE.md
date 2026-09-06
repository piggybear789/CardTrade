# NoDitto — Play submission checklist

Requirements 7.9, 8.7, 10.1–10.7 of `.kiro/specs/mobile-release-readiness/`.
Companion to `BUILD.md`, which covers producing the artifact. This file covers the material a
submission needs that is **not** code.

## How to read this file

Every answer below is **derived from the shipped code**, and each one names the capability that
justifies it. That is decision **D14**: filling in the Play Console should be a transcription,
not a judgement call made in a web form with the code out of sight. So:

- **Do not add a Data safety category that no shipped capability justifies.** An
  over-declaration is a promise about handling data NoDitto does not hold, and it is as wrong as
  an under-declaration — just wrong in the direction that looks cautious.
- **When a capability changes, change this file in the same commit.** The two places this bites
  hardest are named inline: choosing an error-reporting vendor (§4) and adding an in-app card
  surface (§3).
- Every path cited here exists in the tree. If one stops existing, the claim above it is stale.

**What still needs a human** (D14, D12, D11):

| # | Needs | Blocked because |
| --- | --- | --- |
| H1 | A Play Console developer account | Nothing here can be submitted without one |
| H2 | The content rating (IARC) questionnaire, answered in the Console | The answers are drafted in §7; only the account holder can submit them |
| H3 | Screenshots and a feature graphic from a signed release build | No signed bundle exists — `key.properties` is absent by design (D12) |
| H4 | Final launcher artwork | The shipped mark is the provisional monogram of D11 |

---

## 1. Store identity and URLs (Req 10.1)

| Field | Value | Source |
| --- | --- | --- |
| App name on the store | **NoDitto** | `android:label` in `android/app/src/main/AndroidManifest.xml` |
| Package name | **`app.noditto`** — immutable after the first upload | `applicationId` in `android/app/build.gradle.kts` (D1) |
| Short description | must fit 80 characters; see §9 for what it may and may not claim | — |
| Full description | see §9 | — |
| Privacy policy URL | **`https://noditto.app/privacy`** | route `app/(marketing)/privacy/page.tsx`; host from `WEB_APP_URL` in `config/prod.env.example` |
| Terms URL (optional in the Console) | `https://noditto.app/terms` | route `app/(marketing)/terms/page.tsx` |
| Account deletion URL / path | in-app — see §5 | `app/api/mobile/account/close/route.ts` |
| Category | Shopping | physical goods marketplace |
| Contains ads | **No** | no ad SDK in `pubspec.yaml` |
| In-app purchases | **No** | goods are physical and are paid for on the website; Play Billing governs digital goods, which NoDitto does not sell |

The app itself links to both policy pages, as announced browser handoffs, from
`features/profile/screens/settings_screen.dart`.

---

## 2. Data safety declarations (Req 10.2)

Play asks, per data type: **collected**, **shared**, **required or optional**, **why**, and
whether it is **encrypted in transit** and **deletable**. Two answers are the same for
everything below and are stated once:

- **Encrypted in transit: yes, everywhere.** Every request leaves over HTTPS. `WEB_APP_URL` and
  `SUPABASE_URL` are both rejected at startup unless they are absolute `https` URLs
  (`lib/core/config_gate.dart`).
- **Deletable: yes.** The in-app closure flow of §5 anonymises the member-identifying data. Read
  §5 before answering this one, because what it deletes is narrower than the word suggests.
- **Shared with third parties: no**, for every row. Data goes to NoDitto's own backend
  (Supabase) and, on the website, to Stripe as the payment and identity provider. Play counts a
  processor acting for the developer as collection, not sharing.

### Declare these

| Play data type | Collected | Required | Why | The capability that justifies it |
| --- | --- | --- | --- | --- |
| **Personal info → Email address** | Yes | Required | Account management | Sign-up and sign-in collect an email and a password: `features/auth/screens/sign_up_screen.dart`, `sign_in_screen.dart`, `forgot_password_screen.dart`. A contact email is editable at `features/profile/screens/edit_profile_screen.dart`. |
| **Personal info → Name** | Yes | Required | Account management, app functionality | The public **display name** — a member-chosen alias, not a legal name — set at sign-up and editable on the same profile screen. |
| **Personal info → User IDs** | Yes | Required | Account management | The Supabase auth user id that every row is keyed to (`lib/services/supabase_service.dart`). |
| **Photos** | Yes | Optional | App functionality | Listing photos are picked in-app and uploaded to the `item-images` bucket: `features/listings/screens/create_listing_screen.dart`, `edit_listing_screen.dart`, `lib/services/storage_service.dart`, bucket name in `lib/core/constants.dart`. |
| **Messages → Other in-app messages** | Yes | Optional | App functionality | 1:1 conversations, sent from `features/messages/widgets/message_input.dart` through `ApiRoutes.messagesSend`. |
| **App activity → Other user-generated content** | Yes | Optional | App functionality | Listing titles, descriptions, conditions and prices; a typed **city or suburb** label on a listing; offer amounts; a written binder request; trade proposals and contract-room actions. Screens: `features/listings/screens/create_listing_screen.dart`, `features/offers/screens/offers_screen.dart`, `features/trades/screens/propose_trade_screen.dart`, `features/sales/screens/purchase_flow_screen.dart`. |

Two notes on that last row, both of which are the kind of thing a reviewer checks:

- **The suburb is typed, not sensed.** `create_listing_screen.dart` collects it as a free-text
  field labelled "City or suburb". It is **not** a Location declaration: the app requests no
  location permission, and no `geolocator`-style package is in `pubspec.yaml`.
- **A member's trading region is a stated jurisdiction, not a guess.** See §8.

### Do NOT declare these

Each line is a category it would be plausible to tick and wrong to.

| Play data type | Why not |
| --- | --- |
| Location (approximate or precise) | No location permission, no location package, no device-location read. The suburb on a listing is typed. |
| Financial info → Payment info | The app has no card field and no card-entry screen. See §3. |
| Personal info → Address | The shipped build has no address-entry surface. `lib/services/trades_service.dart` carries `saveDeliveryAddress`, but no screen calls it; a posted trade's address of record is entered on the website. Adding that screen means adding this row. |
| Personal info → Race, ethnicity, political or religious beliefs, sexual orientation | Never collected anywhere in the product. |
| Personal info → Other info (government ID, date of birth) | Identity verification is Stripe Identity and runs **on the website** (§6). The app renders a status and a legal name the server already holds; it collects no document, number or date of birth. |
| Photos → Videos, Audio, Files and docs | No video, audio or file picker. Message attachments cannot be sent from the app (`message_input.dart` states so); they are viewable on the website (`features/messages/widgets/message_bubble.dart`). |
| Contacts, Calendar, SMS, Call logs | No such permission and no such package. |
| Health and fitness | Not applicable. |
| Device or other IDs → Advertising ID | No ad SDK, no advertising-ID read, no analytics SDK. |
| App activity → App interactions, search history, installed apps | No analytics or product-telemetry SDK is in `pubspec.yaml`. Catalog search terms are query parameters on a read; they are not recorded as a member's search history. |
| Diagnostics → Crash logs, performance data | Nothing is transmitted today. See §4 — this is the row most likely to become wrong. |

---

## 3. Payments (Req 10.3)

**Declare: payment is processed by the payment provider, Stripe, not by NoDitto. NoDitto never
receives a card number, CVC or expiry date.**

What is true of the shipped build, precisely:

- **There is no card field in the app.** Card details are entered into Stripe's own UI, inside
  Stripe's own iframe on the website — never into a NoDitto form, schema, request body or table.
  That rule is in `.kiro/steering/stripe-payments.md` and holds on both clients.
- **Buying hands off to the website.** `WebHandoff.buyListing` in `lib/core/web_handoff.dart`
  opens the listing in the device browser, carrying a written binder request and its price so
  neither is retyped. Agreeing terms and paying happen there.
- **The Stripe SDK is initialised with a publishable key only.** `lib/main.dart` sets
  `Stripe.publishableKey` from `STRIPE_PUBLISHABLE_KEY`, and `lib/core/config_gate.dart` treats
  a key without the `pk_` prefix as **missing**, so a secret key pasted into that slot fails the
  build's startup gate rather than shipping. No secret key exists in the bundle.
- **`ApiRoutes` names three payment endpoints** (`payments/begin-card-setup`,
  `complete-card-setup`, `get-status`) and **no Dart code calls any of them.** They are paired
  with their handlers for the contract guard; they are not a shipped member capability.

**If a card-setup screen is ever added to the app, this section and §2 both change in the same
commit:** the declaration becomes Financial info → Payment info, collected, and the Stripe SDK
starts collecting on the device.

For context that belongs in the listing copy rather than in Data safety: NoDitto is merchant of
record. A cash sale's funds are collected and **held by the platform** until the buyer accepts
the goods, then released to the seller net of the platform fee. That one is genuinely escrow —
see §9 for where the word is allowed.

---

## 4. Diagnostics (Req 8.7)

**Declare: no diagnostic data is collected. Nothing leaves the device.**

Per decision **D13**, the error-reporting seam ships with the hooks, the redaction guarantee and
the interface — and **no vendor SDK and no network binding**:

- `lib/core/observability/error_reporter.dart` binds `NoopErrorReporter` in debug and in any
  release build with no `ERROR_REPORTER_DSN`. With a DSN set, it binds
  `LocalLogErrorReporter`, which writes to the **device log** and transmits nothing.
- `ERROR_REPORTER_DSN` is optional in `config/prod.env.example`; there is no vendor package in
  `pubspec.yaml`.
- `recordError` takes an error, a stack trace and a fatality flag and **nothing else** — no user
  parameter, no breadcrumbs, no tags — so there is no path by which a legal name, address,
  identity document field, card detail or session token could ride along (Req 8.4).

**Choosing a vendor creates the obligation.** The moment a network binding is added, this
section becomes "Diagnostics → Crash logs (and, if the vendor reports it, performance data),
collected, not shared, for app functionality and diagnostics", and Play's Data safety form must
say so before that build is uploaded. That change belongs in the same commit as the binding.
Manual check **M14** in `design.md` cannot be performed until then either — with the no-op
bound, there is no reporter for a report to arrive in.

---

## 5. Account deletion declaration (Req 7.9)

Play specifically checks this one, so state it exactly.

**Path to declare: in-app.** In the app: **Profile → Settings → Close account**
(`features/profile/screens/settings_screen.dart`, control labelled `Close account`). It calls
`POST /api/mobile/account/close` (`app/api/mobile/account/close/route.ts`), which delegates to
`closeAccount` in `domain/orchestrator/accountClosureOrchestrator.ts` — the one closure path in
the product.

**Declare it as account closure, not as deletion of all data.** What the server does, in the
order it does it:

1. Refuses outright if the member has money in flight — a live cash sale, an uncaptured trade
   collateral authorisation, a queued payout, or an open dispute — and names the blocking
   category.
2. Otherwise: **anonymises** the profile, so the display name, photo, bio and links stop being
   publicly identifiable; marks the account closed; revokes existing sessions; and detaches the
   sign-in, so the old credentials no longer work.
3. **Retains** contract, payout, review and arbitration records, because accounting and dispute
   resolution read them.
4. **Retains** the fraud identity blocklist key, so closing an account is not a way to shed a
   ban.

Suggested Console wording, which matches the in-app dialog rather than improving on it:

> Closing your NoDitto account removes your display name, photo, bio and links, so your profile
> is no longer publicly identifiable, and your sign-in stops working. Your sales, trades and
> payout records are kept, because accounting and dispute resolution need them. An account with
> a sale, trade, payout or dispute still in progress cannot be closed until it finishes.

**Do not describe this as deleting all of a member's data.** It is not what the server does, and
a declaration that overstates the outcome is the same defect Req 7.8 forbids in the UI — the
stub this flow replaced promised permanent deletion and then did nothing.

**Do not declare a web deletion URL.** Play accepts one, and it would be the natural answer
here, but the web app has no surface for it: `closeMyAccount` exists in `lib/actions/account.ts`
and **no component calls it** (task 8.7's finding — verified again while writing this file). A
URL pointing at a page with no control on it is worse than no URL. The in-app path is the one to
declare. If a web surface is built later, add the URL as well rather than instead: Play prefers
both.

---

## 6. Capabilities the app hands off to the website (Req 10.7)

**Listing copy must not describe any of these as something the app does.** Each is an announced
browser handoff — the control says it opens the website before it does — enumerated in
`lib/core/web_handoff.dart` and confirmed by task 14.1:

| Handoff | Where the affordance is |
| --- | --- |
| Identity verification (photo ID and selfie, Stripe Identity) | `features/profile/screens/identity_verification_screen.dart`, `features/profile/widgets/verification_section.dart` |
| Payout setup (Stripe Connect onboarding) | `features/profile/screens/payout_setup_screen.dart` |
| Payout reporting (what is owed, what has landed) | `features/profile/screens/my_profile_screen.dart`, `payout_setup_screen.dart` |
| Starting a cash sale — agreeing terms and paying | `features/sales/screens/purchase_flow_screen.dart` |
| Claiming a private invite | `features/invites/screens/invite_screen.dart` |
| Reporting a listing or a member | `features/listings/screens/listing_detail_screen.dart` |
| Setting a profile picture | `features/profile/screens/edit_profile_screen.dart` |
| Viewing a message attachment (and sending one) | `features/messages/widgets/message_bubble.dart`, `message_input.dart` |
| Terms of service, privacy policy | `features/profile/screens/settings_screen.dart` |

**Reviews are read-only on mobile.** Members can read a seller's rating and reviews
(`features/profile/screens/seller_profile_screen.dart`); there is no surface for leaving one. So
the listing must not promise "rate your trades" or "leave a review".

Copy that is safe to write, because the app performs it natively: browse and search the catalog,
watch a listing, create and edit a listing including its photos, make and counter offers,
message a counterparty, propose and negotiate a trade, follow a contract room through to
completion, read notifications, and close your account.

---

## 7. Content rating (IARC) answers to draft (H2)

The questionnaire is answered in the Console by the account holder. These are the answers the
build supports:

| Question | Answer | Why |
| --- | --- | --- |
| Category | Utility / Productivity / Communication (a marketplace app, not a game) | — |
| Violence, blood, horror | None | — |
| Sexual content or nudity | None | — |
| Profanity or crude humour | None authored by NoDitto | member-typed text is covered by the UGC answer below |
| Controlled substances (drugs, alcohol, tobacco) | None | — |
| Gambling or simulated gambling | None | Trading cards are traded and sold at a stated price. No chance mechanic, no loot box, no wagering. |
| Does the app let users interact or exchange content? | **Yes** | 1:1 messaging, plus listing text and photos other members see |
| Can users share their location with other users? | **No** | a listing carries a typed suburb-level label; no device location, and no member-to-member location sharing |
| Does the app let users purchase digital goods? | **No** | physical trading cards; payment happens on the website |
| Is there user-generated content, and is it moderated? | **Yes, moderated** | any member can report a listing or a member (handed off to the website, §6); staff can hide an item; confirmed fraud bans the account |
| Does the app share personal information with third parties? | **No** — see §2 | — |

Because the answer to the interaction question is yes, the rating flow will also ask about
moderation and reporting. The honest answer is that reporting exists and is reachable from the
app **as a handoff to the website**, and that staff act on the queue.

---

## 8. Region and store availability (Req 10.6)

**NoDitto trades in one region today: Australia (AU).**

`domain/region/regions.ts` is the registry, and `tradingEnabled` is true for `AU` alone. Every
other region in that table is **browsable**, not tradeable.

What that means for the Console:

- **Distribute to Australia.** Listing another country invites members who can browse and can
  never complete a contract, which is worse than being absent from that store.
- **Prices are in AUD.** Currency comes from the region table.
- Do not write listing copy implying international trading. A contract runs inside one region:
  the orchestrators refuse a cross-region cash sale or trade through
  `checkRegionCompatibility`, and an absent region is refused rather than waved through.

**Two region values, and the store copy must not blur them:**

- **Trading_Region** (`profiles.region_code`) is the jurisdiction a member trades in. It is
  **stated by the member** at onboarding, gates contracts, must agree with the country on their
  Stripe payout account, and **never comes from an IP address**. In the app it is a choice on
  `features/profile/screens/edit_profile_screen.dart`, offered only for regions where trading is
  enabled.
- **Browse_Region** is a display scope for the catalog and may be guessed from the request. It
  governs what a visitor sees and nothing else.

So: never describe the app as detecting where a member is in order to trade. It asks.

---

## 9. Vocabulary for all store-facing copy (Req 10.4)

From `.kiro/steering/product.md`. These are not stylistic preferences.

| Say | Never say | Why |
| --- | --- | --- |
| **NoDitto** | CardTrade | CardTrade is the repo, the Flutter package and the database schema. It is not a name a member sees. |
| **binder or bulk listing** | shopfront | `SHOPFRONT` is the internal `listing_kind`. And any copy about one must state that **nothing is held**: on every other listing, opening a contract reserves the goods. |
| **trade collateral**, described as a **temporary card hold** | escrow (for a trade), DittoBond | Trade collateral is an uncaptured card authorisation. No money moves and none reaches the platform, so "escrow" would claim the platform holds funds it does not. |
| **held in escrow** — for a **cash sale** only | — | Cash-sale funds genuinely are collected and held by the platform until the buyer accepts. Accurate here, and only here. |
| **trading cards**, the card games by name | collectibles | Member copy is cards-only, which is also why the `pubspec.yaml` description says trading cards. |
| **photo ID check** — for identity only | — | The identity step really is a document-and-selfie check. Never say it about payout setup. |

The shipped `pubspec.yaml` description is already written to this standard and is a usable
starting point for the short description:

> NoDitto — buy, sell and trade trading cards, with your payment held in escrow and swaps backed
> by a temporary card hold.

---

## 10. Graphics inventory (Req 10.5) — H3, cannot be captured yet

**None of this can be produced yet.** No signed release build exists: a release task fails closed
on the absent `flutter_app/android/key.properties` (D12), and Req 10.5 asks for screenshots
captured **from a release build** — a debug build carries debug affordances and is not the thing
members will see. Generate the keystore and build the bundle first (`BUILD.md`), then capture.

Required and optional assets:

| Asset | Spec | Count | Status |
| --- | --- | --- | --- |
| App icon | 512 × 512, 32-bit PNG, full square (Play masks it and applies its own corner radius) | 1 | Blocked on H4 — the shipped mark is D11's provisional monogram |
| Feature graphic | 1024 × 500, JPEG or 24-bit PNG, **no alpha channel** | 1 | Not authored |
| Phone screenshots | PNG or JPEG, each side between 320 px and 3840 px, up to 8 MB each; 1080 × 1920 portrait is the usual choice | 2 minimum, 8 maximum | Blocked on H3 |
| 7-inch tablet screenshots | same format rules, tablet aspect | up to 8 | Only if tablet support is declared; the phone layouts are what `.kiro/specs/mobile-visual-parity/` baselined |
| 10-inch tablet screenshots | same | up to 8 | as above |
| Promo video | a YouTube URL | optional | Not planned for v1 |

Sources for the specs above: [Add preview assets to showcase your app](https://support.google.com/googleplay/android-developer/answer/9866151)
and [Google Play icon design specifications](https://developer.android.com/distribute/google-play/resources/icon-design-specifications).
(Content was rephrased for compliance with licensing restrictions.)

**Screens to capture, and why each one:** every frame must show a capability the app actually
performs (§6), so no screenshot may feature a browser page or a handoff sheet.

1. **Catalog** — the product in one image. Real listings, region AU, no empty state.
2. **Listing detail** — photos, price, condition, seller rating.
3. **Contract room (cash sale)** — the progress rail and the money table. This is the
   differentiator; the caption may say funds are held until the buyer accepts.
4. **Trade room or trade proposal** — captions must say **temporary card hold**, not escrow.
5. **Conversation** — messaging inside a contract.
6. **Profile / verification** — the two steps as the app presents them. Careful: the button on
   this screen says it opens the website, so either crop it out or caption it honestly.
7. *(optional)* **Offers** or **My listings** — depth of the seller flow.

Capture rules, so a reviewer sees no contradiction with §2 and §6:

- Signed release build on a real device, in both light and dark if both are shown.
- **No real member data.** Use seeded demo content (`supabase/seed.sql`) or accounts created for
  the purpose. No real name, real address, real email, real card, real payout figure.
- No debug banner, no placeholder text, no empty state, no error state.
- Nothing that displays a provider reference, a legal name, or an identity document field.
- Manual check **M15** in `design.md` is this capture; **M16** is the pass afterwards that reads
  every declaration in this file back against the bundle.

---

## 11. Final pass before submitting

1. Every §2 row still maps to a capability in the bundle being uploaded (**M16**).
2. §4 still says "nothing transmitted" — or the vendor binding landed and §4 was rewritten with
   it.
3. §5's wording matches the dialog in `settings_screen.dart`, which matches what
   `accountClosureOrchestrator.ts` does.
4. No sentence anywhere in the listing claims a §6 handoff as an in-app capability, and none
   promises leaving a review.
5. §9's vocabulary holds in the short description, the full description and every screenshot
   caption.
6. Distribution is Australia only (§8).
7. Screenshots came from the signed build, not a debug build, and contain no real member data.
