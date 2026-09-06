// Feature: mobile-visual-parity — Properties 22 and 23.
//
// Property 23: for any route string drawn from the app's route table, the hub the
// shell marks current is the hub the web's `isMarketplaceSectionActive` would mark
// for the same path, and at most one hub is current.
//
// Property 22 (shell half): for any route string owned by no Hub_Set entry, the
// shell marks no destination current.
//
// DIVISION OF LABOUR with `tests/unit/mobileShellAgreement.test.ts`, which is the
// other half of Property 23. That test compares the OWNERSHIP TABLE — which hub
// claims which section — against the imported web helper, mechanically, over every
// route in the table. It cannot execute `isHubSectionActive`, because the predicate
// is Dart. So this file executes it: the section rule's four boundaries, the
// query/fragment/trailing-slash normalisation the web never sees because
// `usePathname()` strips it, and the unowned case.
//
// The expected hub for each route is stated here rather than derived, and that is
// deliberate: a table whose expectations were computed by the same code under test
// would agree with itself. The mechanical cross-check against the web lives on the
// Vitest side.
//
// Validates: Requirements 4.15, 4.16, 4.12.

import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/router/hub_set.dart';
import 'package:cardtrade/router/router.dart';

void main() {
  group('Property 23: a route resolves to the one hub that owns it', () {
    // Every entry is a route the Flutter router actually serves, or a route with
    // one path parameter filled in. The three `/listings/` boundaries are the
    // whole reason the section rule is not a prefix match.
    const Map<String, MobileHubId> owned = <String, MobileHubId>{
      AppRoutes.home: MobileHubId.browse,
      '/listings/abc123': MobileHubId.browse,
      '/sellers/abc123': MobileHubId.browse,
      AppRoutes.purchases: MobileHubId.contracts,
      AppRoutes.sales: MobileHubId.contracts,
      '/sales/abc123': MobileHubId.contracts,
      '/sales/buy/abc123': MobileHubId.contracts,
      AppRoutes.trades: MobileHubId.contracts,
      '/trades/new': MobileHubId.contracts,
      '/trades/abc123': MobileHubId.contracts,
      AppRoutes.sell: MobileHubId.sell,
      AppRoutes.myListings: MobileHubId.sell,
      '/listings/edit/abc123': MobileHubId.sell,
      AppRoutes.offers: MobileHubId.sell,
      AppRoutes.messages: MobileHubId.inbox,
      '/messages/abc123': MobileHubId.inbox,
      AppRoutes.profile: MobileHubId.account,
      '/profile/edit': MobileHubId.account,
      '/profile/payouts': MobileHubId.account,
      AppRoutes.notifications: MobileHubId.account,
      AppRoutes.saved: MobileHubId.account,
      AppRoutes.staff: MobileHubId.account,
      '/admin/arbitration': MobileHubId.account,
    };

    test('each route in the table resolves to its own hub', () {
      owned.forEach((String route, MobileHubId expected) {
        expect(currentHub(route)?.id, expected, reason: route);
      });
    });

    test('no route is owned by two hubs', () {
      for (final String route in owned.keys) {
        final List<MobileHub> claimants =
            kMobileHubs.where((MobileHub hub) => hub.owns(route)).toList();
        expect(
          claimants.map((MobileHub hub) => hub.id).toList(),
          hasLength(1),
          reason: '$route is claimed by ${claimants.length} hubs',
        );
      }
    });

    test('creating, editing and owning a listing are Sell, not Browse', () {
      // The defect this pins: `/listings/` is shared between the public detail
      // pages and three selling screens, so a prefix match lights up Browse on a
      // member's own inventory. The web helper carries the same three exceptions.
      for (final String route in <String>[
        AppRoutes.sell,
        AppRoutes.myListings,
        '/listings/mine/drafts',
        '/listings/edit/abc123',
      ]) {
        expect(currentHub(route)?.id, MobileHubId.sell, reason: route);
        expect(isHubSectionActive(route, AppRoutes.home), isFalse, reason: route);
      }
    });

    test('the create screen owns itself and nothing beneath it', () {
      expect(isHubSectionActive(AppRoutes.sell, AppRoutes.sell), isTrue);
      // `/listings/new/anything` is not a route; the section must not claim it,
      // because the listing-detail route would then be read as a create screen.
      expect(isHubSectionActive('/listings/new/step-2', AppRoutes.sell), isFalse);
    });
  });

  group('a location is normalised before it is matched', () {
    // The web helper never sees a query string or a fragment — `usePathname()`
    // strips both — so this behaviour has no web counterpart to compare against
    // and is asserted here instead.
    const List<String> sameSection = <String>[
      '/messages',
      '/messages/',
      '/messages?tab=unread',
      '/messages#latest',
      '/messages/?tab=unread',
    ];

    test('a query, a fragment and a trailing slash do not change the hub', () {
      for (final String route in sameSection) {
        expect(currentHub(route)?.id, MobileHubId.inbox, reason: route);
      }
    });

    test('a query on a detail route keeps its section', () {
      expect(currentHub('/listings/abc?from=saved')?.id, MobileHubId.browse);
      expect(currentHub('/trades/abc?tab=terms')?.id, MobileHubId.contracts);
    });
  });

  group('Property 22 (shell half): an unowned route marks nothing current', () {
    test('a route no hub owns resolves to null, not to the first hub', () {
      // Null rather than `browse`: defaulting to the first element is the failure
      // mode this property exists for, and it tells a member something untrue.
      for (final String route in <String>[
        AppRoutes.signIn,
        AppRoutes.signUp,
        AppRoutes.forgotPassword,
        '/help',
        '/terms',
        '/',
        '/homesteads',
        '/messenger',
        '/profiles',
        '',
      ]) {
        expect(currentHub(route), isNull, reason: route);
      }
    });

    test('a near-miss on a section root is not a match', () {
      // Prefix matching without the boundary check is what makes `/messenger`
      // look like `/messages`.
      expect(isHubSectionActive('/messenger', AppRoutes.messages), isFalse);
      expect(isHubSectionActive('/savedlists', AppRoutes.saved), isFalse);
      expect(isHubSectionActive('/administrators', AppRoutes.staff), isFalse);
    });
  });

  group('guest targeting', () {
    test('a link hub carries its own screen as the post-sign-in target', () {
      final MobileHub inbox =
          kMobileHubs.firstWhere((MobileHub hub) => hub.id == MobileHubId.inbox);
      expect(inbox.signInTarget, AppRoutes.messages);
      expect(
        signInLocationFor(inbox),
        '${AppRoutes.signIn}?redirectTo=${Uri.encodeQueryComponent(AppRoutes.messages)}',
      );
    });

    test('a sheet hub carries its FIRST listed row, not the sheet', () {
      final MobileHub contracts = kMobileHubs
          .firstWhere((MobileHub hub) => hub.id == MobileHubId.contracts);
      expect(contracts.kind, MobileHubKind.sheet);
      expect(contracts.signInTarget, contracts.destinations.first.path);
      expect(contracts.signInTarget, AppRoutes.purchases);
    });

    test('only the catalog is reachable without a session', () {
      expect(
        kMobileHubs
            .where((MobileHub hub) => !hub.requiresAuth)
            .map((MobileHub hub) => hub.id)
            .toList(),
        <MobileHubId>[MobileHubId.browse],
      );
    });
  });

  group('the Hub_Set is the five web destinations', () {
    test('five entries, in the web order, with the web labels', () {
      expect(
        kMobileHubs.map((MobileHub hub) => hub.id).toList(),
        <MobileHubId>[
          MobileHubId.browse,
          MobileHubId.contracts,
          MobileHubId.sell,
          MobileHubId.inbox,
          MobileHubId.account,
        ],
      );
      expect(
        kMobileHubs.map((MobileHub hub) => hub.label).toList(),
        <String>['Browse', 'Contracts', 'Sell', 'Inbox', 'Account'],
      );
    });

    test('each sheet lists exactly its three supported rows', () {
      final Map<MobileHubId, List<String>> rows = <MobileHubId, List<String>>{
        for (final MobileHub hub
            in kMobileHubs.where((MobileHub hub) => hub.kind == MobileHubKind.sheet))
          hub.id: hub.destinations
              .map((HubDestination destination) => destination.label)
              .toList(),
      };

      expect(rows[MobileHubId.contracts], <String>['Purchases', 'Sales', 'Trades']);
      expect(rows[MobileHubId.sell], <String>['Sell an item', 'My Listings', 'Offers']);

      // Req 4.6: the web's private-deal row is omitted rather than shown inert,
      // and the supporting copy must not promise it either.
      for (final MobileHub hub in kMobileHubs) {
        expect(
          (hub.sheetDescription ?? '').toLowerCase(),
          isNot(contains('private deal')),
          reason: hub.label,
        );
      }
    });

    test('a link hub has exactly one destination', () {
      for (final MobileHub hub
          in kMobileHubs.where((MobileHub hub) => hub.kind == MobileHubKind.link)) {
        expect(hub.destinations, hasLength(1), reason: hub.label);
      }
    });
  });
}
