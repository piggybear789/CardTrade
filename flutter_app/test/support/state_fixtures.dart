// Fixture profiles, list states and provider overrides for the Account hub and
// for the three server-data lists, and for the profile and state golden CASES.
//
// FIXTURES ONLY, for the reason recorded at the head of `listing_fixtures.dart`:
// Req 15.11 requires a golden to build from fixture data rather than a read, and
// a widget test that reaches a database means something different every morning.
//
// THE FOUR GATE COMBINATIONS ARE BUILT FROM COLUMNS, NOT FROM BOOLEANS ON THE
// SECTION. [makeAccountProfile] sets `identity_check_status` for step one and the
// `merchant_status` / `merchant_settlements_enabled` / `merchant_ref` trio for step
// two, and the screen then evaluates each through the port it already reads. A
// fixture that set the section's two flags directly would assert the section draws
// what it was told rather than that the two gates are read independently, which is
// the whole of Req 10.2.
//
// THE THREE LISTS ARE PUT INTO STATE BY THEIR OWN PROVIDER, likewise: a pending
// read for the loading state, a value of zero rows for the empty ones, and a thrown
// error for the two failures — one a fault, one a lost connection. Nothing here
// reaches Supabase and nothing here adds a request capability (Req 14.12).
//
// A LOADING FIXTURE LEAVES TIMERS RUNNING. `SkeletonGate` arms a 200 ms suppression
// timer and then a 500 ms floor timer, and the binding fails a test that ends with
// either pending. [disposeStateSurface] unmounts the tree so the gate cancels them,
// exactly as it would when a member leaves the screen.
//
// Requirements 10.2–10.9, 11.1–11.10, 13.13, 15.10, 15.11.

import 'dart:async';
import 'dart:io' show SocketException;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/conversation.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/models/profile.dart';
import 'package:cardtrade/models/trade.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/messages_provider.dart';
import 'package:cardtrade/providers/notifications_provider.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/providers/sales_provider.dart';
import 'package:cardtrade/providers/trades_provider.dart';
import 'package:cardtrade/widgets/common/load_state.dart';

import 'harness.dart';
import 'listing_fixtures.dart';
import 'message_fixtures.dart';

/// The merchant reference a payout-ready fixture carries.
///
/// A value, because `canReceiveFunds` needs one: the trio is the gate and a
/// fixture that set the two status columns and left the reference null would be
/// asserting a state the port calls unpayable.
const String kFixtureMerchantRef = 'merchant-ref-1';

/// The document-backed legal name a verified fixture carries.
const String kFixtureIdentityName = 'Jordan Alexis Reyes';

/// The member's own profile in one of the four gate combinations.
///
/// [identityPassed] writes step one's own column and [payoutPassed] writes step
/// two's own columns. Neither writes the other's: the pair being independent in
/// both directions is what Req 10.3 asks the section to present.
Profile makeAccountProfile({
  bool identityPassed = false,
  bool payoutPassed = false,
  String id = kFixtureBuyerId,
  String displayName = 'Sam',
  String? regionCode = 'AU',
  double? rating = 4.6,
  int ratingCount = 12,
}) {
  return Profile(
    id: id,
    displayName: displayName,
    contactEmail: 'sam@example.test',
    merchantRef: payoutPassed ? kFixtureMerchantRef : null,
    merchantStatus:
        payoutPassed ? MerchantStatus.approved : MerchantStatus.none,
    merchantSettlementsEnabled: payoutPassed,
    rating: rating,
    ratingCount: ratingCount,
    regionCode: regionCode,
    identityCheckStatus: identityPassed
        ? IdentityCheckStatus.verified
        : IdentityCheckStatus.none,
    identityCheckName: identityPassed ? kFixtureIdentityName : null,
    identityCheckVerifiedAt: identityPassed ? kFixtureInstant : null,
    createdAt: kFixtureInstant,
    updatedAt: kFixtureInstant,
  );
}

/// A trade as the contracts list reads it.
TradeSummary makeTradeSummary({
  String id = 'trade-1',
  TradeState state = TradeState.negotiating,
  String counterpartDisplayName = 'CardMaster',
}) {
  return TradeSummary(
    id: id,
    state: state,
    initiatorItemId: 'item-1',
    counterpartItemId: 'item-2',
    updatedAt: kFixtureInstant,
    initiatorItemTitle: 'Charizard Holo',
    counterpartItemTitle: 'Blastoise Holo',
    counterpartDisplayName: counterpartDisplayName,
  );
}

// ---------------------------------------------------------------------------
// Pinned notifiers.
//
// Overriding an AsyncNotifierProvider supplies a notifier FACTORY rather than a
// value, so each state means a subclass returning it from `build`.
// ---------------------------------------------------------------------------

class _FixedMyProfile extends MyProfileNotifier {
  _FixedMyProfile(this.profile);

  final Profile? profile;

  @override
  Future<Profile?> build() async => profile;
}

class _PendingMyProfile extends MyProfileNotifier {
  @override
  Future<Profile?> build() => Completer<Profile?>().future;
}

class _FailingMyProfile extends MyProfileNotifier {
  _FailingMyProfile(this.error);

  final Object error;

  @override
  Future<Profile?> build() async => throw error;
}

class _FixedCatalog extends CatalogNotifier {
  _FixedCatalog(this.items);

  final List<ItemSummary> items;

  @override
  Future<List<ItemSummary>> build() async => items;
}

class _PendingCatalog extends CatalogNotifier {
  @override
  Future<List<ItemSummary>> build() => Completer<List<ItemSummary>>().future;
}

class _FailingCatalog extends CatalogNotifier {
  _FailingCatalog(this.error);

  final Object error;

  @override
  Future<List<ItemSummary>> build() async => throw error;
}

class _FixedCatalogFilter extends CatalogFilterNotifier {
  _FixedCatalogFilter(this.filter);

  final CatalogFilter filter;

  @override
  CatalogFilter build() => filter;
}

/// A read that never settles, for a loading state.
Future<T> _pending<T>() => Completer<T>().future;

/// The two failures Req 11.4 and 11.10 separate.
///
/// The offline value is a real `SocketException`, because that is what the device
/// actually produces and because `RequestFailure` classifies from the type name and
/// the message. A stand-in string would let the classifier be wrong about the one
/// input it exists for. Its host is a fixture domain rather than the provider's, so
/// no fixture carries a provider name at all.
Object get fixtureFaultError => Exception('the read did not complete');
Object get fixtureOfflineError =>
    const SocketException('Failed host lookup: api.example.test');

/// Which of the five presentations a list is in (Req 11.7).
enum ListStateKind {
  /// The first read is still outstanding.
  loading,

  /// Zero rows, no filter or search term active (Req 11.3).
  empty,

  /// Zero rows with a search term active (Req 11.9). Catalog only — the contracts
  /// list and the inbox have no filter surface, and giving them one would be a new
  /// capability rather than a presentation change (Req 14.12).
  filteredEmpty,

  /// The read failed with a server fault.
  error,

  /// The read failed because the device has no connectivity (Req 11.10).
  offline,
}

/// Everything [MyProfileScreen] watches, for one member in one gate combination.
///
/// [countsLoading] leaves the three count reads outstanding, which is the state
/// Req 10.8 is about: a list that has not loaded must not draw a confident zero.
List<Override> accountOverrides({
  Profile? profile,
  bool profilePending = false,
  Object? profileError,
  bool countsLoading = false,
  int listings = 3,
  int trades = 2,
  int sales = 5,
  String? viewerId = kFixtureBuyerId,
}) {
  return <Override>[
    myProfileProvider.overrideWith(() {
      if (profilePending) return _PendingMyProfile();
      if (profileError != null) return _FailingMyProfile(profileError);
      return _FixedMyProfile(profile ?? makeAccountProfile());
    }),
    myListingsProvider.overrideWith(
      (ref) => countsLoading
          ? _pending<List<Item>>()
          : Future<List<Item>>.value(<Item>[
              for (int i = 0; i < listings; i++) makeItem(id: 'item-$i'),
            ]),
    ),
    myTradesProvider.overrideWith(
      (ref) => countsLoading
          ? _pending<List<TradeSummary>>()
          : Future<List<TradeSummary>>.value(<TradeSummary>[
              for (int i = 0; i < trades; i++) makeTradeSummary(id: 'trade-$i'),
            ]),
    ),
    mySalesProvider.overrideWith(
      (ref) => countsLoading
          ? _pending<List<CashSaleSummary>>()
          : Future<List<CashSaleSummary>>.value(<CashSaleSummary>[
              for (int i = 0; i < sales; i++) makeContract(id: 'sale-$i'),
            ]),
    ),
    currentUserProvider
        .overrideWithValue(viewerId == null ? null : makeUser(viewerId)),
  ];
}

/// Everything `CatalogScreen` watches, in one of its five states.
///
/// The notification count is overridden because the hub's floating control reads
/// it, and an un-overridden read of it constructs the Supabase client.
List<Override> catalogStateOverrides(ListStateKind kind) {
  return <Override>[
    catalogFilterProvider.overrideWith(
      () => _FixedCatalogFilter(
        kind == ListStateKind.filteredEmpty
            ? const CatalogFilter(searchQuery: 'charizard')
            : const CatalogFilter(),
      ),
    ),
    catalogProvider.overrideWith(() {
      switch (kind) {
        case ListStateKind.loading:
          return _PendingCatalog();
        case ListStateKind.empty:
        case ListStateKind.filteredEmpty:
          return _FixedCatalog(const <ItemSummary>[]);
        case ListStateKind.error:
          return _FailingCatalog(fixtureFaultError);
        case ListStateKind.offline:
          return _FailingCatalog(fixtureOfflineError);
      }
    }),
    unreadNotificationCountProvider.overrideWith((ref) => Future<int>.value(0)),
    currentUserProvider.overrideWithValue(makeUser(kFixtureBuyerId)),
  ];
}

/// Everything `TradesListScreen` watches, in one of its states.
List<Override> contractsStateOverrides(ListStateKind kind) {
  return <Override>[
    myTradesProvider.overrideWith((ref) => _listRead<TradeSummary>(kind)),
    currentUserProvider.overrideWithValue(makeUser(kFixtureBuyerId)),
  ];
}

/// Everything `ConversationsScreen` watches, in one of its states.
List<Override> inboxStateOverrides(ListStateKind kind) {
  return <Override>[
    conversationsProvider.overrideWith((ref) => _listRead<Conversation>(kind)),
    currentUserProvider.overrideWithValue(makeUser(kFixtureViewerId)),
  ];
}

/// One list read in the state [kind] describes.
Future<List<T>> _listRead<T>(ListStateKind kind) {
  switch (kind) {
    case ListStateKind.loading:
      return _pending<List<T>>();
    case ListStateKind.empty:
    case ListStateKind.filteredEmpty:
      return Future<List<T>>.value(<T>[]);
    case ListStateKind.error:
      return Future<List<T>>.error(fixtureFaultError);
    case ListStateKind.offline:
      return Future<List<T>>.error(fixtureOfflineError);
  }
}

/// How far past the request a state surface is pumped before it is measured.
///
/// Just past [SkeletonGate.suppressBelow], so a loading fixture is measured with
/// its placeholder on screen rather than inside the suppression window where there
/// is deliberately nothing to see. This is the "fixed point in the pulse cycle"
/// Req 11.7 asks for, held still by reduce-motion: the pulse holds at full opacity,
/// so the phase is a stated value rather than whenever the frame landed.
final Duration kSkeletonPhase =
    SkeletonGate.suppressBelow + const Duration(milliseconds: 50);

/// Pumps a profile or state surface at a fixed viewport, text scale and phase.
///
/// Deliberately not `pumpAndSettle`: a loading fixture never settles, which is the
/// point of it.
Future<void> pumpStateSurface(
  WidgetTester tester,
  Widget child, {
  required List<Override> overrides,
  double textScaleFactor = 1.0,
  Size surface = kPhoneViewport,
  bool scaffold = false,
  Duration? phase,
}) async {
  await setViewport(tester, surface);
  await tester.pumpWidget(
    withOverrides(
      pumpFixture(
        child,
        textScaleFactor: textScaleFactor,
        reduceMotion: true,
        scaffold: scaffold,
      ),
      overrides,
    ),
  );
  await tester.pump();
  await tester.pump();
  await tester.pump(phase ?? kSkeletonPhase);
}

/// Unmounts the surface so its gate cancels the timers it armed.
///
/// A loading fixture leaves the 500 ms floor timer running — on a device it is
/// cancelled when the member leaves the screen, and here that has to be done
/// explicitly or the binding fails the test for a timer the widget would have
/// cleaned up.
Future<void> disposeStateSurface(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump();
}
