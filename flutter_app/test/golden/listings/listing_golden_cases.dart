// The listing golden CASES — catalog tiles and listing details — staged ahead of
// the harness that captures them.
//
// THIS FILE STILL HOLDS NO `matchesGoldenFile` CALL, for the reason recorded at the
// head of `test/golden/shell/shell_golden_cases.dart`: a case declares a name, a
// surface, the scales it is captured at and the tree to capture, and says nothing
// about pixels. `listing_golden_test.dart` walks this list through the harness and
// owns the references in `goldens/`; `listing_cases_test.dart` builds every case at
// every declared scale and asserts it lays out, which runs on every host unlike the
// comparison.
//
// The references were captured only after `test/golden/_harness/` existed to pin the
// designated host, the typeface, the device pixel ratio, the clock, the text-scale cap
// and the animations. An image taken before that would have to be re-baselined for a
// reason that is not a design change, which is the one thing Req 15.12 forbids.
//
// EVERY CASE IS FIXTURE-BUILT (Req 15.11): the detail cases pump the real screen
// over the provider overrides in `test/support/listing_fixtures.dart`, so no case
// reads Supabase and none of them can change because the database did.
//
// Requirements 5.10, 6.9, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/features/listings/screens/listing_detail_screen.dart';
import 'package:cardtrade/features/listings/widgets/listing_card.dart';
import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/models/profile.dart';

import 'package:flutter_riverpod/misc.dart' show Override;

import '../../support/listing_fixtures.dart';

/// The phone surface every listing golden is captured on.
const Size kListingGoldenSurface = Size(390, 844);

/// The width one tile occupies in the two-column mosaic at that surface.
const double kListingGoldenTileWidth = 186;

/// One golden case: a name, a surface, the text scales it is captured at, the
/// tree to capture, and the provider overrides it is captured over.
@immutable
class ListingGoldenCase {
  const ListingGoldenCase({
    required this.name,
    required this.build,
    required this.overrides,
    this.surface = kListingGoldenSurface,
    this.textScales = const <double>[1.0, 2.0],
    this.ownsScaffold = false,
  });

  /// File-name stem. The harness appends the scale, so `listing_card_binder`
  /// becomes `listing_card_binder@1.0x.png` and `…@2.0x.png`.
  ///
  /// Member-facing vocabulary, and never a retired word: the binder cases are
  /// named `binder` and not for the internal `SHOPFRONT` listing kind.
  final String name;

  /// The tree under test, built fresh per scale.
  final Widget Function() build;

  /// The fixture providers the case is built over.
  final List<Override> overrides;

  final Size surface;

  /// Req 13.13 pairs every state with a 2.0 twin at the same surface size.
  final List<double> textScales;

  /// Whether [build] brings its own `Scaffold` — a whole screen does.
  final bool ownsScaffold;
}

/// A tile as the mosaic draws it: one column's width, top-aligned.
Widget _tile(ItemSummary item) => Align(
      alignment: Alignment.topLeft,
      child: SizedBox(
        width: kListingGoldenTileWidth,
        child: ListingCard(item: item),
      ),
    );

ListingGoldenCase _cardCase(String name, ItemSummary item) => ListingGoldenCase(
      name: name,
      build: () => _tile(item),
      overrides: watchOverrides(item.id),
    );

ListingGoldenCase _detailCase(
  String name, {
  required Item item,
  PublicProfile? seller,
  Profile? viewer,
  String? viewerId = kFixtureBuyerId,
  List<CashSaleSummary> mySales = const <CashSaleSummary>[],
}) {
  return ListingGoldenCase(
    name: name,
    build: () => ListingDetailScreen(itemId: item.id),
    ownsScaffold: true,
    overrides: listingDetailOverrides(
      item: item,
      seller: seller,
      viewer: viewer ?? makeViewer(),
      viewerId: viewerId,
      mySales: mySales,
    ),
  );
}

/// The card states Req 5.10 requires: a single listing, a binder or bulk listing,
/// reserved, sold, and one with no photo.
final List<ListingGoldenCase> kListingCardGoldenCases = <ListingGoldenCase>[
  _cardCase(
    'listing_card_single',
    makeSummary(coverWidthPx: 630, coverHeightPx: 880),
  ),
  _cardCase(
    'listing_card_binder',
    makeSummary(
      id: 'item-binder',
      title: 'Base Set binder, commons and uncommons',
      listingKind: ListingKind.shopfront,
    ),
  ),
  _cardCase(
    'listing_card_reserved',
    makeSummary(id: 'item-reserved', status: ItemStatus.reserved),
  ),
  _cardCase(
    'listing_card_sold',
    makeSummary(id: 'item-sold', status: ItemStatus.sold),
  ),
  _cardCase(
    'listing_card_no_image',
    makeSummary(id: 'item-no-image', imagePaths: const <String>[]),
  ),
];

/// The detail states Req 6.9 requires: a single listing, a binder or bulk
/// listing, the owner's own view, a guest's, and a cross-region viewer's.
final List<ListingGoldenCase> kListingDetailGoldenCases = <ListingGoldenCase>[
  _detailCase('listing_detail_single', item: makeItem()),
  _detailCase(
    'listing_detail_binder',
    item: makeItem(
      title: 'Base Set binder, commons and uncommons',
      listingKind: ListingKind.shopfront,
    ),
  ),
  _detailCase(
    'listing_detail_owner',
    item: makeItem(),
    viewerId: kFixtureOwnerId,
    mySales: <CashSaleSummary>[makeContract()],
  ),
  _detailCase('listing_detail_guest', item: makeItem(), viewerId: null),
  _detailCase(
    'listing_detail_region_mismatch',
    item: makeItem(),
    seller: makeSeller(regionCode: 'NZ'),
    viewer: makeViewer(regionCode: 'AU'),
  ),
];

/// Every listing golden case, cards then details.
final List<ListingGoldenCase> kListingGoldenCases = <ListingGoldenCase>[
  ...kListingCardGoldenCases,
  ...kListingDetailGoldenCases,
];
