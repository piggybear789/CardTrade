// Feature: mobile-release-readiness — Property 5.
//
// Property 5: For any configuration in which at least one Required_Config_Key
// is empty, or a URL key is not an absolute https URL, or the Stripe key lacks
// a publishable prefix, `validateConfig` returns a non-empty result naming each
// offending key; and for any configuration in which every Required_Config_Key
// satisfies its rule, it returns an empty result.
//
// Dart has no `fast-check`, so the generators below are hand-written over a
// SEEDED `Random`, in the style `deep_link_test.dart` established. Every failure
// reports the seed and the exact input, so a counterexample reproduces by
// re-running the file rather than by luck.
//
// The generators do NOT emit a real credential of any kind. Every "valid"
// Stripe key here is `pk_test_` followed by filler, and the hostile cases are
// prefixes (`sk_`, `rk_`, `whsec_`) with filler after them. A test fixture that
// looked like a live key would be a leak in a tracked file.

import 'dart:math';

import 'package:cardtrade/core/config_gate.dart';
import 'package:flutter_test/flutter_test.dart';

/// Fixed so a counterexample is reproducible. Change it only to hunt for new
/// ones, and never to make a failure go away.
const int kSeed = 20260301;

/// Generated cases per property. The task floor is 100.
const int kIterations = 200;

/// Runs [body] and, on failure, re-raises it carrying the seed and the input.
void check(String input, int iteration, void Function() body) {
  try {
    body();
  } catch (error) {
    fail(
      'counterexample (seed=$kSeed, iteration=$iteration)\n'
      '  input: <$input>\n'
      '  failure: $error',
    );
  }
}

/// Values that satisfy the absolute-https rule, including the shapes a `.env`
/// file produces: surrounding whitespace and a trailing newline.
const List<String> _validUrls = <String>[
  'https://noditto.app',
  'https://noditto.app/',
  'https://project.supabase.co',
  'https://project.supabase.co/',
  'https://staging.noditto.app/base/path',
  'https://noditto.app:8443',
  'HTTPS://noditto.app',
  '  https://noditto.app  ',
  'https://noditto.app\n',
  '\thttps://project.supabase.co\r\n',
];

/// Values that must be reported. Every entry is either empty-after-trimming or
/// not an absolute https URL.
const List<String> _invalidUrls = <String>[
  '',
  ' ',
  '   ',
  '\n',
  '\t\r\n',
  'http://noditto.app', // plain http: the session token rides this origin
  'http://project.supabase.co',
  '//noditto.app', // scheme-relative: no scheme at all
  'noditto.app', // bare host: parses as a relative PATH
  'noditto.app/api',
  '/noditto.app',
  'https://', // scheme, no host
  'https:///path', // authority present but empty host
  'https:noditto.app', // opaque, no authority
  'ftp://noditto.app',
  'noditto://t/abc', // the app's own scheme is not a web origin
  'javascript:alert(1)',
  'file:///etc/passwd',
  'data:text/html,x',
  'localhost:3000',
  'example', // a word
  '::::',
  'https://exa mple.com', // unparseable
];

/// Non-empty values for the opaque anon-key slot. The rule there is presence
/// only — the app has no way to validate a Supabase key's shape offline, and a
/// guess at one would reject legitimate keys after a provider rotation.
const List<String> _validOpaque = <String>[
  'anon-key-placeholder',
  'sb_publishable_PLACEHOLDER',
  'header.payload.signature',
  'x',
  '  padded-with-spaces  ',
  'trailing-newline\n',
];

/// Values that must be reported as empty.
const List<String> _blank = <String>['', ' ', '   ', '\n', ' \t\r\n '];

/// Values carrying the publishable prefix.
const List<String> _validStripeKeys = <String>[
  'pk_test_PLACEHOLDER',
  'pk_live_PLACEHOLDER',
  'pk_PLACEHOLDER',
  '  pk_test_PLACEHOLDER  ',
  'pk_test_PLACEHOLDER\n',
];

/// The hostile Stripe cases, named because each is a specific paste mistake.
/// Every one must read as MISSING rather than as configured (Req 6.5).
const List<String> _invalidStripeKeys = <String>[
  '', // unset
  ' ', // whitespace only
  '   ',
  '\n',
  'sk_test_PLACEHOLDER', // a SECRET key in a mobile bundle
  'sk_live_PLACEHOLDER',
  'rk_test_PLACEHOLDER', // a restricted key is still a server credential
  'rk_live_PLACEHOLDER',
  'whsec_PLACEHOLDER', // a webhook signing secret
  'PK_TEST_PLACEHOLDER', // prefix is case-sensitive, as Stripe's is
  'Pk_test_PLACEHOLDER',
  'pkTEST', // near-miss: no underscore
  'pk-test_PLACEHOLDER',
  ' sk_test_PLACEHOLDER ', // trimming must not smuggle a secret through
  'sk_test_PLACEHOLDER\n',
  'xpk_test_PLACEHOLDER', // prefix must be a prefix, not a substring
  'test_pk_PLACEHOLDER',
  'eyJhbGciOi', // an anon key pasted into the Stripe slot
];

T _oneOf<T>(Random random, List<T> pool) => pool[random.nextInt(pool.length)];

Set<String> _keysOf(List<MissingConfig> problems) =>
    problems.map((MissingConfig p) => p.key).toSet();

void main() {
  group(
    'Feature: mobile-release-readiness, Property 5: for any configuration in '
    'which at least one Required_Config_Key is empty, or a URL key is not an '
    'absolute https URL, or the Stripe key lacks a publishable prefix, '
    'validateConfig returns a non-empty result naming each offending key; and '
    'for any configuration in which every Required_Config_Key satisfies its '
    'rule, it returns an empty result',
    () {
      test('a fully valid configuration validates clean, over $kIterations '
          'cases', () {
        final Random random = Random(kSeed);

        for (int i = 0; i < kIterations; i++) {
          final String supabaseUrl = _oneOf(random, _validUrls);
          final String anonKey = _oneOf(random, _validOpaque);
          final String stripeKey = _oneOf(random, _validStripeKeys);
          final String webAppUrl = _oneOf(random, _validUrls);

          check('$supabaseUrl | $anonKey | $stripeKey | $webAppUrl', i, () {
            expect(
              validateConfig(
                supabaseUrl: supabaseUrl,
                supabaseAnonKey: anonKey,
                stripePublishableKey: stripeKey,
                webAppUrl: webAppUrl,
              ),
              isEmpty,
            );
          });
        }
      });

      test('every offending key is named, and only offending keys are, over '
          '$kIterations cases', () {
        final Random random = Random(kSeed + 1);

        for (int i = 0; i < kIterations; i++) {
          // Independently decide, per key, whether to make it offend. The
          // expected key set is then derived from those decisions rather than
          // from the validator, so the assertion is not circular.
          final bool badSupabaseUrl = random.nextBool();
          final bool badAnonKey = random.nextBool();
          final bool badStripeKey = random.nextBool();
          final bool badWebAppUrl = random.nextBool();

          final String supabaseUrl = badSupabaseUrl
              ? _oneOf(random, _invalidUrls)
              : _oneOf(random, _validUrls);
          final String anonKey = badAnonKey
              ? _oneOf(random, _blank)
              : _oneOf(random, _validOpaque);
          final String stripeKey = badStripeKey
              ? _oneOf(random, _invalidStripeKeys)
              : _oneOf(random, _validStripeKeys);
          final String webAppUrl = badWebAppUrl
              ? _oneOf(random, _invalidUrls)
              : _oneOf(random, _validUrls);

          final Set<String> expected = <String>{
            if (badSupabaseUrl) ConfigKeys.supabaseUrl,
            if (badAnonKey) ConfigKeys.supabaseAnonKey,
            if (badStripeKey) ConfigKeys.stripePublishableKey,
            if (badWebAppUrl) ConfigKeys.webAppUrl,
          };

          check('$supabaseUrl | $anonKey | $stripeKey | $webAppUrl', i, () {
            final List<MissingConfig> problems = validateConfig(
              supabaseUrl: supabaseUrl,
              supabaseAnonKey: anonKey,
              stripePublishableKey: stripeKey,
              webAppUrl: webAppUrl,
            );

            expect(_keysOf(problems), expected);
            // At least one offender means a non-empty result, which is the half
            // of the property the release gate actually depends on.
            expect(problems.isNotEmpty, expected.isNotEmpty);
            // One report per key, never two.
            expect(problems.length, expected.length);
          });
        }
      });

      test('no reason ever echoes the value, over $kIterations cases', () {
        // A reason reaches a startup error screen, a debug log and therefore a
        // screenshot. A malformed secret pasted into the wrong slot must not
        // travel with it.
        final Random random = Random(kSeed + 2);

        for (int i = 0; i < kIterations; i++) {
          final String stripeKey = _oneOf(random, _invalidStripeKeys);
          final String anonKey = _oneOf(random, <String>[
            ..._blank,
            ..._validOpaque,
          ]);
          final String supabaseUrl = _oneOf(random, _invalidUrls);
          final String webAppUrl = _oneOf(random, _invalidUrls);

          check('$supabaseUrl | $anonKey | $stripeKey | $webAppUrl', i, () {
            final List<MissingConfig> problems = validateConfig(
              supabaseUrl: supabaseUrl,
              supabaseAnonKey: anonKey,
              stripePublishableKey: stripeKey,
              webAppUrl: webAppUrl,
            );

            for (final MissingConfig problem in problems) {
              for (final String value in <String>[
                stripeKey,
                anonKey,
                supabaseUrl,
                webAppUrl,
              ]) {
                final String trimmed = value.trim();
                // Short values are substrings of ordinary prose by accident, so
                // only meaningful ones are asserted against.
                if (trimmed.length < 4) continue;
                expect(
                  problem.reason.contains(trimmed),
                  isFalse,
                  reason: 'reason for ${problem.key} echoes a config value',
                );
                expect(
                  problem.toString().contains(trimmed),
                  isFalse,
                  reason: 'toString for ${problem.key} echoes a config value',
                );
              }
              // And the reason names its own key, so the screen is actionable.
              expect(problem.reason, isNotEmpty);
              expect(problem.toString(), contains(problem.key));
            }
          });
        }
      });

      test('validation is total: it never throws, over $kIterations mixed '
          'cases', () {
        final Random random = Random(kSeed + 3);
        final List<String> anything = <String>[
          ..._validUrls,
          ..._invalidUrls,
          ..._validOpaque,
          ..._blank,
          ..._validStripeKeys,
          ..._invalidStripeKeys,
        ];

        for (int i = 0; i < kIterations; i++) {
          final String a = _oneOf(random, anything);
          final String b = _oneOf(random, anything);
          final String c = _oneOf(random, anything);
          final String d = _oneOf(random, anything);

          check('$a | $b | $c | $d', i, () {
            expect(
              validateConfig(
                supabaseUrl: a,
                supabaseAnonKey: b,
                stripePublishableKey: c,
                webAppUrl: d,
              ),
              isA<List<MissingConfig>>(),
            );
          });
        }
      });
    },
  );

  group('the named hostile cases each read as a problem', () {
    // Examples, not a property: each is a specific paste mistake worth pinning
    // by name so a regression says which one broke.
    const Map<String, String> hostileStripe = <String, String>{
      'a secret key': 'sk_test_PLACEHOLDER',
      'a restricted key': 'rk_live_PLACEHOLDER',
      'a webhook signing secret': 'whsec_PLACEHOLDER',
      'whitespace only': '   ',
      'a trailing newline around nothing': '\n',
    };

    for (final MapEntry<String, String> entry in hostileStripe.entries) {
      test('STRIPE_PUBLISHABLE_KEY: ${entry.key}', () {
        final List<MissingConfig> problems = validateConfig(
          supabaseUrl: 'https://project.supabase.co',
          supabaseAnonKey: 'anon-key-placeholder',
          stripePublishableKey: entry.value,
          webAppUrl: 'https://noditto.app',
        );
        expect(_keysOf(problems), <String>{ConfigKeys.stripePublishableKey});
      });
    }

    const Map<String, String> hostileUrls = <String, String>{
      'plain http': 'http://noditto.app',
      'scheme-relative': '//noditto.app',
      'a bare host with no scheme': 'noditto.app',
      'whitespace only': '   ',
      'a scheme with no host': 'https://',
      // `Uri.tryParse` accepts this and returns a host with a space in it.
      'a space inside the host': 'https://exa mple.com',
    };

    for (final MapEntry<String, String> entry in hostileUrls.entries) {
      test('WEB_APP_URL: ${entry.key}', () {
        final List<MissingConfig> problems = validateConfig(
          supabaseUrl: 'https://project.supabase.co',
          supabaseAnonKey: 'anon-key-placeholder',
          stripePublishableKey: 'pk_test_PLACEHOLDER',
          webAppUrl: entry.value,
        );
        expect(_keysOf(problems), <String>{ConfigKeys.webAppUrl});
      });

      test('SUPABASE_URL: ${entry.key}', () {
        final List<MissingConfig> problems = validateConfig(
          supabaseUrl: entry.value,
          supabaseAnonKey: 'anon-key-placeholder',
          stripePublishableKey: 'pk_test_PLACEHOLDER',
          webAppUrl: 'https://noditto.app',
        );
        expect(_keysOf(problems), <String>{ConfigKeys.supabaseUrl});
      });
    }

    test('a value that is only a trailing newline from a .env file is empty',
        () {
      final List<MissingConfig> problems = validateConfig(
        supabaseUrl: 'https://project.supabase.co\n',
        supabaseAnonKey: '\n',
        stripePublishableKey: 'pk_test_PLACEHOLDER\n',
        webAppUrl: 'https://noditto.app\n',
      );
      expect(_keysOf(problems), <String>{ConfigKeys.supabaseAnonKey});
    });

    test('an entirely unset configuration names all four keys', () {
      final List<MissingConfig> problems = validateConfig(
        supabaseUrl: '',
        supabaseAnonKey: '',
        stripePublishableKey: '',
        webAppUrl: '',
      );
      expect(_keysOf(problems), ConfigKeys.required.toSet());
      expect(problems.length, ConfigKeys.required.length);
    });
  });

  group('the Required_Config_Key list declares no secret (Req 6.4)', () {
    test('no key name reads as a service-role or secret credential', () {
      for (final String key in ConfigKeys.required) {
        final String lower = key.toLowerCase();
        for (final String forbidden in <String>[
          'service_role',
          'service-role',
          'servicerole',
          'secret',
          'private',
        ]) {
          expect(
            lower.contains(forbidden),
            isFalse,
            reason: '$key looks like a server-only credential',
          );
        }
      }
    });
  });
}
