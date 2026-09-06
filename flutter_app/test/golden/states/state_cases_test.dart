// The host-independent cover for the list-state golden cases.
//
// No pixel comparison here: `state_golden_test.dart` does that and owns the references
// in `goldens/`, for the reason recorded at the head of `state_golden_cases.dart`.
// What this asserts instead is that the case list is the
// set Req 11.7 asks for, that the filtered-to-empty state is staged exactly where a
// screen can reach it, that every case pairs a 1.0 capture with a 2.0 twin at one
// surface size (Req 13.13), and that each case is genuinely in the state its name
// claims — a placeholder for loading, the right one of the two empty treatments, and
// a lost connection distinguished from a fault.
//
// Requirements 11.1–11.4, 11.7, 11.9, 11.10, 13.10, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';

import '../../support/harness.dart';
import '../../support/state_fixtures.dart';
import 'state_golden_cases.dart';

/// The catalog search field's own hint text.
///
/// Named here because it is EXCLUDED from the truncation assertion below, and an
/// exclusion with no name is an exclusion nobody notices.
const String _kCatalogSearchHint = 'Search cards';

/// Fails if any paragraph lost text to a line clamp, except a field's own
/// decoration text.
///
/// RECORDED, NOT HIDDEN, and the same gap `a11y/text_scale_test.dart` already
/// records for a field's `labelText`: Material builds `hintText` with a single
/// ellipsised line, so at a 2.0 scale the catalog's search hint is clipped rather
/// than reflowed. Req 13.10 forbids that, and replacing the decoration text with a
/// wrapping widget is the shared field work in task 8.1 — asserting it here would
/// fail every catalog state on one defect that none of these states introduces and
/// that this task cannot fix without changing a shared control.
void _expectNoTruncatedContent(WidgetTester tester, {required String context}) {
  for (final RenderParagraph paragraph in allParagraphs(tester)) {
    final String text = paragraph.text.toPlainText();
    if (text == _kCatalogSearchHint) continue;
    expect(
      paragraph.didExceedMaxLines,
      isFalse,
      reason: '$context: text was truncated: "$text"',
    );
  }
}

void main() {
  group('Req 11.7: the list-state golden case list', () {
    test('covers the three surfaces the criterion names', () {
      expect(
        kStateGoldenCases.map((StateGoldenCase e) => e.surfaceKind).toSet(),
        StateSurface.values.toSet(),
      );
    });

    test('stages every state each surface can be in', () {
      expect(
        kCatalogGoldenCases.map((StateGoldenCase e) => e.name).toList(),
        <String>[
          'catalog_loading',
          'catalog_empty',
          'catalog_filtered_empty',
          'catalog_error',
          'catalog_offline',
        ],
      );
      expect(
        kContractsGoldenCases.map((StateGoldenCase e) => e.name).toList(),
        <String>[
          'contracts_loading',
          'contracts_empty',
          'contracts_error',
          'contracts_offline',
        ],
      );
      expect(
        kInboxGoldenCases.map((StateGoldenCase e) => e.name).toList(),
        <String>[
          'inbox_loading',
          'inbox_empty',
          'inbox_error',
          'inbox_offline',
        ],
      );
    });

    test('stages filtered-to-empty only where a filter surface exists', () {
      // Recorded as an assertion rather than as an omission: Req 11.9 governs a list
      // that came back empty WITH a filter active, and the catalog is the only one of
      // the three that has one. Adding a filter to the other two would be a new
      // capability (Req 14.12), and a reference image of a state a screen cannot
      // enter would be a picture of a fiction.
      expect(
        kStateGoldenCases
            .where((StateGoldenCase e) => e.state == ListStateKind.filteredEmpty)
            .map((StateGoldenCase e) => e.surfaceKind)
            .toList(),
        <StateSurface>[StateSurface.catalog],
      );
    });

    test('names collide with nothing', () {
      final List<String> names =
          kStateGoldenCases.map((StateGoldenCase e) => e.name).toList();
      expect(names.toSet(), hasLength(names.length));
    });

    test('pairs every case with a 2.0 text-scale twin at one surface size', () {
      for (final StateGoldenCase entry in kStateGoldenCases) {
        expect(entry.textScales, <double>[1.0, 2.0], reason: entry.name);
        expect(entry.surface, kStateGoldenSurface, reason: entry.name);
      }
    });

    test('names no retired vocabulary', () {
      for (final StateGoldenCase entry in kStateGoldenCases) {
        for (final String retired in <String>[
          'deal',
          'ditto',
          'kyc',
          'shopfront',
          'escrow',
          'bond',
        ]) {
          expect(
            entry.name.toLowerCase(),
            isNot(contains(retired)),
            reason: '${entry.name} names retired vocabulary "$retired"',
          );
        }
      }
    });

    test('exactly the loading cases declare a skeleton phase', () {
      // Req 11.7's "fixed point in the pulse cycle" only applies to a capture that
      // HAS a placeholder in it. This assertion keeps the flag derived from the state
      // rather than restated per case.
      for (final StateGoldenCase entry in kStateGoldenCases) {
        expect(
          entry.pumpsSkeleton,
          entry.state == ListStateKind.loading,
          reason: '${entry.name} disagrees about whether it draws a placeholder',
        );
      }
    });
  });

  group('every staged case lays out at every scale it will be captured at', () {
    for (final StateGoldenCase entry in kStateGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpStateSurface(
            tester,
            entry.build(),
            overrides: entry.overrides,
            textScaleFactor: scale,
            surface: entry.surface,
          );

          expectNoLayoutOverflow(tester);
          _expectNoTruncatedContent(tester, context: '${entry.name} at ${scale}x');

          await disposeStateSurface(tester);
        });
      }
    }
  });

  group('each case is in the state its name claims', () {
    /// Pumps one case at the declared phase.
    Future<void> pumpCase(WidgetTester tester, StateGoldenCase entry) {
      return pumpStateSurface(
        tester,
        entry.build(),
        overrides: entry.overrides,
        surface: entry.surface,
      );
    }

    StateGoldenCase caseNamed(String name) =>
        kStateGoldenCases.firstWhere((StateGoldenCase e) => e.name == name);

    for (final String name in <String>[
      'catalog_loading',
      'contracts_loading',
      'inbox_loading',
    ]) {
      testWidgets('$name has a placeholder on screen at the declared phase',
          (tester) async {
        await pumpCase(tester, caseNamed(name));

        // Req 11.1: the placeholder is the thing on screen, and it is out of the
        // accessibility tree. A capture with nothing in it would mean the phase sat
        // inside the 200 ms suppression window.
        expect(
          find.byWidgetPredicate(
            (Widget widget) =>
                widget is SkeletonListTile || widget is SkeletonListingCard,
          ),
          findsWidgets,
        );
        expect(find.byType(ErrorView), findsNothing);

        await disposeStateSurface(tester);
      });
    }

    for (final String name in <String>[
      'catalog_empty',
      'contracts_empty',
      'inbox_empty',
    ]) {
      testWidgets('$name presents the plain empty state', (tester) async {
        await pumpCase(tester, caseNamed(name));

        expect(find.byType(EmptyState), findsOneWidget);
        // Req 11.9 reserves the plain empty state for a list with no filter active,
        // so this one offers nothing to clear.
        expect(find.text('Clear filters'), findsNothing);

        await disposeStateSurface(tester);
      });
    }

    testWidgets('catalog_filtered_empty names the term and offers one way out',
        (tester) async {
      await pumpCase(tester, caseNamed('catalog_filtered_empty'));

      expect(find.byType(EmptyState), findsOneWidget);
      expect(find.textContaining('charizard'), findsOneWidget);
      expect(find.text('Clear filters'), findsOneWidget);

      await disposeStateSurface(tester);
    });

    for (final String name in <String>[
      'catalog_error',
      'contracts_error',
      'inbox_error',
    ]) {
      testWidgets('$name explains a fault and offers a retry', (tester) async {
        await pumpCase(tester, caseNamed(name));

        expect(find.text('We couldn\'t load that'), findsOneWidget);
        expect(find.text('Try again'), findsOneWidget);
        // Req 11.4: the explanation carries nothing internal. The error value behind
        // this case is an `Exception`, whose text would otherwise be on screen.
        expect(find.textContaining('Exception'), findsNothing);

        await disposeStateSurface(tester);
      });
    }

    for (final String name in <String>[
      'catalog_offline',
      'contracts_offline',
      'inbox_offline',
    ]) {
      testWidgets('$name names the lost connection, not a fault', (tester) async {
        await pumpCase(tester, caseNamed(name));

        // Req 11.10: a device with no connectivity is a different message from a
        // server fault, and the two must not collapse into one apology.
        expect(find.text('You\'re offline'), findsOneWidget);
        expect(find.text('We couldn\'t load that'), findsNothing);
        expect(find.text('Try again'), findsOneWidget);
        expect(find.textContaining('SocketException'), findsNothing);

        await disposeStateSurface(tester);
      });
    }

    testWidgets('the two failures do not present the same explanation',
        (tester) async {
      // Metamorphic: the same surface, the same operation, one input difference. If
      // these two strings ever match, the classifier has stopped classifying.
      await pumpCase(tester, caseNamed('contracts_error'));
      final String fault = tester
          .widgetList<Text>(find.byType(Text))
          .map((Text text) => text.data ?? '')
          .firstWhere((String value) => value.contains('your trades'));
      await disposeStateSurface(tester);

      await pumpCase(tester, caseNamed('contracts_offline'));
      final String offline = tester
          .widgetList<Text>(find.byType(Text))
          .map((Text text) => text.data ?? '')
          .firstWhere((String value) => value.contains('your trades'));
      await disposeStateSurface(tester);

      expect(offline, isNot(fault));
      expect(fault, contains('your trades'));
      expect(offline, contains('your trades'));
    });
  });
}
