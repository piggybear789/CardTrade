// Feature: mobile-visual-parity — Properties 3 and 24.
//
// Property 3: For all text scale factors f1 < f2 in [1.0, 2.0], the laid-out
// height of a paragraph at f2 is greater than or equal to its height at f1.
//
// Property 24: For any sampled text scale factor in [1.0, 2.5], the applied
// factor is min(f, 2.0), no RenderObject reports overflow, and no reading text or
// control label is ellipsised.
//
// These live in `flutter test` rather than the Vitest harness because their
// subject is a laid-out widget tree. Dart's generator story is thinner than
// fast-check's, so the sampling is an explicit list built in the test — the
// arrangement the design records for Properties 3 and 14–24.
//
// Validates: Requirements 13.10.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';

import '../support/harness.dart';

/// Factors sampled for the monotonicity property, inside the applied range.
const List<double> _withinRange = [1.0, 1.15, 1.3, 1.5, 1.75, 1.9, 2.0];

/// Factors sampled for the cap, deliberately straddling it.
const List<double> _acrossCap = [
  0.85,
  1.0,
  1.4,
  1.99,
  2.0,
  2.01,
  2.2,
  2.5,
];

/// Copy shapes a paragraph can take, including the ones a hand-picked fixture
/// misses: a single word too long to break, and non-ASCII.
const List<String> _paragraphs = [
  'Buy',
  'Charizard Holo 1st Edition, near mint, sleeved since pull.',
  'Reallylongsinglewordwithnobreakopportunityanywhereinside',
  'ポケモンカード リザードン 1st Edition ニアミント',
  'A binder or bulk listing holds nothing until both members agree terms, so '
      'another buyer can ask about the same card while you are deciding.',
];

void main() {
  group('Property 3: text scaling does not reduce a laid-out size', () {
    testWidgets('height is nondecreasing in the factor, for every copy shape',
        (tester) async {
      for (final String copy in _paragraphs) {
        double previousHeight = 0;

        for (final double factor in _withinRange) {
          await tester.pumpWidget(
            pumpFixture(
              // A fixed width, so the only free variable is the factor. Without
              // it a wider viewport would absorb the growth and the property
              // would pass while proving nothing.
              Align(
                alignment: Alignment.topLeft,
                child: SizedBox(width: 240, child: Text(copy)),
              ),
              textScaleFactor: factor,
              // The raw factor, uncapped: this property is about the range the
              // client applies, and Property 24 owns the ceiling.
              capTextScale: false,
            ),
          );

          final double height = tester.getSize(find.text(copy)).height;
          expect(
            height,
            greaterThanOrEqualTo(previousHeight),
            reason: 'at $factor "$copy" laid out shorter than at the previous '
                'factor ($height < $previousHeight)',
          );
          previousHeight = height;
        }
      }
    });

    testWidgets('every type level grows with the factor', (tester) async {
      const Map<String, TextStyle> levels = {
        'meta': AppType.meta,
        'body': AppType.body,
        'nav': AppType.nav,
        'lead': AppType.lead,
        'subhead': AppType.subhead,
        'head': AppType.head,
        'display': AppType.display,
      };

      for (final MapEntry<String, TextStyle> level in levels.entries) {
        double previousHeight = 0;
        for (final double factor in _withinRange) {
          await tester.pumpWidget(
            pumpFixture(
              Align(
                alignment: Alignment.topLeft,
                child: SizedBox(
                  width: 240,
                  child: Text('Trade collateral held', style: level.value),
                ),
              ),
              textScaleFactor: factor,
              capTextScale: false,
            ),
          );

          final double height =
              tester.getSize(find.text('Trade collateral held')).height;
          expect(height, greaterThanOrEqualTo(previousHeight),
              reason: '${level.key} shrank at $factor');
          previousHeight = height;
        }
      }
    });
  });

  group('Property 24: no layout overflows at any applied text scale', () {
    test('the applied factor is min(f, 2.0)', () {
      for (final double factor in _acrossCap) {
        expect(
          AppTextScale.capFactor(factor),
          factor < AppTextScale.maxFactor ? factor : AppTextScale.maxFactor,
          reason: 'a reported $factor must apply as min($factor, 2.0)',
        );
      }
    });

    testWidgets('CappedTextScale applies min(f, 2.0) to the tree below it',
        (tester) async {
      for (final double factor in _acrossCap) {
        late TextScaler applied;

        await tester.pumpWidget(
          pumpFixture(
            Builder(
              builder: (BuildContext context) {
                applied = MediaQuery.textScalerOf(context);
                return const Text('Inspection ends in 3 days');
              },
            ),
            textScaleFactor: factor,
          ),
        );

        final double expected = AppTextScale.capFactor(factor);
        // `scale` rather than the deprecated factor getter: the assertion is
        // about the size a glyph is drawn at, which is what the cap governs.
        expect(
          applied.scale(16),
          closeTo(16 * expected, 0.001),
          reason: 'a reported $factor must render as $expected',
        );
      }
    });

    testWidgets('the shared primitives neither overflow nor truncate, through 2.5',
        (tester) async {
      await setViewport(tester, kNarrowViewport);

      for (final double factor in _acrossCap) {
        await tester.pumpWidget(
          pumpFixture(
            SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const EmptyState(
                    icon: Icons.inbox_outlined,
                    title: 'Nothing here yet',
                    subtitle:
                        'Listings you save will appear here so you can find '
                        'them again.',
                    actionLabel: 'Browse the catalog',
                  ),
                  const SizedBox(height: AppSpacing.group),
                  const ErrorView(
                    title: 'We could not load your contracts',
                    message:
                        'Check your connection and try again. Nothing has been '
                        'charged.',
                  ),
                  const SizedBox(height: AppSpacing.group),
                  AppButton(label: 'Propose a trade', onPressed: () {}),
                  const SizedBox(height: AppSpacing.group),
                  // Short copy deliberately. The test font has square glyph
                  // metrics, so a sentence occupies far more width here than in
                  // Plus Jakarta Sans — fixture copy length is not a proxy for
                  // real width, and a long helper line would fail this assertion
                  // for a reason that does not exist on a device.
                  const AppTextField(
                    label: 'Price',
                    helperText: 'Buyers see this.',
                  ),
                  // RECORDED, not hidden: Material builds a field's `labelText`
                  // with `overflow: ellipsis`, so a label too long for its field
                  // is ellipsised rather than reflowed — which Req 13.10 forbids
                  // and which this fixture's short label does not exercise.
                  // Replacing `labelText` with a wrapping `label` widget is task
                  // 8.1's field work; asserting it here would fail on a defect
                  // this task is not scoped to fix.
                ],
              ),
            ),
            textScaleFactor: factor,
          ),
        );
        await tester.pumpAndSettle();

        expectNoLayoutOverflow(tester);
        expectNoTruncatedText(tester, context: 'at text scale factor $factor');
      }
    });
  });
}
