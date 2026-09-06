// Feature: mobile-visual-parity — Property 14, plus the skeleton's timing and
// geometry.
//
// Property 14: For any fixture content shape, laying out the placeholder and
// laying out the resolved content produce element positions differing by no more
// than 1 logical pixel and an identical scroll extent.
//
// The timing assertions cover the pulse Req 11.2 specifies — 1.0 → 0.5 → 1.0 on a
// 2000 ms loop, held static under reduce-motion. The 200 ms suppression and
// 500 ms floor of Req 11.8 are NOT here: they belong to `SkeletonGate` in
// `widgets/common/load_state.dart`, which decides WHEN a placeholder is on screen
// rather than what one looks like, and task 9.3 owns asserting that boundary
// alongside the screens that read it.
//
// Validates: Requirements 11.1, 11.2, 5.2, 13.11, 13.12.

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';

import '../support/harness.dart';

/// The type levels a text placeholder can stand in for.
const Map<String, TextStyle> _levels = {
  'metaText': AppText.metaText,
  'bodyText': AppText.bodyText,
  'rowName': AppText.rowName,
  'cardTitle': AppText.cardTitle,
  'priceCard': AppText.priceCard,
};

/// A row shaped exactly like [SkeletonListTile]'s resolved content.
///
/// Kept beside the placeholder deliberately: Property 14 compares the two, and a
/// resolved row built from different padding or different roles would make the
/// comparison meaningless rather than making it fail.
class _ResolvedListTile extends StatelessWidget {
  const _ResolvedListTile({required this.name, required this.subtitle});

  final String name;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.cozy,
        vertical: AppSpacing.snug,
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(
              color: AppColors.muted,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: AppSpacing.snug),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: AppText.rowName, maxLines: 1),
                Text(subtitle, style: AppText.supportText, maxLines: 1),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The pulse's current opacity, scoped past the route transition's own
/// [FadeTransition].
double _pulseOpacity(WidgetTester tester) => tester
    .widget<FadeTransition>(
      find.descendant(
        of: find.byType(SkeletonPulse),
        matching: find.byType(FadeTransition),
      ),
    )
    .opacity
    .value;

void main() {
  group('Skeleton geometry', () {
    testWidgets('a text placeholder reserves the line box its copy will occupy',
        (tester) async {
      // Metamorphic rather than arithmetic: the assertion compares the
      // placeholder against a REAL paragraph at the same level. Restating
      // `fontSize * height` here would have agreed with the implementation and
      // still been 0.2 pixels short of what the text engine lays out.
      for (final MapEntry<String, TextStyle> level in _levels.entries) {
        await tester.pumpWidget(
          pumpFixture(
            Align(
              alignment: Alignment.topLeft,
              child: SizedBox(
                width: 200,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    SkeletonTextLines(level: level.value),
                    Text('Ag', style: level.value, maxLines: 1),
                  ],
                ),
              ),
            ),
          ),
        );

        final double placeholder =
            tester.getSize(find.byType(SkeletonTextLines)).height;
        final double resolved = tester.getSize(find.text('Ag')).height;

        expect(
          placeholder,
          closeTo(resolved, 0.01),
          reason: '${level.key} reserved $placeholder for copy that occupies '
              '$resolved',
        );
        expect(
          tester.getSize(find.byType(SkeletonBox)).height,
          closeTo(level.value.fontSize! * SkeletonTextLines.barFraction, 0.01),
          reason: '${level.key} bar must be 0.9em, as the web draws it',
        );
      }
    });

    testWidgets('a text placeholder grows with the text scale', (tester) async {
      // The web's `h-[0.9em]` is relative to the font size, so a placeholder at
      // a 2.0 factor reserves twice the box. A fixed box would under-reserve and
      // the content would jump on load for exactly the members least able to
      // absorb it.
      double reservedHeight() =>
          tester.getSize(find.byType(SkeletonTextLines)).height;

      await tester.pumpWidget(
        pumpFixture(
          const Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: 200,
              child: SkeletonTextLines(level: AppText.bodyText),
            ),
          ),
        ),
      );
      final double atOne = reservedHeight();

      await tester.pumpWidget(
        pumpFixture(
          const Align(
            alignment: Alignment.topLeft,
            child: SizedBox(
              width: 200,
              child: SkeletonTextLines(level: AppText.bodyText),
            ),
          ),
          textScaleFactor: 2.0,
        ),
      );
      final double atTwo = reservedHeight();

      expect(atTwo, greaterThan(atOne * 1.5));
    });

    testWidgets('one bar per line, at the requested width fraction',
        (tester) async {
      const List<List<double>> shapes = [
        [1.0],
        [1.0, 0.6],
        [1.0, 1.0, 0.35],
        [0.5, 0.5, 0.5, 0.5],
      ];

      for (final List<double> widths in shapes) {
        await tester.pumpWidget(
          pumpFixture(
            Align(
              alignment: Alignment.topLeft,
              child: SizedBox(
                width: 200,
                child: SkeletonTextLines(
                  level: AppText.bodyText,
                  widths: widths,
                ),
              ),
            ),
          ),
        );

        final List<Size> bars = tester
            .widgetList<SkeletonBox>(find.byType(SkeletonBox))
            .map((box) => tester.getSize(find.byWidget(box)))
            .toList();

        expect(bars.length, widths.length);
        for (int i = 0; i < widths.length; i++) {
          expect(
            bars[i].width,
            closeTo(200 * widths[i], 0.5),
            reason: 'line $i of $widths',
          );
        }
      }
    });

    testWidgets('a listing placeholder reserves a square cover', (tester) async {
      await tester.pumpWidget(
        pumpFixture(
          const Align(
            alignment: Alignment.topLeft,
            child: SizedBox(width: 180, child: SkeletonListingCard()),
          ),
        ),
      );

      final Size cover = tester.getSize(find.byType(AspectRatio));
      expect(
        cover.width,
        closeTo(cover.height, 0.01),
        reason: 'the fallback cover is a square, so the tile cannot resize when '
            'the photo arrives (Req 5.2)',
      );
    });
  });

  group('Skeleton timing', () {
    testWidgets('opacity runs 1.0 → 0.5 → 1.0 on a 2000 ms loop',
        (tester) async {
      await tester.pumpWidget(
        pumpFixture(const SkeletonPulse(child: SkeletonBox(height: 20))),
      );

      expect(_pulseOpacity(tester), closeTo(1.0, 0.01), reason: 'the crest');

      await tester.pump(SkeletonPulse.period ~/ 2);
      expect(
        _pulseOpacity(tester),
        closeTo(SkeletonPulse.minOpacity, 0.01),
        reason: 'the trough, half a period in',
      );

      await tester.pump(SkeletonPulse.period ~/ 2);
      expect(
        _pulseOpacity(tester),
        closeTo(1.0, 0.01),
        reason: 'back to the crest one full period in',
      );

      // The loop repeats rather than settling, which is why a golden of a
      // loading state needs reduce-motion.
      await tester.pump(SkeletonPulse.period ~/ 2);
      expect(_pulseOpacity(tester), closeTo(SkeletonPulse.minOpacity, 0.01));
    });

    testWidgets('reduce-motion holds it static at full opacity', (tester) async {
      await tester.pumpWidget(
        pumpFixture(
          const SkeletonPulse(child: SkeletonBox(height: 20)),
          reduceMotion: true,
        ),
      );

      expect(_pulseOpacity(tester), closeTo(1.0, 0.01));
      await tester.pump(SkeletonPulse.period);
      expect(
        _pulseOpacity(tester),
        closeTo(1.0, 0.01),
        reason: 'Req 13.12: the end state is applied, not animated to',
      );

      // Nothing is scheduled, so the tree settles — the property a golden needs.
      await tester.pumpAndSettle();
      expect(_pulseOpacity(tester), closeTo(1.0, 0.01));
    });
  });

  group('Skeleton accessibility', () {
    testWidgets('placeholders are excluded from the semantics tree',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await tester.pumpWidget(
        pumpFixture(
          const Column(children: [SkeletonListTile(), SkeletonListTile()]),
        ),
      );

      expect(
        find.descendant(
          of: find.byType(SkeletonListTile),
          matching: find.byType(ExcludeSemantics),
        ),
        findsNWidgets(2),
      );
      // Req 11.1: a skeleton announces once that content is loading and puts
      // nothing else in the tree. A labelled placeholder block would have a
      // screen reader read out a shape.
      for (final SemanticsNode node in allSemanticsNodes(tester)) {
        expect(node.getSemanticsData().label, isEmpty);
      }
      expect(actionableSemanticsNodes(tester), isEmpty);

      handle.dispose();
    });

    testWidgets('a loading region announces once per load, not per rebuild',
        (tester) async {
      final List<String> announcements = [];
      tester.binding.defaultBinaryMessenger
          .setMockDecodedMessageHandler<dynamic>(
        SystemChannels.accessibility,
        (dynamic message) async {
          final Map<Object?, Object?> decoded =
              message as Map<Object?, Object?>;
          if (decoded['type'] == 'announce') {
            final Map<Object?, Object?> data =
                decoded['data']! as Map<Object?, Object?>;
            announcements.add(data['message']! as String);
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger
            .setMockDecodedMessageHandler<dynamic>(
          SystemChannels.accessibility,
          null,
        ),
      );

      await tester.pumpWidget(
        pumpFixture(const SkeletonRegion(child: SkeletonListTile())),
      );
      await tester.pump();
      await tester.pump();

      expect(announcements, ['Loading content']);
    });
  });

  group('Property 14: a placeholder occupies its content\'s layout', () {
    testWidgets('a row placeholder and its resolved row lay out identically',
        (tester) async {
      // Generated content shapes: the name and subtitle lengths a real row
      // varies by. Each must resolve into the SAME box the placeholder reserved.
      const List<(String, String)> shapes = [
        ('A', 'x'),
        ('Jane Smith', 'Sent you an offer'),
        ('Averylongdisplaynamewithnospaces', 'Attachment'),
        ('ポケモン トレーダー', '新しいメッセージ'),
      ];

      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(
        pumpFixture(const SkeletonListTile(), reduceMotion: true),
      );
      final double placeholderHeight =
          tester.getSize(find.byType(SkeletonListTile)).height;

      for (final (String name, String subtitle) in shapes) {
        await tester.pumpWidget(
          pumpFixture(_ResolvedListTile(name: name, subtitle: subtitle)),
        );

        expect(
          tester.getSize(find.byType(_ResolvedListTile)).height,
          closeTo(placeholderHeight, 1.0),
          reason: 'resolving ("$name", "$subtitle") moved the row by more than '
              'one logical pixel',
        );
      }
    });

    testWidgets('a list of placeholders has the resolved list\'s scroll extent',
        (tester) async {
      await setViewport(tester, kPhoneViewport);

      // Long enough to scroll at this viewport, so the extents being equal is an
      // assertion rather than two zeroes agreeing — and long enough that a
      // sub-pixel error per row would accumulate past the tolerance, which is
      // how the rounding difference between a computed and a laid-out line box
      // was found.
      const int rows = 24;

      Future<double> extentOf(Widget Function(int) builder) async {
        await tester.pumpWidget(
          pumpFixture(
            ListView.builder(
              itemCount: rows,
              itemBuilder: (_, int index) => builder(index),
            ),
            reduceMotion: true,
          ),
        );
        await tester.pumpAndSettle();
        return tester
            .state<ScrollableState>(find.byType(Scrollable))
            .position
            .maxScrollExtent;
      }

      final double placeholderExtent =
          await extentOf((_) => const SkeletonListTile());
      final double resolvedExtent = await extentOf(
        (int index) => _ResolvedListTile(
          name: 'Trader $index',
          subtitle: 'Last message $index',
        ),
      );

      expect(
        placeholderExtent,
        greaterThan(0),
        reason: 'the fixture must actually scroll',
      );
      expect(
        resolvedExtent,
        closeTo(placeholderExtent, 1.0),
        reason: 'replacing the skeleton must not change the scroll extent '
            '(Req 11.1)',
      );
    });
  });
}
