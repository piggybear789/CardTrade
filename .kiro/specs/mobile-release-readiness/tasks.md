# Implementation Plan: mobile-release-readiness

## Overview

Order is driven by two things: the irreversible decision goes first (`applicationId`), and every
file that several tasks touch is written by one task per wave. `build.gradle.kts` is edited three
times (identity, signing, shrinking), `AndroidManifest.xml` three times (label, permissions,
deep links) and `main.dart` twice (config gate, error hooks) — those are sequenced, not merged,
so each change is reviewable on its own.

Languages are already fixed by the tree: TypeScript for the server capability, Dart for the
client, Kotlin DSL for Gradle. No language question arises.

`.kiro/specs/mobile-parity/` task 12 is a **precondition**, not a task here. Task 13.2 asserts
its outcome; it does not perform it.

## Tasks

- [x] 1. Settle app identity
  - [x] 1.1 Change `applicationId` and `namespace` to `app.noditto` and move the Kotlin source
    - `flutter_app/android/app/build.gradle.kts`: both values, and delete the scaffolded
      applicationId TODO
    - Move `android/app/src/main/kotlin/com/cardtrade/cardtrade/MainActivity.kt` to
      `android/app/src/main/kotlin/app/noditto/MainActivity.kt` and rewrite its `package` line
    - Leave no reference to `com.cardtrade.cardtrade` anywhere under `flutter_app/android/`
    - _Requirements: 1.1, 1.2, 1.3, 1.7_

  - [x] 1.2 Set the member-facing name and description
    - `AndroidManifest.xml`: `android:label="NoDitto"`
    - `pubspec.yaml`: keep `name: cardtrade`; replace the description with member-facing copy
      naming NoDitto and trading cards, not "collectibles"
    - _Requirements: 1.4, 1.5, 1.6_

- [x] 2. Release signing
  - [x] 2.1 Add a release signing config that fails closed
    - Load `key.properties` from `flutter_app/android/`; apply a `release` signing config
    - Throw a `GradleException` naming `key.properties` and the BUILD.md section when a release
      task runs without it
    - Remove `signingConfig = signingConfigs.getByName("debug")` and its TODO
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

  - [x] 2.2 Keep the keystore out of the repository
    - `.gitignore`: `key.properties`, `*.jks`, `*.keystore` under `flutter_app/`
    - Add a tracked `flutter_app/android/key.properties.example` with the four field names and
      no values
    - _Requirements: 2.4, 2.7_

- [x] 3. Manifest permissions and the UCrop activity
  - [x] 3.1 Declare what the dependencies require
    - `POST_NOTIFICATIONS` permission; keep `INTERNET`; declare no permission no capability uses
    - `com.yalantis.ucrop.UCropActivity` with an AppCompat no-action-bar theme
    - _Requirements: 3.1, 3.4, 3.6_

  - [x] 3.2 Request the notification permission at first need
    - Request lazily at the first point a local notification would post, not at launch
    - On denial: continue, keep the in-app notification centre working, no second prompt that
      session
    - _Requirements: 3.2, 3.3_

  - [x]* 3.3 Write widget tests for the permission branches
    - Faked permission result for grant and deny; assert no re-prompt after denial
    - _Requirements: 3.2, 3.3_

- [x] 4. Deep links
  - [x] 4.1 Add the pure link resolver
    - `flutter_app/lib/core/deep_link.dart`: sealed `DeepLinkTarget` and
      `DeepLinkTarget resolveDeepLink(Uri)`
    - Total: never throws, never returns null, unmatched → `CatalogFallbackTarget`
    - Return markers resolve to a screen and carry no verification or payout status
    - _Requirements: 4.3, 4.4, 4.5, 4.6_

  - [x]* 4.2 Write property tests for the resolver
    - **Property 6: Deep-link resolution is total and never fails open**
    - **Property 7: A Deal_Invite link round-trips to its token**
    - **Property 8: Return markers resolve to a screen and carry no state**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5, 4.6**

  - [x] 4.3 Declare the intent filters
    - VIEW + BROWSABLE on `https` for the NoDitto host with `android:autoVerify="true"`
    - VIEW + BROWSABLE on the `noditto` custom scheme
    - `<meta-data android:name="flutter_deeplinking_enabled" android:value="true"/>`
    - Add no deep-link package
    - _Requirements: 4.1, 4.2_

  - [x] 4.4 Route the resolved target
    - Router consumes `resolveDeepLink`; a Deal_Invite target opens the invite for that token
    - Verification and payout targets open their screen and re-read state from the server
    - Signed out: retain the target and resume to it after sign-in
    - _Requirements: 4.3, 4.4, 4.5, 4.7, 4.8_

  - [x] 4.5 Serve the Digital Asset Links file
    - `/.well-known/assetlinks.json` from the Next.js app naming `app.noditto` and the app
      signing key SHA-256 fingerprint
    - _Requirements: 4.9_

  - [x]* 4.6 Write a router test for the signed-out resume
    - No session, then a session; assert the final location is the link target
    - _Requirements: 4.7_

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Brand assets
  - [x] 6.1 Ship the NoDitto launcher icon
    - Source artwork under `assets/brand/`; generate legacy mipmap rasters,
      `mipmap-anydpi-v26/ic_launcher.xml`, adaptive foreground and background, monochrome layer
    - Remove the stock Flutter artwork
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 6.2 Replace the scaffolded splash
    - `launch_background.xml` plus a `values-night` counterpart: NoDitto mark on the app
      background in both system themes
    - Change no bundled font and no theme token
    - _Requirements: 5.5, 5.7_

  - [x] 6.3 Resolve the empty declared asset directories
    - Grep for widgets resolving paths under `assets/images/` and
      `assets/images/empty_states/`; ship the referenced asset, or remove the `pubspec.yaml`
      declaration where nothing resolves
    - _Requirements: 5.6_

- [x] 7. Fail-closed runtime configuration
  - [x] 7.1 Add the config validator and make it reachable
    - `flutter_app/lib/core/config_gate.dart`: pure `validateConfig(...)` returning the missing
      or malformed Required_Config_Keys; non-empty, absolute https, `pk_` prefix rules
    - `env.dart`: replace the baked-in `SUPABASE_URL` and `SUPABASE_ANON_KEY` defaults with `''`
    - Declare no key whose name or value is a service-role or secret key
    - _Requirements: 6.1, 6.4, 6.5, 6.8_

  - [x]* 7.2 Write a property test for the validator
    - **Property 5: A release build refuses to run on incomplete configuration**
    - **Validates: Requirements 6.1, 6.2, 6.5**

  - [x] 7.3 Wire the gate into startup
    - `main.dart`: validate in `_bootstrap`; under `kReleaseMode` throw into the existing
      `StartupErrorApp` listing the missing keys and exposing no member surface
    - Under debug: report on a visible in-app surface and continue
    - Gate on `kReleaseMode`, not `Env.isProduction`
    - _Requirements: 6.2, 6.3_

  - [x] 7.4 Complete the config files
    - `config/prod.env.example`: every key from the design's table
    - `.gitignore`: `config/prod.env`
    - _Requirements: 6.6_

- [x] 8. Account closure — server capability
  - [x] 8.1 Add the pure eligibility rule
    - `domain/account/accountClosure.ts`: `MoneyInFlightSnapshot`, `ClosureBlocker`,
      `evaluateClosureEligibility` returning a sorted, deduplicated blocker list
    - _Requirements: 7.2, 7.3_

  - [x]* 8.2 Write property tests for eligibility
    - **Property 1: Money in flight always blocks closure**
    - **Property 2: Blockers report exactly the categories present**
    - **Validates: Requirements 7.2, 7.3**

  - [x] 8.3 Add the migration
    - New numbered file in `supabase/migrations/`: `profiles.closed_at`, public projection
      returning the anonymised display name for a closed profile, RLS policies for the new column
    - Update `lib/supabase/database.types.ts` by hand
    - _Requirements: 7.4, 7.5_

  - [x] 8.4 Add the orchestrator and repository interface
    - `domain/orchestrator/accountClosureOrchestrator.ts`: `AccountClosureRepository`,
      `closeAccount` returning an `ActionResult`
    - Own-account guard; refusal carries the blocking categories
    - _Requirements: 7.1, 7.2, 7.3, 7.7_

  - [x] 8.5 Add the Supabase repository
    - `loadMoneyInFlight`, `anonymiseProfile`, `markClosed`, `revokeSessions`,
      `detachAuthIdentity`, plus a `createDefaultAccountClosureOrchestrator()` factory
    - Retain contract, payout, review and arbitration records; retain the fraud blocklist key
    - _Requirements: 7.4, 7.5, 7.6_

  - [x]* 8.6 Write property tests for the closure invariants
    - **Property 3: Closure retains the records that arbitration and accounting read**
    - **Property 4: Closure preserves the fraud blocklist key**
    - **Validates: Requirements 7.4, 7.5, 7.6**

  - [x] 8.7 Add the web entry point
    - `lib/actions/account.ts` (`'use server'`): authenticate, delegate to the orchestrator,
      revalidate; return the standard `ActionResult`
    - _Requirements: 7.1_

  - [x] 8.8 Add the mobile endpoint and pair it
    - `app/api/mobile/account/close/route.ts`, authenticated by `lib/api/mobileSession.ts`,
      delegating to the same orchestrator
    - Add the matching entry to `flutter_app/lib/core/api_routes.dart` — the guard pairs
      handlers and Dart entries in both directions
    - Add no `.rpc()` call site, no direct contract-table write, no `GRANT EXECUTE`
    - _Requirements: 7.1, 7.10_

  - [x]* 8.9 Write endpoint example tests
    - Authenticated self succeeds; another member's id refused; unauthenticated refused; a
      blocked closure returns its categories
    - _Requirements: 7.7, 7.3_

- [x] 9. Account closure — client
  - [x] 9.1 Replace the stub with the real flow
    - `flutter_app/lib/features/profile/screens/settings_screen.dart`: delete the
      "handled by support" SnackBar; call the endpoint
    - Dialog copy states what happens: account closes, profile stops being publicly
      identifiable, contract history retained for accounting and dispute resolution, sign-in
      stops working
    - Render a refusal as the blocking category in member language, never an enum name
    - Claim no outcome the server did not return
    - _Requirements: 7.8_

  - [x]* 9.2 Write widget tests for the three responses
    - Success, refusal, transport failure; assert no success copy on a non-success response
    - _Requirements: 7.8_

- [x] 10. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Observability
  - [x] 11.1 Add the error reporter seam
    - `flutter_app/lib/core/observability/error_reporter.dart`: `ErrorReporter` interface,
      `NoopErrorReporter`, one binding decision in one place, DSN read from Runtime_Config
    - Interface accepts no user context, so no call site can attach a name, address, document
      field, card detail or token
    - _Requirements: 8.4, 8.5_

  - [x] 11.2 Wire the error hooks
    - `main.dart`: `FlutterError.onError`, `PlatformDispatcher.instance.onError`, and
      `runZonedGuarded` around `runApp`
    - Recorded errors leave the app running or show an error screen; no framework exception
      surface reaches the member
    - _Requirements: 8.1, 8.2, 8.3, 8.6_

  - [x]* 11.3 Write unit tests for the reporter
    - Each hook records into a fake; debug binds the no-op and sends nothing
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

- [x] 12. Shrinking and the release artifact
  - [x] 12.1 Enable shrinking with keep rules
    - `isMinifyEnabled` and `isShrinkResources` on the `release` buildType
    - `proguard-rules.pro`: Stripe Android SDK, `com.yalantis.ucrop.**`, the reporter's native
      bindings
    - _Requirements: 9.1, 9.2_

  - [x] 12.2 Produce and record the signed App Bundle
    - `flutter build appbundle --release --dart-define-from-file=config/prod.env`
    - Record the deobfuscation mapping path and the target API level for BUILD.md
    - _Requirements: 9.4, 9.5, 9.6_

- [x] 13. Guard the release configuration
  - [x] 13.1 Add a release-config parse test
    - Assert: `applicationId` and `namespace` are `app.noditto`; no debug signing config on
      release; `isMinifyEnabled` true; `POST_NOTIFICATIONS` and `UCropActivity` declared; both
      deep-link filters present with `autoVerify` on the https one; `android:label` is
      `NoDitto`; `.gitignore` covers `key.properties`, `*.jks`, `*.keystore`, `config/prod.env`;
      every declared asset directory resolves to a real asset; BUILD.md contains no
      `build ipa` while `flutter_app/ios/` is absent
    - _Requirements: 1.1, 1.2, 1.4, 2.4, 2.5, 3.1, 3.4, 4.1, 4.2, 5.6, 6.6, 9.1, 11.2_

  - [x] 13.2 Add source-absence checks
    - No hard-coded contract step list in `features/trades/widgets/trade_progress_rail.dart` or
      `features/sales/screens/sale_room_screen.dart`
    - `env.dart` declares no secret-shaped key name
    - No migration makes the `message-attachments` bucket public
    - _Requirements: 6.4, 12.1, 12.7_
    - Written as `tests/unit/mobileReleaseSourceAbsence.test.ts`. All three requirements are
      now SATISFIED and asserted green.
    - Req 12.1 was pending on another spec for a while, and the history is worth keeping
      because it explains the shape of the test. When 13.2 was written, both rails still
      declared their own labels and their own state→column map — the sale list living in
      `features/sales/widgets/sale_progress_rail.dart`, not the screen this task names — and
      removing them belonged to `.kiro/specs/mobile-parity/` task 12, not here. The
      unweakened assertion was therefore carried as `it.fails` rather than `it.skip`, so the
      suite would turn RED on the day that work landed instead of staying quietly green.
      That work has since landed: task 12 serves the derived plan from
      `app/api/mobile/{cash-sale,trades}/step-plan`, the hard-coded lists are gone, and the
      assertion is now a plain passing `it`. Req 12.1 is met, and task 17.1 reports it as met.

- [x] 14. Handoff scope
  - [x] 14.1 Announce handoffs and remove orphan controls
    - Every `WebHandoff` affordance states it opens the website before it does
    - A control for a capability the app cannot perform either performs it, hands off, or is
      removed
    - _Requirements: 12.2, 12.5_

  - [x] 14.2 Indicate message attachments as web-viewable
    - Placeholder stating the attachment opens on the website; request no public bucket and no
      service-role credential; keep the bucket private
    - _Requirements: 12.6, 12.7_

  - [x]* 14.3 Write widget tests for the handoff surfaces
    - Each announced handoff and the attachment placeholder
    - _Requirements: 12.2, 12.5, 12.6_

- [x] 15. Documentation and store artifacts
  - [x] 15.1 Rewrite BUILD.md
    - Android only; remove the `ipa` command; an "iOS would require" section (mac build host,
      `ios/` folder, bundle identifier, signing identity); state `flutter_app/web/` is not a
      shipped target and why it remains
    - Clean-checkout-to-signed-bundle sequence, every command runnable on Windows
    - Keystore procedure and the upload-key reset consequence; `applicationId` fixed at first
      upload and set to `app.noditto`; every Required_Config_Key and its flavor mapping;
      mapping-file upload; target API level; every remaining website handoff with its reason;
      the manual review register
    - _Requirements: 1.8, 2.6, 6.7, 9.4, 9.5, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 12.3, 12.4, 12.8_

  - [x] 15.2 Add STORE.md
    - Privacy policy URL; Data safety answers each mapped to the shipping capability that
      justifies it; the diagnostic-data declaration; the account-deletion declaration;
      screenshot inventory; content rating answers; the single trading region
    - Member-facing vocabulary: NoDitto, "binder or bulk listing", trade collateral as a
      temporary card hold; describe no handoff as an in-app capability
    - _Requirements: 7.9, 8.7, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

- [x] 16. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 17. Verify against the recorded baselines
  - [x] 17.1 Run the Verification_Suite and compare
    - `flutter analyze --no-pub` → "No issues found!"
    - `flutter test --no-pub` → at least 903 passed / 1 skipped, 156 goldens, no failures
    - `npx vitest --run --project domain` → at least 691 passed, no failures
    - `npm run audit:mobile` → 0 RPC call sites, every endpoint paired (49: 47 after task 8.8,
      plus the two step-plan handlers `.kiro/specs/mobile-parity/` task 12 added at
      `app/api/mobile/cash-sale/step-plan` and `app/api/mobile/trades/step-plan`),
      every direct write non-contract
    - `npx vitest --run tests/unit/mobileRpcContract.test.ts`,
      `npx vitest --run tests/unit/mobileDomainAgreement.test.ts`,
      `npx vitest --run tests/unit/mobileThemeAgreement.test.ts --testTimeout=30000`
    - No assertion weakened, skipped or allowlisted; no ninth Advisory_Domain_Port; no theme
      token or bundled font changed
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12_

## Notes

- Tasks marked `*` are optional and can be skipped for a faster path to an artifact. Properties
  1–5 are the ones worth keeping if only some survive: they cover money-in-flight refusal and
  the fail-closed gate, which are the two places a mistake costs a member rather than a rebuild.
- The manual review register in `design.md` (M1–M16) cannot be automated. It is copied into
  BUILD.md by task 15.1 so it is performed rather than assumed.
- `.kiro/specs/mobile-parity/` task 12 had to land before task 13.2 could pass, and it has.
  That work belonged to that spec; see the note under 13.2 for the history.
- Three files are edited by several tasks in different waves on purpose:
  `build.gradle.kts` (1.1, 2.1, 12.1), `AndroidManifest.xml` (1.2, 3.1, 4.3), `main.dart`
  (7.3, 11.2).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "4.1", "6.1", "8.1", "8.3"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.2", "6.2", "8.2", "8.4"] },
    { "id": 2, "tasks": ["4.3", "6.3", "7.1", "8.5", "12.1"] },
    { "id": 3, "tasks": ["2.2", "4.4", "7.2", "8.6", "11.1"] },
    { "id": 4, "tasks": ["3.2", "4.5", "4.6", "7.3", "8.7"] },
    { "id": 5, "tasks": ["3.3", "7.4", "8.8", "11.2"] },
    { "id": 6, "tasks": ["8.9", "9.1", "11.3", "14.1"] },
    { "id": 7, "tasks": ["9.2", "12.2", "14.2"] },
    { "id": 8, "tasks": ["14.3", "15.1", "15.2"] },
    { "id": 9, "tasks": ["13.1", "13.2"] },
    { "id": 10, "tasks": ["17.1"] }
  ]
}
```
