// Task 4.6: a link arrives with no session, a session appears, and the member
// lands on the link's target rather than on the catalog or the sign-in screen.
//
// WHY THE PARSER RATHER THAN A PUMPED APP. `redirect` is what task 4.4 changed,
// and `GoRouteInformationParser.parseRouteInformationWithDependencies` runs it —
// including the transitive passes, which is how one call can show a marker link
// being resolved to a screen AND then gated on auth. Pumping `MaterialApp.router`
// would additionally BUILD the catalog and the sign-in screen, both of which read
// Supabase, so the test would be asserting a route through a stack of provider
// overrides that have nothing to do with routing.
//
// WHY THE SESSION IS A NOTIFIER RATHER THAN A FIXED OVERRIDE. The subject is a
// TRANSITION: signed out, then signed in, with one retained target spanning both.
// A fixed override could only ever assert one half. Flipping it also rebuilds
// `routerProvider`, which watches `isAuthenticatedProvider` — and that rebuild is
// precisely why `pendingDeepLinkProvider` depends on nothing. If the slot lived in
// the router's closure these tests would fail, which is the point of asserting the
// resumed location rather than the retained one alone.
//
// Validates: Requirements 4.7, and 4.3–4.5 for the target each link resolves to.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// Riverpod 3 no longer re-exports Override from flutter_riverpod.dart; its
// curated `show` list omits it and misc.dart is where it now lives.
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/router/pending_deep_link.dart';
import 'package:cardtrade/router/router.dart';

/// A session that can appear part-way through a test.
class _Session extends Notifier<bool> {
  @override
  bool build() => false;

  void appear() => state = true;
}

final _sessionProvider = NotifierProvider<_Session, bool>(_Session.new);

/// Identifies the throwaway widget whose element supplies a `BuildContext`.
const Key _probe = Key('router-probe');

/// A container whose only auth signal is [_sessionProvider].
ProviderContainer _container() => ProviderContainer.test(
      overrides: <Override>[
        isAuthenticatedProvider.overrideWith(
          (Ref ref) => ref.watch(_sessionProvider),
        ),
      ],
    );

/// Puts a context in the tree without building any screen.
Future<void> _pumpProbe(WidgetTester tester, ProviderContainer container) async {
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: SizedBox.shrink(key: _probe)),
    ),
  );
}

/// Where the running app would end up if it received [location].
///
/// The router is read fresh each time, because a session appearing rebuilds it.
Future<String> _resolve(
  WidgetTester tester,
  ProviderContainer container,
  String location,
) async {
  final GoRouter router = container.read(routerProvider);
  final matches = await router.routeInformationParser
      .parseRouteInformationWithDependencies(
    RouteInformation(uri: Uri.parse(location)),
    tester.element(find.byKey(_probe)),
  );
  return matches.uri.toString();
}

void main() {
  group('Req 4.7: a link received with no session is resumed after sign-in', () {
    testWidgets('an invite link', (WidgetTester tester) async {
      final ProviderContainer container = _container();
      await _pumpProbe(tester, container);

      expect(
        await _resolve(tester, container, '/t/INVITE-TOKEN'),
        AppRoutes.signIn,
        reason: 'an invite is not a public route: it opens a contract',
      );
      expect(
        container.read(pendingDeepLinkProvider).peek,
        '/t/INVITE-TOKEN',
        reason: 'the bounce must retain the target, not discard it',
      );

      container.read(_sessionProvider.notifier).appear();
      await tester.pump();

      expect(
        await _resolve(tester, container, AppRoutes.signIn),
        '/t/INVITE-TOKEN',
        reason: 'resuming to the catalog would lose the invite the member '
            'followed, which is the moment a new member arrives',
      );
    });

    testWidgets('a payout return marker', (WidgetTester tester) async {
      final ProviderContainer container = _container();
      await _pumpProbe(tester, container);

      // Two redirects in one pass: the marker resolves to the payouts SCREEN,
      // and the screen is then gated on the absent session.
      expect(
        await _resolve(tester, container, '/profile?payouts=complete'),
        AppRoutes.signIn,
      );
      expect(container.read(pendingDeepLinkProvider).peek, AppRoutes.payouts);

      container.read(_sessionProvider.notifier).appear();
      await tester.pump();

      final String resumed = await _resolve(tester, container, AppRoutes.signIn);
      expect(resumed, AppRoutes.payouts);
      // Req 4.5: what is retained and resumed is a screen. The marker does not
      // survive into the location, so nothing downstream can read a status off it.
      expect(resumed, isNot(contains('payouts=')));
    });

    testWidgets('an identity return marker', (WidgetTester tester) async {
      final ProviderContainer container = _container();
      await _pumpProbe(tester, container);

      expect(
        await _resolve(tester, container, '/profile?identity=complete'),
        AppRoutes.signIn,
      );
      expect(container.read(pendingDeepLinkProvider).peek, AppRoutes.identity);

      container.read(_sessionProvider.notifier).appear();
      await tester.pump();

      final String resumed = await _resolve(tester, container, AppRoutes.signIn);
      expect(resumed, AppRoutes.identity);
      expect(resumed, isNot(contains('identity=')));
    });

    testWidgets('nothing retained resumes to the catalog', (
      WidgetTester tester,
    ) async {
      // The other half of the same branch: an empty slot must not resume
      // anywhere, or the sign-in screen becomes a trapdoor to a stale target.
      final ProviderContainer container = _container();
      await _pumpProbe(tester, container);

      container.read(_sessionProvider.notifier).appear();
      await tester.pump();

      expect(await _resolve(tester, container, AppRoutes.signIn), AppRoutes.home);
    });

    testWidgets('the slot is spent once, not replayed', (
      WidgetTester tester,
    ) async {
      final ProviderContainer container = _container();
      await _pumpProbe(tester, container);

      await _resolve(tester, container, '/t/INVITE-TOKEN');
      container.read(_sessionProvider.notifier).appear();
      await tester.pump();

      expect(await _resolve(tester, container, AppRoutes.signIn), '/t/INVITE-TOKEN');
      expect(container.read(pendingDeepLinkProvider).peek, isNull);
      expect(await _resolve(tester, container, AppRoutes.signIn), AppRoutes.home);
    });
  });

  group('a signed-in member goes straight to the target', () {
    testWidgets('an invite link needs no bounce', (WidgetTester tester) async {
      final ProviderContainer container = _container();
      await _pumpProbe(tester, container);
      container.read(_sessionProvider.notifier).appear();
      await tester.pump();

      expect(
        await _resolve(tester, container, '/t/INVITE-TOKEN'),
        '/t/INVITE-TOKEN',
      );
      expect(container.read(pendingDeepLinkProvider).peek, isNull);
    });

    testWidgets('a return marker lands on its screen', (
      WidgetTester tester,
    ) async {
      final ProviderContainer container = _container();
      await _pumpProbe(tester, container);
      container.read(_sessionProvider.notifier).appear();
      await tester.pump();

      expect(
        await _resolve(tester, container, '/profile/payouts?payouts=refresh'),
        AppRoutes.payouts,
      );
      expect(
        await _resolve(tester, container, '/profile/identity?identity=complete'),
        AppRoutes.identity,
      );
    });
  });
}
