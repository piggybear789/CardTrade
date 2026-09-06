// Feature: mobile-release-readiness — the account closure entry point.
//
// THE DEFECT THESE TESTS PIN. The row used to read "Delete account", raise a dialog
// promising to "permanently delete your account and all associated data", and then show
// a SnackBar saying deletion was handled by support. It claimed an outcome nothing
// performed. Requirement 7.8 is the rule that forbids it, and it cuts in three
// directions at once, so there is one test per direction:
//
//   1. the server closed the account  → the outcome may be stated, and the member is
//      signed out of this device;
//   2. the server REFUSED             → the blocking categories are stated in member
//      language, and no success copy appears;
//   3. the call never landed          → nothing is claimed at all.
//
// The refusal case also asserts the negative that matters: `ACTIVE_CASH_SALE` never
// reaches a member's eyes. A member told an enum name has been told nothing.
//
// The service is faked rather than stubbed at the HTTP layer, because what is under
// test is the screen's reading of a `Result` — the endpoint's own behaviour is covered
// by `tests/unit/accountClosureEndpoint.test.ts`.
//
// Validates: Requirements 7.8.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/result.dart';
import 'package:cardtrade/features/profile/screens/settings_screen.dart';
import 'package:cardtrade/providers/account_provider.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/services/account_service.dart';

import '../support/harness.dart';

/// One canned answer from the Account_Closure_Service.
class _FakeAccountService implements AccountService {
  _FakeAccountService(this.answer);

  final Result<AccountClosure> answer;
  int calls = 0;

  @override
  Future<Result<AccountClosure>> closeAccount() async {
    calls++;
    return answer;
  }
}

/// Records the local sign-out without reaching Supabase.
class _RecordingAuthActions extends AuthActionsNotifier {
  bool signedOut = false;

  @override
  Future<void> signOut() async {
    signedOut = true;
  }
}

/// Pumps the settings screen over one canned answer and returns both fakes.
Future<(_FakeAccountService, _RecordingAuthActions)> _pumpSettings(
  WidgetTester tester,
  Result<AccountClosure> answer,
) async {
  final _FakeAccountService service = _FakeAccountService(answer);
  final _RecordingAuthActions auth = _RecordingAuthActions();

  await setViewport(tester, kPhoneViewport);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        accountServiceProvider.overrideWithValue(service),
        authActionsProvider.overrideWith(() => auth),
      ],
      child: pumpFixture(
        const SettingsScreen(),
        reduceMotion: true,
        scaffold: false,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (service, auth);
}

/// Brings the account row into view. It sits at the bottom of a scrolling list, so on
/// a phone viewport it may not have been built yet.
Future<void> _revealCloseRow(WidgetTester tester) async {
  await tester.scrollUntilVisible(find.text(closeAccountLabel), 200.0);
  await tester.pumpAndSettle();
}

/// Walks the row and the confirmation dialog, leaving whatever came back on screen.
Future<void> _confirmClosure(WidgetTester tester) async {
  await _revealCloseRow(tester);
  await tester.tap(find.text(closeAccountLabel));
  await tester.pumpAndSettle();

  expect(
    find.text('Close your account?'),
    findsOneWidget,
    reason: 'the confirmation step is where the member reads what happens',
  );

  await tester.tap(find.widgetWithText(FilledButton, closeAccountLabel));
  await tester.pumpAndSettle();
}

/// Copy that may appear only after the server said it closed the account.
void _expectNoSuccessCopy(WidgetTester tester) {
  expect(find.textContaining('Your account is closed'), findsNothing);
  expect(find.textContaining('no longer publicly identifiable'), findsNothing);
}

void main() {
  group('Req 7.8: the entry point states only what the server returned', () {
    testWidgets('the row and its dialog promise closure, never deletion',
        (tester) async {
      await _pumpSettings(tester, const Ok(AccountClosure(closedAt: '')));
      await _revealCloseRow(tester);

      expect(find.text(closeAccountLabel), findsOneWidget);
      expect(
        find.textContaining('Delete account'),
        findsNothing,
        reason: 'closure is anonymise-and-detach, so the control is not a delete',
      );

      await tester.tap(find.text(closeAccountLabel));
      await tester.pumpAndSettle();

      // The four things closure actually does, and none of the one it does not.
      expect(find.textContaining('no longer publicly identifiable'), findsOneWidget);
      expect(find.textContaining('records are kept'), findsOneWidget);
      expect(find.textContaining('sign-in stops working'), findsOneWidget);
      expect(find.textContaining('delete'), findsNothing);
      expect(find.textContaining('all associated data'), findsNothing);
    });

    testWidgets('a closure the server performed is stated, and signs the member out',
        (tester) async {
      final (service, auth) = await _pumpSettings(
        tester,
        const Ok(AccountClosure(closedAt: '2026-01-15T09:30:00.000Z')),
      );

      await _confirmClosure(tester);

      expect(service.calls, 1);
      expect(find.text('Your account is closed'), findsOneWidget);
      expect(
        find.textContaining('kept for accounting and dispute resolution'),
        findsOneWidget,
      );

      // The outcome is read first, then the sign-out takes them out of the
      // authenticated app — the router redirects on the auth state change.
      expect(auth.signedOut, isFalse);
      await tester.tap(find.widgetWithText(FilledButton, 'OK'));
      await tester.pumpAndSettle();
      expect(auth.signedOut, isTrue);
    });

    testWidgets('a refusal names its blocking categories in member language',
        (tester) async {
      final (service, auth) = await _pumpSettings(
        tester,
        const Err<AccountClosure>(
          'MONEY_IN_FLIGHT',
          message:
              'Your account still has activity in progress, so it cannot be closed yet.',
          details: <String, dynamic>{
            'blockers': <String>['ACTIVE_CASH_SALE', 'OPEN_DISPUTE'],
          },
        ),
      );

      await _confirmClosure(tester);

      expect(service.calls, 1);
      expect(find.text('Your account cannot be closed yet'), findsOneWidget);
      expect(
        find.textContaining('a sale is still in progress'),
        findsOneWidget,
      );
      expect(find.textContaining('a dispute is still open'), findsOneWidget);

      // The assertion the requirement is really about: the code the server chose is
      // never the thing a member reads.
      for (final String code in <String>[
        'ACTIVE_CASH_SALE',
        'ACTIVE_TRADE_COLLATERAL',
        'PENDING_PAYOUT',
        'OPEN_DISPUTE',
        'MONEY_IN_FLIGHT',
      ]) {
        expect(
          find.textContaining(code),
          findsNothing,
          reason: '$code reached the member as an enum name',
        );
      }

      _expectNoSuccessCopy(tester);
      expect(auth.signedOut, isFalse);
    });

    testWidgets('every blocking category has a sentence of its own', (tester) async {
      // The four the server can return, mapped one at a time, so a category added to
      // the union without copy shows up here rather than as a fallback sentence in
      // front of a member.
      for (final String code in <String>[
        'ACTIVE_CASH_SALE',
        'ACTIVE_TRADE_COLLATERAL',
        'PENDING_PAYOUT',
        'OPEN_DISPUTE',
      ]) {
        final String sentence = closureBlockerSentence(code);
        expect(sentence, isNot(contains(code)));
        expect(sentence, isNot('something on your account has not finished yet'));
      }
    });

    testWidgets('a call that never landed claims nothing', (tester) async {
      final (service, auth) = await _pumpSettings(
        tester,
        const Err<AccountClosure>(
          'NETWORK_ERROR',
          message: 'Unable to reach the server. Check your connection.',
        ),
      );

      await _confirmClosure(tester);

      expect(service.calls, 1);
      expect(find.text('We could not close your account'), findsOneWidget);
      expect(
        find.textContaining('Unable to reach the server'),
        findsOneWidget,
      );
      _expectNoSuccessCopy(tester);
      expect(auth.signedOut, isFalse);
    });

    testWidgets('a partial closure shows the server\'s own careful wording',
        (tester) async {
      // `DETACH_INCOMPLETE` means the account IS closed but the sign-in may still
      // work. Composing our own summary of that would be a second account of a
      // partial outcome, so the server's message is shown as-is.
      const String serverMessage =
          'Your account is closed and your profile is no longer publicly identifiable, '
          'but your sign-in details may still work. Please try again.';

      final (_, auth) = await _pumpSettings(
        tester,
        const Err<AccountClosure>('DETACH_INCOMPLETE', message: serverMessage),
      );

      await _confirmClosure(tester);

      expect(find.text(serverMessage), findsOneWidget);
      expect(
        find.textContaining('sign-in no longer works'),
        findsNothing,
        reason: 'the closure did not finish, so that would be a false statement',
      );

      await tester.tap(find.widgetWithText(FilledButton, 'OK'));
      await tester.pumpAndSettle();
      expect(auth.signedOut, isTrue);
    });
  });
}
