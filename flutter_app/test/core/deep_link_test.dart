// Feature: mobile-release-readiness — Properties 6, 7 and 8.
//
// Property 6: For any `Uri`, `resolveDeepLink` returns a `DeepLinkTarget`
// without throwing, and returns `CatalogFallbackTarget` for every URI that
// matches no known route.
//
// Property 7: For any invite token, resolving the invite link built from that
// token yields an `InviteTarget` carrying the same token, on both the https
// host and the custom scheme.
//
// Property 8: For any link carrying an `identity` or `payouts` marker with any
// marker value, `resolveDeepLink` returns the corresponding screen target and
// the returned target carries no verification or payout status.
//
// Dart has no `fast-check`, so the generators below are hand-written over a
// SEEDED `Random`. Every failure reports the seed and the exact input, so a
// counterexample reproduces by re-running the file rather than by luck.

import 'dart:math';

import 'package:cardtrade/core/deep_link.dart';
import 'package:cardtrade/router/router.dart' show AppRoutes;
import 'package:flutter_test/flutter_test.dart';

/// Fixed so a counterexample is reproducible. Change it only to hunt for new
/// ones, and never to make a failure go away.
const int kSeed = 20260227;

/// Generated cases per property. The task floor is 100.
const int kIterations = 200;

/// The Deal_Invite token alphabet: `randomBytes(18).toString('base64url')` in
/// `lib/actions/dealInvites.ts`. Length is 16..64 per the
/// `deal_invites_token_len` CHECK in migration 0103.
const String kTokenAlphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/// Runs [body] and, on failure, re-raises it carrying the seed and the input, so
/// the counterexample is in the failure message rather than in a rerun.
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

String _randomToken(Random random) {
  final int length = 16 + random.nextInt(49); // 16..64 inclusive
  return String.fromCharCodes(<int>[
    for (int i = 0; i < length; i++)
      kTokenAlphabet.codeUnitAt(random.nextInt(kTokenAlphabet.length)),
  ]);
}

/// Schemes worth throwing at the resolver: the two it claims, near-misses, and
/// schemes that would be a security problem if they routed.
const List<String> _schemes = <String>[
  'https',
  'noditto',
  'http',
  'NoDitto',
  'HTTPS',
  'nodittoo',
  'file',
  'javascript',
  'data',
  'mailto',
  'content',
  'intent',
  '',
];

/// Hosts worth throwing at the resolver. Every entry other than `noditto.app`
/// is attacker-suppliable and must not drive routing.
const List<String> _hosts = <String>[
  'noditto.app',
  'NODITTO.APP',
  'evil.example',
  'noditto.app.evil.example',
  'evil.example/noditto.app',
  'noditto-app.example',
  'www.noditto.app',
  'localhost',
  '127.0.0.1',
  '',
  'ünïcode.example',
  'xn--80ak6aa92e.com',
];

/// Path shapes worth throwing at the resolver: empty, doubled and trailing
/// separators, traversal, bad percent-encoding, unicode, and something absurd.
final List<String> _paths = <String>[
  '',
  '/',
  '//',
  '///',
  '/t',
  '/t/',
  '/t//',
  '/t/%',
  '/t/%zz',
  '/t/ABCdef-_0123456789',
  '/t/ABC/extra',
  '/profile',
  '/profile/',
  '/profile/payouts',
  '/listings/abc-123',
  '/sellers/abc',
  '/admin',
  '/admin/arbitration',
  '/unknown',
  '/UNKNOWN',
  '/../../etc/passwd',
  '/%2e%2e%2f',
  '/ünïcode/pä†h',
  '/\u0000',
  '/${'a' * 4000}',
  '/${List<String>.filled(64, 'x').join('/')}',
];

/// Query shapes, including the two markers with hostile values.
final List<String> _queries = <String>[
  '',
  '?',
  '?=',
  '?&&',
  '?identity',
  '?identity=complete',
  '?identity=%zz',
  '?payouts=complete',
  '?payouts=refresh',
  '?payouts',
  '?identity=complete&payouts=refresh',
  '?verified=true',
  '?is_verified=1',
  '?q=${'z' * 300}',
  '?a=%',
];

/// Fragments, which must never change a routing decision.
const List<String> _fragments = <String>['', '#', '#top', '#%zz'];

String _oneOf(Random random, List<String> pool) =>
    pool[random.nextInt(pool.length)];

/// A random hostile URI string. Deliberately assembled by CONCATENATION rather
/// than through `Uri()`, because the strings a link handler actually receives
/// are not ones a `Uri` constructor produced.
String _hostileUriString(Random random) {
  final String scheme = _oneOf(random, _schemes);
  final String host = _oneOf(random, _hosts);
  final String path = _oneOf(random, _paths);
  final String query = _oneOf(random, _queries);
  final String fragment = _oneOf(random, _fragments);

  // Three authority shapes: `scheme://host/path`, the hostless
  // `scheme:///path`, and the opaque `scheme:path`.
  final int shape = random.nextInt(3);
  final String prefix = switch (shape) {
    0 => scheme.isEmpty ? '//$host' : '$scheme://$host',
    1 => scheme.isEmpty ? '/$path' : '$scheme://',
    _ => scheme.isEmpty ? path : '$scheme:',
  };
  return '$prefix$path$query$fragment';
}

/// A top-level path segment that is not a known prefix and not the invite
/// segment, so the resolver must fall back on it.
String _unknownSegment(Random random) {
  const String letters = 'abcdefghijklmnopqrstuvwxyz';
  while (true) {
    final int length = 1 + random.nextInt(12);
    final String segment = String.fromCharCodes(<int>[
      for (int i = 0; i < length; i++)
        letters.codeUnitAt(random.nextInt(letters.length)),
    ]);
    if (segment == kInviteSegment) continue;
    if (kKnownRoutePrefixes.contains(segment)) continue;
    return segment;
  }
}

void main() {
  group(
    'Feature: mobile-release-readiness, Property 6: for any Uri, '
    'resolveDeepLink returns a DeepLinkTarget without throwing, and returns '
    'CatalogFallbackTarget for every URI that matches no known route',
    () {
      test('resolution is total over $kIterations hostile URIs', () {
        final Random random = Random(kSeed);

        for (int i = 0; i < kIterations; i++) {
          final String raw = _hostileUriString(random);

          // A string the platform could deliver but `Uri` cannot parse never
          // reaches the resolver, so it is not part of its input space. Assert
          // that it is unparseable rather than skipping silently.
          final Uri? uri = Uri.tryParse(raw);
          if (uri == null) {
            check(raw, i, () => expect(Uri.tryParse(raw), isNull));
            continue;
          }

          check(raw, i, () {
            final DeepLinkTarget target = resolveDeepLink(uri);
            // `isNotNull` is the weaker half; the type check is the contract.
            expect(target, isNotNull);
            expect(target, isA<DeepLinkTarget>());
          });
        }
      });

      test('resolution is total over $kIterations Uri-constructed inputs', () {
        final Random random = Random(kSeed + 1);

        for (int i = 0; i < kIterations; i++) {
          final Uri uri = Uri(
            scheme: _oneOf(random, _schemes).isEmpty
                ? null
                : _oneOf(random, _schemes),
            host: _oneOf(random, <String>['noditto.app', 'evil.example', '']),
            pathSegments: <String>[
              for (int s = 0; s < random.nextInt(20); s++)
                _oneOf(random, <String>[
                  '',
                  't',
                  'profile',
                  'ünïcode',
                  '\u0000',
                  'a' * 200,
                  _unknownSegment(random),
                ]),
            ],
            queryParameters: random.nextBool()
                ? <String, String>{
                    _oneOf(random, <String>['identity', 'payouts', 'zz']):
                        _oneOf(random, <String>['complete', 'refresh', '']),
                  }
                : null,
          );

          check(uri.toString(), i, () {
            expect(resolveDeepLink(uri), isA<DeepLinkTarget>());
          });
        }
      });

      test('an https link on a host other than the NoDitto host falls back',
          () {
        final Random random = Random(kSeed + 2);

        for (int i = 0; i < kIterations; i++) {
          final String host = _oneOf(
            random,
            _hosts.where((String h) => h.toLowerCase() != kNoDittoHost).toList(),
          );
          if (host.isEmpty) continue;
          final String token = _randomToken(random);
          final String raw = 'https://$host/t/$token';
          final Uri? uri = Uri.tryParse(raw);
          if (uri == null) continue;
          if (uri.host.toLowerCase() == kNoDittoHost) continue;

          check(raw, i, () {
            expect(
              resolveDeepLink(uri),
              const CatalogFallbackTarget(),
              reason: 'an attacker-controlled host must not drive routing',
            );
          });
        }
      });

      test('an unknown top-level segment on the NoDitto host falls back', () {
        final Random random = Random(kSeed + 3);

        for (int i = 0; i < kIterations; i++) {
          final String segment = _unknownSegment(random);
          final String tail =
              random.nextBool() ? '' : '/${_unknownSegment(random)}';
          for (final String raw in <String>[
            'https://$kNoDittoHost/$segment$tail',
            '$kNoDittoScheme://$segment$tail',
            '$kNoDittoScheme:///$segment$tail',
          ]) {
            final Uri uri = Uri.parse(raw);
            check(raw, i, () {
              expect(resolveDeepLink(uri), const CatalogFallbackTarget());
            });
          }
        }
      });
    },
  );

  group(
    'Feature: mobile-release-readiness, Property 7: for any invite token, '
    'resolving the invite link built from that token yields an InviteTarget '
    'carrying the same token, on both the https host and the custom scheme',
    () {
      test('a token round-trips on both transports, over $kIterations tokens',
          () {
        final Random random = Random(kSeed + 10);

        for (int i = 0; i < kIterations; i++) {
          final String token = _randomToken(random);

          // Both transports, plus the two custom-scheme shapes Android may
          // deliver: `noditto://t/TOKEN` puts `t` in the authority, while
          // `noditto:///t/TOKEN` puts it in the path. They must resolve alike.
          final List<String> links = <String>[
            'https://$kNoDittoHost/t/$token',
            'https://$kNoDittoHost/t/$token/',
            'https://$kNoDittoHost/t/$token?ref=share',
            'https://$kNoDittoHost/t/$token#frag',
            '$kNoDittoScheme://t/$token',
            '$kNoDittoScheme:///t/$token',
            '$kNoDittoScheme:t/$token',
          ];

          for (final String raw in links) {
            check(raw, i, () {
              final DeepLinkTarget target = resolveDeepLink(Uri.parse(raw));
              expect(target, isA<InviteTarget>());
              expect((target as InviteTarget).token, token);
              expect(target, InviteTarget(token));
            });
          }
        }
      });

      test('an invite link with no token is never an invite carrying an empty '
          'string', () {
        for (final String raw in <String>[
          'https://$kNoDittoHost/t',
          'https://$kNoDittoHost/t/',
          'https://$kNoDittoHost/t//',
          '$kNoDittoScheme://t',
          '$kNoDittoScheme://t/',
          '$kNoDittoScheme:///t',
        ]) {
          expect(
            resolveDeepLink(Uri.parse(raw)),
            const CatalogFallbackTarget(),
            reason: '$raw must not become InviteTarget("")',
          );
        }
      });
    },
  );

  group(
    'Feature: mobile-release-readiness, Property 8: for any link carrying an '
    'identity or payouts marker with any marker value, resolveDeepLink returns '
    'the corresponding screen target and the returned target carries no '
    'verification or payout status',
    () {
      // Marker values, including the ones an attacker would choose if the
      // resolver were credulous enough to read a status out of them.
      const List<String> markerValues = <String>[
        'complete',
        'refresh',
        'COMPLETE',
        'true',
        '1',
        'verified',
        'approved',
        'enabled',
        '',
        'null',
        'refresh ',
        ' refresh',
        'refresh&payouts=complete',
        'ünïcode',
        '%zz',
      ];

      test('an identity marker resolves to the verification SCREEN and holds '
          'no state, over $kIterations links', () {
        final Random random = Random(kSeed + 20);

        for (int i = 0; i < kIterations; i++) {
          final String value = _oneOf(random, markerValues);
          final String path = _oneOf(
            random,
            <String>['/profile', '/profile/identity', '/onboarding', '/'],
          );
          final String raw = '$kNoDittoHost$path'
              '?$kIdentityMarker=${Uri.encodeQueryComponent(value)}';

          for (final String link in <String>[
            'https://$raw',
            '$kNoDittoScheme://${raw.substring(kNoDittoHost.length + 1)}',
          ]) {
            final Uri? uri = Uri.tryParse(link);
            if (uri == null) continue;

            check(link, i, () {
              final DeepLinkTarget target = resolveDeepLink(uri);
              expect(target, isA<VerificationReturnTarget>());

              // STRUCTURAL absence of status, not a string match on a field
              // name. `VerificationReturnTarget` has a const constructor with
              // no parameters, so every const instance is the SAME canonical
              // object. If the class ever gained a field carrying the marker's
              // value, the resolver could not return the canonical instance and
              // this identity check would fail.
              expect(
                identical(target, const VerificationReturnTarget()),
                isTrue,
                reason: 'the target carries state derived from <$value>',
              );
            });
          }
        }
      });

      test('a payouts marker resolves to the payouts SCREEN, carrying only '
          'which screen state Stripe returned to, over $kIterations links', () {
        final Random random = Random(kSeed + 21);

        for (int i = 0; i < kIterations; i++) {
          final String value = _oneOf(random, markerValues);
          final String path = _oneOf(
            random,
            <String>['/profile', '/profile/payouts', '/onboarding', '/'],
          );
          final String raw = '$kNoDittoHost$path'
              '?$kPayoutsMarker=${Uri.encodeQueryComponent(value)}';

          for (final String link in <String>[
            'https://$raw',
            '$kNoDittoScheme://${raw.substring(kNoDittoHost.length + 1)}',
          ]) {
            final Uri? uri = Uri.tryParse(link);
            if (uri == null) continue;

            check(link, i, () {
              final DeepLinkTarget target = resolveDeepLink(uri);
              expect(target, isA<PayoutReturnTarget>());

              final bool expectedRefresh = value == 'refresh';

              // Same structural argument as above. `refresh` is the ONLY field,
              // so the resolver's result is one of exactly two canonical
              // instances. A hidden approved/enabled field would break this.
              expect(
                identical(
                  target,
                  expectedRefresh
                      ? const PayoutReturnTarget(refresh: true)
                      : const PayoutReturnTarget(refresh: false),
                ),
                isTrue,
                reason: 'the target carries state beyond refresh, from <$value>',
              );

              // And `refresh` is a screen state, not an approval: an obviously
              // affirmative marker value still yields refresh: false.
              expect((target as PayoutReturnTarget).refresh, expectedRefresh);
            });
          }
        }
      });

      test('a marker with no value at all still resolves to its screen', () {
        expect(
          resolveDeepLink(Uri.parse('https://$kNoDittoHost/profile?identity')),
          const VerificationReturnTarget(),
        );
        expect(
          resolveDeepLink(Uri.parse('https://$kNoDittoHost/profile?payouts')),
          const PayoutReturnTarget(refresh: false),
        );
      });

      test('identity wins when both markers are present', () {
        expect(
          resolveDeepLink(
            Uri.parse(
              'https://$kNoDittoHost/profile'
              '?identity=complete&payouts=refresh',
            ),
          ),
          const VerificationReturnTarget(),
        );
      });
    },
  );

  group('the guarded hazards resolve to the catalog rather than throwing', () {
    // One case per hazard the resolver names. These are examples, not a
    // property: each is a specific shape a device can deliver.
    const Map<String, String> hazards = <String, String>{
      'empty string': '',
      'no scheme, no host': '/t/ABCdef',
      'scheme only': 'noditto:',
      'https with no path': 'https://noditto.app',
      'https root': 'https://noditto.app/',
      'https trailing slashes': 'https://noditto.app///',
      'custom scheme, nothing else': 'noditto://',
      'bad percent-encoding in the path': 'https://noditto.app/%zz',
      'unknown scheme on the right host': 'ftp://noditto.app/t/ABCdef',
      'plain http on the right host': 'http://noditto.app/t/ABCdef',
      'a subdomain of the right host': 'https://www.noditto.app/t/ABCdef',
      'the right host as a path of another': 'https://evil.example/noditto.app',
    };

    for (final MapEntry<String, String> hazard in hazards.entries) {
      test(hazard.key, () {
        final Uri? uri = Uri.tryParse(hazard.value);
        expect(uri, isNotNull, reason: '${hazard.value} should parse');
        expect(resolveDeepLink(uri!), const CatalogFallbackTarget());
      });
    }

    test('an undecodable query does not discard a valid path', () {
      // A query that cannot be percent-decoded carries no marker, which is not
      // the same as making the whole link unroutable — the PATH is still a
      // route the app serves, and Req 4.6 only sends a link to the catalog when
      // it matches no known route.
      expect(
        resolveDeepLink(Uri.parse('https://$kNoDittoHost/profile?a=%')),
        const KnownRouteTarget('/profile'),
      );
      // Nor does it turn an invite into a fallback.
      expect(
        resolveDeepLink(Uri.parse('https://$kNoDittoHost/t/ABCdef0123456789?a=%')),
        const InviteTarget('ABCdef0123456789'),
      );
    });

    test('an absurdly long path falls back', () {
      final Uri uri = Uri.parse('https://$kNoDittoHost/profile/${'a' * 4000}');
      expect(resolveDeepLink(uri), const CatalogFallbackTarget());
    });

    test('a path with more segments than any route has falls back', () {
      final String path = List<String>.filled(40, 'profile').join('/');
      expect(
        resolveDeepLink(Uri.parse('https://$kNoDittoHost/$path')),
        const CatalogFallbackTarget(),
      );
    });

    test('empty segments and a trailing slash normalise to one location', () {
      const KnownRouteTarget expected = KnownRouteTarget('/profile/payouts');
      for (final String raw in <String>[
        'https://$kNoDittoHost/profile/payouts',
        'https://$kNoDittoHost/profile/payouts/',
        'https://$kNoDittoHost/profile//payouts',
        'https://$kNoDittoHost//profile/payouts//',
        '$kNoDittoScheme://profile/payouts',
        '$kNoDittoScheme:///profile/payouts/',
      ]) {
        expect(resolveDeepLink(Uri.parse(raw)), expected, reason: raw);
      }
    });
  });

  group('the known-prefix allowlist agrees with the router', () {
    // The routes live inside the `routerProvider` closure and are not
    // enumerable at compile time, so `kKnownRoutePrefixes` is a hand-written
    // allowlist. This pins it to `AppRoutes` — the constants that closure paths
    // itself from — so the allowlist cannot drift from the route table quietly.
    test('every AppRoutes constant has its top-level prefix allowlisted', () {
      const Map<String, String> routes = <String, String>{
        'signIn': AppRoutes.signIn,
        'signUp': AppRoutes.signUp,
        'forgotPassword': AppRoutes.forgotPassword,
        'home': AppRoutes.home,
        'trades': AppRoutes.trades,
        'sell': AppRoutes.sell,
        'messages': AppRoutes.messages,
        'profile': AppRoutes.profile,
        'myListings': AppRoutes.myListings,
        'editListing': AppRoutes.editListing,
        'purchases': AppRoutes.purchases,
        'sales': AppRoutes.sales,
        'offers': AppRoutes.offers,
        'saved': AppRoutes.saved,
        'notifications': AppRoutes.notifications,
        'sellers': AppRoutes.sellers,
      };

      for (final MapEntry<String, String> route in routes.entries) {
        final String prefix = route.value.split('/')[1];
        expect(
          kKnownRoutePrefixes,
          contains(prefix),
          reason: 'AppRoutes.${route.key} (${route.value}) is not routable '
              'from a deep link',
        );
      }
    });

    test('AppRoutes.staff is the one deliberate exclusion', () {
      // `/admin` is claimed by the Account hub so a route added later is owned,
      // but the Flutter client declares no GoRoute under it. Routing a deep
      // link there would reach go_router's error page, which is worse than the
      // catalog (Req 4.6).
      expect(kKnownRoutePrefixes, isNot(contains('admin')));
      expect(
        resolveDeepLink(Uri.parse('https://$kNoDittoHost${AppRoutes.staff}')),
        const CatalogFallbackTarget(),
      );
    });

    test('the invite segment is not an allowlisted route prefix', () {
      // `/t/{token}` has no GoRoute of its own; it is resolved to a
      // InviteTarget instead, so allowlisting it would create a second,
      // broken path to the same link.
      expect(kKnownRoutePrefixes, isNot(contains(kInviteSegment)));
    });
  });
}
