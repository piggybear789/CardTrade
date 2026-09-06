// Feature: mobile-release-readiness — task 7.3 (Req 6.2, 6.3).
//
// Covers the two surfaces the startup gate can reach, and one source-reading
// assertion about the branch it cannot:
//
//   1. Debug (Req 6.3): a non-empty result is reported on a VISIBLE in-app
//      surface and the app underneath keeps running. A complete config renders
//      no banner at all.
//   2. Release (Req 6.2): `StartupErrorApp` names the missing keys.
//   3. `_bootstrap` itself is NOT exercised — it calls `Supabase.initialize` and
//      `Stripe.instance.applySettings`, both of which need platform channels, so
//      there is no widget test of the release throw. Manual check M11 (a release
//      build with a deliberately blank `STRIPE_PUBLISHABLE_KEY`) is what
//      confirms it. What IS asserted here is that the strictness gate reads
//      `kReleaseMode` and never `Env.isProduction` (design decision D4), which
//      is a property of the source's shape rather than of its behaviour.

import 'dart:io';

import 'package:cardtrade/core/config_gate.dart';
import 'package:cardtrade/core/config_report_banner.dart';
import 'package:cardtrade/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const MissingConfig _stripeMissing = MissingConfig(
  ConfigKeys.stripePublishableKey,
  'is not set',
);

Widget _host(List<MissingConfig> problems) => MaterialApp(
  home: ConfigReportBanner(
    problems: problems,
    child: const Scaffold(body: Text('member surface')),
  ),
);

void main() {
  group('ConfigReportBanner (Req 6.3)', () {
    testWidgets('renders nothing when the config is complete', (tester) async {
      await tester.pumpWidget(_host(const <MissingConfig>[]));

      expect(find.text('Configuration incomplete'), findsNothing);
      expect(find.text('member surface'), findsOneWidget);
    });

    testWidgets('names each missing key over a running app', (tester) async {
      await tester.pumpWidget(_host(const <MissingConfig>[_stripeMissing]));

      expect(find.text('Configuration incomplete'), findsOneWidget);
      expect(
        find.text('${ConfigKeys.stripePublishableKey}: is not set'),
        findsOneWidget,
      );
      // Req 6.3: the app continues to run underneath the report.
      expect(find.text('member surface'), findsOneWidget);
    });

    testWidgets('can be dismissed so it does not block local work', (
      tester,
    ) async {
      await tester.pumpWidget(_host(const <MissingConfig>[_stripeMissing]));

      await tester.tap(find.byIcon(Icons.close));
      await tester.pump();

      expect(find.text('Configuration incomplete'), findsNothing);
      expect(find.text('member surface'), findsOneWidget);
    });
  });

  group('StartupErrorApp on a missing config (Req 6.2)', () {
    testWidgets('names the missing keys and shows no member surface', (
      tester,
    ) async {
      await tester.pumpWidget(
        StartupErrorApp(
          message: describeMissingConfig(const <MissingConfig>[
            _stripeMissing,
            MissingConfig(ConfigKeys.webAppUrl, 'is not set'),
          ]),
        ),
      );

      expect(find.text('CardTrade could not start'), findsOneWidget);
      expect(
        find.textContaining(ConfigKeys.stripePublishableKey),
        findsOneWidget,
      );
      expect(find.textContaining(ConfigKeys.webAppUrl), findsOneWidget);
      // No navigation, no router, nothing a member could act on.
      expect(find.byType(MaterialApp), findsOneWidget);
      expect(find.byType(ElevatedButton), findsNothing);
      expect(find.byType(TextButton), findsNothing);
    });

    test('the report carries keys and reasons only, never a value', () {
      const String secret = 'sk_live_ThisMustNeverBeRendered';
      final List<MissingConfig> problems = validateConfig(
        supabaseUrl: 'https://project.supabase.co',
        supabaseAnonKey: 'anon',
        stripePublishableKey: secret,
        webAppUrl: 'https://noditto.app',
      );

      final String report = describeMissingConfig(problems);

      expect(report, contains(ConfigKeys.stripePublishableKey));
      expect(report, isNot(contains(secret)));
      expect(report, isNot(contains('sk_live')));
    });
  });

  group('design decision D4', () {
    test('the startup gate reads kReleaseMode and not Env.isProduction', () {
      // Comments are stripped first: the doc comment on `_bootstrap` names
      // `Env.isProduction` in order to say it is NOT read, and prose matching
      // the regex just as well as code does is the shape of bug the
      // TypeScript-side agreement tests already record.
      final String source = File('lib/main.dart')
          .readAsStringSync()
          .split('\n')
          .where((line) => !line.trimLeft().startsWith('//'))
          .join('\n');

      expect(source, contains('kReleaseMode'));
      expect(
        source.contains('Env.isProduction'),
        isFalse,
        reason:
            'isProduction is itself a config value, so gating strictness on it '
            'would let a prod.env typo ship a permissive release (D4).',
      );
    });
  });
}
