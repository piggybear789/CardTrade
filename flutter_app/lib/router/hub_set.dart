// The five destinations the web's mobile bottom bar presents, and the ONE place
// a route is mapped to the destination that owns it.
//
// The web states this twice over in `components/layout/marketplace-nav-config.ts`:
// once as `MOBILE_HUBS`, which fixes the order, the labels and which entries open
// a sheet rather than navigate, and once as `isMarketplaceSectionActive`, which
// decides which section a path belongs to. Both are ported here, and the section
// rule keeps the web's four special cases rather than prefix-matching everything:
// without them the catalog lights up on a member's own listings, because those
// still live under `/listings/`.
//
// This file holds NO rule about eligibility, permission, money or contract state.
// It is a route table read for presentation, which is why it sits with the router
// and not under `domain/` — Req 14.1 fixes that directory at eight rule modules.
//
// Requirements 4.5, 4.6, 4.11, 4.12, 4.15, 4.16.

import 'package:flutter/material.dart';

import 'router.dart';

/// The five Hub_Set entries, in the web's left-to-right order.
enum MobileHubId { browse, contracts, sell, inbox, account }

/// Whether selecting a hub navigates to one screen or opens a bottom sheet.
enum MobileHubKind { link, sheet }

/// One screen a hub can reach: the single screen of a `link` hub, or one row of
/// a `sheet` hub's list.
@immutable
class HubDestination {
  const HubDestination({
    required this.path,
    required this.label,
    required this.icon,
  });

  /// The route this row navigates to.
  final String path;

  /// Member-facing label, matching the web's wording for the same row.
  final String label;

  /// Decorative glyph. The row's label is what a screen reader announces.
  final IconData icon;
}

/// A Hub_Set entry.
@immutable
class MobileHub {
  const MobileHub({
    required this.id,
    required this.label,
    required this.icon,
    required this.kind,
    required this.requiresAuth,
    required this.destinations,
    required this.ownedSections,
    this.sheetTitle,
    this.sheetDescription,
  });

  final MobileHubId id;

  /// The label under the icon, at the `meta` level (Req 4.7).
  final String label;

  final IconData icon;

  /// Whether this entry navigates or opens a sheet (Req 4.5).
  final MobileHubKind kind;

  /// Whether a session is needed to use this entry. Declared per hub rather than
  /// inferred, because the bar is presented to a guest as well and "which of
  /// these five can a signed-out visitor use" is one product decision (Req 4.11).
  final bool requiresAuth;

  /// A `link` hub has exactly one; a `sheet` hub lists these in order (Req 4.6).
  final List<HubDestination> destinations;

  /// The section roots this hub owns for the purpose of marking itself current.
  ///
  /// Not derived from [destinations]: `Browse` owns seller profiles it never
  /// links to, and `Account` owns notifications and the watchlist (Req 4.15).
  final List<String> ownedSections;

  /// Sheet heading, for a `sheet` hub.
  final String? sheetTitle;

  /// Sheet supporting line, for a `sheet` hub.
  final String? sheetDescription;

  /// Where a guest who tapped this entry should land once signed in: the single
  /// screen of a navigating entry, and the FIRST listed destination of a sheet
  /// entry (Req 4.12). Their destination, not the page they were standing on —
  /// someone who taps `Inbox` wants the inbox once they are through.
  String get signInTarget => destinations.first.path;

  /// Whether this hub's section owns [location].
  bool owns(String location) =>
      ownedSections.any((section) => isHubSectionActive(location, section));
}

/// The Hub_Set, in order. `Contracts` and `Sell` open sheets; the other three
/// navigate to one screen each (Req 4.5).
///
/// The web's `Contracts` sheet carries a private-invite entry above its three
/// rows. It is omitted rather than shown inert, because that capability belongs
/// to `.kiro/specs/mobile-parity/` and a menu row that does nothing is worse
/// than an absent one (Req 4.6).
const List<MobileHub> kMobileHubs = <MobileHub>[
  MobileHub(
    id: MobileHubId.browse,
    label: 'Browse',
    icon: Icons.grid_view_outlined,
    kind: MobileHubKind.link,
    // The catalog is public, so this is the one entry a guest can use as-is.
    requiresAuth: false,
    destinations: <HubDestination>[
      HubDestination(
        path: AppRoutes.home,
        label: 'Browse All',
        icon: Icons.grid_view_outlined,
      ),
    ],
    ownedSections: <String>[AppRoutes.home, AppRoutes.sellers],
  ),
  MobileHub(
    id: MobileHubId.contracts,
    label: 'Contracts',
    icon: Icons.handshake_outlined,
    kind: MobileHubKind.sheet,
    requiresAuth: true,
    sheetTitle: 'Contracts',
    sheetDescription: 'Your purchases, sales and trades.',
    destinations: <HubDestination>[
      HubDestination(
        path: AppRoutes.purchases,
        label: 'Purchases',
        icon: Icons.shopping_bag_outlined,
      ),
      HubDestination(
        path: AppRoutes.sales,
        label: 'Sales',
        icon: Icons.sell_outlined,
      ),
      HubDestination(
        path: AppRoutes.trades,
        label: 'Trades',
        icon: Icons.repeat,
      ),
    ],
    ownedSections: <String>[
      AppRoutes.purchases,
      AppRoutes.sales,
      AppRoutes.trades,
    ],
  ),
  MobileHub(
    id: MobileHubId.sell,
    label: 'Sell',
    icon: Icons.inventory_2_outlined,
    kind: MobileHubKind.sheet,
    requiresAuth: true,
    sheetTitle: 'Selling',
    sheetDescription: 'Your listings and incoming offers.',
    destinations: <HubDestination>[
      HubDestination(
        path: AppRoutes.sell,
        label: 'Sell an item',
        icon: Icons.add_box_outlined,
      ),
      HubDestination(
        path: AppRoutes.myListings,
        label: 'My Listings',
        icon: Icons.local_offer_outlined,
      ),
      HubDestination(
        path: AppRoutes.offers,
        label: 'Offers',
        icon: Icons.payments_outlined,
      ),
    ],
    ownedSections: <String>[
      AppRoutes.sell,
      AppRoutes.myListings,
      AppRoutes.offers,
    ],
  ),
  MobileHub(
    id: MobileHubId.inbox,
    label: 'Inbox',
    icon: Icons.chat_bubble_outline,
    kind: MobileHubKind.link,
    requiresAuth: true,
    destinations: <HubDestination>[
      HubDestination(
        path: AppRoutes.messages,
        label: 'Inbox',
        icon: Icons.chat_bubble_outline,
      ),
    ],
    ownedSections: <String>[AppRoutes.messages],
  ),
  MobileHub(
    id: MobileHubId.account,
    label: 'Account',
    icon: Icons.person_outline,
    kind: MobileHubKind.link,
    requiresAuth: true,
    destinations: <HubDestination>[
      HubDestination(
        path: AppRoutes.profile,
        label: 'Account',
        icon: Icons.person_outline,
      ),
    ],
    ownedSections: <String>[
      AppRoutes.profile,
      AppRoutes.notifications,
      AppRoutes.saved,
      AppRoutes.staff,
    ],
  ),
];

/// The one Hub_Set entry whose section owns [location], or null when no entry
/// does.
///
/// Null rather than the first entry: a route nothing owns leaves every
/// destination in its not-current treatment, because marking `Browse` current on
/// a screen `Browse` cannot reach tells a member something untrue (Req 4.16).
MobileHub? currentHub(String location) {
  for (final MobileHub hub in kMobileHubs) {
    if (hub.owns(location)) return hub;
  }
  return null;
}

/// Where a guest's tap on [hub] should send them: sign-in, carrying that hub's
/// own destination as the post-sign-in target (Req 4.12).
String signInLocationFor(MobileHub hub) =>
    '${AppRoutes.signIn}?redirectTo=${Uri.encodeQueryComponent(hub.signInTarget)}';

/// Whether [location] belongs to the section rooted at [section].
///
/// The port of the web's `isMarketplaceSectionActive`, including its special
/// cases. Three of them exist because selling, editing and a member's own
/// inventory all live under `/listings/` beside the public detail pages, so a
/// plain prefix match would light up the catalog on every one of them.
bool isHubSectionActive(String location, String section) {
  final String path = _routePath(location);

  if (section == AppRoutes.home) {
    // The catalog owns the listing DETAIL pages and nothing else under
    // `/listings/`. Creating, editing and owning are the Sell section.
    if (path == AppRoutes.sell || _isOwnListingsPath(path)) return false;
    return path == AppRoutes.home || path.startsWith('$_listingsRoot/');
  }
  if (section == AppRoutes.sell) {
    // Exactly the create screen: `/listings/new/anything` is not a thing.
    return path == AppRoutes.sell;
  }
  if (section == AppRoutes.myListings) {
    // Editing a listing implies owning it, so it belongs here rather than to
    // the catalog.
    return _isOwnListingsPath(path);
  }
  return path == section || path.startsWith('$section/');
}

const String _listingsRoot = '/listings';

bool _isOwnListingsPath(String path) =>
    path == AppRoutes.myListings ||
    path.startsWith('${AppRoutes.myListings}/') ||
    path == AppRoutes.editListing ||
    path.startsWith('${AppRoutes.editListing}/');

/// The path part of a router location, without a query string or a trailing
/// slash, so that `/messages/` and `/messages?tab=1` are the same section as
/// `/messages`.
String _routePath(String location) {
  final int queryAt = location.indexOf('?');
  String path = queryAt == -1 ? location : location.substring(0, queryAt);
  final int fragmentAt = path.indexOf('#');
  if (fragmentAt != -1) path = path.substring(0, fragmentAt);
  if (path.length > 1 && path.endsWith('/')) {
    path = path.substring(0, path.length - 1);
  }
  return path;
}
