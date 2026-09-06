// The host-independent cover for the profile golden cases.
//
// This file makes NO pixel comparison: `profile_golden_test.dart` does that and owns
// the references in `goldens/`. The split is the one recorded at the head of
// `profile_golden_cases.dart` — the comparison is scoped to the designated host
// because font rasterisation differs between platforms, and everything here measures
// geometry and reads text, so it runs everywhere.
//
// What it asserts instead is that the case LIST is the set Req 10.9 asks for —
// one case per combination of the two steps, plus the hub with its counts still
// loading — that every case pairs a 1.0 capture with a 2.0 twin at one surface size
// (Req 13.13), that no case names retired vocabulary, and that every case builds and
// lays out at both scales. A golden of a tree that overflows is a picture of a bug.
//
// Requirements 10.3, 10.9, 13.10, 13.13, 15.10, 15.11.

import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/features/profile/widgets/profile_sections.dart';
import 'package:cardtrade/features/profile/widgets/verification_section.dart';

import '../../support/harness.dart';
import '../../support/state_fixtures.dart';
import 'profile_golden_cases.dart';

void main() {
  group('Req 10.9: the profile golden case list', () {
    test('covers each gate combination and the loading hub', () {
      expect(
        kProfileGoldenCases.map((ProfileGoldenCase e) => e.name).toList(),
        <String>[
          'verification_neither_passed',
          'verification_identity_passed',
          'verification_payout_passed',
          'verification_both_passed',
          'account_counts_loading',
        ],
      );
    });

    test('names collide with nothing', () {
      final List<String> names =
          kProfileGoldenCases.map((ProfileGoldenCase e) => e.name).toList();
      expect(names.toSet(), hasLength(names.length));
    });

    test('all four combinations of the two steps are present, and only those', () {
      // Four states, not three stages: the criterion enumerates the product of the
      // two steps, and a list missing one of them would be missing the one that is
      // easiest to draw wrong.
      expect(kVerificationGoldenCases, hasLength(4));
    });

    test('pairs every case with a 2.0 text-scale twin at one surface size', () {
      for (final ProfileGoldenCase entry in kProfileGoldenCases) {
        expect(entry.textScales, <double>[1.0, 2.0], reason: entry.name);
        expect(entry.surface, kProfileGoldenSurface, reason: entry.name);
      }
    });

    test('names no retired vocabulary', () {
      // Req 14.4 covers identifiers, strings and routes; a golden file name is all
      // three at once, and Flutter is the client that has reintroduced a retired
      // concept by naming it before.
      for (final ProfileGoldenCase entry in kProfileGoldenCases) {
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

    test('only the loading case declares a skeleton phase', () {
      // A placeholder's presence depends on the clock having passed the skeleton's
      // suppression window, so 11.1's harness has to advance it to a declared
      // instant before capture (Req 15.11). This assertion is what stops a case
      // being added with a placeholder in it and no flag.
      for (final ProfileGoldenCase entry in kProfileGoldenCases) {
        expect(
          entry.pumpsSkeleton,
          entry.name == 'account_counts_loading',
          reason: '${entry.name} disagrees about whether it draws a placeholder',
        );
      }
    });
  });

  group('every staged case lays out at every scale it will be captured at', () {
    for (final ProfileGoldenCase entry in kProfileGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpStateSurface(
            tester,
            entry.build(),
            overrides: entry.overrides,
            textScaleFactor: scale,
            surface: entry.surface,
            scaffold: !entry.ownsScaffold,
          );

          expectNoLayoutOverflow(tester);
          expectNoTruncatedText(tester, context: '${entry.name} at ${scale}x');

          await disposeStateSurface(tester);
        });
      }
    }
  });

  group('the captured states are the states they claim to be', () {
    // A reference image is only worth reviewing if the tree behind it is in the
    // state its name says. These four assertions are what make the file names
    // meaningful to task 11.2.
    for (final (String name, String identity, String payout) in <(
      String,
      String,
      String
    )>[
      (
        'verification_neither_passed',
        VerificationSection.pendingLabel,
        VerificationSection.pendingLabel
      ),
      (
        'verification_identity_passed',
        VerificationSection.passedLabel,
        VerificationSection.pendingLabel
      ),
      (
        'verification_payout_passed',
        VerificationSection.pendingLabel,
        VerificationSection.passedLabel
      ),
      (
        'verification_both_passed',
        VerificationSection.passedLabel,
        VerificationSection.passedLabel
      ),
    ]) {
      testWidgets('$name marks identity $identity and payout $payout',
          (tester) async {
        final ProfileGoldenCase entry = kProfileGoldenCases
            .firstWhere((ProfileGoldenCase e) => e.name == name);

        await pumpStateSurface(
          tester,
          entry.build(),
          overrides: entry.overrides,
          scaffold: !entry.ownsScaffold,
        );

        // Both words appear once each when the steps disagree, and twice when they
        // agree, so the count is the assertion.
        final int passed = identity == VerificationSection.passedLabel
            ? (payout == VerificationSection.passedLabel ? 2 : 1)
            : (payout == VerificationSection.passedLabel ? 1 : 0);
        expect(find.text(VerificationSection.passedLabel), findsNWidgets(passed));
        expect(
          find.text(VerificationSection.pendingLabel),
          findsNWidgets(2 - passed),
        );

        await disposeStateSurface(tester);
      });
    }

    testWidgets('account_counts_loading draws three placeholders and no zero',
        (tester) async {
      final ProfileGoldenCase entry = kProfileGoldenCases
          .firstWhere((ProfileGoldenCase e) => e.name == 'account_counts_loading');

      await pumpStateSurface(
        tester,
        entry.build(),
        overrides: entry.overrides,
        scaffold: !entry.ownsScaffold,
      );

      expect(find.text(ProfileCount.placeholder), findsNWidgets(3));
      expect(find.text('0'), findsNothing);

      await disposeStateSurface(tester);
    });
  });
}
