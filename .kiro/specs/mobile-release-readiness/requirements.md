# Requirements Document

## Introduction

`flutter_app/` is feature-shaped and, since `.kiro/specs/mobile-visual-parity/` completed
its 45 tasks, visually in agreement with the web app at phone widths. It is also
**not shippable**. This spec closes the gap between "the app looks and behaves right on a
developer's device" and "a signed artifact a store will accept and a member can trust".

Nothing here is presentation work. `.kiro/specs/mobile-visual-parity/` owns colour, type,
spacing, shell and screen composition, and this spec does not restate or revisit any of it —
in particular because the 156 golden references were baselined on Windows (`GoldenHost`), so
touching a bundled font or a theme token re-baselines all of them. That is a reason to leave
them alone, not a task.

### Measured state, not assumed state

The following were read off the tree before this document was written. They are the premises
of every requirement below and are not re-derived anywhere in it.

**Export blockers**

1. **There is no `flutter_app/ios/` directory.** `flutter_app/BUILD.md` nonetheless
   documents `flutter build ipa --release`, a command that cannot run against this tree at
   all. The developer's machine is Windows, so an iOS artifact needs macOS or a hosted mac
   runner regardless of whether the platform folder exists.
2. **The release build is debug-signed.** `flutter_app/android/app/build.gradle.kts` still
   carries the scaffolded TODO and sets
   `signingConfig = signingConfigs.getByName("debug")` on the `release` buildType. There is
   no keystore, no `key.properties`, and no `.gitignore` entry for either. Play rejects a
   debug-signed App Bundle.
3. **App identity is the repo name, not the product name.** `namespace` and `applicationId`
   are both `com.cardtrade.cardtrade`; `android:label` is `"CardTrade"`; `pubspec.yaml`
   declares `name: cardtrade` with
   `description: CardTrade — peer-to-peer collectibles marketplace with trustless escrow.`;
   the Kotlin source lives at
   `android/app/src/main/kotlin/com/cardtrade/cardtrade/MainActivity.kt`. Per
   `.kiro/steering/product.md`, the member-facing product is **NoDitto** (`NoDitto.app`) and
   CardTrade is the repo, the Flutter package and the Postgres schema — not a name a member
   sees. The product is also cards-only in member copy, so "collectibles marketplace" is
   wrong on two counts at once. `applicationId` is **immutable after the first Play upload**,
   which is what makes this a pre-export decision rather than a cleanup.

**Runtime and policy gaps**

4. **The manifest is the scaffold.** `android/app/src/main/AndroidManifest.xml` declares
   `android.permission.INTERNET` and nothing else. Absent: `POST_NOTIFICATIONS`, which
   Android 13+ requires and `flutter_local_notifications` ^22.3.0 depends on; the
   `com.yalantis.ucrop.UCropActivity` declaration that `image_cropper` ^12.2.1 requires,
   whose absence is a **crash at avatar-crop time in release as well as debug**; and any
   deep-link `intent-filter` — the only filter present is MAIN/LAUNCHER. BUILD.md prescribes
   both a custom scheme and https App Links, and neither exists, so a `Deal_Invite` link
   (`/t/[token]`) and the `?identity=complete` / `?payouts=complete` return markers have no
   native path back into the app.
5. **Brand assets are the scaffold.** The launcher icon is the stock Flutter
   `ic_launcher.png` in five mipmap buckets; the splash is the generated
   `launch_background.xml`. There is no `mipmap-anydpi-v26`, no adaptive icon and no
   monochrome layer. `assets/images/` and `assets/images/empty_states/` are declared in
   `pubspec.yaml` and contain only `.gitkeep`.
6. **Account deletion is a stub that lies.**
   `flutter_app/lib/features/profile/screens/settings_screen.dart` `_handleDeleteAccount`
   raises a danger dialog promising permanent deletion and then shows a SnackBar reading
   "Account deletion is handled by support for now." A search of `app/`, `components/`,
   `lib/` and `supabase/` found **no account deletion capability anywhere in the product** —
   the web app cannot do it either. Google Play requires an app that supports account
   creation to offer in-app deletion or a declared web deletion URL. This product has a
   wrinkle beyond the policy: deletion must be refused or deferred while a member has money
   in flight (live Cash_Sales, uncaptured Trade_Collateral, queued payouts, open disputes)
   and must not destroy what arbitration and accounting read, so the shape is closer to
   anonymise-and-detach than to a row delete.
7. **There is no crash or error reporting of any kind.** `main.dart` uses `debugPrint`.
8. **There is no R8/ProGuard configuration and no keep rules.** A shrunk release build has
   never been exercised.
9. **Missing configuration is a debug line, not a failure.** `main.dart` `debugPrint`s when
   `Env.stripePublishableKey` is empty and continues. `config/dev.env` and
   `config/prod.env.example` exist; `config/prod.env` does not.
10. **`flutter_app/web/` exists** and no document says whether it is a shipped target, which
    changes what the word "export" means.

**Inherited functional scope**

11. `.kiro/specs/mobile-parity/` **task 12 is open and unstarted** (12.1–12.5): serve the
    derived contract step plan from a mobile read endpoint and delete the two hard-coded step
    lists in `features/trades/widgets/trade_progress_rail.dart` and
    `features/sales/screens/sale_room_screen.dart`. That spec owns the work. This spec treats
    it as a release precondition and does not restate it.
12. Buying still hands off to the website through `WebHandoff.buyListing` even though
    `app/api/mobile/cash-sale/initiate` exists. Identity and payout onboarding hand off too.
    Message attachments can neither be sent nor opened from Flutter, because there is no
    mobile signing route for the private `message-attachments` bucket. Reviews are read-only.

### Three decisions, recorded with what they reject

These were put to the user, who answered "just get it done". Recording them as reasoned
decisions rather than as settled trivia, because two of the three are irreversible.

**App identity — display name NoDitto, `applicationId` `app.noditto`.**
`app.noditto` is the reverse DNS of `noditto.app`. The internal Dart package name `cardtrade`
stays, which is exactly what `.kiro/steering/product.md` licenses: CardTrade is the repo, the
package and the schema. *Rejected:* keeping `com.cardtrade.cardtrade` — it is doubly wrong
(repo name, and doubled segment), and after the first upload it can never be corrected.
*Rejected:* `app.noditto.cardtrade` — a third segment naming the repo inside the member-facing
id buys nothing and reads as a mistake. Note the mechanical cost: changing `applicationId`
means moving the Kotlin package directory and changing `namespace` in the same pass.

**Platform scope — Android only for this export.**
iOS is a named successor, not a silent omission; it needs a mac build host, which this machine
is not. *Rejected:* scaffolding `ios/` now — an unbuildable platform folder is a worse lie than
an absent one, because it looks tested. The iOS deliverable in **this** spec is that BUILD.md
stops documenting an `ipa` build that cannot run and instead records what iOS would require.

**Account deletion — build it once on the server and have Flutter reach it.**
*Rejected:* a mobile-only deletion flow — it would be the second implementation of a rule the
web app also lacks, and the money-in-flight refusal has to live where the contracts do.
*Rejected:* shipping the SnackBar behind the existing dialog — a dialog that promises permanent
deletion and then does nothing is a false statement to the member, independent of any store
policy. Whether the mobile entry point is an in-app flow or a link to a declared web URL is a
design question; that the stub cannot ship is not.

### Hard constraints carried forward

Every one of these is a rule from `.kiro/steering/flutter.md`, `.kiro/steering/tech.md` or a
preceding spec, and each appears again as an explicit acceptance criterion in Requirement 13.

- **No ninth Dart domain port.** `flutter_app/lib/domain/` holds eight advisory ports and
  `tests/unit/mobileDomainAgreement.test.ts` pins them.
- **No new `.rpc()` call site in Dart**, and no direct table write to a contract table
  (`cash_sales`, `cash_sale_items`, `trades`, `trade_items`, `pre_auth_holds`, the
  delivery-detail tables). New server capability goes behind an endpoint under
  `app/api/mobile/**` that delegates to the existing orchestrator or server action, paired in
  `tests/unit/mobileRpcContract.test.ts`.
- **No `GRANT EXECUTE` on a `cardtrade` function to `authenticated`.**
- **No credential surface change**, and never a service-role key or a Stripe secret in an app
  bundle.
- **No guard test weakened, skipped or allowlisted.** The measured green baseline to preserve:
  `flutter analyze --no-pub` → "No issues found!"; `flutter test --no-pub` → 903 passed /
  1 skipped including 156 golden comparisons; `npx vitest --run --project domain` → 691 passed
  across 55 files; `npm run audit:mobile` → 0 RPC call sites, 46/46 endpoints paired, 7 direct
  writes all non-contract.
- `tests/unit/mobileThemeAgreement.test.ts` needs `--testTimeout=30000` on this machine. That
  is a recorded runner limit, not a failing assertion.

## Glossary

- **App_Identity**: the set of values that name the application to the platform and the
  store: `applicationId`, `namespace`, the Kotlin package directory, `android:label`, and the
  `pubspec.yaml` `name` and `description`.
- **Release_Build**: the artifact produced by `flutter build appbundle --release` from
  `flutter_app/`.
- **Signing_Config**: the Gradle signing configuration applied to the `release` buildType,
  together with the keystore and `key.properties` it reads.
- **Manifest**: `flutter_app/android/app/src/main/AndroidManifest.xml`.
- **Runtime_Config**: the values `flutter_app/lib/core/env.dart` (`Env`) exposes, sourced from
  a `config/*.env` file at build time.
- **Required_Config_Key**: a Runtime_Config key without which a member-facing capability is
  inoperable. `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `STRIPE_PUBLISHABLE_KEY` and the web
  handoff base URL are Required_Config_Keys.
- **Crash_Reporter**: the component that receives uncaught Dart errors, Flutter framework
  errors and platform errors from a Release_Build.
- **Account_Closure_Service**: the single server-side capability that closes a member account,
  reachable by both the web app and Flutter.
- **Money_In_Flight**: a state in which a member is party to value the platform has not
  settled: a Cash_Sale in any non-terminal status, an uncaptured Trade_Collateral
  authorisation, a queued or failed payout, or an open dispute or arbitration case.
- **Build_Docs**: `flutter_app/BUILD.md`.
- **Store_Listing_Artifacts**: the material a Play submission needs that is not code — privacy
  policy URL, Data safety declarations, screenshots, feature graphic, content rating answers,
  and the account-deletion declaration.
- **Verification_Suite**: the commands named in Requirement 13 together with their recorded
  baselines.
- **Advisory_Domain_Port**: one of the eight hand-ported rule modules under
  `flutter_app/lib/domain/`, advisory because the server re-evaluates every one of them.

## Requirements

### Requirement 1: App identity and immutable identifiers

**User Story:** As a member installing the app, I want the app to be called NoDitto
everywhere I see it, so that the thing on my launcher matches the product I signed up to.

#### Acceptance Criteria

1. THE App_Identity SHALL set `applicationId` to `app.noditto`.
2. THE App_Identity SHALL set the Gradle `namespace` to the same value as `applicationId`.
3. THE App_Identity SHALL place `MainActivity.kt` in a Kotlin source directory whose path
   matches `namespace`.
4. THE App_Identity SHALL set `android:label` to `NoDitto`.
5. THE App_Identity SHALL set the `pubspec.yaml` `description` to member-facing copy that
   names NoDitto and describes trading cards rather than collectibles.
6. THE App_Identity SHALL keep the `pubspec.yaml` `name` as `cardtrade`.
7. WHEN a Dart import path or a generated file references the previous Kotlin package
   `com.cardtrade.cardtrade`, THE App_Identity SHALL be updated so that no reference to that
   package remains in `flutter_app/android/`.
8. THE Build_Docs SHALL record that `applicationId` is fixed at the first store upload and
   SHALL name `app.noditto` as the chosen value.

### Requirement 2: Release signing and keystore handling

**User Story:** As the developer, I want release artifacts signed with a real upload key I
control, so that the store accepts the upload and future updates remain installable.

#### Acceptance Criteria

1. THE Signing_Config SHALL apply a release signing configuration to the `release` buildType.
2. THE Signing_Config SHALL read the keystore path, key alias and passwords from a
   `key.properties` file that is not tracked in version control.
3. IF `key.properties` is absent, THEN THE Release_Build SHALL fail with a message naming the
   missing file and the Build_Docs section that explains how to create it.
4. THE repository `.gitignore` SHALL exclude `key.properties` and every `*.jks` and
   `*.keystore` file under `flutter_app/`.
5. THE Release_Build SHALL contain no reference to `signingConfigs.getByName("debug")`.
6. THE Build_Docs SHALL record the keystore generation command, the values `key.properties`
   requires, and that loss of the upload key requires a store-side key reset.
7. THE Signing_Config SHALL keep keystore passwords and the keystore itself out of every
   tracked file and every build log.

### Requirement 3: Manifest completeness

**User Story:** As a member, I want notifications, avatar cropping and NoDitto links to work
on my device, so that the app does not fail at the moment I use it.

#### Acceptance Criteria

1. THE Manifest SHALL declare `android.permission.POST_NOTIFICATIONS`.
2. WHEN the app first needs to show a local notification on Android 13 or later, THE app SHALL
   request the notification permission at runtime.
3. IF the member declines the notification permission, THEN THE app SHALL continue to operate
   and SHALL present in-app notification state without a further permission prompt in that
   session.
4. THE Manifest SHALL declare the `com.yalantis.ucrop.UCropActivity` activity that
   `image_cropper` requires.
5. WHEN a member crops an avatar image in a Release_Build, THE app SHALL complete the crop and
   return to the calling screen.
6. THE Manifest SHALL retain `android.permission.INTERNET` and SHALL declare no permission
   that no shipped capability uses.
7. THE Manifest SHALL declare a Data safety-relevant permission only where the corresponding
   Store_Listing_Artifacts entry declares the same data use.

### Requirement 4: Deep links into the app

**User Story:** As a member who taps a NoDitto invite link or returns from identity
verification, I want to land inside the app, so that the flow I started continues where I left
it.

#### Acceptance Criteria

1. THE Manifest SHALL declare an `intent-filter` for the `https` scheme on the NoDitto host
   with `android:autoVerify="true"`.
2. THE Manifest SHALL declare an `intent-filter` for a custom scheme reserved to NoDitto.
3. WHEN the app receives a Deal_Invite link path, THE app SHALL route to the invite screen for
   the token in that link.
4. WHEN the app receives a link carrying the `identity=complete` marker, THE app SHALL route
   to the verification screen and SHALL re-read Identity_Gate state from the server rather
   than from the link.
5. WHEN the app receives a link carrying the `payouts=complete` or `payouts=refresh` marker,
   THE app SHALL route to the payouts screen and SHALL re-read payout state from the server
   rather than from the link.
6. IF a received link matches no known route, THEN THE app SHALL open the catalog and SHALL
   present no error naming the link.
7. WHILE the member holds no session, THE app SHALL retain the received link target and SHALL
   resume to it after sign-in.
8. WHEN the app is not running and receives a link, THE app SHALL route to the link target
   after cold start.
9. THE deployment SHALL serve a Digital Asset Links file at the NoDitto host that names
   `app.noditto` and the upload key certificate fingerprint.

### Requirement 5: Brand assets

**User Story:** As a member, I want a NoDitto icon on my launcher and a NoDitto splash on
open, so that the app is recognisable and does not look unfinished.

#### Acceptance Criteria

1. THE Release_Build SHALL ship a launcher icon that contains no stock Flutter artwork.
2. THE Release_Build SHALL ship an adaptive icon with separate foreground and background
   layers under `mipmap-anydpi-v26`.
3. THE Release_Build SHALL ship a monochrome adaptive icon layer.
4. THE Release_Build SHALL ship a legacy raster launcher icon in each mipmap density bucket
   for platforms below API 26.
5. THE splash SHALL present the NoDitto mark on the app's own background colour in both light
   and dark system themes.
6. WHERE `pubspec.yaml` declares an asset directory, THE Release_Build SHALL ship at least one
   asset from that directory or THE declaration SHALL be removed.
7. THE brand assets SHALL introduce no new bundled font and SHALL change no theme token.

### Requirement 6: Fail-closed runtime configuration

**User Story:** As the developer, I want a misconfigured release to fail at startup rather
than in a member's payment flow, so that a missing key is my problem and never theirs.

#### Acceptance Criteria

1. WHEN a Release_Build starts, THE app SHALL validate that every Required_Config_Key holds a
   non-empty value.
2. IF a Required_Config_Key is empty in a Release_Build, THEN THE app SHALL present a
   configuration-failure screen naming the missing key and SHALL present no member-facing
   capability.
3. WHILE the build is a debug build, THE app SHALL report a missing Required_Config_Key on a
   visible in-app surface and SHALL continue to run.
4. THE Runtime_Config SHALL expose no key whose name or value is a service-role key or a
   Stripe secret key.
5. IF `STRIPE_PUBLISHABLE_KEY` does not carry a publishable-key prefix, THEN THE app SHALL
   treat the key as missing.
6. THE repository SHALL track `config/prod.env.example` and SHALL exclude `config/prod.env`
   from version control.
7. THE Build_Docs SHALL name every Required_Config_Key and SHALL state which build flavor
   reads which `config/*.env` file.
8. THE Release_Build SHALL read a production configuration file and SHALL NOT read
   `config/dev.env`.

### Requirement 7: Account closure

**User Story:** As a member, I want to close my account from the app, so that leaving NoDitto
does not require me to email support and hope.

#### Acceptance Criteria

1. THE Account_Closure_Service SHALL exist once on the server and SHALL be reachable by both
   the web app and Flutter.
2. WHEN a member requests account closure and holds no Money_In_Flight, THE
   Account_Closure_Service SHALL close the account and SHALL sign the member out of the app.
3. IF a member requests account closure while holding Money_In_Flight, THEN THE
   Account_Closure_Service SHALL refuse the request and SHALL return which category of
   Money_In_Flight blocks it.
4. WHEN the Account_Closure_Service closes an account, THE Account_Closure_Service SHALL
   retain the contract, payout and arbitration records that accounting and dispute resolution
   read.
5. WHEN the Account_Closure_Service closes an account, THE Account_Closure_Service SHALL
   remove or replace the member's profile display name, avatar, bio and social links from
   every public read path.
6. WHEN the Account_Closure_Service closes an account, THE Account_Closure_Service SHALL
   retain the identity blocklist key that refuses a fraud-banned person a second account.
7. THE Account_Closure_Service SHALL close an account only on the authenticated request of
   that account's own member.
8. THE app SHALL present the closure outcome that the Account_Closure_Service returned and
   SHALL present no dialog whose copy promises an outcome the service did not perform.
9. THE Store_Listing_Artifacts SHALL declare the account-deletion path that the app offers.
10. THE mobile closure entry point SHALL reach the Account_Closure_Service through an endpoint
    under `app/api/mobile/**` or through a declared web URL, and SHALL add no `.rpc()` call
    site and no direct table write.

### Requirement 8: Observability

**User Story:** As the developer, I want to see crashes and errors from installed builds, so
that a release failure is something I learn about rather than guess at.

#### Acceptance Criteria

1. WHEN an uncaught Dart error occurs in a Release_Build, THE Crash_Reporter SHALL record the
   error with its stack trace.
2. WHEN a Flutter framework error occurs in a Release_Build, THE Crash_Reporter SHALL record
   the error with its stack trace.
3. WHEN a platform-level error occurs in a Release_Build, THE Crash_Reporter SHALL record the
   error.
4. THE Crash_Reporter SHALL record no Identity_Gate document data, no legal name, no postal
   address, no card detail and no session token.
5. WHILE the build is a debug build, THE Crash_Reporter SHALL leave error output on the
   console and SHALL send no report.
6. WHEN an error is recorded, THE app SHALL continue to run or SHALL present an error screen,
   and SHALL present no unhandled-exception surface from the framework.
7. THE Store_Listing_Artifacts SHALL declare the diagnostic data the Crash_Reporter collects.

### Requirement 9: Shrinking and a verified release build

**User Story:** As the developer, I want a shrunk release build that runs, so that the
artifact I upload is the artifact I tested.

#### Acceptance Criteria

1. THE Release_Build SHALL enable code shrinking and resource shrinking.
2. THE Release_Build SHALL carry keep rules for every reflective dependency the app uses.
3. WHEN a Release_Build runs, THE app SHALL complete sign-in, catalog browse, listing detail,
   a contract room, messaging, avatar crop and account closure entry without a
   shrinking-induced failure.
4. THE Release_Build SHALL produce a deobfuscation mapping artifact and THE Build_Docs SHALL
   record where that artifact is written and that it must be uploaded with the bundle.
5. THE Release_Build SHALL target the API level the store requires for new uploads and THE
   Build_Docs SHALL name that level.
6. THE Release_Build SHALL produce an App Bundle rather than an APK for store upload.

### Requirement 10: Store listing and policy artifacts

**User Story:** As the developer, I want the non-code submission material ready and truthful,
so that review does not reject the release for a declaration that contradicts the app.

#### Acceptance Criteria

1. THE Store_Listing_Artifacts SHALL name a reachable privacy policy URL.
2. THE Store_Listing_Artifacts SHALL declare every category of member data the app collects,
   and each declaration SHALL correspond to a capability the Release_Build ships.
3. THE Store_Listing_Artifacts SHALL declare the payment capability the app offers and SHALL
   state that payment is processed by the payment provider rather than by NoDitto.
4. THE Store_Listing_Artifacts SHALL use member-facing vocabulary: NoDitto for the product,
   "binder or bulk listing" for a shopfront listing, and trade collateral described as a
   temporary card hold.
5. THE Store_Listing_Artifacts SHALL include screenshots captured from a Release_Build at the
   densities the store requires.
6. THE Store_Listing_Artifacts SHALL state that NoDitto trades in one region and SHALL name
   that region.
7. THE Store_Listing_Artifacts SHALL describe no capability the Release_Build hands off to the
   website as if the app performed it.

### Requirement 11: Platform scope and truthful build documentation

**User Story:** As the developer returning to this in three months, I want BUILD.md to
document only commands that run, so that I do not debug a build that was never possible.

#### Acceptance Criteria

1. THE Build_Docs SHALL name Android as the shipped platform target of this release.
2. THE Build_Docs SHALL document no `flutter build ipa` command while `flutter_app/ios/` is
   absent.
3. THE Build_Docs SHALL record what an iOS release would require, including a macOS or hosted
   mac build host, an `ios/` platform folder, an Apple bundle identifier and a signing
   identity.
4. THE Build_Docs SHALL state whether `flutter_app/web/` is a shipped target, and IF it is
   not, THEN THE Build_Docs SHALL state why the directory remains.
5. THE Build_Docs SHALL document the release command sequence from a clean checkout through a
   signed App Bundle, and every command in that sequence SHALL run on Windows.
6. THE Build_Docs SHALL name the manual checks that no automated test can perform.

### Requirement 12: Release preconditions and handoff scope

**User Story:** As the developer deciding whether to press submit, I want one list of what
must be true first and which website handoffs are acceptable in v1, so that scope is a
decision rather than an omission discovered by a member.

#### Acceptance Criteria

1. THE release SHALL treat `.kiro/specs/mobile-parity/` task 12 as a precondition, and THE
   Release_Build SHALL contain no hard-coded contract step list.
2. WHERE the app hands off to the website, THE app SHALL present the handoff as leaving the
   app before it opens the browser.
3. WHERE the app hands off to the website for Identity_Gate verification or payout
   onboarding, THE release SHALL accept that handoff and THE Build_Docs SHALL record it as
   accepted v1 scope.
4. WHERE the app hands off to the website to start a Cash_Sale while
   `app/api/mobile/cash-sale/initiate` exists, THE release SHALL record the handoff as a
   deliberate v1 decision with its reason.
5. WHERE a screen offers a control for a capability the app cannot perform, THE app SHALL
   either perform the capability, hand off to the website, or remove the control.
6. IF a member opens a conversation containing a message attachment, THEN THE app SHALL
   indicate that the attachment is viewable on the website and SHALL request no public bucket
   and no service-role credential.
7. THE release SHALL keep the `message-attachments` bucket private.
8. THE Build_Docs SHALL list every remaining website handoff in the Release_Build.

### Requirement 13: Verification and preserved baselines

**User Story:** As the developer, I want the release work verified by the same guards that
already hold this codebase together, so that shipping does not cost the invariants.

#### Acceptance Criteria

1. WHEN release work completes, THE Verification_Suite SHALL report "No issues found!" from
   `flutter analyze --no-pub`.
2. WHEN release work completes, THE Verification_Suite SHALL report at least 903 passed and no
   failures from `flutter test --no-pub`, including 156 golden comparisons.
3. WHEN release work completes, THE Verification_Suite SHALL report at least 691 passed and no
   failures from `npx vitest --run --project domain`.
4. WHEN release work completes, THE Verification_Suite SHALL report 0 Dart `.rpc()` call
   sites, every mobile endpoint paired, and every direct table write on a non-contract table
   from `npm run audit:mobile`.
5. WHEN release work completes, THE Verification_Suite SHALL pass
   `npx vitest --run tests/unit/mobileRpcContract.test.ts` and
   `npx vitest --run tests/unit/mobileDomainAgreement.test.ts`.
6. THE release work SHALL add no Advisory_Domain_Port beyond the existing eight.
7. THE release work SHALL add no Dart `.rpc()` call site and no direct Dart write to
   `cash_sales`, `cash_sale_items`, `trades`, `trade_items`, `pre_auth_holds` or a
   delivery-detail table.
8. THE release work SHALL grant `EXECUTE` on no `cardtrade` function to `authenticated`.
9. THE release work SHALL weaken, skip and allowlist no assertion in any guard test.
10. WHERE a new server capability is added, THE capability SHALL be reached through an
    endpoint under `app/api/mobile/**` that delegates to an existing orchestrator or server
    action, and THAT endpoint SHALL be paired in `tests/unit/mobileRpcContract.test.ts`.
11. WHERE `tests/unit/mobileThemeAgreement.test.ts` is run on this machine, THE
    Verification_Suite SHALL pass `--testTimeout=30000`.
12. THE release work SHALL change no bundled font and no theme token, so that the 156 golden
    references stay valid.
