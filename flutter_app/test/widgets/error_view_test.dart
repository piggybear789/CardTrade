// Feature: mobile-visual-parity — Property 21.
//
// Property 21: For any error value the client can hold, the rendered explanation
// matches no payment-provider reference (`pi_`, `sk_`, `whsec_`, `cus_`, `acct_`,
// `vf_`), no UUID, no exception type name and no stack frame.
//
// A negative claim over the whole error space. Three hand-picked examples pass
// this while a leak survives, which is why the leaky inputs below are composed
// from every shape the client can actually reach: every caller in the app passes
// `error.toString()`, so a `PostgrestException`, a provider identifier or a stack
// frame is one uncaught path away from a member's screen.
//
// Validates: Requirements 11.4.

import 'dart:io' show SocketException;

import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/widgets/common/error_view.dart';

import '../support/harness.dart';

/// The patterns Property 21 names, as the assertion sees them.
final Map<String, RegExp> _forbidden = {
  'provider reference': RegExp(
    r'\b(?:pi|seti|acct|cus|cs|py|tr|ch|vs|vf|sk|whsec|pk)_[A-Za-z0-9_]{6,}',
  ),
  'UUID': RegExp(
    r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b',
    caseSensitive: false,
  ),
  'exception type': RegExp(r'\b\w*(?:Exception|Error)\b'),
  'stack frame': RegExp(r'(^|\s)#\d+\s|\bat\s+\w+\s*\('),
  'provider name': RegExp(
    r'\b(?:stripe|supabase|postgrest|ship24)\b',
    caseSensitive: false,
  ),
};

/// Error values the client can hold, one per leak shape.
const List<String> _leaky = [
  'Exception: failed to load contract',
  'PostgrestException(message: permission denied for table cash_sales, '
      'code: 42501)',
  'StateError: Bad state: no element',
  'Payment failed for pi_3QaBcDeFgHiJkLmN',
  'No such customer: cus_QaBcDeFgHiJk',
  'acct_1QaBcDeFgHiJkLmN is restricted',
  'Verification flow vf_1QaBcDeFgHiJk not found',
  'Signing secret whsec_AbCdEfGhIjKlMnOpQrSt did not match',
  'sk_test_AbCdEfGhIjKlMnOpQrSt is invalid',
  'Contract 3f8b1c2e-9a4d-4e7b-8f21-0c5d6e7a8b9c is not yours',
  '#0      _CashSaleRepository.fetch (package:cardtrade/x.dart:41:7)',
  'TypeError: Cannot read properties of undefined\n    at handler (index.js:1)',
  'Supabase returned 500',
  'Ship24 tracking lookup failed',
  '',
  '   ',
];

/// Values that are already member-facing and must survive untouched.
const List<String> _safe = [
  'Check your connection and try again.',
  'This listing is no longer available.',
  'Your card was declined. Try another card.',
  'The seller has closed this binder or bulk listing.',
  'You cannot open a contract with a member who trades in another region.',
];

void main() {
  group('Property 21: an error explanation discloses nothing internal', () {
    test('every leaky value is replaced with the generic explanation', () {
      for (final String leak in _leaky) {
        final String rendered = ErrorView.sanitise(leak);
        expect(
          rendered,
          ErrorView.genericExplanation,
          reason: 'this reached a member unchanged: "$leak"',
        );
      }
    });

    test('no sanitised value matches any forbidden pattern', () {
      // The cross-product, so a future pattern added to one list is checked
      // against every input rather than only the one it was added for.
      for (final String leak in [..._leaky, ..._safe]) {
        final String rendered = ErrorView.sanitise(leak);
        for (final MapEntry<String, RegExp> pattern in _forbidden.entries) {
          expect(
            pattern.value.hasMatch(rendered),
            isFalse,
            reason: '"$rendered" (from "$leak") discloses a ${pattern.key}',
          );
        }
      }
    });

    test('a member-facing explanation is left alone', () {
      for (final String message in _safe) {
        expect(ErrorView.sanitise(message), message);
      }
    });

    test('the explanation is never blank', () {
      // A blank explanation reads as the client having broken rather than the
      // request having failed, which is a different and worse message.
      for (final String value in [..._leaky, ..._safe]) {
        expect(ErrorView.sanitise(value).trim(), isNotEmpty);
      }
    });

    testWidgets('the rendered widget shows the sanitised text, not the input',
        (tester) async {
      await setViewport(tester, kPhoneViewport);

      for (final String leak in _leaky.where((v) => v.trim().isNotEmpty)) {
        await tester.pumpWidget(
          pumpFixture(
            ErrorView(
              title: 'We could not load this contract',
              message: leak,
            ),
          ),
        );

        expect(find.text(ErrorView.genericExplanation), findsOneWidget);
        expect(
          find.textContaining(leak.split('\n').first),
          findsNothing,
          reason: 'the raw error is on screen',
        );
      }
    });

    test('a classified failure never quotes the error it classified', () {
      // The other half of the property, and the one `sanitise` cannot cover:
      // `RequestFailure` reads the error's text to decide whether the DEVICE lost
      // its connection, and a classifier that then included what it read would
      // leak by construction rather than by a forgotten call site.
      for (final String leak in _leaky) {
        final RequestFailure failure =
            RequestFailure.from(Exception(leak), operation: 'your trades');

        for (final String rendered in <String>[
          failure.title,
          failure.message,
          failure.refreshMessage,
        ]) {
          for (final MapEntry<String, RegExp> pattern in _forbidden.entries) {
            expect(
              pattern.value.hasMatch(rendered),
              isFalse,
              reason: '"$rendered" (classified from "$leak") discloses a '
                  '${pattern.key}',
            );
          }
          expect(
            ErrorView.sanitise(rendered),
            rendered,
            reason: 'a classified explanation must already be safe, so that '
                'sanitising it does not replace it with the generic one',
          );
        }
      }
    });

    test('a classified failure names the operation and nothing else', () {
      // Req 11.4: the explanation says WHICH request to try again. The operation is
      // the screen's own words, so the assertion is that it survives — a generic
      // apology would pass every redaction check above and tell a member nothing.
      for (final String operation in <String>[
        'the catalog',
        'your trades',
        'your messages',
      ]) {
        for (final Object error in <Object>[
          Exception('PostgrestException(message: permission denied)'),
          const SocketException('Failed host lookup: api.example.test'),
        ]) {
          final RequestFailure failure =
              RequestFailure.from(error, operation: operation);
          expect(failure.message, contains(operation));
          expect(failure.refreshMessage, contains(operation));
        }
      }
    });

    test('a lost connection is a different explanation from a fault', () {
      // Req 11.10. Nothing on the server has gone wrong, and telling a member it has
      // sends them to look for a problem that is not there.
      final RequestFailure offline = RequestFailure.from(
        const SocketException('Failed host lookup: api.example.test'),
        operation: 'the catalog',
      );
      final RequestFailure fault = RequestFailure.from(
        Exception('the read did not complete'),
        operation: 'the catalog',
      );

      expect(offline.offline, isTrue);
      expect(fault.offline, isFalse);
      expect(offline.message, isNot(fault.message));
      expect(offline.title, isNot(fault.title));
      // Req 13.11: the glyph is a second, motionless signal, so the two survive
      // greyscale.
      expect(offline.icon, isNot(fault.icon));
    });

    testWidgets('a rendered failure shows the classified copy, never the cause',
        (tester) async {
      await setViewport(tester, kPhoneViewport);

      for (final String leak in _leaky.where((v) => v.trim().isNotEmpty)) {
        await tester.pumpWidget(
          pumpFixture(
            ErrorView.forFailure(
              RequestFailure.from(Exception(leak), operation: 'your sales'),
            ),
          ),
        );

        expect(find.textContaining('your sales'), findsOneWidget);
        expect(
          find.textContaining(leak.split('\n').first),
          findsNothing,
          reason: 'the raw error is on screen',
        );
      }
    });

    testWidgets('a retry action reissues the operation without leaving the screen',
        (tester) async {
      int retries = 0;

      await tester.pumpWidget(
        pumpFixture(
          ErrorView(
            title: 'We could not load your sales',
            message: 'Check your connection and try again.',
            onRetry: () => retries++,
          ),
        ),
      );

      await tester.tap(find.text('Try again'));
      await tester.pump();

      expect(retries, 1);
      expect(find.text('We could not load your sales'), findsOneWidget);
    });
  });
}
