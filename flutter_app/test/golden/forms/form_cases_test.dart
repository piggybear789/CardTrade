// The host-independent cover for the form-control golden cases.
//
// This file makes NO pixel comparison: `form_golden_test.dart` does that and owns the
// references in `goldens/`. The split is the one recorded at the head of
// `form_golden_cases.dart` — the comparison is scoped to the designated host because
// font rasterisation differs between platforms, and everything here measures geometry
// and reads names, so it runs everywhere.
//
// What it asserts instead is that the case LIST is the set Req 8.12 asks for —
// a field at rest, focused, invalid and disabled, each button treatment enabled,
// disabled and busy, and a form presenting a form-level summary — that every case
// pairs a 1.0 capture with a 2.0 twin at one surface size (Req 13.13), that no
// case names retired vocabulary, and that every case builds and lays out at both
// scales. A golden of a tree that overflows is a picture of a bug.
//
// Requirements 8.12, 13.10, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/widgets/common/controls.dart';

import '../../support/harness.dart';
import '../../support/message_fixtures.dart';
import 'form_golden_cases.dart';

void main() {
  group('Req 8.12: the form golden case list', () {
    test('covers every field, button and summary state the criterion names', () {
      expect(
        kFormGoldenCases.map((FormGoldenCase entry) => entry.name).toList(),
        <String>[
          'field_at_rest',
          'field_focused',
          'field_invalid',
          'field_disabled',
          'button_primary_enabled',
          'button_primary_disabled',
          'button_primary_busy',
          'button_iris_enabled',
          'button_iris_disabled',
          'button_iris_busy',
          'button_outlined_enabled',
          'button_outlined_disabled',
          'button_outlined_busy',
          'button_destructive_enabled',
          'button_destructive_disabled',
          'button_destructive_busy',
          'form_with_summary',
          'choice_chips_selected',
        ],
      );
    });

    test('names collide with nothing', () {
      final List<String> names =
          kFormGoldenCases.map((FormGoldenCase e) => e.name).toList();
      expect(names.toSet(), hasLength(names.length));
    });

    test('pairs every case with a 2.0 text-scale twin at one surface size', () {
      for (final FormGoldenCase entry in kFormGoldenCases) {
        // Req 13.13: the factor is the only difference between a pair, so the
        // surface is declared once per case and never per scale.
        expect(entry.textScales, <double>[1.0, 2.0], reason: entry.name);
        expect(entry.surface, kFormGoldenSurface, reason: entry.name);
      }
    });

    test('names no retired vocabulary', () {
      // Req 14.4 covers identifiers, strings and routes; a golden file name is all
      // three at once, and Flutter is the client that has reintroduced a retired
      // concept by naming it before.
      for (final FormGoldenCase entry in kFormGoldenCases) {
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

    test('every busy case is marked as animating', () {
      // A running indicator's frame depends on the clock, so 11.1's harness has to
      // advance it to a declared state before capture (Req 15.11). This assertion
      // is what stops a busy case being added without that flag.
      for (final FormGoldenCase entry in kFormGoldenCases) {
        expect(
          entry.pumpsAnimation,
          entry.name.endsWith('_busy'),
          reason: '${entry.name} disagrees about whether it animates',
        );
      }
    });
  });

  group('every staged case lays out at every scale it will be captured at', () {
    for (final FormGoldenCase entry in kFormGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpMessageSurface(
            tester,
            entry.build(),
            textScaleFactor: scale,
            surface: entry.surface,
          );

          if (entry.focusField) {
            await tester.tap(find.byType(TextField));
            await tester.pump();
            expect(
              tester.binding.focusManager.primaryFocus,
              isNotNull,
              reason: '${entry.name} is a focused capture and took no focus',
            );
          }

          expectNoLayoutOverflow(tester);
          expectNoTruncatedText(tester, context: '${entry.name} at ${scale}x');
        });
      }
    }
  });

  group('the busy pair is the same control, not a smaller one', () {
    // Req 8.10 in the terms a REVIEWER of the reference images needs: the busy
    // capture must be the enabled capture with a spinner over it. If these two
    // differ in size, the pair of goldens is a picture of a form jumping.
    for (final (String enabled, String busy) in <(String, String)>[
      ('button_primary_enabled', 'button_primary_busy'),
      ('button_iris_enabled', 'button_iris_busy'),
      ('button_outlined_enabled', 'button_outlined_busy'),
      ('button_destructive_enabled', 'button_destructive_busy'),
    ]) {
      testWidgets('$enabled and $busy measure the same', (tester) async {
        Widget treeOf(String name) => kFormGoldenCases
            .firstWhere((FormGoldenCase entry) => entry.name == name)
            .build();

        await pumpMessageSurface(tester, treeOf(enabled));
        final Size resting = tester.getSize(find.byType(AppButton));

        await pumpMessageSurface(tester, treeOf(busy));
        expect(tester.getSize(find.byType(AppButton)), resting);
        expect(find.byType(CircularProgressIndicator), findsOneWidget);
      });
    }
  });
}
