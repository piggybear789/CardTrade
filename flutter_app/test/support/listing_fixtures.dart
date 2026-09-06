// Fixture data and provider overrides for the listing card and listing detail
// tests, and for the listing golden CASES.
//
// FIXTURES ONLY, AND DELIBERATELY SO. Req 15.11 requires a golden to build from
// fixture data rather than a network or database read, and the same is true of a
// widget test that wants to mean something twice in a row. Every provider the
// listing surfaces read is overridden here with a value; nothing below reaches
// Supabase, so nothing below can pass or fail because of what is in the database
// this morning.
//
// The overrides stop at `currentUserProvider` rather than at the auth service:
// overriding the provider itself short-circuits the `authStateProvider` →
// `authServiceProvider` → `SupabaseService.instance` chain, which would otherwise
// throw in a test process where Supabase was never initialised.
//
// Requirements 5.10–5.12, 6.6, 6.9, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// Riverpod 3's curated `show` list omits Override; misc.dart is where it lives.
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:supabase_flutter/supabase_flutter.dart' show User;

import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/models/profile.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/providers/sales_provider.dart';
import 'package:cardtrade/providers/watchlist_provider.dart';

/// A fixed instant, so nothing a fixture renders depends on today's date.
final DateTime kFixtureInstant = DateTime.utc(2026, 1, 15, 9, 30);

/// The id of the member who owns every fixture listing.
const String kFixtureOwnerId = 'owner-1';

/// A signed-in member who is not the owner.
const String kFixtureBuyerId = 'buyer-1';

/// A photo path, so a cover draws the loading fill rather than the empty
/// treatment. It resolves to a URL that is never fetched: the widget tests below
/// never let an image request resolve, which is exactly the state Req 5.2 is
/// about.
const String kFixturePhotoPath = 'owner-1/charizard.jpg';

/// The fixture price, deliberately SHORT.
///
/// The test font has square glyph metrics, so a money string occupies far more
/// width here than in Plus Jakarta Sans — a hero price at a 2.0 text scale is
/// about 56 logical pixels PER CHARACTER against a 358-pixel content width. A
/// realistic four-figure price would therefore fail an overflow assertion for a
/// reason that does not exist on a device, which is the same trap
/// `a11y/text_scale_test.dart` records for field labels. Six characters is what
/// fits, so the fixture is six characters.
const int kFixturePriceCents = 4200;

/// A description of exactly [length] characters, none of them at the ends.
///
/// Built by padding rather than typed out, so the boundary in a test is the same
/// number the widget reads and not a hand-counted string that drifted.
///
/// The last character is forced to be non-whitespace. The widget measures the
/// TRIMMED length, so a generator that happened to cut the seed on a space would
/// hand a 201-character string to a 200-character assertion and read as the
/// boundary being wrong — which is what it did on the first run.
String descriptionOfLength(int length) {
  const String seed =
      'Charizard Holo 1st Edition, sleeved since pull, no whitening. ';
  final StringBuffer buffer = StringBuffer();
  while (buffer.length < length) {
    buffer.write(seed);
  }
  final String cut = buffer.toString().substring(0, length);
  final String body = cut.trimRight().length == length
      ? cut
      : '${cut.substring(0, length - 1)}.';
  assert(
    body.trim().length == length,
    'the fixture must be $length characters after trimming',
  );
  return body;
}

ItemSummary makeSummary({
  String id = 'item-1',
  String title = 'Charizard Holo 1st Edition',
  int fmvCents = kFixturePriceCents,
  String condition = 'Near Mint',
  String category = 'Pokémon',
  ListingKind listingKind = ListingKind.single,
  ItemStatus status = ItemStatus.available,
  List<String> imagePaths = const <String>[kFixturePhotoPath],
  bool sellerIdentityVerified = true,
  String? ownerDisplayName = 'CardMaster',
  DateTime? closedAt,
  int? coverWidthPx,
  int? coverHeightPx,
}) {
  return ItemSummary(
    id: id,
    title: title,
    fmvCents: fmvCents,
    condition: condition,
    category: category,
    listingKind: listingKind,
    status: status,
    imagePaths: imagePaths,
    sellerIdentityVerified: sellerIdentityVerified,
    ownerDisplayName: ownerDisplayName,
    closedAt: closedAt,
    coverWidthPx: coverWidthPx,
    coverHeightPx: coverHeightPx,
  );
}

Item makeItem({
  String id = 'item-1',
  String ownerId = kFixtureOwnerId,
  String title = 'Charizard Holo 1st Edition',
  String? description,
  String category = 'Pokémon',
  String condition = 'Near Mint',
  int fmvCents = kFixturePriceCents,
  ItemStatus status = ItemStatus.available,
  ListingKind listingKind = ListingKind.single,
  DateTime? closedAt,
  List<String> imagePaths = const <String>[kFixturePhotoPath],
  bool hidden = false,
  bool sellerIdentityVerified = true,
  String? locationLabel = 'Newtown, NSW',
}) {
  return Item(
    id: id,
    ownerId: ownerId,
    title: title,
    description: description ?? descriptionOfLength(120),
    category: category,
    condition: condition,
    fmvCents: fmvCents,
    status: status,
    listingKind: listingKind,
    closedAt: closedAt,
    imagePaths: imagePaths,
    hidden: hidden,
    sellerIdentityVerified: sellerIdentityVerified,
    locationLabel: locationLabel,
    createdAt: kFixtureInstant,
    updatedAt: kFixtureInstant,
  );
}

/// A seller as `public_profiles` reports them.
///
/// [identityCheckName] is the provider-verified legal name, and null is the
/// grandfathered case Req 6.4 covers — never a blank string standing in for one.
PublicProfile makeSeller({
  String id = kFixtureOwnerId,
  String displayName = 'CardMaster',
  String? identityCheckName = 'Jordan Alexis Reyes',
  double? rating = 4.8,
  int ratingCount = 24,
  String? regionCode = 'AU',
}) {
  return PublicProfile(
    id: id,
    displayName: displayName,
    rating: rating,
    ratingCount: ratingCount,
    isVerified: identityCheckName != null,
    regionCode: regionCode,
    identityCheckStatus: identityCheckName == null
        ? IdentityCheckStatus.none
        : IdentityCheckStatus.verified,
    identityCheckName: identityCheckName,
  );
}

/// The viewing member's own profile, which is where their trading region is read
/// from for the advisory region notice.
Profile makeViewer({
  String id = kFixtureBuyerId,
  String displayName = 'Sam',
  String? regionCode = 'AU',
}) {
  return Profile(
    id: id,
    displayName: displayName,
    contactEmail: 'sam@example.test',
    merchantStatus: MerchantStatus.none,
    regionCode: regionCode,
    identityCheckStatus: IdentityCheckStatus.verified,
    createdAt: kFixtureInstant,
    updatedAt: kFixtureInstant,
  );
}

CashSaleSummary makeContract({
  String id = 'sale-1',
  String itemId = 'item-1',
  String buyerId = kFixtureBuyerId,
  String sellerId = kFixtureOwnerId,
  CashSaleStatus status = CashSaleStatus.escrowHeld,
  int agreedPriceCents = kFixturePriceCents,
  String counterpartDisplayName = 'Sam',
}) {
  return CashSaleSummary(
    id: id,
    status: status,
    itemId: itemId,
    itemTitle: 'Charizard Holo 1st Edition',
    agreedPriceCents: agreedPriceCents,
    buyerId: buyerId,
    sellerId: sellerId,
    updatedAt: kFixtureInstant,
    counterpartDisplayName: counterpartDisplayName,
  );
}

/// A signed-in member, as far as `currentUserProvider` is concerned.
User makeUser(String id) => User(
      id: id,
      appMetadata: const <String, dynamic>{},
      userMetadata: const <String, dynamic>{},
      aud: 'authenticated',
      createdAt: kFixtureInstant.toIso8601String(),
    );

/// A profile notifier pinned to one value.
///
/// Overriding an AsyncNotifierProvider supplies a notifier FACTORY rather than a
/// value, so a fixed profile means subclassing and returning it from `build`.
class _FixedMyProfile extends MyProfileNotifier {
  _FixedMyProfile(this.profile);

  final Profile? profile;

  @override
  Future<Profile?> build() async => profile;
}

/// The watchlist service, present but unreachable.
///
/// Nothing in a render test toggles the watchlist, and a fake that silently
/// succeeded would let a test assert an optimistic update that never went
/// anywhere. Declared once, because Riverpod refuses the same provider overridden
/// twice in one container — which is what a per-item list would do.
Override get watchlistServiceOverride => watchlistServiceProvider.overrideWith(
      (ref) => throw UnimplementedError('no watchlist call in a render test'),
    );

List<Override> _perItemWatchOverrides(
  String itemId, {
  required bool watching,
  required int watchCount,
}) {
  return <Override>[
    isWatchingProvider(itemId).overrideWith((ref) => Future.value(watching)),
    watchCountProvider(itemId).overrideWith((ref) => Future.value(watchCount)),
  ];
}

/// Everything a [ListingCard] reads for ONE listing, so it renders without a
/// service.
List<Override> watchOverrides(
  String itemId, {
  bool watching = false,
  int watchCount = 0,
}) {
  return <Override>[
    watchlistServiceOverride,
    ..._perItemWatchOverrides(
      itemId,
      watching: watching,
      watchCount: watchCount,
    ),
  ];
}

/// The same, for a whole mosaic of listings.
List<Override> watchOverridesForAll(Iterable<String> itemIds) {
  return <Override>[
    watchlistServiceOverride,
    for (final String itemId in itemIds)
      ..._perItemWatchOverrides(itemId, watching: false, watchCount: 0),
  ];
}

/// Everything [ListingDetailScreen] reads, for one viewer looking at one listing.
///
/// [viewerId] null is a guest. A viewer equal to the item's `ownerId` is the
/// owner case, which is decided by the screen and not passed to it.
List<Override> listingDetailOverrides({
  required Item item,
  PublicProfile? seller,
  Profile? viewer,
  String? viewerId = kFixtureBuyerId,
  List<CashSaleSummary> mySales = const <CashSaleSummary>[],
  bool watching = false,
  int watchCount = 0,
}) {
  return <Override>[
    ...watchOverrides(item.id, watching: watching, watchCount: watchCount),
    itemDetailProvider(item.id).overrideWith((ref) => Future.value(item)),
    publicProfileProvider(item.ownerId).overrideWith(
      (ref) => Future.value(seller ?? makeSeller(id: item.ownerId)),
    ),
    myProfileProvider.overrideWith(() => _FixedMyProfile(viewer)),
    mySalesProvider.overrideWith((ref) => Future.value(mySales)),
    currentUserProvider
        .overrideWithValue(viewerId == null ? null : makeUser(viewerId)),
  ];
}

/// Wraps [child] in a scope carrying [overrides].
///
/// The scope gets a fresh key per call, because Riverpod refuses to UPDATE a
/// scope's override set — pumping a second fixture whose overrides name a
/// different item id would otherwise assert "tried to update the override of a
/// provider that was not overridden before" rather than rebuilding. A new key
/// remounts the scope, which is what a new fixture is.
Widget withOverrides(Widget child, List<Override> overrides) =>
    ProviderScope(key: UniqueKey(), overrides: overrides, child: child);
