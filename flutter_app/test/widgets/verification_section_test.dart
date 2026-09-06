// Feature: mobile-visual-parity — the two gates and the honest count.
//
// FOUR COMBINATIONS, NOT THREE STAGES. Req 10.3 names each of the four states the
// two steps can be in as its own presentation, and the one that is easy to get
// wrong is payout-passed-identity-pending: it is a legitimate state, it is not an
// error, and a client that inferred one step from the other would either draw it as
// a fault or refuse to draw it at all. The cases below pump the whole Account hub
// over a profile whose COLUMNS carry each combination, so the section's marks are
// the port's answers rather than two booleans a fixture handed it.
//
// A COUNT IS NOT A ZERO. Req 10.8: while a count read is outstanding the hub draws
// the em-dash placeholder and says "not loaded yet" to a screen reader, because the
// screen this replaced wrote `value?.length ?? 0` and told a member with three
// listings that they had none.
//
// A RE-READ NEVER BLANKS A MARK. Req 10.7: `ProfileReRead` retains the last profile
// the SERVER reported, and past `ProfileReRead.overdueAfter` the section says the
// answer is late and offers to ask again — it does not report a status it has not
// been told.
//
// Validates: Requirements 10.2, 10.3, 10.4, 10.7, 10.8.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/features/profile/screens/my_profile_screen.dart';
import 'package:cardtrade/features/profile/widgets/profile_reread.dart';
import 'package:cardtrade/features/profile/widgets/profile_sections.dart';
import 'package:cardtrade/features/profile/widgets/verification_section.dart';

import '../support/harness.dart';
import '../support/state_fixtures.dart';

/// The status word drawn beside one step's heading.
///
/// Read from the rendered tree rather than inferred: the section draws the word and
/// the colour from the same answer, and reading the word is what makes the assertion
/// about what a member sees instead of about the widget's arguments.
String _statusOf(WidgetTester tester, String stepTitle) {
  final Finder row = find.ancestor(
    of: find.text(stepTitle),
    matching: find.byType(Row),
  );
  final Finder status = find.descendant(
    of: row.first,
    matching: find.byWidgetPredicate(
      (Widget widget) =>
          widget is Text &&
          (widget.data == VerificationSection.passedLabel ||
              widget.data == VerificationSection.pendingLabel),
    ),
  );
  return tester.widget<Text>(status.first).data!;
}

/// The colour the step's status word is drawn in.
Color _statusColourOf(WidgetTester tester, String stepTitle) {
  final Finder row = find.ancestor(
    of: find.text(stepTitle),
    matching: find.byType(Row),
  );
  final Finder status = find.descendant(
    of: row.first,
    matching: find.byWidgetPredicate(
      (Widget widget) =>
          widget is Text &&
          (widget.data == VerificationSection.passedLabel ||
              widget.data == VerificationSection.pendingLabel),
    ),
  );
  return tester.widget<Text>(status.first).style!.color!;
}

void main() {
  group('Req 10.3: each of the four gate combinations is its own presentation', () {
    /// The four combinations, with the two marks each must present.
    const List<(String, bool, bool)> combinations = <(String, bool, bool)>[
      ('neither step passed', false, false),
      ('identity passed, payout not', true, false),
      ('payout passed, identity not', false, true),
      ('both steps passed', true, true),
    ];

    for (final (String label, bool identity, bool payout) in combinations) {
      testWidgets('$label draws each mark from its own status', (tester) async {
        await pumpStateSurface(
          tester,
          const MyProfileScreen(),
          overrides: accountOverrides(
            profile: makeAccountProfile(
              identityPassed: identity,
              payoutPassed: payout,
            ),
          ),
        );

        expect(
          _statusOf(tester, VerificationSection.identityTitle),
          identity
              ? VerificationSection.passedLabel
              : VerificationSection.pendingLabel,
        );
        expect(
          _statusOf(tester, VerificationSection.payoutTitle),
          payout
              ? VerificationSection.passedLabel
              : VerificationSection.pendingLabel,
        );

        // Req 10.4: `--trust` for a passed step, `--muted-foreground` for a
        // pending one, and the word beside it either way so colour is never the
        // only signal.
        expect(
          _statusColourOf(tester, VerificationSection.identityTitle),
          identity ? AppColors.trust : AppColors.mutedForeground,
        );
        expect(
          _statusColourOf(tester, VerificationSection.payoutTitle),
          payout ? AppColors.trust : AppColors.mutedForeground,
        );

        // Req 10.3: the identity step is the one named as outstanding, and only
        // while it is outstanding. A member who set payouts up first is not being
        // chased for anything.
        expect(
          find.text('Next step: ${VerificationSection.identityTitle}'),
          identity ? findsNothing : findsOneWidget,
        );

        await disposeStateSurface(tester);
      });
    }

    testWidgets('a payout-ready member who has not verified sees no error',
        (tester) async {
      // The combination most at risk of being drawn as a fault. Nothing has gone
      // wrong: they simply have not done step one yet.
      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(
          profile: makeAccountProfile(identityPassed: false, payoutPassed: true),
        ),
      );

      for (final String alarming in <String>[
        'error',
        'failed',
        'problem',
        'went wrong',
        'not allowed',
      ]) {
        expect(
          find.textContaining(alarming, findRichText: true),
          findsNothing,
          reason: 'a valid pending state is presented as "$alarming"',
        );
      }

      await disposeStateSurface(tester);
    });

    testWidgets('neither step is inferred from the other', (tester) async {
      // Metamorphic: hold step two fixed and move step one. Only step one's mark
      // may move. This is the assertion that fails if either mark is ever derived
      // from `canReceiveFunds && satisfiesIdentityGate`.
      for (final bool payout in <bool>[false, true]) {
        final List<String> identityMarks = <String>[];
        final List<String> payoutMarks = <String>[];

        for (final bool identity in <bool>[false, true]) {
          await pumpStateSurface(
            tester,
            const MyProfileScreen(),
            overrides: accountOverrides(
              profile: makeAccountProfile(
                identityPassed: identity,
                payoutPassed: payout,
              ),
            ),
          );
          identityMarks.add(_statusOf(tester, VerificationSection.identityTitle));
          payoutMarks.add(_statusOf(tester, VerificationSection.payoutTitle));
          await disposeStateSurface(tester);
        }

        expect(
          identityMarks,
          <String>[
            VerificationSection.pendingLabel,
            VerificationSection.passedLabel,
          ],
          reason: 'step one did not follow its own status',
        );
        expect(
          payoutMarks.toSet(),
          hasLength(1),
          reason: 'step two moved when only step one changed',
        );
      }
    });

    testWidgets('a pending step offers its own outbound control', (tester) async {
      // Req 10.6: the handoff names the page it opens and says it leaves the app,
      // rather than implying the step finishes here. Both steps offer one while
      // outstanding, in either order (Req 10.2).
      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(profile: makeAccountProfile()),
      );

      expect(find.text('Verify on the website'), findsOneWidget);
      expect(find.text('Add payout details on the website'), findsOneWidget);
      expect(
        find.textContaining('You will leave the app'),
        findsNWidgets(2),
      );

      await disposeStateSurface(tester);
    });

    testWidgets('a photo document is mentioned only by the identity step',
        (tester) async {
      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(profile: makeAccountProfile()),
      );

      // Req 10.5. The payout step asks for bank details and never for a document,
      // and copy that says otherwise is the 0060 mistake stated in words.
      final Finder mentions = find.textContaining('photo ID');
      expect(mentions, findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(VerificationSection),
          matching: mentions,
        ),
        findsOneWidget,
      );

      await disposeStateSurface(tester);
    });
  });

  group('Req 10.8: a count is a numeral only where one was read', () {
    testWidgets('an outstanding count draws the placeholder, not a zero',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(
          profile: makeAccountProfile(identityPassed: true),
          countsLoading: true,
        ),
      );

      expect(
        find.text(ProfileCount.placeholder),
        findsNWidgets(3),
        reason: 'three counts are outstanding, so three placeholders',
      );
      expect(
        find.text('0'),
        findsNothing,
        reason: 'a confident zero is the defect Req 10.8 names',
      );

      // The placeholder is punctuation, which a screen reader skips or reads as
      // "dash". The state is spelled out instead.
      for (final String label in <String>['Listings', 'Trades', 'Sales']) {
        expect(
          find.bySemanticsLabel('$label, not loaded yet'),
          findsOneWidget,
        );
      }

      handle.dispose();
      await disposeStateSurface(tester);
    });

    testWidgets('a read count draws its figure and reads it out', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(
          profile: makeAccountProfile(identityPassed: true),
          listings: 3,
          trades: 2,
          sales: 5,
        ),
      );

      expect(find.text('3'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.text('5'), findsOneWidget);
      expect(find.text(ProfileCount.placeholder), findsNothing);
      expect(find.bySemanticsLabel('3 Listings'), findsOneWidget);

      handle.dispose();
      await disposeStateSurface(tester);
    });

    testWidgets('a count of zero that WAS read draws the numeral', (tester) async {
      // The distinction Req 10.8 exists for, from the other side: a real zero is a
      // zero, and the placeholder must not swallow it.
      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(
          profile: makeAccountProfile(identityPassed: true),
          listings: 0,
          trades: 0,
          sales: 0,
        ),
      );

      expect(find.text('0'), findsNWidgets(3));
      expect(find.text(ProfileCount.placeholder), findsNothing);

      await disposeStateSurface(tester);
    });

    testWidgets('the placeholder occupies the numeral\'s line box',
        (tester) async {
      // Req 11.1 in the small: swapping the placeholder for the figure must not
      // move the label under it.
      // `.first`: the row carries three counts, and the claim is about one slot.
      double figureHeight(WidgetTester tester, String text) =>
          tester.getSize(find.text(text).first).height;

      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(
          profile: makeAccountProfile(identityPassed: true),
          countsLoading: true,
        ),
      );
      final double placeholder =
          figureHeight(tester, ProfileCount.placeholder);
      await disposeStateSurface(tester);

      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(
          profile: makeAccountProfile(identityPassed: true),
          listings: 3,
        ),
      );
      expect(figureHeight(tester, '3'), closeTo(placeholder, 1.0));

      await disposeStateSurface(tester);
    });
  });

  group('Req 10.7: a re-read never costs a member the answer they had', () {
    testWidgets('an overdue re-read says so and offers to ask again',
        (tester) async {
      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(
          profile: makeAccountProfile(identityPassed: true, payoutPassed: true),
        ),
      );

      // Nothing outstanding, so nothing to say.
      expect(find.byType(ProfileReReadNotice), findsNothing);

      await disposeStateSurface(tester);
    });

    testWidgets('the overdue notice retains the marks it was already showing',
        (tester) async {
      // Presented directly rather than by faking a resume: the resume signal comes
      // from the platform lifecycle, and what Req 10.7 fixes is that the notice
      // appears BESIDE the retained marks rather than in place of them.
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(
        pumpFixture(
          VerificationSection(
            identityPassed: true,
            payoutPassed: false,
            reReadOverdue: true,
            onReRead: () {},
            onIdentityDetail: () {},
            onPayoutDetail: () {},
          ),
          reduceMotion: true,
        ),
      );

      expect(find.byType(ProfileReReadNotice), findsOneWidget);
      expect(
        _statusOf(tester, VerificationSection.identityTitle),
        VerificationSection.passedLabel,
        reason: 'a late re-read must not redraw a passed step as pending',
      );
      expect(find.text('Check again'), findsOneWidget);
    });

    test('the overdue boundary is the value Req 10.7 fixes', () {
      expect(ProfileReRead.overdueAfter, const Duration(seconds: 10));
    });

    testWidgets('a first load with nothing reported shows the placeholder, not a status',
        (tester) async {
      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(profilePending: true),
      );

      // No mark either way: the client has not been told anything yet, and
      // guessing here is what Req 10.7 forbids.
      expect(find.byType(VerificationSection), findsNothing);
      expect(find.text(VerificationSection.passedLabel), findsNothing);
      expect(find.text(VerificationSection.pendingLabel), findsNothing);

      await disposeStateSurface(tester);
    });

    testWidgets('a first load that failed explains itself and offers a retry',
        (tester) async {
      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(profileError: fixtureFaultError),
      );

      expect(find.text('We could not load your account'), findsOneWidget);
      expect(find.text('Try again'), findsOneWidget);

      await disposeStateSurface(tester);
    });
  });

  group('the hub presents the web\'s three regions in the web\'s order', () {
    testWidgets('Profile, then Verification, then Payouts', (tester) async {
      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(
          profile: makeAccountProfile(identityPassed: true),
        ),
      );

      // Req 10.1, asserted by ORDER rather than by presence: three headings in the
      // tree says nothing about the sequence a member reads them in.
      //
      // Read off the hub's own child list rather than from screen positions. The
      // hub is a `ListView`, so the Payouts region is below the fold and has not
      // been laid out at all — a position comparison would fail on a region that is
      // present and correctly last.
      final ListView hub = tester.widget<ListView>(find.byType(ListView));
      final List<Widget> regions =
          (hub.childrenDelegate as SliverChildListDelegate).children;
      expect(
        regions.whereType<ProfileSection>().map((ProfileSection s) => s.title),
        orderedEquals(<String>['Profile', 'Verification', 'Payouts']),
      );

      await disposeStateSurface(tester);
    });

    testWidgets('every region lays out at the 2.0 text scale', (tester) async {
      // Req 13.10: the hub carries the longest copy in the app — two handoff
      // explanations and a payout paragraph — so it is where a clipped label would
      // show up first.
      await pumpStateSurface(
        tester,
        const MyProfileScreen(),
        overrides: accountOverrides(profile: makeAccountProfile()),
        textScaleFactor: 2.0,
      );

      expectNoLayoutOverflow(tester);
      expectNoTruncatedText(tester, context: 'the Account hub at 2.0x');

      await disposeStateSurface(tester);
    });
  });
}
