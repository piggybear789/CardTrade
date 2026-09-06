# NoDitto for Android — build and release

This is the build document for `flutter_app/`. **Android is the shipped platform target of
this release** (Req 11.1). There is no iOS artifact and no iOS command anywhere in this
document, because `flutter_app/ios/` does not exist and no such command could run against this
tree — see [Platform scope](#platform-scope).

Every command below is written for **Windows** `cmd` / PowerShell and was checked against this
tree. Where something has not been verified, this document says so rather than stating it as
fact. There is no CI pipeline for the mobile app; every step here is run by hand.

Product naming, for copy and for store material: the app is **NoDitto**. `cardtrade` remains
the Dart package name, the repo name and the Postgres schema, which is what
`.kiro/steering/product.md` licenses. A member never sees it.

---

## Contents

- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [App identity](#app-identity)
- [Release signing](#release-signing)
- [Release sequence: clean checkout to signed App Bundle](#release-sequence-clean-checkout-to-signed-app-bundle)
- [Release artifacts and store requirements](#release-artifacts-and-store-requirements)
- [Deep links](#deep-links)
- [Platform scope](#platform-scope)
- [Website handoffs in this release](#website-handoffs-in-this-release)
- [Error reporting: what a release build does today](#error-reporting-what-a-release-build-does-today)
- [Verification](#verification)
- [Manual review register](#manual-review-register)

---

## Prerequisites

| Need | Notes |
| --- | --- |
| Flutter SDK | Dart SDK constraint is `>=3.8.0 <4.0.0` (`pubspec.yaml`) |
| JDK 17 | `build.gradle.kts` sets `sourceCompatibility`/`targetCompatibility`/`jvmTarget` to 17 |
| Android SDK, platform 37 | `compileSdk = 37` |
| `keytool` | ships with the JDK; used once, in [Release signing](#release-signing) |
| Node (for icon regeneration only) | `node tool/generate_brand_icons.mjs`, dependency-free |

Run `flutter doctor` first. Nothing in this document works around a red line there.

---

## Configuration

Configuration reaches the app through `--dart-define-from-file`, read by
`lib/core/env.dart` (`Env`). **There are no Gradle product flavors** — the only "flavor" is
which `config/*.env` file the build command names.

| Build | Command file | Tracked? |
| --- | --- | --- |
| Local development | `config/dev.env` | no (git-ignored) |
| Release / store upload | `config/prod.env` | no (git-ignored) |
| Template for the above | `config/prod.env.example` | **yes**, and it must never hold a real value |

`config/staging.env` is git-ignored but **does not exist** in this tree. There is no staging
build today; add the file and it is picked up by naming it on the command line.

A release build must read `config/prod.env` and must not read `config/dev.env` (Req 6.8).

### Required_Config_Keys

These four are validated at startup by `lib/core/config_gate.dart`. Under `kReleaseMode` a
missing or malformed one is fatal: the app shows a configuration-failure screen naming the key
and exposes no member surface. Under debug it is reported on a visible in-app surface and the
app continues. Strictness keys off the **build mode**, never off `PRODUCTION` (design D4).

| Key | Rule | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | non-empty, absolute `https` with a host | no baked-in default (design D5) |
| `SUPABASE_ANON_KEY` | non-empty | the **anon** key; a service-role key must never appear in a bundle |
| `STRIPE_PUBLISHABLE_KEY` | non-empty and prefixed `pk_` | an `sk_` / `rk_` / `whsec_` value is reported as *missing*, not accepted (Req 6.5) |
| `WEB_APP_URL` | non-empty, absolute `https` with a host | **required but defaulted** — see below |

**`WEB_APP_URL` is required-but-defaulted, and that is deliberate.** `lib/core/env.dart` keeps
a `defaultValue` of the production origin for this one key, so omitting it does not fail the
gate — it falls back to the same value. The gate still rejects a malformed *override* (no
scheme, plain `http`, embedded whitespace), which is the realistic way this key goes wrong in a
`.env` file. Set it explicitly anyway: the residual risk is a stale host the day the production
origin changes. The reasoning for the inconsistency with design D5 is recorded on the field
itself in `env.dart`; this document does not contradict it.

`WEB_APP_URL` is load-bearing twice over — it is the handoff target *and* the origin of every
mobile API call, since `ApiRoutes.base` is `WEB_APP_URL + /api/mobile`.

### Optional keys

| Key | Default | Notes |
| --- | --- | --- |
| `DEFAULT_REGION` | `AU` | browse default only; never becomes anyone's trading region |
| `PRODUCTION` | `false` | **names** the environment. Controls no validation and disables no check (D4) |
| `ERROR_REPORTER_DSN` | empty | empty is the current, valid state — see [Error reporting](#error-reporting-what-a-release-build-does-today) |

Nothing in `config/*.env` may be a service-role key or a Stripe secret key (Req 6.4). The file
is compiled into a bundle that ships to devices, so anything the app can read is disclosed.

---

## App identity

`applicationId` is **`app.noditto`** — the reverse DNS of `noditto.app` (design D1). It is set in
`android/app/build.gradle.kts` alongside a matching `namespace`, and the Kotlin source sits at
`android/app/src/main/kotlin/app/noditto/MainActivity.kt`.

**`applicationId` is fixed at the first store upload and can never be changed afterwards**
(Req 1.8). A Play listing is bound to it: changing it later means a new listing, a new install
base and no upgrade path for anyone. Check it before the first upload; after that there is
nothing to check.

`android:label` is `NoDitto`. `pubspec.yaml` keeps `name: cardtrade`.

---

## Release signing

**No keystore exists in this repository and none ever will** (design D12). A release Gradle
task fails closed until you create one and write `android/key.properties`. That failure is the
intended behaviour, not a broken tree: the message names this section by name, so if you arrived
here from a `GradleException` you are in the right place.

### 1. Create the upload keystore

Run this once, from anywhere, on the machine that will build releases. Point `-keystore` at a
directory **outside this repository**:

```cmd
keytool -genkeypair -v -keystore C:\Users\<you>\keys\noditto-upload.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

`keytool` prompts for the keystore password, the key password and a distinguished name. Nothing
it asks for belongs in this repository, in a commit message, or in a terminal transcript that is
pasted anywhere.

**Keep the keystore outside the repository.** `flutter_app/.gitignore` refuses `key.properties`,
`*.jks` and `*.keystore` across the whole subtree, but an ignore rule is a second line of
defence; a path that `git add -A` cannot reach is the first.

Back the keystore up somewhere you will still have in three years, together with both passwords.

### 2. Write `key.properties`

Copy the tracked template and fill it in:

```cmd
copy android\key.properties.example android\key.properties
```

Four fields, all read by `android/app/build.gradle.kts`:

| Field | Meaning |
| --- | --- |
| `storeFile` | absolute path to the keystore, outside the repo. Forward slashes are fine on Windows |
| `storePassword` | password protecting the keystore file |
| `keyAlias` | the alias passed to `keytool -alias` (`upload` above) |
| `keyPassword` | password protecting that key |

`key.properties` is git-ignored and must never be committed. `key.properties.example` is
tracked and must never be given values.

Debug builds and `flutter test` do not need any of this. Only tasks whose name contains
`Release` do.

### 3. Losing the upload key

**If the upload key is lost or compromised, you cannot fix it locally.** It signs every upload
for the life of the listing, so recovery is a **store-side upload key reset**: request one in the
Play Console, register a new key, and until Google completes the reset no update can be uploaded
at all. There is no way to sign around it and no way to re-derive the old key.

Note the distinction that matters here and again under [Deep links](#deep-links): Play App
Signing means the **upload key** is what you sign with, and a different **app signing key**,
held by Google, is what devices verify. That is why an upload key reset is recoverable at all —
and why the App Links fingerprint is the app signing key's, not this one's.

---

## Release sequence: clean checkout to signed App Bundle

Every command runs on Windows (Req 11.5). Run them from `flutter_app/` unless stated otherwise.

```cmd
:: 0. One-time, if you have not already: create the keystore and key.properties.
::    See "Release signing" above. Skip this and step 5 fails closed by design.

:: 1. Dependencies.
flutter pub get

:: 2. Code generation. Required from a clean checkout: *.g.dart and *.freezed.dart
::    are git-ignored, and lib/models/** declares them as parts.
dart run build_runner build --delete-conflicting-outputs

:: 3. Static analysis. Expect: "No issues found!"
flutter analyze --no-pub

:: 4. Tests, including the golden comparisons.
flutter test --no-pub

:: 5. Create config/prod.env from the tracked template and fill in real values.
copy config\prod.env.example config\prod.env

:: 6. The release build.
flutter build appbundle --release --dart-define-from-file=config/prod.env
```

Step 6 writes:

```
flutter_app\build\app\outputs\bundle\release\app-release.aab
```

Upload that file, plus the mapping file named in the next section, to the Play Console.

**Optional, for diagnosing a Gradle-level failure only.** The Gradle wrapper can be invoked
directly from `flutter_app/android/`, which is useful when you want Gradle's own error rather
than Flutter's summary of it:

```cmd
cd android
.\gradlew.bat :app:bundleRelease
```

Do not use that as the release command — it skips the Dart build that
`--dart-define-from-file` feeds, so the artifact it produces carries no configuration.

Brand assets are checked in and are **not** part of the release sequence. Regenerate them only
when the source artwork changes: `node tool/generate_brand_icons.mjs` from `flutter_app/`.

---

## Release artifacts and store requirements

### The artifact is an App Bundle, not an APK

`flutter build appbundle` writes `build/app/outputs/bundle/release/app-release.aab`. Play
requires an AAB for new uploads and generates per-device splits from it; an APK would be
rejected and would ship every ABI and density to every device.

### Deobfuscation mapping — upload it with the bundle

R8 writes the mapping file to:

```
flutter_app\build\app\outputs\mapping\release\mapping.txt
```

**It must be uploaded to Play with the bundle** (Req 9.4). Without it every release crash report
arrives unsymbolicated and is not actionable.

Note the path: the Flutter Gradle plugin redirects the module build directory to
`flutter_app/build/app`, so the mapping is **not** under `android/app/build/`. The same directory
also receives `usage.txt`, `seeds.txt`, `resources.txt`, `configuration.txt` and
`missing_rules.txt`. Read `missing_rules.txt` first when a shrinking failure turns up in manual
check M10 — it names the keep rules R8 concluded were absent.

### SDK levels against the Play target-API requirement

| | Value | Where it comes from |
| --- | --- | --- |
| `minSdk` | **24** | `flutter.minSdkVersion` |
| `targetSdk` | **36** (Android 16) | `flutter.targetSdkVersion` |
| `compileSdk` | **37** | a literal in `android/app/build.gradle.kts` |

Google Play requires new apps and updates to target **Android 16 (API level 36) or higher** from
31 August 2026; before that date the floor is API 35. Source:
[Target API level requirements for Google Play apps](https://support.google.com/googleplay/android-developer/answer/11926878).
The current pin therefore satisfies the requirement on both sides of that date with no change.
(Content was rephrased for compliance with licensing restrictions.)

**Re-check this at every release** — the deadline moves annually. Check the numbers above, not
the Gradle symbols: `targetSdk` follows the Flutter pin and will move when the SDK does, while
`compileSdk` is a hand-written `37`. A compile SDK one above the target SDK is legal and normal.

### Shrinking, and what has not been verified

The `release` buildType sets `isMinifyEnabled = true` and `isShrinkResources = true`, with keep
rules in `android/app/proguard-rules.pro`.

**No signed bundle has ever been produced from this tree**, because a release task fails closed
on the missing `key.properties` (D12). Consequently the keep rules have never been evaluated by a
real R8 run and resource shrinking has never removed anything. What *was* verified:
`:app:bundleRelease --dry-run` fails on exactly one thing — the keystore message — with no
resource, manifest, dependency or AGP complaint ahead of it; and `:app:assembleDebug` succeeds as
a real build, which compiles resources and merges the manifest for real. Shrinking is the only
release-only step debug does not exercise, which is why manual check **M10** is the only thing
that can confirm the shrunk build runs.

---

## Deep links

Two transports, both declared in `android/app/src/main/AndroidManifest.xml`:

1. **App Links** — `https` on `noditto.app` with `android:autoVerify="true"`, path-scoped to
   `/t/`, `/profile`, `/onboarding` and `/listings/`. Scoped rather than host-wide on purpose: a
   host filter with no path claims every page of the web app, including ones this client cannot
   render.
2. **A custom scheme** — `noditto`, with no host. This is the fallback while App Link
   verification has not completed, which per design D10 is the state this release ships in.

`lib/core/deep_link.dart` resolves an incoming `Uri` to a screen. It is total: anything
unmatched, malformed or hostile opens the catalog silently.

### Two things that will otherwise be rediscovered painfully

**`ANDROID_APP_SIGNING_SHA256` must be set from the Play Console after the first upload, or
App Links silently do not verify.** The Digital Asset Links statement is served by the Next.js
app at `/.well-known/assetlinks.json` (`app/.well-known/assetlinks.json/route.ts`) and reads that
environment variable. Unset, it serves an empty statement list — honest, but unverified, so
`https://noditto.app/...` links fall through to the browser with no error anywhere.

**The fingerprint is the app signing key's SHA-256, not the upload key's** (design D10). Play App
Signing re-signs the bundle, so the certificate a device sees is Google's, not yours. Using the
upload key's fingerprint is the standard reason App Links fail with nothing in any log. Take the
value from the Play Console's app signing page. Manual check M7 cannot pass before this is set.

**A custom-scheme invite link must be written in the three-slash form:**

```
noditto:///t/{token}
```

With two slashes (`noditto://t/TOKEN`), `t` arrives as the URI *authority* rather than as a path
segment. `_segmentsFor` in `lib/core/deep_link.dart` folds a non-empty authority back into the
path so both shapes resolve alike, and the intent filter carries no host so both reach the app —
but an authority is **case-folded** by `Uri`, so nothing case-sensitive may ever sit there. A
token in the authority would not round-trip. Write the three-slash form and the token stays in
the path where it is safe.

---

## Platform scope

### Android only

This release ships Android. iOS is a named successor, not a silent omission (design D2).

### What an iOS release would require (Req 11.3)

None of this exists today, and no command in this document produces an iOS artifact.

| Requirement | Note |
| --- | --- |
| A **macOS build host** — a Mac or a hosted mac runner | Xcode is macOS-only. The development machine here is Windows, so this is a hard blocker, not a configuration gap |
| An **`ios/` platform folder** | `flutter_app/ios/` is absent. It would be created with `flutter create --platforms=ios .`, then every item below configured inside it. `ios/` was deliberately not scaffolded: an unbuildable platform folder looks tested and is a worse lie than an absent one |
| An **Apple bundle identifier** | the iOS counterpart to `applicationId`, registered in the Apple Developer account. Like `applicationId` it is effectively permanent once a listing exists |
| A **signing identity** | an Apple Developer Program membership, a distribution certificate and a provisioning profile, all of which live on the mac host |
| Per-platform work the Android side already has | Universal Links (an `apple-app-site-association` file and an associated-domains entitlement) in place of App Links, an `Info.plist` URL scheme in place of the `noditto` intent filter, launcher icon and launch screen assets, and permission usage strings for photo library access |

Only when all of that exists does an iOS build command become meaningful. Until then this
document names none: Flutter's iOS packaging command would fail immediately for want of `ios/`,
and on Windows it could not run even with the folder present.

### `flutter_app/web/` is not a shipped target

`flutter_app/web/` exists and is **not** shipped (Req 11.4, design D8). No web artifact is built,
uploaded or served from it, and `flutter build web` is not part of any release.

It remains because it is what lets a widget be debugged in a desktop browser during development,
and regenerating it later costs more than this paragraph. Deleting it was considered and
rejected as churn; leaving it undocumented was rejected too, because then "export" is ambiguous.
Treat anything under it as a development convenience with no release meaning.

---

## Website handoffs in this release

Some capabilities open the website instead of running in the app. Every affordance that does
this **says so before the browser opens** (Req 12.2) and names the page it will land on, because
a member cannot read the address bar of a browser that has not opened yet.

The complete list of remaining handoffs in this release (Req 12.8). `lib/core/web_handoff.dart`
is the single place these URLs are built.

| Handoff | Why it hands off |
| --- | --- |
| **Identity verification** | needs a Stripe Identity session, created server-side with the secret key. **Accepted v1 scope** — see below |
| **Payout setup** (Connect onboarding) | needs a Stripe Connect onboarding link, also server-side. **Accepted v1 scope** — see below |
| **Payout reporting** | `domain/payouts/payoutReadModel.ts` has no mobile equivalent. A payout figure that disagreed with the website would be worse than no figure |
| **Starting a Cash_Sale** | **deliberate v1 decision** — see below |
| **Claiming a private invite** (`/t/{token}`) | claiming opens a Cash_Sale or a Trade, so the Identity_Gate, the region check and the seller-identity snapshot all apply, and no mobile endpoint fronts them. The invite is claimed where those guards live |
| **Reporting a listing or a member** | `lib/actions/reports.ts` is a Server Action with no mobile endpoint; the report is filed where the moderation queue is written |
| **Setting a profile picture** | needs the crop-and-upload path the website owns. A caption saying "not available" with no way to get there is the same gap with the member given nothing to do about it, so it is an announced handoff instead |
| **Message attachments** | attachments live in the **private** `message-attachments` bucket. Rendering one needs the participation-checked signing the website does server-side. The only ways to close this on the phone would be a public bucket or a service-role credential in a bundle, and Req 12.7 rules out both. The bubble names the attachment and opens the thread on the web |
| **Terms** | a website page |
| **Privacy** | a website page |

### Accepted v1 scope: identity verification and payout onboarding (Req 12.3)

Both hand off to the website and **this release accepts that**. Both need a server-created Stripe
session or link, and both are one-time flows a member completes once and rarely revisits.
Rebuilding either natively would duplicate the gate evaluation that must have exactly one
definition, for a screen most members see once.

### Deliberate v1 decision: starting a Cash_Sale still opens the website (Req 12.4)

`app/api/mobile/cash-sale/initiate` exists, and buying **still** hands off through
`WebHandoff.buyListing`. Recorded here as a decision rather than left as a discrepancy.

The reason is that opening a contract is only the first step of the flow. The steps immediately
after it — the seller's identity disclosure confirmation, negotiating line items on a binder
listing, and the card payment that is the Commitment_Point — have no complete native surface, so
a native `initiate` would create a live contract on the phone and then send the member to the
website to do anything with it. That is a worse outcome than starting on the website: a
half-native money path has two places to get the same rule wrong. `buyListing` carries the
written request and the offered price through in the URL so nothing is retyped.

Revisit this when the payment surface is native, not before.

---

## Error reporting: what a release build does today

`lib/core/observability/error_reporter.dart` is a seam with the hooks wired
(`FlutterError.onError`, `PlatformDispatcher.instance.onError`, and a `runZonedGuarded` around
`runApp`) and **no vendor SDK bound** (design D13). No provider has been chosen, so a release
build records errors to the device log and **sends nothing off the device**.

Consequences, both stated rather than discovered:

- Manual check **M14** (a crash report arrives) is **blocked**, not failing. With no binding
  there is no reporter for a report to arrive in.
- Because nothing leaves the device, there is no diagnostic-data obligation in the Play Data
  safety form today. Setting `ERROR_REPORTER_DSN` changes that: errors would then be transmitted
  to a third party, and the Data safety declaration must be updated in the same change.

---

## Verification

Run from `flutter_app/`:

```cmd
flutter analyze --no-pub
flutter test --no-pub
```

Recorded baselines to preserve: `flutter analyze --no-pub` reports "No issues found!";
`flutter test --no-pub` reports at least 903 passed / 1 skipped with no failures, including 156
golden comparisons.

**The goldens were baselined on Windows.** Changing a bundled font or a theme token re-baselines
all 156 of them, which is a reason to leave both alone.

Run from the repository root:

```cmd
npm run audit:mobile
npx vitest --run --project domain
npx vitest --run tests/unit/mobileRpcContract.test.ts
npx vitest --run tests/unit/mobileDomainAgreement.test.ts
npx vitest --run tests/unit/mobileThemeAgreement.test.ts --testTimeout=30000
```

`--testTimeout=30000` on the theme agreement test is a recorded runner limit on this machine, not
a failing assertion.

---

## Manual review register

Automated tests cannot see a launcher. Each item below is a **human check on a physical Android
device running the signed release bundle** (Req 11.6). Copied from `design.md` so it is performed
rather than assumed.

| # | Check | Pass condition | Requirement |
| --- | --- | --- | --- |
| M1 | Launcher icon on a real launcher | NoDitto mark legible at every launcher size, no stock Flutter artwork, adaptive mask does not clip the mark | 5.1–5.4 |
| M2 | Monochrome icon in themed-icon mode | mark readable as a single-colour silhouette | 5.3 |
| M3 | Splash in light and dark system theme | NoDitto mark on the app background, no white flash, no visible theme swap into the first screen | 5.5 |
| M4 | App name on launcher and in Settings → Apps | reads `NoDitto` | 1.4 |
| M5 | Deep link, cold start | app not running, tapping an invite link opens the invite for that token | 4.3, 4.8 |
| M6 | Deep link, signed out | link target resumes after sign-in rather than landing on the catalog | 4.7 |
| M7 | App Link verification | after install from Play, the https link opens the app without a chooser | 4.1, 4.9 |
| M8 | Avatar crop in the signed release build | crop completes and returns; no crash | 3.5, 9.3 |
| M9 | Notification permission prompt | appears at first notification need with context, denial leaves the app usable | 3.2, 3.3 |
| M10 | Shrunk-build walkthrough | sign-in, catalog, listing detail, a contract room, messaging, avatar crop, closure entry all work | 9.3 |
| M11 | Configuration failure | a release build with a deliberately blank `STRIPE_PUBLISHABLE_KEY` shows the failure screen and no member surface | 6.2 |
| M12 | Closure refusal on a live contract | refusal names the blocking category in member language | 7.3 |
| M13 | Closure success | account closes, sign-in stops working, the public profile no longer shows the previous display name or avatar | 7.2, 7.5 |
| M14 | Crash report arrives | a deliberately thrown release-mode error appears in the reporter with a symbolicated stack, carrying no legal name, address or token | 8.1, 8.4 |
| M15 | Screenshots | captured from the signed release build at the required densities, showing no placeholder or debug affordance | 10.5 |
| M16 | Store declarations against the build | every Data safety entry corresponds to a capability the bundle ships, and no listing sentence describes a website handoff as an in-app capability | 10.2, 10.7 |

Two of these carry an extra obligation from the decision record:

- **M1 and M2 are performed twice.** Once against the provisional monogram of design D11, and
  again against the final artwork when a designer supplies it. Mask-clipping and the
  single-colour-silhouette reading are properties of the *mark*, not of the pipeline that
  generates it, so passing them on the placeholder says nothing about the replacement.
  Regeneration is one command (`node tool/generate_brand_icons.mjs`) and changes no code.
- **M14 is blocked until design D13's reporter binding is chosen.** With the no-op bound there is
  no reporter for a report to arrive in, so the check cannot be performed at all — blocked, not
  failed. See [Error reporting](#error-reporting-what-a-release-build-does-today).

Store listing and policy material — privacy policy URL, Data safety answers, screenshots, content
rating, the account-deletion declaration and the trading-region statement — belongs in
`flutter_app/STORE.md` next to this file. M15 and M16 are checked against it. At the time this
document was written that file had not been added yet; if it is still absent, the store material
has not been authored and the submission is not ready regardless of the state of the bundle.
