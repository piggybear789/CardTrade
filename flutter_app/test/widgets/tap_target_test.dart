// Feature: mobile-visual-parity — Property 19.
//
// Property 19: For any screen state the golden suite covers, every `TapTarget`'s
// inflated rect measures at least 48 logical pixels on both axes, contains its
// child's visible rect, and shares no interior area with another `TapTarget`'s
// rect.
//
// The geometry is MEASURED off `RenderTapTarget` rather than inferred from
// whether a synthetic tap happened to land. A tap that lands proves one point is
// inside; it says nothing about the extent, and nothing at all about two targets
// overlapping.
//
// Validates: Requirements 13.6, 8.7, 5.5, 4.4.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/tap_target.dart';

import '../support/harness.dart';

/// Every [RenderTapTarget] currently laid out, in tree order.
List<RenderTapTarget> targetsOf(WidgetTester tester) =>
    tester.renderObjectList<RenderTapTarget>(find.byType(TapTarget)).toList();

void main() {
  group('Property 19: every hit area contains its control and touches no other',
      () {
    testWidgets('a target is never smaller than the minimum on either axis',
        (tester) async {
      // One generated case per visible size the design admits, from the card's
      // 32dp watch control up past the minimum itself, because a control drawn
      // LARGER than 48 must keep the target it already had rather than shrink to
      // the floor.
      const List<double> visibleSizes = [
        12,
        20,
        AppMetrics.watchControl,
        AppMetrics.controlHeight,
        AppMetrics.minHitArea,
        64,
        120,
      ];

      for (final double size in visibleSizes) {
        await tester.pumpWidget(
          pumpFixture(
            Center(
              child: TapTarget(
                child: SizedBox(width: size, height: size),
              ),
            ),
          ),
        );

        final RenderTapTarget target = targetsOf(tester).single;

        expect(
          target.targetRect.width,
          greaterThanOrEqualTo(AppMetrics.minHitArea),
          reason: 'a $size dp control must still accept 48 dp of touch',
        );
        expect(
          target.targetRect.height,
          greaterThanOrEqualTo(AppMetrics.minHitArea),
          reason: 'a $size dp control must still accept 48 dp of touch',
        );

        // Contains its control, and never moves it.
        expect(target.targetRect.contains(target.drawnRect.topLeft), isTrue);
        expect(
          target.targetRect.containsRect(target.drawnRect),
          isTrue,
          reason: 'the target must contain the drawn bounds, not merely overlap',
        );
        expect(target.drawnRect.size, Size(size, size),
            reason: 'the expansion must not change what the control draws');
      }
    });

    testWidgets('the drawn size is untouched — the target expands, layout does not',
        (tester) async {
      await tester.pumpWidget(
        pumpFixture(
          Center(
            child: AppIconButton(
              icon: Icons.favorite_border_rounded,
              semanticLabel: 'Add to watchlist',
              visibleSize: AppMetrics.watchControl,
              onPressed: () {},
            ),
          ),
        ),
      );

      final RenderTapTarget target = targetsOf(tester).single;

      // 32 drawn, 48 touched. Req 8.7 forbids reaching the target by inflating
      // the drawn height, so both numbers are asserted, not just the larger.
      expect(target.drawnRect.size,
          const Size.square(AppMetrics.watchControl));
      expect(target.targetRect.size, const Size.square(AppMetrics.minHitArea));
    });

    testWidgets('a row of controls at the group step keeps its targets disjoint',
        (tester) async {
      await tester.pumpWidget(
        pumpFixture(
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (int i = 0; i < 4; i++) ...[
                if (i > 0) const SizedBox(width: AppSpacing.group),
                AppIconButton(
                  icon: Icons.more_horiz_rounded,
                  semanticLabel: 'Control $i',
                  visibleSize: AppMetrics.watchControl,
                  onPressed: () {},
                ),
              ],
            ],
          ),
        ),
      );

      expectNoTargetsOverlap(tester);
    });

    testWidgets('stacked fields at the group step keep their targets disjoint',
        (tester) async {
      // Recorded from task 3.2: two 40 dp fields need at least
      // AppSpacing.group between them, because each target inflates 4 dp past
      // the drawn edge on both axes. This is the assertion that pins it.
      await tester.pumpWidget(
        pumpFixture(
          const Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppTextField(label: 'Title'),
              SizedBox(height: AppSpacing.group),
              AppTextField(label: 'Description'),
              SizedBox(height: AppSpacing.group),
              AppTextField(label: 'Price'),
            ],
          ),
        ),
      );

      expect(targetsOf(tester).length, 3);
      expectNoTargetsOverlap(tester);
    });

    testWidgets('a stack of buttons at the group step keeps its targets disjoint',
        (tester) async {
      await tester.pumpWidget(
        pumpFixture(
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppButton(label: 'Buy now', onPressed: () {}),
              const SizedBox(height: AppSpacing.group),
              AppButton(
                label: 'Make an offer',
                variant: AppButtonVariant.outline,
                onPressed: () {},
              ),
              const SizedBox(height: AppSpacing.group),
              AppButton(
                label: 'Propose a trade',
                variant: AppButtonVariant.outline,
                onPressed: () {},
              ),
            ],
          ),
        ),
      );

      expect(targetsOf(tester).length, 3);
      expectNoTargetsOverlap(tester);
    });

    testWidgets('a touch in the inflated margin still reaches the child',
        (tester) async {
      int taps = 0;

      await tester.pumpWidget(
        pumpFixture(
          Center(
            child: SizedBox(
              // The parent must itself be at least the minimum, or its own hit
              // test clips the expansion — the caveat tap_target.dart records.
              width: AppMetrics.minHitArea,
              height: AppMetrics.minHitArea,
              child: Center(
                child: AppIconButton(
                  icon: Icons.favorite_border_rounded,
                  semanticLabel: 'Add to watchlist',
                  visibleSize: AppMetrics.watchControl,
                  onPressed: () => taps++,
                ),
              ),
            ),
          ),
        ),
      );

      final RenderTapTarget target = targetsOf(tester).single;

      // Every corner of the inflated margin, because the watch control is a
      // CIRCLE: a delivery strategy that clamped onto the child's box edge left
      // all four of these outside the disc and dropped them silently, so one
      // sampled point would have passed while the expansion did nothing.
      final List<Offset> margins = [
        target.globalTargetRect.topLeft + const Offset(2, 2),
        target.globalTargetRect.topRight + const Offset(-2, 2),
        target.globalTargetRect.bottomLeft + const Offset(2, -2),
        target.globalTargetRect.bottomRight + const Offset(-2, -2),
      ];

      for (final Offset margin in margins) {
        expect(target.globalDrawnRect.contains(margin), isFalse,
            reason: '$margin must be outside the drawn 32 dp box');
        await tester.tapAt(margin);
        await tester.pump();
      }

      expect(taps, margins.length,
          reason: 'every point in the margin must deliver to the child');
    });
  });
}

/// Asserts no two laid-out targets share interior area.
void expectNoTargetsOverlap(WidgetTester tester) {
  final List<Rect> rects =
      targetsOf(tester).map((target) => target.globalTargetRect).toList();

  for (int i = 0; i < rects.length; i++) {
    for (int j = i + 1; j < rects.length; j++) {
      expect(
        rects[i].overlaps(rects[j]),
        isFalse,
        reason: 'targets $i ${rects[i]} and $j ${rects[j]} share interior area',
      );
    }
  }
}

extension on Rect {
  /// Whether [other] lies wholly inside this rectangle, edges included.
  bool containsRect(Rect other) =>
      other.left >= left &&
      other.top >= top &&
      other.right <= right &&
      other.bottom <= bottom;
}
