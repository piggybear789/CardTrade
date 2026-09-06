/// Turns an incoming router location into the screen a received link opens.
///
/// `core/deep_link.dart` parses a `Uri` into a `DeepLinkTarget` and deliberately
/// stops there. This is the other half of task 4.4: which locations are
/// externally supplied at all, and which router location each target opens. Both
/// halves are pure functions, so a router test can assert a destination without a
/// device.
///
/// **Why the origin is restored before resolving.** Android's Flutter embedding
/// hands `go_router` the intent data's PATH, QUERY and FRAGMENT only — the scheme
/// and host are dropped before any Dart runs. `resolveDeepLink` requires them,
/// because an https link on a host that is not ours must never route (decision
/// D10). So the NoDitto origin is put back here: by the time the intent arrives
/// Android has already matched the verified intent-filter host, and a
/// custom-scheme link arrives host-stripped as well.
///
/// **Why not every location.** Running the resolver over ordinary in-app
/// navigation would normalise the query string away, and `/trades/new?itemId=…`
/// would lose its item. So only the two shapes this app never navigates to
/// ITSELF count as arrivals: the invite path, and a location carrying a return
/// marker. Every other unrecognised location is caught by the router's
/// `onException`, which is Req 4.6's silent catalog fallback.
///
/// This evaluates no Identity_Gate, no region, no bond and no fee. It maps a link
/// to a screen; the screen asks the server. It is not a tenth Advisory_Domain_Port
/// and must not become one.
///
/// Satisfies Req 4.3, 4.4, 4.5, 4.6, 4.7.
library;

import '../core/deep_link.dart';
import 'router.dart';

/// The origin restored onto an incoming location before it is resolved.
const String kDeepLinkOrigin = 'https://$kNoDittoHost';

/// A received link, resolved to the screen it opens.
final class DeepLinkArrival {
  const DeepLinkArrival({
    required this.location,
    required this.reReadsProfile,
  });

  /// The router location to open.
  final String location;

  /// Whether landing here must drop the cached profile and ask the server again.
  ///
  /// True for the identity and payout return markers (Req 4.4, 4.5). The marker
  /// is evidence that the member came back from somewhere and evidence of nothing
  /// else — a deep link is a query string an attacker can also send — so the
  /// screen it opens must not be drawn from a row read before the member left.
  final bool reReadsProfile;

  @override
  bool operator ==(Object other) =>
      other is DeepLinkArrival &&
      other.location == location &&
      other.reReadsProfile == reReadsProfile;

  @override
  int get hashCode => Object.hash(DeepLinkArrival, location, reReadsProfile);

  @override
  String toString() =>
      'DeepLinkArrival($location, reReadsProfile: $reReadsProfile)';
}

/// The arrival [location] describes, or null when it is ordinary navigation.
///
/// Never throws: an unreadable location is not an arrival, and the router leaves
/// it to the route table and to `onException`.
DeepLinkArrival? deepLinkArrival(Uri location) {
  try {
    if (!_looksExternallySupplied(location)) return null;
    final DeepLinkTarget target = resolveDeepLink(
      Uri.parse('$kDeepLinkOrigin$location'),
    );
    return DeepLinkArrival(
      location: locationForTarget(target),
      reReadsProfile:
          target is VerificationReturnTarget || target is PayoutReturnTarget,
    );
  } catch (_) {
    return null;
  }
}

/// The router location [target] opens.
///
/// Exhaustive over the sealed target set, so a screen added to the resolver
/// cannot be left unrouted.
String locationForTarget(DeepLinkTarget target) => switch (target) {
      // Req 4.3. The token is re-encoded because it travels as a path segment.
      InviteTarget(token: final String token) =>
        '${AppRoutes.invite}/${Uri.encodeComponent(token)}',

      // Req 4.4 and 4.5: a screen, never a state.
      VerificationReturnTarget() => AppRoutes.identity,

      // `refresh` is not read, and that is the point. It says which of Stripe's
      // two return URLs was used — the flow ended, or the single-use link
      // expired — and neither is a payout status. The screen offers another
      // onboarding link whenever the member is not yet payable, which covers the
      // refresh case without routing on it.
      PayoutReturnTarget() => AppRoutes.payouts,

      KnownRouteTarget(location: final String location) => location,

      // Req 4.6: the catalog, and nothing said about the link.
      CatalogFallbackTarget() => AppRoutes.home,
    };

/// Whether [location] has a shape this app never navigates to itself.
bool _looksExternallySupplied(Uri location) {
  final List<String> segments =
      location.pathSegments.where((String s) => s.isNotEmpty).toList();
  if (segments.isNotEmpty && segments.first == kInviteSegment) return true;

  final Map<String, String> query = location.queryParameters;
  return query.containsKey(kIdentityMarker) ||
      query.containsKey(kPayoutsMarker);
}
