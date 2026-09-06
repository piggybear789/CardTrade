// The golden harness, tested — because everything it pins fails SILENTLY.
//
// A capture on the stand-in typeface, at the host's own pixel ratio, or with an
// uncapped text scale does not throw. It produces an image, and that image becomes
// the reference. So each control the harness claims to hold is asserted here, on
// every host, with no reference image involved: this file calls no
// `matchesGoldenFile` and commits no `.png` (task 11.2 owns those).
//
// Requirements 11.2, 13.12, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme/text_scale.dart';
import 'package:cardtrade/core/theme/type_scale.dart';
import 'package:cardtrade/widgets/common/load_state.dart';

import 'fonts.dart';
import 'golden_harness.dart';

/// A provider that exists only to be overridden, so the test can prove the
/// override set reached the tree rather than trusting that it did.
final Provider<String> _fixtureProvider =
    Provider<String>((ref) => 'not overridden');

void main() {
  setUpAll(setUpGoldenSuite);

  group('Req 15.10: the designated host', () {
    test('is Windows, named in one constant', () {
      expect(GoldenHost.designated, TargetPlatform.windows);
      expect(GoldenHost.designatedName, 'windows');
    });

    test('skips with a stated reason on any other host, and only there', () {
      if (GoldenHost.isDesignated) {
        // On the designated host the comparison must actually run. A skip reason
        // here would turn the whole suite into a skip, which is the one outcome
        // worse than having no goldens.
        expect(GoldenHost.skipReason, isNull);
        return;
      }
      final String? reason = GoldenHost.skipReason;
      expect(reason, isNotNull);
      // The reason names BOTH platforms, because "skipped" without them reads as
      // a passing test to anyone scanning output.
      expect(reason, contains(GoldenHost.designatedName));
      expect(reason, contains(GoldenHost.currentName));
      expect(reason, contains('rasterisation'));
    });

    test('refuses to compare off the designated host', () async {
      // Belt and braces for a file that forgets `skip: GoldenHost.skipReason`:
      // it fails with the reason rather than with a diff between two rasterisers,
      // which would read as a design regression and is not one.
      if (GoldenHost.isDesignated) return;
      await expectLater(() => expectGolden('unused', 1.0), throwsStateError);
    });
  });

  group('Req 15.11: the reference path', () {
    test('sits beside the test and carries the scale in the name', () {
      expect(goldenPath('shell_guest', 1.0), 'goldens/shell_guest@1.0x.png');
      expect(goldenPath('shell_guest', 2.0), 'goldens/shell_guest@2.0x.png');
    });
  });

  group('Req 15.11: the comparator', () {
    test('is the exact-match one, with nothing fuzzy installed over it', () {
      expect(assertZeroToleranceComparator, returnsNormally);
      expect(goldenFileComparator.runtimeType, LocalFileComparator);
    });
  });

  group('Req 12.5: the typeface', () {
    test('is loaded before any capture', () {
      expect(appFontsLoaded, isTrue);
    });

    testWidgets('measures differently from the stand-in face', (tester) async {
      // THE ASSERTION THAT MATTERS. If `loadAppFonts` had not registered the
      // bundled faces, a run naming the family would fall back to the test
      // runner's stand-in face — the same face an unknown family falls back to —
      // and the two widths below would be equal. A reference captured in that
      // state is a picture of the wrong typeface and reports nothing.
      final double bundled = await _measure(tester, AppType.family);
      final double fallback = await _measure(tester, 'NoSuchFamilyIsBundled');
      expect(
        bundled,
        isNot(closeTo(fallback, 0.01)),
        reason: 'text measured the same with the product family as with an '
            'unknown one, so the bundled faces did not load',
      );
    });
  });

  group('Req 15.11: pumpGolden holds every listed control', () {
    testWidgets('pins the pixel ratio, the surface and the text scale',
        (tester) async {
      MediaQueryData? seen;
      await pumpGolden(
        tester,
        Builder(builder: (BuildContext context) {
          seen = MediaQuery.of(context);
          return const SizedBox.shrink();
        }),
        textScale: 2.0,
      );

      expect(seen, isNotNull);
      expect(seen!.devicePixelRatio, kGoldenDevicePixelRatio);
      expect(seen!.size, kGoldenSurface);
      // Req 13.13's twin is the same surface at twice the scale, and Req 13.10's
      // cap is the app's own — a golden captured with the cap bypassed would not
      // be a picture of what ships.
      expect(seen!.textScaler.scale(16), 32);
      expect(AppTextScale.maxFactor, 2.0);
    });

    testWidgets('captures a narrow surface where the case names one',
        (tester) async {
      Size? seen;
      await pumpGolden(
        tester,
        Builder(builder: (BuildContext context) {
          seen = MediaQuery.sizeOf(context);
          return const SizedBox.shrink();
        }),
        surface: kGoldenNarrowSurface,
      );
      expect(seen, kGoldenNarrowSurface);
    });

    testWidgets('turns reduce-motion on by default, and off on request',
        (tester) async {
      bool? reduced;
      Widget probe() => Builder(builder: (BuildContext context) {
            reduced = MediaQuery.of(context).disableAnimations;
            return const SizedBox.shrink();
          });

      await pumpGolden(tester, probe());
      expect(reduced, isTrue, reason: 'reduce-motion is the default (Req 11.2)');

      await pumpGolden(tester, probe(), reduceMotion: false);
      expect(reduced, isFalse, reason: 'the one animated capture opts out');
    });

    testWidgets('builds over the fixture overrides it is given', (tester) async {
      String? seen;
      await pumpGolden(
        tester,
        Consumer(builder: (BuildContext context, WidgetRef ref, _) {
          seen = ref.watch(_fixtureProvider);
          return const SizedBox.shrink();
        }),
        overrides: <Override>[
          _fixtureProvider.overrideWithValue('from the fixture'),
        ],
      );
      expect(seen, 'from the fixture');
    });

    testWidgets('advances past the skeleton suppression window', (tester) async {
      // Req 11.7 asks for the placeholder at a stated point in the pulse, and
      // `SkeletonGate` draws nothing at all for its first 200 ms. A capture taken
      // inside that window is a picture of an empty box.
      expect(kGoldenPhase, greaterThan(SkeletonGate.suppressBelow));

      await pumpGolden(
        tester,
        SkeletonGate(
          isLoading: true,
          builder: (BuildContext context, bool showSkeleton) => SizedBox(
            key: Key(showSkeleton ? 'skeleton' : 'content'),
            height: 40,
          ),
        ),
      );
      expect(find.byKey(const Key('skeleton')), findsOneWidget);
      await disposeGolden(tester);
    });

    testWidgets('runs beforeCapture against a laid-out tree', (tester) async {
      final FocusNode node = FocusNode();
      addTearDown(node.dispose);

      await pumpGolden(
        tester,
        TextField(focusNode: node),
        beforeCapture: (WidgetTester tester) async {
          // A finder resolves here, which is the point of running after layout:
          // the focused capture of Req 8.12 is taken at the same drawn bounds as
          // the resting one.
          expect(find.byType(TextField), findsOneWidget);
          node.requestFocus();
        },
      );
      expect(node.hasFocus, isTrue);
    });
  });

  group('Req 15.11: the clock', () {
    test('is one pinned instant, shared with the fixtures', () {
      // Not a second definition: a golden and the widget tests either side of it
      // read the same instant, so "12m ago" is the same words in both.
      expect(kGoldenInstant.isAfter(kGoldenFixtureInstant), isTrue);
      expect(kGoldenInstant.isUtc, isTrue);
    });
  });
}

/// The width of one run of text under [family], at a fixed size and no scaling.
Future<double> _measure(WidgetTester tester, String family) async {
  const Key key = Key('measured');
  await tester.pumpWidget(
    Directionality(
      textDirection: TextDirection.ltr,
      child: Center(
        child: Text(
          'Handover confirmed',
          key: key,
          textScaler: TextScaler.noScaling,
          style: TextStyle(fontFamily: family, fontSize: 20),
        ),
      ),
    ),
  );
  return tester.getSize(find.byKey(key)).width;
}
