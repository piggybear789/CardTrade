/// Deep link resolution: an incoming [Uri] becomes a [DeepLinkTarget].
///
/// Satisfies Req 4.3 (a Deal_Invite link routes to the invite for its token),
/// Req 4.4 and Req 4.5 (the identity and payout return markers route to a
/// SCREEN and never to a STATE) and Req 4.6 (an unrecognised link opens the
/// catalog and says nothing about the link).
///
/// This file is a **link parser and nothing else**. It evaluates no
/// Identity_Gate, no region compatibility, no bond and no fee, so it is not a
/// ninth Advisory_Domain_Port under `lib/domain/` — there is no server rule
/// duplicated here to drift from. Keep it that way: the moment this decides
/// whether a member may do something rather than which screen they land on, it
/// becomes a second copy of a rule that must have exactly one definition.
///
/// It also adds no package (decision D7): `flutter_deeplinking_enabled` hands
/// the intent to `go_router`, and `go_router` hands the `Uri` here. Routing the
/// result is task 4.4's job and is deliberately not done in this file.
library;

/// The NoDitto https host (decision D10).
///
/// An https link on any OTHER host resolves to [CatalogFallbackTarget]. A deep
/// link is attacker-suppliable, so an unverified host must never drive routing:
/// `https://evil.example/t/TOKEN` is not a NoDitto invite.
const String kNoDittoHost = 'noditto.app';

/// The custom scheme reserved to NoDitto, used while App Link verification has
/// not completed.
const String kNoDittoScheme = 'noditto';

/// The path segment that introduces a Deal_Invite token: `/t/{token}`.
///
/// Matches `invitePath` in `lib/actions/dealInvites.ts`.
const String kInviteSegment = 't';

/// Top-level route prefixes the app is willing to route a deep link to.
///
/// **Why an allowlist rather than the router's own route list.** The routes are
/// declared inside the `routerProvider` closure in `lib/router/router.dart`, so
/// they are values built at runtime from a `ref` and are not enumerable at
/// compile time — nothing can read them from here without constructing a
/// `GoRouter`. So this is a conservative allowlist of the TOP-LEVEL prefixes
/// that closure declares, taken from the `AppRoutes` constants it paths itself
/// from, and `test/core/deep_link_test.dart` pins it against `AppRoutes` so the
/// two cannot drift apart silently.
///
/// Conservative in two directions: a prefix absent here degrades to the catalog
/// (Req 4.6) rather than to an error, and `AppRoutes.staff` (`/admin`) is
/// deliberately excluded because the Flutter client declares no route under it —
/// routing a link there would reach `go_router`'s error page, which is a worse
/// outcome than the catalog.
const Set<String> kKnownRoutePrefixes = <String>{
  'auth',
  'home',
  'listings',
  'trades',
  'sales',
  'purchases',
  'messages',
  'profile',
  'offers',
  'saved',
  'notifications',
  'sellers',
};

/// The query marker Stripe Identity appends on return.
const String kIdentityMarker = 'identity';

/// The query marker Stripe Connect onboarding appends on return.
const String kPayoutsMarker = 'payouts';

/// Refuse to parse an absurd link rather than walk it.
const int _kMaxUriLength = 2048;

/// Refuse a path with more segments than any real route has.
const int _kMaxPathSegments = 16;

/// Where a received link sends the member.
///
/// Sealed, so a caller that adds a screen cannot forget to route one of these.
sealed class DeepLinkTarget {
  const DeepLinkTarget();
}

/// Open the Deal_Invite identified by [token].
///
/// **Named [InviteTarget], not for the retired identifier.** `Deal` went with
/// migration 0055 and the Flutter retired-vocabulary guard refuses it in any
/// Dart identifier or string, because this client names things as strings and
/// once outlived that table by doing so. The prose above may say Deal_Invite —
/// the guard strips comments deliberately so the tree can document the
/// retirement — but the TYPE may not. This is a naming constraint only: the
/// type means exactly what a private-deal invite link means.
final class InviteTarget extends DeepLinkTarget {
  const InviteTarget(this.token);

  /// The invite token exactly as the link carried it, already percent-decoded.
  ///
  /// Never empty: a `/t/` link with no token resolves to
  /// [CatalogFallbackTarget] instead, because an invite screen holding `''`
  /// would render a not-found state for a link that was simply not an invite.
  final String token;

  @override
  bool operator ==(Object other) =>
      other is InviteTarget && other.token == token;

  @override
  int get hashCode => Object.hash(InviteTarget, token);

  @override
  String toString() => 'InviteTarget($token)';
}

/// Open the identity verification screen.
///
/// **A screen, never a status (Req 4.4).** This type carries no field at all,
/// which is the point: whatever `?identity=` said, the verification screen
/// re-reads Identity_Gate state from the server. A deep link is a query string
/// an attacker can also send, so `identity=complete` is evidence that the member
/// came back from somewhere and evidence of nothing else.
final class VerificationReturnTarget extends DeepLinkTarget {
  const VerificationReturnTarget();

  @override
  bool operator ==(Object other) => other is VerificationReturnTarget;

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() => 'VerificationReturnTarget()';
}

/// Open the payouts screen.
///
/// **A screen, never a status (Req 4.5).** There is no approved/enabled/complete
/// field here and there must never be one; the payouts screen re-reads payout
/// state from the server.
final class PayoutReturnTarget extends DeepLinkTarget {
  const PayoutReturnTarget({required this.refresh});

  /// Which SCREEN STATE Stripe returned to, **not** whether payouts are
  /// enabled.
  ///
  /// This is the distinction a future reader will get wrong, so: Stripe's hosted
  /// onboarding has two return URLs. It sends the member to the `refresh` URL
  /// when the single-use link it was following expired or was abandoned, and to
  /// the `return` URL when the flow ran to its end. Neither says the account was
  /// approved — "the flow finished" and "transfers are active" are different
  /// facts, and only `canReceiveFunds` on the server answers the second. So
  /// `refresh: true` means "offer another onboarding link", not "not yet
  /// verified", and `refresh: false` means "the flow ended", not "payouts are
  /// on".
  final bool refresh;

  @override
  bool operator ==(Object other) =>
      other is PayoutReturnTarget && other.refresh == refresh;

  @override
  int get hashCode => Object.hash(PayoutReturnTarget, refresh);

  @override
  String toString() => 'PayoutReturnTarget(refresh: $refresh)';
}

/// Open [location], a router location this app declares a route for.
final class KnownRouteTarget extends DeepLinkTarget {
  const KnownRouteTarget(this.location);

  /// A normalised router location: leading slash, no empty segments, no
  /// trailing slash, no query string.
  final String location;

  @override
  bool operator ==(Object other) =>
      other is KnownRouteTarget && other.location == location;

  @override
  int get hashCode => Object.hash(KnownRouteTarget, location);

  @override
  String toString() => 'KnownRouteTarget($location)';
}

/// Open the catalog and say nothing about the link (Req 4.6).
final class CatalogFallbackTarget extends DeepLinkTarget {
  const CatalogFallbackTarget();

  @override
  bool operator ==(Object other) => other is CatalogFallbackTarget;

  @override
  int get hashCode => runtimeType.hashCode;

  @override
  String toString() => 'CatalogFallbackTarget()';
}

/// Resolves [uri] to the screen it should open.
///
/// **Total.** Never throws and never returns null, for any [Uri] whatsoever.
/// Every unmatched, malformed, hostile or absurd link resolves to
/// [CatalogFallbackTarget] (Req 4.6). That is not defensive padding: this
/// function's whole input surface is supplied by whoever sent the member a link.
///
/// Accepts both transports — `https://noditto.app/...` and `noditto://...` — and
/// resolves them identically.
DeepLinkTarget resolveDeepLink(Uri uri) {
  try {
    return _resolve(uri);
  } catch (_) {
    // Totality is a contract, not a best effort. A `Uri` whose query cannot be
    // decoded, or whose shape no branch above anticipated, is a link that
    // matched no known route.
    return const CatalogFallbackTarget();
  }
}

DeepLinkTarget _resolve(Uri uri) {
  if (uri.toString().length > _kMaxUriLength) {
    return const CatalogFallbackTarget();
  }

  final List<String>? segments = _segmentsFor(uri);
  if (segments == null) return const CatalogFallbackTarget();
  if (segments.length > _kMaxPathSegments) {
    return const CatalogFallbackTarget();
  }

  // `/t/{token}` first: it is the most specific shape, and a token is a path
  // rather than a marker, so no query string can shadow it.
  if (segments.isNotEmpty && segments.first == kInviteSegment) {
    final String token = segments.length > 1 ? segments[1] : '';
    if (token.isEmpty) return const CatalogFallbackTarget();
    return InviteTarget(token);
  }

  final Map<String, String> query = _queryFor(uri);

  if (query.containsKey(kIdentityMarker)) {
    // The marker's VALUE is deliberately unread. See VerificationReturnTarget.
    return const VerificationReturnTarget();
  }
  if (query.containsKey(kPayoutsMarker)) {
    return query[kPayoutsMarker] == 'refresh'
        ? const PayoutReturnTarget(refresh: true)
        : const PayoutReturnTarget(refresh: false);
  }

  if (segments.isEmpty) return const CatalogFallbackTarget();
  if (!kKnownRoutePrefixes.contains(segments.first)) {
    return const CatalogFallbackTarget();
  }
  return KnownRouteTarget('/${segments.join('/')}');
}

/// The path segments [uri] should be matched on, or null if [uri] is not a
/// NoDitto link at all.
///
/// Empty segments are dropped, which is what makes a trailing slash, a doubled
/// slash and a bare `/` all behave as the same path.
List<String>? _segmentsFor(Uri uri) {
  final String scheme = uri.scheme.toLowerCase();
  final String host = uri.host.toLowerCase();

  if (scheme == 'https') {
    if (host != kNoDittoHost) return null;
    return _nonEmpty(uri.pathSegments);
  }

  if (scheme == kNoDittoScheme) {
    // Android delivers `noditto://t/ABC` with `t` as the URI AUTHORITY, not as
    // a path segment, while `noditto:///t/ABC` and `noditto:t/ABC` deliver it
    // as the first path segment. Prepending a non-empty host makes all three
    // shapes resolve identically.
    //
    // Note that a value arriving as the authority is lowercased by `Uri`, which
    // is why the invite token lives in the PATH of `noditto://t/{token}` and
    // never in the authority — a case-folded token would not round-trip.
    return _nonEmpty(<String>[
      if (host.isNotEmpty) host,
      ...uri.pathSegments,
    ]);
  }

  // Any other scheme, including plain `http`, is not a transport this app
  // claims. Neither intent-filter matches it, so nothing should route on it.
  return null;
}

List<String> _nonEmpty(Iterable<String> segments) =>
    segments.where((String s) => s.isNotEmpty).toList(growable: false);

/// [uri]'s query parameters, or an empty map if they cannot be decoded.
///
/// `Uri.queryParameters` throws on invalid percent-encoding, and an
/// undecodable query is a query that carries no marker.
Map<String, String> _queryFor(Uri uri) {
  try {
    return uri.queryParameters;
  } catch (_) {
    return const <String, String>{};
  }
}
