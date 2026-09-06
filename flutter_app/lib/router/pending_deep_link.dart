/// Holds where a member was going when they were bounced to sign-in, so that
/// signing in resumes there instead of dropping them on the catalog.
///
/// Satisfies Req 4.7 for a received link, and incidentally for any protected
/// route: the redirect that retains the target is the SAME redirect that already
/// bounced an unauthenticated member, so there is one mechanism rather than a
/// second one for deep links. Before this, that redirect returned `signIn` and
/// the intended location was simply lost.
///
/// **Why a plain mutable holder rather than Riverpod state.** `routerProvider`
/// watches `isAuthenticatedProvider`, so the entire `GoRouter` is rebuilt the
/// moment a session appears — which is exactly the moment the retained target is
/// needed. A slot living in the router's own closure would be rebuilt with it and
/// the target lost. This provider depends on nothing, so it outlives every router
/// rebuild. And the slot is written from inside `redirect`, where publishing
/// notifier state would re-enter route resolution mid-navigation.
///
/// **One slot, cleared only when consumed.** The target survives any number of
/// intermediate hops between arrival and landing, which matters because the
/// route the member is sent to first is not always the route they end on. The
/// web sends a member with no `onboarding_completed_at` to `/onboarding` from
/// every protected route; this client declares no onboarding route and performs
/// no such hop, so there is nothing here to survive today — but an interstitial
/// added later cannot lose the target, because nothing clears the slot except
/// taking it.
///
/// This decides nothing about whether the member MAY go there. The redirect
/// re-applies its own auth gating to the resumed location, and every screen
/// still asks the server.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A single retained router location.
final class PendingDeepLink {
  String? _location;

  /// The retained location without consuming it, or null if there is none.
  String? get peek => _location;

  /// Retains [location], replacing any earlier one.
  ///
  /// Last write wins: if a member is bounced twice before signing in, the second
  /// thing they tried to open is the thing they are still trying to open. An
  /// empty location is not a destination and is ignored.
  void retain(String location) {
    if (location.isEmpty) return;
    _location = location;
  }

  /// Returns the retained location and empties the slot.
  String? take() {
    final String? location = _location;
    _location = null;
    return location;
  }

  /// Empties the slot without routing anywhere.
  void clear() => _location = null;
}

/// The one retained target for the life of the app.
///
/// Deliberately depends on no other provider, so nothing invalidates it. See the
/// library comment: a slot that is rebuilt with the router is a slot that is
/// empty when it is read.
final pendingDeepLinkProvider = Provider<PendingDeepLink>(
  (ref) => PendingDeepLink(),
);
