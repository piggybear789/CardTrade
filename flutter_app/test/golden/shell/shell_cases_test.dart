// The host-independent cover for the Mobile_Shell golden cases.
//
// This file makes NO pixel comparison: `shell_golden_test.dart` does that and owns
// the references in `goldens/`. What it asserts instead is that every case Req 4.14
// names builds and lays out at every text scale it will be captured at, and that the
// case list is the set the requirement asks for.
//
// WHY BOTH FILES EXIST. The comparison is scoped to the designated host, because font
// rasterisation differs between platforms; everything here measures geometry and reads
// names, so it runs everywhere. A golden of a tree that overflows is a picture of a
// bug, and this is what stops one being committed as a reference.
//
// Requirements 4.14, 13.10, 13.13.

import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/router/hub_set.dart';

import '../../support/harness.dart';
import 'shell_golden_cases.dart';

void main() {
  group('Req 4.14: the shell golden case list', () {
    test('covers all five destinations, none current, guest, and the cap', () {
      final List<String> names =
          kShellGoldenCases.map((ShellGoldenCase entry) => entry.name).toList();

      expect(names, <String>[
        for (final MobileHub hub in kMobileHubs) 'shell_current_${hub.id.name}',
        'shell_current_none',
        'shell_guest',
        'shell_badge_capped',
      ]);
      expect(names.toSet(), hasLength(names.length), reason: 'names collide');
    });

    test('pairs every case with a 2.0 text-scale twin at one surface size', () {
      for (final ShellGoldenCase entry in kShellGoldenCases) {
        // Req 13.13: the factor is the only difference between a pair, so the
        // surface is declared once per case and never per scale.
        expect(entry.textScales, <double>[1.0, 2.0], reason: entry.name);
        expect(entry.surface, kShellGoldenSurface, reason: entry.name);
      }
    });

    test('names no retired vocabulary', () {
      // Req 14.4 covers identifiers, strings and routes; a golden file name is all
      // three at once, and the Flutter app is the client that has reintroduced a
      // retired concept by naming it before.
      for (final ShellGoldenCase entry in kShellGoldenCases) {
        for (final String retired in <String>['deal', 'ditto', 'kyc', 'shopfront']) {
          expect(
            entry.name.toLowerCase(),
            isNot(contains(retired)),
            reason: '${entry.name} names retired vocabulary "$retired"',
          );
        }
      }
    });
  });

  group('every staged case lays out at every scale it will be captured at', () {
    for (final ShellGoldenCase entry in kShellGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await setViewport(tester, entry.surface);
          await tester.pumpWidget(
            pumpFixture(entry.build(), textScaleFactor: scale),
          );

          expectNoLayoutOverflow(tester);
          expectNoTruncatedText(tester, context: '${entry.name} at ${scale}x');
        });
      }
    }
  });
}
