// The Golden_Test_Suite's harness: the designated host, and everything a capture
// has to hold still.
//
// A GOLDEN IS ONLY WORTH ANYTHING IF THE ONLY THING THAT CAN MOVE THE PIXELS IS
// THE DESIGN. Every control below exists because something else could otherwise
// move them: the wall clock, the platform's font rasteriser, a device pixel ratio
// the host chose, an animation frame that landed a millisecond differently, or a
// database read that returns different rows this morning. Req 15.11 lists them and
// this file is where each is pinned.
//
// THIS FILE COMMITS NO REFERENCE IMAGE AND CALLS NO `matchesGoldenFile` ITSELF.
// Each `test/golden/<area>/<area>_golden_test.dart` does that, walking the case
// list in `<area>_golden_cases.dart` through [pumpGolden] and [expectGolden] and
// owning the images in its own `goldens/`. The harness landed FIRST deliberately: a
// reference captured before the fonts, the pixel ratio and the clock are pinned
// would have to be re-baselined for a reason unrelated to the design, and Req 15.12
// forbids re-baselining a mismatch whose cause has not been identified as intended.
//
// HOW AN AREA TEST USES THIS:
//
// ```dart
// void main() {
//   setUpAll(setUpGoldenSuite);
//
//   // The skip sits on the GROUP, not on each `testWidgets`. That is not a style
//   // choice: `testWidgets` types its `skip` as `bool?` and would reduce the stated
//   // reason to a silent true, and a silent skip is indistinguishable from a
//   // passing test. `group` takes the reason and prints it.
//   group('captured', skip: GoldenHost.skipReason, () {   // ← the one host reference
//     for (final ShellGoldenCase entry in kShellGoldenCases) {
//       for (final double scale in entry.textScales) {
//         testWidgets('${entry.name} at ${scale}x', (tester) async {
//           await pumpGolden(tester, entry.build(), surface: entry.surface,
//               textScale: scale);
//           await expectGolden(entry.name, scale);
//           await disposeGolden(tester);
//         });
//       }
//     }
//   });
// }
// ```
//
// RE-BASELINING (Req 15.12), stated here because this is the file a person reads
// when an image moves:
//
//   1. Identify the change that moved the pixels. A mismatch whose cause is not
//      yet understood is NOT re-baselined — it is investigated. A golden is never
//      regenerated to make a build green; the whole value of the suite is the diff
//      a person looks at.
//   2. On the designated host: `flutter test --update-goldens test/golden/<area>`,
//      scoped to the affected directory and never the whole suite.
//   3. Commit the regenerated images IN THE SAME CHANGE as the code that moved
//      them, naming each moved image in the commit body.
//   4. A reviewer checks that the set of moved images is the set the change should
//      have moved. An unexplained extra image says the change did more than it
//      said.
//
// A mismatch writes `failures/<name>_masterImage.png`, `_testImage.png`,
// `_isolatedDiff.png` and `_maskedDiff.png` beside the test. Those artefacts are
// the output that matters, not the verdict.
//
// Requirements 11.2, 13.12, 13.13, 15.10, 15.11, 15.12.

import 'dart:io' show Platform;

// `TargetPlatform` arrives with material.dart, which the harness needs anyway.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import '../../support/harness.dart';
import '../../support/listing_fixtures.dart' show kFixtureInstant, withOverrides;
import '../../support/message_fixtures.dart' show kMessageNow;
import '../../support/state_fixtures.dart' show kSkeletonPhase;
import 'fonts.dart';
import 'network_images.dart';

export 'fonts.dart' show loadAppFonts;
export 'network_images.dart' show stubNetworkImages;

/// Which host platform the pixel comparison runs on, and the reason it is skipped
/// anywhere else.
///
/// FONT RASTERISATION DIFFERS BETWEEN PLATFORMS, so the same tree captured on two
/// operating systems produces two different images and neither is wrong. Req 15.10
/// therefore designates ONE host and skips the comparison — with a stated reason —
/// on every other. The rest of `flutter test` is host-independent and still runs:
/// the case lists, the layout assertions, the semantics tree and the token
/// agreement all measure geometry rather than pixels.
///
/// WINDOWS, AND WHY. This is where the toolchain is and there is no CI yet.
/// Req 15.10 makes the suite skip its comparison on any other host, so designating
/// a platform nobody has would turn the whole suite into a skip — a vacuous pass
/// in another costume, which is one step past having no test at all.
///
/// LINUX IS THE INTENDED SUCCESSOR. It is the cheaper and more available CI host
/// and `vercel.json` already puts this project's automation there. THE SWITCH IS A
/// REGENERATION, not an edit: change [designated] to `TargetPlatform.linux`, then
/// re-capture every reference on a Linux host with
/// `flutter test --update-goldens test/golden` and commit the images in that same
/// change, naming the switch as the cause. Every image will move, and that is
/// expected — it is the rasteriser changing, not the design. Do NOT switch the
/// constant without the regeneration: the suite would then compare Linux captures
/// against Windows references and fail on all of them, which reads as a design
/// regression and is not one.
///
/// See `.kiro/specs/mobile-visual-parity/design.md` § Open questions Q5.
abstract final class GoldenHost {
  /// The one host platform whose captures the reference images are of.
  static const TargetPlatform designated = TargetPlatform.windows;

  /// `Platform.operatingSystem` for [designated].
  static String get designatedName => _operatingSystemName(designated);

  /// The host this process is running on.
  static String get currentName => Platform.operatingSystem;

  /// Whether a pixel comparison on this host means anything.
  static bool get isDesignated => currentName == designatedName;

  /// Null on the designated host — which is what `testWidgets(skip:)` wants — and
  /// otherwise a reason that says WHY, because a silent skip is indistinguishable
  /// from a passing test.
  static String? get skipReason {
    if (isDesignated) return null;
    return 'Golden comparison skipped: designated host is $designatedName, '
        'this host is $currentName. Font rasterisation differs between '
        'platforms; a difference here is not a parity difference. '
        'See design.md § Open questions Q5.';
  }

  static String _operatingSystemName(TargetPlatform platform) {
    switch (platform) {
      case TargetPlatform.windows:
        return 'windows';
      case TargetPlatform.linux:
        return 'linux';
      case TargetPlatform.macOS:
        return 'macos';
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.iOS:
        return 'ios';
      case TargetPlatform.fuchsia:
        return 'fuchsia';
    }
  }
}

/// The phone surface every golden is captured on, unless the case names another.
///
/// iPhone-class, and the width the mobile design is drawn for.
const Size kGoldenSurface = kPhoneViewport;

/// The narrowest surface the design commits to (Req 7.2), for the cases that have
/// to survive it.
const Size kGoldenNarrowSurface = kNarrowViewport;

/// One logical pixel is one image pixel, so a diff is readable as a measurement
/// rather than as a resampling artefact.
const double kGoldenDevicePixelRatio = 1.0;

/// The instant every golden is captured AT.
///
/// NOT A SECOND DEFINITION OF THE CLOCK — it is the fixture clock under the name
/// the harness uses, so a message thread's `Today`, its run clock and its `12m
/// ago` are the same words in the reference image as in the capture. The harness
/// cannot inject it: a relative label is read from a `now` the SURFACE takes, so
/// each case hands this value to the widget it builds (see
/// `test/golden/messages/message_golden_cases.dart`). Pinned here so there is one
/// answer to "what time is it in a golden".
final DateTime kGoldenInstant = kMessageNow;

/// The instant the non-message fixtures are dated from, exposed for the same
/// reason: a case that needs "some time before now" states it against this.
final DateTime kGoldenFixtureInstant = kFixtureInstant;

/// How far past the first frame a capture is pumped.
///
/// Just past `SkeletonGate.suppressBelow`, so a placeholder case is captured with
/// its skeleton on screen rather than inside the suppression window where there is
/// deliberately nothing to see. Under reduce-motion the pulse holds static at full
/// opacity (Req 11.2), which is what makes an infinite animation capturable at all
/// — `pumpAndSettle` would spin on it forever.
final Duration kGoldenPhase = kSkeletonPhase;

/// Loads the typeface, stubs remote images, and asserts the comparator has not
/// been made fuzzy.
///
/// Call from `setUpAll` in every golden test file.
///
/// The image stub is here rather than per area because several areas draw a remote
/// photo and the failure it prevents lands on whichever case happens to be running
/// — see `network_images.dart` for what that looked like.
Future<void> setUpGoldenSuite() async {
  await loadAppFonts();
  stubNetworkImages();
  assertZeroToleranceComparator();
}

/// Fails if anything has installed a comparator that tolerates a differing pixel.
///
/// Req 15.11 requires a tolerance of ZERO differing pixels. Flutter's default
/// `LocalFileComparator` already compares exactly, so the way this requirement
/// gets broken is not by writing a tolerance — it is by someone adding a
/// `flutter_test_config.dart` that swaps in a percentage-tolerant subclass to
/// quiet a flake. That silently widens every golden in the suite at once, so it is
/// asserted rather than assumed.
///
/// The check is on the exact runtime type, not `is LocalFileComparator`: a fuzzy
/// comparator is conventionally written as a SUBCLASS of it, which an `is` test
/// would wave through.
void assertZeroToleranceComparator() {
  if (goldenFileComparator.runtimeType != LocalFileComparator) {
    throw StateError(
      'the ambient golden comparator is ${goldenFileComparator.runtimeType}, '
      'not LocalFileComparator. Req 15.11 requires a tolerance of zero '
      'differing pixels; a tolerant comparator hides exactly the small '
      'regressions this suite exists to catch.',
    );
  }
}

/// Pumps [child] with everything Req 15.11 lists held at a declared value.
///
/// | Control | Value |
/// | --- | --- |
/// | Fonts | the bundled faces, loaded by [setUpGoldenSuite] |
/// | Device pixel ratio | [kGoldenDevicePixelRatio] |
/// | Surface | [surface], default [kGoldenSurface] |
/// | Text scale | [textScale], through the app's own capping wrapper |
/// | Clock | [kGoldenInstant], injected by the case |
/// | Animations | reduce-motion on, so the capture is an end state |
/// | Data | [overrides] only; no Supabase client is constructed |
///
/// [ownsScaffold] is true where [child] brings its own `Scaffold` — a whole screen
/// under `AppScaffold` does, and nesting one inside another puts two bottom-bar
/// slots and two `ScaffoldMessenger` scopes in the tree.
///
/// [reduceMotion] defaults to true, which has a consequence worth naming: NO
/// GOLDEN COVERS A MID-ANIMATION FRAME by default. The one golden per animated
/// surface that Req 11.7 asks for at a stated point in the cycle passes
/// `reduceMotion: false` with an explicit [phase]; the animation VALUES are
/// asserted by ordinary widget tests rather than by pixels.
///
/// [beforeCapture] runs after the tree is laid out and before the final pump — it
/// is where a case that has to be captured in a particular interaction state puts
/// that state, such as focusing a field. It runs against a laid-out tree so a
/// `Finder` in it resolves.
///
/// Deliberately NOT `pumpAndSettle`. A loading fixture never settles, which is the
/// point of it, and a countdown room schedules a frame every second.
Future<void> pumpGolden(
  WidgetTester tester,
  Widget child, {
  Size surface = kGoldenSurface,
  double textScale = 1.0,
  List<Override> overrides = const <Override>[],
  bool ownsScaffold = false,
  bool reduceMotion = true,
  Duration? phase,
  Future<void> Function(WidgetTester tester)? beforeCapture,
}) async {
  if (!appFontsLoaded) {
    throw StateError(
      'pumpGolden was called before the typeface was loaded. Add '
      '`setUpAll(setUpGoldenSuite);` to this file. Without it the capture '
      "succeeds and renders the test runner's stand-in face, which is the "
      'failure mode a reference image cannot report (Req 15.11).',
    );
  }

  tester.view.devicePixelRatio = kGoldenDevicePixelRatio;
  tester.view.physicalSize = surface * kGoldenDevicePixelRatio;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    withOverrides(
      pumpFixture(
        child,
        textScaleFactor: textScale,
        reduceMotion: reduceMotion,
        scaffold: !ownsScaffold,
      ),
      overrides,
    ),
  );

  // Two frames run the overridden futures and lay the result out, which is what
  // every other fixture pump in this suite does.
  await tester.pump();
  await tester.pump();
  if (beforeCapture != null) {
    await beforeCapture(tester);
    await tester.pump();
  }
  await tester.pump(phase ?? kGoldenPhase);
}

/// Unmounts the tree so a surface that armed a timer cancels it.
///
/// A loading fixture leaves `SkeletonGate`'s 500 ms floor timer running and a
/// countdown room leaves a periodic one; on a device both are cancelled when the
/// member leaves the screen, and here that has to be done explicitly or the
/// binding fails the test for a timer the widget would have cleaned up.
Future<void> disposeGolden(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump();
}

/// Where the reference image for [stem] at [textScale] lives.
///
/// Beside the test that captures it, under `goldens/`, in version control
/// (Req 15.10). The scale is part of the NAME rather than of the directory, so the
/// Req 13.13 pair sorts together and a missing twin is visible in one listing.
String goldenPath(String stem, double textScale) =>
    'goldens/$stem@${textScale.toStringAsFixed(1)}x.png';

/// Compares the whole captured surface against the reference for [stem].
///
/// The root of the pumped app rather than a sub-tree, so the image covers the
/// surface the case declared and a change in what surrounds the widget is visible
/// rather than cropped out.
///
/// Only ever reached on the designated host: an area test passes
/// [GoldenHost.skipReason] to the `group` that holds its captures, which is the one
/// reference to the host constant that the design asks for. Asserted here too, so a
/// file that forgets the skip fails with the reason rather than with a pixel diff
/// between two rasterisers.
Future<void> expectGolden(
  String stem,
  double textScale, {
  Finder? finder,
}) async {
  if (!GoldenHost.isDesignated) {
    throw StateError(
      '${GoldenHost.skipReason} '
      'Pass `skip: GoldenHost.skipReason` to the group holding the captures in '
      'this file — `testWidgets` types its own skip as bool and would drop the '
      'reason.',
    );
  }
  await expectLater(
    finder ?? find.byType(MaterialApp),
    matchesGoldenFile(goldenPath(stem, textScale)),
  );
}
